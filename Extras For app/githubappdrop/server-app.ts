// This file contains ONLY the Express app and its /api/* routes — no app.listen(),
// no static file serving, no Vite dev middleware. That's on purpose: this exact same
// app is reused by two very different runtimes:
//   - server.ts        -> a real long-running Node process (local dev, Cloud Run, etc.)
//   - netlify/functions/api.ts -> wrapped with serverless-http as a Netlify Function
// Netlify's static hosting never executes `node dist/server.cjs`, so if the Gemini/Groq
// routes only lived in server.ts, they simply would not exist once deployed there.
import dotenv from 'dotenv';
// Load env vars here, at the very top of THIS module, before anything below
// (like GROQ_KEYS) reads process.env. Doing it only in server.ts is too late:
// with `"type": "module"`, `import app from './server-app.js'` fully evaluates
// this whole file - including the GROQ_KEYS constant - before server.ts even
// reaches its own dotenv.config() calls, so GROQ_API_KEY was always undefined
// by the time GROQ_KEYS got built. Calling it here too closes that gap.
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

import express from 'express';
import path from 'path';
import fs from 'fs';
import { GoogleGenAI, Type } from '@google/genai';
import { generateDynamicFollowUpReply } from './src/utils/dynamicFollowUpResponses.js';
import { TONE_OUTPUT_SPEC } from './src/utils/toneRules.js';
import { analyzeSentiment, readDirectAnswer } from './src/utils/adaptiveEngine.js';
import { QUESTION_POOL } from './src/data/questions.js';
import {
  buildResearchBrief,
  buildSectionFormatRules,
  composeEmpatheticParagraph,
  composeNervousSystemParagraph,
  composePerspectiveShiftParagraph,
  detectResearchTheme,
  ResearchComposeInput,
  ResearchTheme,
  RetrievedPassage,
} from './src/utils/researchKnowledge.js';
import { retrievePassagesLexical, sanitizePassages, summarizeSources } from './src/utils/researchRetrieval.js';
import { DimensionInsight, DimensionInsightDraft, DimensionScore, AnswerRecord, RiskAssessment, SemanticAnalysis } from './src/types.js';
import {
  answersForCategory,
  buildDimensionSystemPrompt,
  buildDimensionUserPrompt,
  buildLocalDimensionInsight,
  buildSynthesisUserPrompt,
  finalizeInsight,
  mergeInsightDrafts,
  mergePassageLists,
  parseInsightDraft,
  retrieveDimensionPassages,
  DimensionPromptInput,
} from './src/utils/dimensionInsight.js';
import { translateBatch, parseTranslations, ModelCall } from './translate-service.js';
import { retrievePsycheCandidates, PsycheExample } from './src/utils/psycheDatasetServer.js';

const app = express();

// Mobile builds are served from Capacitor's local origin rather than the
// Vercel website origin. Allow those API calls while keeping credentials
// disabled (the app uses server-side API keys, not browser cookies).
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowed = !origin || [
    'https://neuroscope-mental-wellness.vercel.app',
    'capacitor://localhost',
    'http://localhost',
    'https://localhost',
  ].includes(origin);

  if (allowed && origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  next();
});

app.use(express.json({ limit: '10mb' }));

// Lazy initializer for Gemini client to comply with guidelines
let geminiClient: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  if (!process.env.GEMINI_API_KEY) return null;
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return geminiClient;
}

// Helper to execute Gemini generateContent with resilient model fallbacks.
// Remembers the model that last worked so a dead model isn't retried on every request.
let stickyGeminiModel: string | null = null;
async function generateGeminiContentWithFallback(
  ai: GoogleGenAI,
  params: {
    contents: any;
    config?: any;
    /** Chat-style calls: no "thinking" and a hard time limit, so replies come back quickly. */
    fast?: boolean;
    /** Per-model request timeout in ms (only used with `fast`). Default 20s. */
    timeoutMs?: number;
    /** Total time budget in ms across every model tried. When it runs out we stop
     * trying more models so the caller can fall back to another provider instead
     * of the user waiting on a chain of slow retries. */
    deadlineMs?: number;
  }
) {
  const candidateModels = [
    'gemini-3.8-flash',
    'gemini-2.5-flash',
    'gemini-flash-latest',
  ];
  const ordered = stickyGeminiModel
    ? [stickyGeminiModel, ...candidateModels.filter((m) => m !== stickyGeminiModel)]
    : candidateModels;

  const started = Date.now();
  let lastError: any = null;
  for (const model of ordered) {
    const remaining = params.deadlineMs != null ? params.deadlineMs - (Date.now() - started) : Infinity;
    if (remaining < 1500) break; // not enough time left for another attempt
    try {
      const perCall = Math.min(params.timeoutMs ?? 20000, remaining);
      const config = params.fast
        ? { ...params.config, thinkingConfig: thinkingFor(model), httpOptions: { timeout: perCall } }
        : params.config;
      const response = await ai.models.generateContent({ model, contents: params.contents, config });
      stickyGeminiModel = model;
      return { response, modelUsed: model };
    } catch (err: any) {
      lastError = err;
      const statusCode = err?.status || err?.code || (err?.message?.includes('503') ? 503 : null);
      console.warn(`Gemini model ${model} encountered error (status: ${statusCode || 'unknown'}), attempting next model...`, err?.message || err);
      // Continue to next fallback model
    }
  }
  throw lastError || new Error('Gemini time budget exhausted');
}

/* ------------------------------------------------------------------
 * Tone/emotion ASSESSMENT layer (distinct from the "solution" communication
 * layer below): a Groq-hosted LLM's own read of a check-in answer's tone and
 * dominant emotion, used as a THIRD, independently-reasoned signal alongside
 * the two on-device transformers (NeuroScope DistilBERT + RoBERTa) instead of
 * having the assessment rest on those two small fine-tuned models alone. See
 * `/api/tone-analysis` below and `ensembleThreeWaySentiment()` in
 * `src/utils/semanticEngine.ts`, which fuses all three readings together.
 * This is a SEPARATE Groq call from the one the "solution" routes
 * (`/api/feeling-solution` etc.) make further down this file — one Groq call
 * reads the user's emotional state, a different Groq call later drafts the
 * empathetic response/solution for it — but both go through the exact same
 * Groq -> Groq #2 -> Gemini -> local Phi fallback chain via
 * `callAIWithFallback()`, so this reader keeps working even if Groq itself is
 * down or rate-limited.
 * ------------------------------------------------------------------ */
const TONE_ANALYSIS_SYSTEM_PROMPT = `You are a precise tone-and-emotion classifier embedded in a mental-health check-in app. You are run as the PRIMARY reader in a three-way ensemble alongside this app's own fine-tuned NeuroScope DistilBERT model and a RoBERTa sentiment model — your reading carries the majority weight of the three — but you must classify into the EXACT SAME taxonomy those two tuned models use, so your vote stays directly comparable to theirs rather than freelancing a different scale. Given one short piece of user-written text, read its emotional tone the way a careful clinician would: pay attention to negation ("not fine" vs "fine"), hedging, sarcasm, intensity words, and passive/indirect distress language, not just surface-level keywords.

${TONE_OUTPUT_SPEC}`;

// Best-effort JSON parse for the Groq tone-analysis reply: strips a stray
// ```json fence if a model ignores the "JSON only" instruction, and falls
// back to a neutral/zero reading rather than throwing, since this route is a
// supplementary ensemble signal, not the safety-critical path.
function parseToneAnalysisReply(raw: string): {
  label: 'severe' | 'distressed' | 'neutral' | 'calm';
  score: number;
  magnitude: number;
  topEmotion: string;
  rationale?: string;
} {
  const cleaned = raw.replace(/```json|```/g, '').trim();
  const parsed = JSON.parse(cleaned);
  const label: 'severe' | 'distressed' | 'neutral' | 'calm' = ['severe', 'distressed', 'neutral', 'calm'].includes(
    parsed?.label
  )
    ? parsed.label
    : 'neutral';
  const score = Math.max(-1, Math.min(1, Number(parsed?.score)));
  const magnitude = Math.max(0, Math.min(1, Number(parsed?.magnitude)));
  const topEmotion =
    typeof parsed?.topEmotion === 'string' && parsed.topEmotion.trim() ? parsed.topEmotion.trim() : 'neutral';
  return {
    label,
    score: Number.isFinite(score) ? score : 0,
    magnitude: Number.isFinite(magnitude) ? magnitude : 0,
    topEmotion,
    rationale: typeof parsed?.rationale === 'string' ? parsed.rationale.slice(0, 200) : undefined,
  };
}

/* ------------------------------------------------------------------
 * Two INDEPENDENT Groq key pools, each with its own two-key fallback,
 * so heavy traffic on one job never starves the other's rate limit —
 * this is the fix for the tone chip silently staying on NeuroScope-only:
 * previously ALL FIVE routes (tone-analysis + the four solution routes)
 * shared one two-key pool, so a burst of solution-drafting calls could
 * exhaust both keys right before a live tone-analysis call needed them.
 *
 *   TONE pool  (GROQ_API_KEY,   GROQ_API_KEY_2)   — assessment layer only.
 *   COMM pool  (GROQ_API_KEY_3, GROQ_API_KEY_4)   — communication layer only.
 *
 * Full priority order for each pool, in `callAIWithFallback()` below:
 *   1. Groq  (pool key #1)      — primary. Fast, cheap, generous free tier.
 *   2. Groq  (pool key #2)      — a second Groq account/key, used only once
 *                                  the primary key errors out or is rate-limited.
 *   3. Gemini (GEMINI_API_KEY)  — used only once BOTH pool keys have failed.
 *      Shared between both pools — there's no reason to split it, and it's
 *      only ever reached after Groq has already failed twice.
 *   4. Phi-4-mini, running locally on the operator's own PC (e.g. via Ollama
 *      or LM Studio's OpenAI-compatible server) — the last-resort rung for
 *      the COMMUNICATION pool only, so a reply is still produced even with
 *      zero cloud providers reachable. The tone-analysis route deliberately
 *      skips this rung (see its handler) to stay fast during a live assessment.
 * Every AI-backed route calls `callAIWithFallback()` below instead of any
 * provider directly, so this order (and the "never fails" guarantee) is
 * enforced in exactly one place.
 * ------------------------------------------------------------------ */

// Assessment pool: reads tone/emotion for /api/tone-analysis, the third
// member of the NeuroScope DistilBERT x RoBERTa x Groq ensemble. Dedicated
// so it's never starved by solution-drafting traffic on the pool below.
const TONE_GROQ_KEYS: string[] = [process.env.GROQ_API_KEY, process.env.GROQ_API_KEY_2].filter(
  (k): k is string => !!k && k.trim().length > 0
);

// Communication pool: drafts the empathetic response/solution for
// /api/assess, /api/feeling-solution, /api/reassess, /api/solution-followup,
// /api/dimension-insight. Dedicated so heavy solution traffic never eats
// into the tone pool's rate limit above.
const COMM_GROQ_KEYS: string[] = [process.env.GROQ_API_KEY_3, process.env.GROQ_API_KEY_4].filter(
  (k): k is string => !!k && k.trim().length > 0
);

// Combined, de-duplicated view — used only for aggregate reporting
// (e.g. "is Groq configured at all") where the pool split doesn't matter.
const GROQ_KEYS: string[] = Array.from(new Set([...TONE_GROQ_KEYS, ...COMM_GROQ_KEYS]));

// Local Phi-4-mini server on the operator's own machine. Point this at any
// OpenAI-compatible chat-completions endpoint serving Phi-4-mini — Ollama
// (`ollama pull phi4-mini`, served at :11434) and LM Studio (:1234) both
// work out of the box. Set LOCAL_LLM_ENABLED=false to disable this rung
// entirely (e.g. on a server deployment with no local model available).
const LOCAL_LLM_URL = process.env.LOCAL_LLM_URL || 'http://localhost:11434/v1/chat/completions';
const LOCAL_LLM_MODEL = process.env.LOCAL_LLM_MODEL || 'phi4-mini';
const LOCAL_LLM_ENABLED = process.env.LOCAL_LLM_ENABLED !== 'false';

// Detects a rate-limit / quota response so the caller can log something more
// useful than a generic failure when a Groq key is exhausted.
function isRateLimitError(err: any): boolean {
  const status = err?.status || err?.code;
  const msg = String(err?.message || err || '');
  return status === 429 || /rate limit|quota|too many requests/i.test(msg);
}

// Groq API caller utility — talks to ONE specific Groq key, trying each
// candidate model in turn until one answers or the time budget runs out.
async function callGroqAPI(
  prompt: string,
  systemPrompt: string,
  temperature = 0.6,
  json = true,                                            // false => plain-text chat reply
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  opts: { timeoutMs?: number; deadlineMs?: number } = {},
  apiKey?: string
) {
  const groqKey = apiKey || GROQ_KEYS[0];
  if (!groqKey) {
    throw new Error('GROQ_API_KEY is not set');
  }

  // Groq periodically decommissions models (see console.groq.com/docs/deprecations
  // - it has already happened twice to this file: mixtral-8x7b-32768/llama3-70b-8192,
  // then llama-3.3-70b-versatile). Rather than hard-code a list that WILL go stale
  // again, read it from GROQ_MODELS (comma-separated, in preference order) so a
  // future deprecation can be fixed by editing .env and restarting - no redeploy.
  // Falls back to the current (Sep 2026) recommended models if unset.
  const candidateModels = (process.env.GROQ_MODELS || 'openai/gpt-oss-120b,qwen/qwen3.6-27b,openai/gpt-oss-20b')
    .split(',')
    .map((m) => m.trim())
    .filter(Boolean);

  let lastError: any = null;
  const groqStarted = Date.now();
  for (const model of candidateModels) {
    const remaining = opts.deadlineMs != null ? opts.deadlineMs - (Date.now() - groqStarted) : Infinity;
    if (remaining < 1200) break;
    try {
      const perCall = Math.min(opts.timeoutMs ?? 30000, remaining);
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        signal: AbortSignal.timeout(perCall),
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${groqKey}`,
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            ...history,
            { role: 'user', content: prompt },
          ],
          ...(json ? { response_format: { type: 'json_object' } } : {}),
          temperature,
          // openai/gpt-oss-* and qwen3.6 are reasoning models: they spend part
          // of their output budget "thinking" before writing the final answer.
          // Without these, a low default cap gets used up by reasoning tokens
          // before any JSON is emitted, which Groq reports as
          // "max completion tokens reached before generating a valid document".
          max_completion_tokens: 8192,
          reasoning_effort: 'low',
        }),
      });

      if (!res.ok) {
        const errorText = await res.text();
        const err: any = new Error(`Groq API error (${res.status}) on model ${model}: ${errorText}`);
        err.status = res.status;
        throw err;
      }

      const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      return data.choices?.[0]?.message?.content || '{}';
    } catch (err: any) {
      lastError = err;
      // A rate-limit on THIS model/key is worth trying the next model for
      // (Groq rate-limits are often per-model), but it's also the strongest
      // signal to hand off to the next key/provider soon.
      const msg = String(err?.message || err || '');
      if (/model_decommissioned|does not exist or you do not have access/i.test(msg)) {
        console.warn(
          `[ACTION NEEDED] Groq model "${model}" is decommissioned/unavailable. ` +
          `Check https://console.groq.com/docs/deprecations for the current replacement ` +
          `and update the GROQ_MODELS env var (or restart to pick up the new default).`
        );
      } else {
        console.warn(`Groq model ${model} failed${isRateLimitError(err) ? ' (rate limited)' : ''}, checking next fallback:`, msg);
      }
    }
  }

  throw lastError || new Error('Groq time budget exhausted');
}

// Tries each configured Groq key in a given pool, in order (pool key #1,
// then pool key #2), moving to the next key the moment one errors out or is
// rate-limited. `keys` is whichever pool (TONE_GROQ_KEYS or COMM_GROQ_KEYS)
// the caller is working through — see `callAIWithFallback`'s `pool` param.
async function callGroqWithKeyFallback(
  prompt: string,
  systemPrompt: string,
  temperature: number,
  json: boolean,
  history: Array<{ role: 'user' | 'assistant'; content: string }>,
  opts: { timeoutMs?: number; deadlineMs?: number },
  keys: string[]
): Promise<{ text: string; providerUsed: 'groq' | 'groq2' }> {
  let lastError: any = null;
  for (let i = 0; i < keys.length; i++) {
    try {
      const text = await callGroqAPI(prompt, systemPrompt, temperature, json, history, opts, keys[i]);
      return { text, providerUsed: i === 0 ? 'groq' : 'groq2' };
    } catch (err) {
      lastError = err;
      const hasNext = i < keys.length - 1;
      console.warn(
        `Groq key #${i + 1}${isRateLimitError(err) ? ' hit its rate limit' : ' failed'}${hasNext ? ', trying next Groq key in this pool...' : ', no more Groq keys configured in this pool'}`,
      );
    }
  }
  throw lastError || new Error('No Groq API key configured for this pool');
}

// Calls Phi-4-mini running locally (Ollama / LM Studio / any OpenAI-compatible
// server) on the operator's own PC. This is the final rung of the fallback
// chain: it only runs once Groq (both keys) and Gemini have all failed.
async function callLocalPhiAPI(
  prompt: string,
  systemPrompt: string,
  temperature = 0.6,
  json = true,
  history: Array<{ role: 'user' | 'assistant'; content: string }> = [],
  opts: { timeoutMs?: number } = {}
): Promise<string> {
  if (!LOCAL_LLM_ENABLED) {
    throw new Error('Local Phi-4-mini fallback is disabled (LOCAL_LLM_ENABLED=false)');
  }
  try {
    const res = await fetch(LOCAL_LLM_URL, {
      signal: AbortSignal.timeout(opts.timeoutMs ?? 45000),
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: LOCAL_LLM_MODEL,
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: prompt },
        ],
        ...(json ? { response_format: { type: 'json_object' } } : {}),
        temperature,
      }),
    });

    if (!res.ok) {
      const errorText = await res.text().catch(() => '');
      throw new Error(`Local Phi-4-mini error (${res.status}): ${errorText}`);
    }

    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content || '{}';
  } catch (err: any) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(`Local Phi-4-mini at ${LOCAL_LLM_URL} timed out — is it running?`);
    }
    if (err?.cause?.code === 'ECONNREFUSED' || /ECONNREFUSED|fetch failed/i.test(String(err?.message))) {
      throw new Error(`Could not reach local Phi-4-mini at ${LOCAL_LLM_URL} — start Ollama/LM Studio with the phi4-mini model loaded, or set LOCAL_LLM_URL.`);
    }
    throw err;
  }
}

/**
 * THE single communication entry point every AI-backed route below should
 * use. Walks the full fallback chain — Groq (primary key) → Groq (secondary
 * key) → Gemini → local Phi-4-mini — and returns as soon as one provider
 * answers. Only throws once every single rung has failed, at which point the
 * caller falls back to NeuroScope's own local/deterministic engine so the
 * user still always gets a response.
 *
 * `geminiContents` / `geminiSchema` let a call site give Gemini its own
 * phrasing and a strict `responseSchema` (Gemini supports structured output
 * natively); Groq and the local model instead rely on `prompt` itself asking
 * for JSON, which is why most call sites pass a prompt that already spells
 * out the exact JSON shape they need.
 *
 * `pool` picks which of the two independent Groq key pools this call draws
 * from (see the block above `TONE_GROQ_KEYS`/`COMM_GROQ_KEYS`):
 *   - 'tone'          — the assessment layer (`/api/tone-analysis` only).
 *   - 'communication' — everything else (the default, so existing call
 *                        sites that don't pass `pool` are unaffected).
 */
async function callAIWithFallback(params: {
  prompt: string;
  systemPrompt: string;
  temperature?: number;
  json?: boolean;
  history?: Array<{ role: 'user' | 'assistant'; content: string }>;
  timeoutMs?: number;
  deadlineMs?: number;
  geminiContents?: any;
  geminiSchema?: any;
  /** Which Groq key pool to draw from. Defaults to 'communication'. */
  pool?: 'tone' | 'communication';
  /** Skip specific rungs, e.g. when a route explicitly asked for one provider. */
  skip?: Array<'groq' | 'gemini' | 'local'>;
}): Promise<{ text: string; providerUsed: 'groq' | 'groq2' | 'gemini' | 'local' }> {
  const {
    prompt,
    systemPrompt,
    temperature = 0.6,
    json = true,
    history = [],
    timeoutMs,
    deadlineMs,
    geminiContents,
    geminiSchema,
    pool = 'communication',
    skip = [],
  } = params;

  const groqKeys = pool === 'tone' ? TONE_GROQ_KEYS : COMM_GROQ_KEYS;
  const poolLabel = pool === 'tone' ? 'tone-analysis' : 'communication';

  // 1 + 2. Groq — this pool's primary key, then its secondary key.
  if (!skip.includes('groq') && groqKeys.length) {
    try {
      return await callGroqWithKeyFallback(prompt, systemPrompt, temperature, json, history, { timeoutMs, deadlineMs }, groqKeys);
    } catch (err) {
      console.warn(`Both Groq keys in the ${poolLabel} pool exhausted/failed, falling back to Gemini:`, (err as any)?.message || err);
    }
  }

  // 3. Gemini.
  if (!skip.includes('gemini') && process.env.GEMINI_API_KEY) {
    try {
      const ai = getGeminiClient();
      if (ai) {
        const contents =
          geminiContents ??
          [
            ...history.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            { role: 'user', parts: [{ text: prompt }] },
          ];
        const config: any = { systemInstruction: systemPrompt, temperature };
        if (json) {
          config.responseMimeType = 'application/json';
          if (geminiSchema) config.responseSchema = geminiSchema;
        }
        const { response } = await generateGeminiContentWithFallback(ai, {
          fast: true,
          timeoutMs: timeoutMs ?? 20000,
          deadlineMs: deadlineMs ?? 22000,
          contents,
          config,
        });
        const text = response.text || '';
        if (text) return { text, providerUsed: 'gemini' };
        throw new Error('Gemini returned an empty response');
      }
    } catch (err) {
      console.warn('Gemini failed, falling back to local Phi-4-mini:', (err as any)?.message || err);
    }
  }

  // 4. Local Phi-4-mini — the last rung, so communication never fully fails.
  if (!skip.includes('local') && LOCAL_LLM_ENABLED) {
    const text = await callLocalPhiAPI(prompt, systemPrompt, temperature, json, history, { timeoutMs: timeoutMs ?? 45000 });
    return { text, providerUsed: 'local' };
  }

  throw new Error(`All AI providers for the ${poolLabel} pool (Groq ×2, Gemini, local Phi-4-mini) are unavailable or unconfigured`);
}


/* ------------------------------------------------------------------
 * Multilingual layer: 40 Indian + 100 international languages.
 * ------------------------------------------------------------------ */

/** Appended to every AI system instruction so answers arrive natively translated. */
function langDirective(req: any): string {
  const lang = req?.body?.language;
  if (!lang || lang === 'English') return '';
  return `\n\nCRITICAL LANGUAGE REQUIREMENT: The user has selected "${lang}".
Write EVERY human-readable string value in your response entirely in ${lang}, using that language's native script.
Keep all JSON keys, enum values (e.g. 'optimal' | 'mild' | 'moderate' | 'high' | 'critical', interactiveToolType / interactiveTool.type identifiers) and any 'id' fields in English EXACTLY as specified — only the prose changes.
Use natural, warm, culturally respectful ${lang} as a caring local clinician would speak it, never a literal word-for-word translation. Clinical or neuroscience terms with no common equivalent may keep the English term in brackets after the ${lang} phrasing.`;
}

// Translation: shared cache + batching lives in translate-service.ts.
const TRANSLATE_MODELS = (process.env.TRANSLATE_MODELS || 'gemini-3.8-flash,gemini-2.5-flash,gemini-flash-latest')
  .split(',').map((s) => s.trim()).filter(Boolean);
let stickyModel: string | null = null; // remember the model that last worked — no repeated failed attempts

// Translation needs no reasoning: disabling "thinking" cuts latency and token spend sharply.
function thinkingFor(model: string): any {
  if (/gemini-2\.5/.test(model)) return { thinkingBudget: 0 };
  if (/gemini-3/.test(model)) return { thinkingLevel: 'minimal' };
  return undefined;
}

const translateSystem = (language: string, wrapped: boolean) =>
  `Translate each UI string of a mental-health app into ${language} (native script). ` +
  `Respond with ${wrapped ? 'a JSON object of the form {"translations":["..."]}' : 'a JSON array of strings'} containing EXACTLY as many strings as the input JSON array, same order. ` +
  `Keep emojis, numbers, punctuation, spacing, {placeholders} and brand names (NeuroScope, Gemini, Groq, WhatsApp, DBT, TIPP) unchanged. ` +
  `Return pure numbers/symbols/acronyms as-is. Warm, natural, non-stigmatising tone. No commentary.`;

/* Keyless fallback: Google's public translate endpoint. Used when no Gemini/Groq
 * key is configured (local dev) or when those providers fail/quota out, so the
 * language switcher never silently does nothing. One request per string keeps
 * input/output alignment guaranteed; a small pool caps parallelism. */
const GOOGLE_LEGACY_CODES: Record<string, string> = { he: 'iw', id: 'in', yi: 'ji', jv: 'jw' };
const googleLangCode = (code: string) => {
  const base = String(code || '').split('-')[0].toLowerCase();
  return GOOGLE_LEGACY_CODES[base] || String(code || 'en');
};

async function googleTranslateOne(text: string, langCode: string): Promise<string | null> {
  const tl = googleLangCode(langCode);
  const url =
    'https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=' +
    encodeURIComponent(tl) + '&dt=t&q=' + encodeURIComponent(text);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctl.signal });
    if (!res.ok) return null;
    const data: any = await res.json();
    const out = Array.isArray(data?.[0])
      ? data[0].map((seg: any) => (typeof seg?.[0] === 'string' ? seg[0] : '')).join('')
      : '';
    return out.trim() ? out : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

const GOOGLE_POOL = 6;
const googleFallbackCall: ModelCall = async (strings, _language, langCode) => {
  const code = langCode || 'en';
  const out: Array<string | null> = new Array(strings.length).fill(null);
  let i = 0;
  async function worker() {
    while (i < strings.length) {
      const idx = i++;
      out[idx] = await googleTranslateOne(strings[idx], code);
    }
  }
  await Promise.all(Array.from({ length: Math.min(GOOGLE_POOL, strings.length) }, worker));
  // Only accept the batch if EVERY string translated, so a partial network
  // failure returns null (caller retries) instead of caching gaps as English.
  return out.every((v) => typeof v === 'string' && v!.trim()) ? (out as string[]) : null;
};

const translateModelCall: ModelCall = async (strings, language, langCode) => {
  const payload = JSON.stringify(strings);

  // Groq (primary key, then secondary key) first. Translation isn't part of
  // either the tone or communication ensemble, so it draws from the full
  // combined pool (all configured keys across both) for maximum resilience.
  if (GROQ_KEYS.length) {
    try {
      const { text } = await callGroqWithKeyFallback(payload, translateSystem(language, true), 0.1, true, [], {}, GROQ_KEYS);
      const parsed = parseTranslations(text);
      if (parsed) return parsed;
    } catch (err) {
      console.warn('Translate: Groq (both keys) failed, trying Gemini:', err);
    }
  }

  const ai = process.env.GEMINI_API_KEY ? getGeminiClient() : null;
  if (ai) {
    const order = stickyModel
      ? [stickyModel, ...TRANSLATE_MODELS.filter((m) => m !== stickyModel)]
      : TRANSLATE_MODELS;
    for (const model of order) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: payload,
          config: {
            systemInstruction: translateSystem(language, false),
            temperature: 0.1,
            responseMimeType: 'application/json',
            responseSchema: { type: Type.ARRAY, items: { type: Type.STRING } },
            thinkingConfig: thinkingFor(model),
            httpOptions: { timeout: 15000 },
          },
        });
        const parsed = parseTranslations(response.text || '');
        if (parsed) { stickyModel = model; return parsed; }
      } catch (err: any) {
        console.warn(`Translate: ${model} failed (${err?.status || err?.code || 'error'}), trying next`);
      }
    }
  }

  // Local Phi-4-mini, running on the operator's own PC.
  if (LOCAL_LLM_ENABLED) {
    try {
      const parsed = parseTranslations(await callLocalPhiAPI(payload, translateSystem(language, true), 0.1));
      if (parsed) return parsed;
    } catch (err) {
      console.warn('Translate: local Phi-4-mini failed:', err);
    }
  }

  // Last resort: keyless web translate. Never throws — returns null on failure
  // so translate-service reports the gap and the client retries shortly.
  return googleFallbackCall(strings, language, langCode);
};

/**
 * Batch UI/content translation endpoint. `translations[i]` is the translation of
 * `texts[i]`, or null if it could not be translated right now (client retries, never caches).
 */
app.post('/api/translate', async (req, res) => {
  const { texts, targetLanguage, targetLang } = req.body || {};
  if (!Array.isArray(texts) || texts.length === 0 || texts.length > 300) {
    return res.status(400).json({ error: 'texts must be a non-empty array (max 300)' });
  }
  const list: string[] = texts.map((t: any) => String(t ?? '').slice(0, 4000));
  if (!targetLanguage || !targetLang || targetLang === 'en') {
    return res.json({ translations: list });
  }
  // No early "unavailable" bail-out: translateModelCall now always has the
  // keyless Google fallback, so translation works even without a premium key.
  const translations = await translateBatch(list, String(targetLang), String(targetLanguage), translateModelCall);
  return res.json({ translations });
});

// Exposes the supported-language count for diagnostics.
app.get('/api/languages', (req, res) => {
  res.json({
    indian: 40,
    international: 100,
    total: 140,
    // Always true now: the keyless Google fallback translates even without a premium key.
    translationReady: true,
    premiumProvider: !!(GROQ_KEYS.length || process.env.GEMINI_API_KEY || LOCAL_LLM_ENABLED),
  });
});

// Health endpoint
app.get('/api/psyche-examples', (req, res) => {
  const query = typeof req.query.query === 'string' ? req.query.query.trim() : '';
  if (!query) return res.json({ examples: [] });
  const category = typeof req.query.category === 'string' ? req.query.category : undefined;
  const riskLevel = typeof req.query.riskLevel === 'string' ? req.query.riskLevel : undefined;
  const emotion = typeof req.query.emotion === 'string' ? req.query.emotion : undefined;
  const limit = Math.min(60, Math.max(8, Number(req.query.limit) || 36));
  const examples = retrievePsycheCandidates({ query, category, riskLevel, emotion, limit });
  return res.json({ examples, datasetSize: examples.length ? undefined : 0 });
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    // Aggregate view across both pools (either pool having a key is enough
    // to say "Groq is available at all").
    groqAvailable: GROQ_KEYS.length > 0,
    groqKeysConfigured: GROQ_KEYS.length,
    // Per-pool breakdown — two independent two-key fallback chains, so a
    // burst on one job never starves the other's rate limit. Order within
    // each pool: pool key #1 -> pool key #2 -> Gemini -> (communication
    // pool only) local Phi-4-mini.
    tonePool: {
      keysConfigured: TONE_GROQ_KEYS.length,
      fallbackKeyConfigured: TONE_GROQ_KEYS.length > 1,
    },
    communicationPool: {
      keysConfigured: COMM_GROQ_KEYS.length,
      fallbackKeyConfigured: COMM_GROQ_KEYS.length > 1,
    },
    geminiAvailable: !!process.env.GEMINI_API_KEY,
    localLlmEnabled: LOCAL_LLM_ENABLED,
    localLlmUrl: LOCAL_LLM_ENABLED ? LOCAL_LLM_URL : undefined,
    localLlmModel: LOCAL_LLM_ENABLED ? LOCAL_LLM_MODEL : undefined,
    // Whether the third (Groq LLM) member of the tone-ensemble has any
    // provider to run on — the tone pool specifically, then shared Gemini.
    toneEnsembleAvailable: !!(TONE_GROQ_KEYS.length || process.env.GEMINI_API_KEY),
    timestamp: new Date().toISOString(),
  });
});

/**
 * Third ensemble member for tone/emotion assessment: a Groq-hosted LLM's own
 * read of one check-in answer, alongside the two on-device transformers
 * (NeuroScope DistilBERT + RoBERTa) the client already runs. Kept fast and
 * best-effort on purpose — this enriches the assessment ensemble, it does
 * not gate it, so a slow/unconfigured provider must never block the UI:
 * failures return `{ available: false }` with a 200 status (not an error)
 * and the client-side ensemble simply degrades to the two transformers.
 *
 * Deliberately skips the local Phi rung (kept for the "solution" routes
 * further below) — this is called once per answer during a live assessment,
 * so it stays on the fast cloud rungs (Groq -> Groq #2 -> Gemini) with tight
 * per-rung timeouts rather than potentially waiting on a local model.
 */
app.post('/api/tone-analysis', async (req, res) => {
  try {
    const { text } = req.body || {};
    if (typeof text !== 'string' || text.trim().length < 2) {
      return res.json({ available: false, reason: 'empty-text' });
    }
    const clipped = text.trim().slice(0, 2000);
    const prompt = `Text to classify:\n"""${clipped}"""`;

    const { text: raw, providerUsed } = await callAIWithFallback({
      prompt,
      systemPrompt: TONE_ANALYSIS_SYSTEM_PROMPT,
      temperature: 0.2,
      json: true,
      timeoutMs: 5000,
      deadlineMs: 5000,
      pool: 'tone',
      skip: ['local'],
    });

    const parsed = parseToneAnalysisReply(raw);
    return res.json({ available: true, providerUsed, ...parsed });
  } catch (err) {
    console.warn(
      '/api/tone-analysis: every provider failed — tone ensemble degrades to NeuroScope + RoBERTa only:',
      (err as any)?.message || err
    );
    return res.json({ available: false, reason: 'provider-error' });
  }
});

// Direct ZIP file download endpoint
app.get('/api/download-zip', (req, res) => {
  const zipPath = path.join(process.cwd(), 'neuroscope-mental-health-evaluator.zip');
  if (fs.existsSync(zipPath)) {
    const stat = fs.statSync(zipPath);
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', 'attachment; filename="neuroscope-mental-health-evaluator.zip"');
    res.setHeader('Content-Length', stat.size);
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
    const fileStream = fs.createReadStream(zipPath);
    fileStream.pipe(res);
  } else {
    res.status(404).json({ error: 'Zip file not generated yet' });
  }
});

// Artwork image upload endpoint
app.post('/api/upload-artwork', (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image data provided' });
    }
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const buffer = Buffer.from(cleanBase64, 'base64');
    const targetPath = path.join(process.cwd(), 'public', 'neural-artwork.png');
    fs.writeFileSync(targetPath, buffer);
    res.json({ success: true, url: '/neural-artwork.png' });
  } catch (err: any) {
    console.error('Failed to save artwork:', err);
    res.status(500).json({ error: err.message || 'Failed to save artwork' });
  }
});

const CRISIS_HELPLINES = [
  {
    name: 'India: Tele-MANAS (Govt. of India 24/7 National Helpline)',
    contact: 'Call 14416 or 1800-891-4416',
    description: 'Free, toll-free 24/7 mental health & crisis intervention across all Indian states in 20+ languages.',
    region: 'India (Toll-Free 24/7)',
    type: 'call',
  },
  {
    name: 'India: Crisis Text Line & WhatsApp (Vandrevala Foundation)',
    contact: 'WhatsApp or Call: +91 9999 666 555',
    description: 'Free, 24/7 crisis support and suicide prevention via WhatsApp chat or direct call.',
    region: 'India (WhatsApp & Call 24/7)',
    type: 'text',
  },
  {
    name: 'India: KIRAN National Mental Health Helpline',
    contact: 'Call 1800-599-0019',
    description: '24/7 national toll-free helpline by Ministry of Social Justice & Empowerment, Govt. of India.',
    region: 'India (Toll-Free)',
    type: 'call',
  },
  {
    name: 'India: AASRA 24/7 Suicide Prevention Helpline',
    contact: 'Call +91-9820466726',
    description: '24/7 confidential crisis intervention and emotional support helpline in India.',
    region: 'India (24/7)',
    type: 'call',
  },
  {
    name: 'US & Canada: Suicide & Crisis Lifeline',
    contact: 'Call or text 988',
    description: 'Free, confidential 24/7 support from trained crisis counselors.',
    region: 'US & Canada',
    type: 'call',
  },
  {
    name: 'US, UK & Canada: Crisis Text Line',
    contact: 'Text HOME to 741741',
    description: 'Free 24/7 crisis support via SMS messaging.',
    region: 'US / UK / Canada',
    type: 'text',
  },
  {
    name: 'International Helplines (Befrienders Worldwide)',
    contact: 'https://www.befrienders.org',
    description: 'Confidential support lines available in over 30 countries globally.',
    region: 'Global',
    type: 'web',
  },
];

/* ------------------------------------------------------------------
 * Client-side intelligence bridge
 * ------------------------------------------------------------------
 * The browser runs the transformer stack (fine-tuned RoBERTa sentiment,
 * multi-class emotion classification, MiniLM semantic vectors) and the dynamic
 * risk tracker, and posts those readings with each request. The server never
 * loads the models itself — it validates what it was sent, caps it, and merges
 * it into the prompts, falling back to its own keyword retrieval and lexical
 * reading so every route still works when the client sends nothing (offline,
 * direct API call, or model download still in flight).
 */

const RISK_LEVELS = ['low', 'elevated', 'high', 'critical'] as const;
const finite = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

/**
 * Groq (unlike the Gemini structured-output path) is only *asked* to return
 * JSON — nothing enforces the schema types — so it occasionally spells a
 * score out ("sixty", "eighty-five percent") instead of writing a number.
 * That used to flow straight through to the client and render literally as
 * "sixty%" in the dashboard. This coerces any of the shapes the model might
 * produce (number, numeric string, "NN%", or an English number word/phrase)
 * into a plain 0-100 integer, or null if nothing usable is found.
 */
const ONES_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19,
};
const TENS_WORDS: Record<string, number> = {
  twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90,
};

function wordsToNumber(raw: string): number | null {
  const cleaned = raw
    .toLowerCase()
    .trim()
    .replace(/percent|per cent|%/g, '')
    .replace(/[-]/g, ' ')
    .replace(/\band\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return null;
  if (cleaned === 'hundred' || cleaned === 'a hundred' || cleaned === 'one hundred') return 100;

  const parts = cleaned.split(' ').filter(Boolean);
  if (!parts.length || parts.length > 3) return null;

  let total = 0;
  let matchedAny = false;
  for (const part of parts) {
    if (part === 'hundred') {
      total = (total || 1) * 100;
      matchedAny = true;
    } else if (part in TENS_WORDS) {
      total += TENS_WORDS[part];
      matchedAny = true;
    } else if (part in ONES_WORDS) {
      total += ONES_WORDS[part];
      matchedAny = true;
    } else {
      return null; // an unrecognized token means this wasn't a spelled-out number
    }
  }
  return matchedAny ? total : null;
}

function coerceScore(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const trimmed = v.trim();
    // Plain or percent-suffixed numeral: "85", "85%", "85.0"
    const numeric = Number(trimmed.replace(/%$/, ''));
    if (Number.isFinite(numeric) && trimmed.replace(/%$/, '').match(/^-?\d+(\.\d+)?$/)) {
      return numeric;
    }
    // Spelled-out English number word/phrase: "sixty", "eighty-five", "eighty five percent"
    const fromWords = wordsToNumber(trimmed);
    if (fromWords !== null) return fromWords;
  }
  return null;
}

const VALID_DIMENSION_STATUSES = ['Optimal', 'Mild Strain', 'Moderate Concern', 'Severe Strain'] as const;
type DimensionStatus = typeof VALID_DIMENSION_STATUSES[number];

/** Re-derives the status band from the (now-numeric) score whenever the
 * model's own status string is missing, unrecognized, or inconsistent with
 * the score it just gave us — keeps the colored badge honest. */
function statusForScore(score: number, claimed: unknown): DimensionStatus {
  if (typeof claimed === 'string' && (VALID_DIMENSION_STATUSES as readonly string[]).includes(claimed)) {
    return claimed as DimensionStatus;
  }
  if (score >= 80) return 'Optimal';
  if (score >= 60) return 'Mild Strain';
  if (score >= 40) return 'Moderate Concern';
  return 'Severe Strain';
}

/**
 * Applied to the raw parsed JSON from /api/assess and /api/reassess before
 * it is sent to the client. Coerces every dimension's score to a real
 * number (see coerceScore) and clamps it to 0-100, so the model spelling a
 * score out in words can never reach the dashboard as literal text again.
 */
function sanitizeParsedDimensionScores<T extends { dimensionalScores?: unknown }>(parsed: T): T {
  if (!parsed || !Array.isArray((parsed as any).dimensionalScores)) return parsed;
  const cleaned = (parsed as any).dimensionalScores.map((d: any) => {
    if (!d || typeof d !== 'object') return d;
    const coerced = coerceScore(d.score);
    const score = coerced === null ? 50 : Math.max(0, Math.min(100, Math.round(coerced)));
    return {
      ...d,
      score,
      status: statusForScore(score, d.status),
    };
  });
  return { ...(parsed as any), dimensionalScores: cleaned };
}

/** Shape-checks the client's dynamic-risk reading; returns undefined when absent. */
function sanitizeRisk(input: any): RiskAssessment | undefined {
  if (!input || typeof input !== 'object') return undefined;
  return {
    score: Math.max(0, Math.min(100, finite(input.score) ?? 0)),
    level: (RISK_LEVELS as readonly string[]).includes(input.level) ? input.level : 'low',
    signals: (Array.isArray(input.signals) ? input.signals : []).slice(0, 12).map((s: any) => ({
      kind: s?.kind || 'marker',
      detail: String(s?.detail ?? '').slice(0, 240),
      weight: finite(s?.weight) ?? 0,
    })),
    toneTrend: Math.max(-1, Math.min(1, finite(input.toneTrend) ?? 0)),
    samples: Math.max(0, Math.min(500, Math.round(finite(input.samples) ?? 0))),
    escalatedAtQuestion: finite(input.escalatedAtQuestion) ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// PRIMARY-model (NeuroScope DistilBERT) prompt plumbing.
// The fine-tuned dual-head classifier running in the user's browser is the
// clinical authority; Gemini/Groq are communicators that write FROM its
// readings. These helpers sanitize what the client sends and turn it into
// prompt directives with that hierarchy spelled out.
// ---------------------------------------------------------------------------

const NEUROSCOPE_DIMENSIONS = [
  'Normal',
  'Depression',
  'Suicidal',
  'Anxiety',
  'Bipolar',
  'Stress',
  'Personality Disorder',
] as const;

interface SanitizedNeuroScopeReading {
  topStatus: string;
  pTop: number;
  pRisk: number;
  riskFlag: boolean;
  band: string;
  top3: { label: string; p: number }[];
}

function sanitizeNeuroScopeReading(input: any): SanitizedNeuroScopeReading | null {
  if (!input || typeof input !== 'object') return null;
  const topStatus = String(input.topStatus || '');
  if (!NEUROSCOPE_DIMENSIONS.includes(topStatus as any)) return null;
  const pTop = Math.max(0, Math.min(1, finite(input.pTop) ?? 0));
  const pRisk = Math.max(0, Math.min(1, finite(input.pRisk) ?? 0));
  const band = ['low', 'elevated', 'high', 'critical'].includes(input.band) ? input.band : 'low';
  const top3 = (Array.isArray(input.top3) ? input.top3 : [])
    .slice(0, 3)
    .map((t: any) => ({
      label: String(t?.label || ''),
      p: Math.max(0, Math.min(1, finite(t?.p) ?? 0)),
    }))
    .filter((t: any) => NEUROSCOPE_DIMENSIONS.includes(t.label));
  return { topStatus, pTop, pRisk, riskFlag: input.riskFlag === true, band, top3 };
}

function sanitizeNeuroScopeReadings(input: unknown, limit = 24): SanitizedNeuroScopeReading[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(sanitizeNeuroScopeReading)
    .filter((r): r is SanitizedNeuroScopeReading => !!r)
    .slice(0, limit);
}

/** Aggregate view of the run's primary readings for prompts. */
function summarizeNeuroScope(readings: SanitizedNeuroScopeReading[]): {
  count: number;
  meanRisk: number;
  maxRisk: number;
  dominant: string;
  criticalAnswers: number;
} | null {
  if (!readings.length) return null;
  const tally = new Map<string, number>();
  let meanRisk = 0;
  let maxRisk = 0;
  let criticalAnswers = 0;
  for (const r of readings) {
    meanRisk += r.pRisk;
    maxRisk = Math.max(maxRisk, r.pRisk);
    if (r.band === 'critical') criticalAnswers += 1;
    tally.set(r.topStatus, (tally.get(r.topStatus) || 0) + r.pTop);
  }
  let dominant = 'Normal';
  let best = -1;
  for (const [status, weight] of tally) {
    if (weight > best) {
      best = weight;
      dominant = status;
    }
  }
  return {
    count: readings.length,
    meanRisk: meanRisk / readings.length,
    maxRisk,
    dominant,
    criticalAnswers,
  };
}

/**
 * The single source of truth for HOW Gemini/Groq must treat the primary
 * classifier. Injected into every clinical prompt: the trained model's read
 * is the frame; the LLM's job is warm, human, plain-language communication
 * OF that read — grounded in research, never overriding it upward on safety.
 */
function buildNeuroScopePromptBlock(readings: SanitizedNeuroScopeReading[]): string {
  const summary = summarizeNeuroScope(readings);
  if (!summary) {
    return `PRIMARY CLASSIFIER UNAVAILABLE: the on-device NeuroScope DistilBERT did not produce readings for this run. Base your clinical framing ONLY on the person's own words and the supporting on-device measurements (tone/emotion), and keep severity language conservative.`;
  }
  const perAnswer = readings
    .slice(-6)
    .map((r, i) => {
      const idx = readings.length - Math.min(readings.length, 6) + i + 1;
      const alternates = r.top3
        .slice(1)
        .map((t) => `${t.label} ${Math.round(t.p * 100)}%`)
        .join(', ');
      return `   ${idx}. ${r.topStatus} (${Math.round(r.pTop * 100)}% confidence${alternates ? `; also: ${alternates}` : ''}) — risk probability ${Math.round(
        r.pRisk * 100
      )}%${r.riskFlag ? ' [risk-flagged]' : ''}, band ${r.band}`;
    })
    .join('\n');
  return `PRIMARY CLINICAL AUTHORITY — NeuroScope DistilBERT (the app's own fine-tuned dual-head classifier, trained on 51,067 mental-health statements; status macro-F1 0.79, risk recall 0.92 at a recall-first threshold):
Run summary: ${summary.count} classified answers; dominant dimension ${summary.dominant}; mean risk probability ${Math.round(
    summary.meanRisk * 100
  )}%; peak ${Math.round(summary.maxRisk * 100)}%; ${summary.criticalAnswers} answer(s) in the critical band.
Per-answer readings (most recent last):
${perAnswer}

HOW TO USE THIS (binding):
- These readings are the PRIMARY evidence about this person's clinical state. Your writing (verdict, sections, insights) must be CONSISTENT with them — a ${summary.dominant}-dominant session with ${Math.round(
    summary.meanRisk * 100
  )}% mean risk must be framed accordingly.
- Never inflate severity above what the readings and the person's words support, and never talk them out of a flagged risk band: ${summary.criticalAnswers > 0 ? 'this run HAS a critical-band reading, so safety resources stay in view.' : 'when a reading is elevated/high, keep support visible without alarming.'}
- Do NOT invent your own diagnosis or contradict the model with generic severity labels; your role is to COMMUNICATE what the primary model registered in warm, human, plain language.`;
}

/** True when any primary reading this run landed in the critical band — used
 * to hold the response-side severity floor (the communicator LLM may not
 * soften a critical read from the trained model). */
function hasPrimaryCritical(body: any): boolean {
  return (summarizeNeuroScope(sanitizeNeuroScopeReadings(body?.neuroscopeReadings))?.criticalAnswers ?? 0) > 0;
}

/** Severity floor: when the primary classifier flagged this run critical, the
 * returned report must not read as mild — clamps the LLM's severityLevel and
 * mirrors it in `assessment` so client surfaces stay consistent. */
function applyPrimarySeverityFloor<T extends Record<string, any>>(parsed: T, body: any): T {
  if (parsed && hasPrimaryCritical(body) && parsed.severityLevel && parsed.severityLevel !== 'critical') {
    return { ...parsed, severityLevel: 'critical' };
  }
  return parsed;
}

/** Turns the client's transformer/risk readings into a prompt block. */
function sanitizeWellnessProfile(input: any): Record<string, unknown> | undefined {
  if (!input || typeof input !== 'object' || input.useForPersonalization === false) return undefined;
  const out: Record<string, unknown> = {};
  const age = finite(input.age);
  const heightCm = finite(input.heightCm);
  const weightKg = finite(input.weightKg);
  const sleepHours = finite(input.sleepHours);
  const caffeineCups = finite(input.caffeineCups);
  if (age !== null && age >= 13 && age <= 120) out.age = Math.round(age);
  if (heightCm !== null && heightCm >= 80 && heightCm <= 250) out.heightCm = Number(heightCm.toFixed(1));
  if (weightKg !== null && weightKg >= 20 && weightKg <= 350) out.weightKg = Number(weightKg.toFixed(1));
  if (sleepHours !== null && sleepHours >= 0 && sleepHours <= 24) out.sleepHours = Number(sleepHours.toFixed(1));
  if (caffeineCups !== null && caffeineCups >= 0 && caffeineCups <= 30) out.caffeineCups = Number(caffeineCups.toFixed(1));
  const exercise = typeof input.exerciseFrequency === 'string' ? input.exerciseFrequency : '';
  if (['rarely', '1-2x', '3-4x', '5+x'].includes(exercise)) out.exerciseFrequency = exercise;
  const tobacco = typeof input.tobacco === 'string' ? input.tobacco : '';
  if (['never', 'sometimes', 'daily'].includes(tobacco)) out.tobacco = tobacco;
  const alcohol = typeof input.alcohol === 'string' ? input.alcohol : '';
  if (['never', 'sometimes', 'often'].includes(alcohol)) out.alcohol = alcohol;
  if (typeof input.medications === 'string' && input.medications.trim()) out.medications = input.medications.trim().slice(0, 400);
  if (typeof input.physicalNotes === 'string' && input.physicalNotes.trim()) out.physicalNotes = input.physicalNotes.trim().slice(0, 600);
  return Object.keys(out).length ? out : undefined;
}

function buildWellnessProfileBlock(input: any): string {
  const profile = sanitizeWellnessProfile(input);
  if (!profile) return '';
  const lines = ['USER-PROVIDED WELLNESS CONTEXT (communication-layer personalization only):'];
  if (profile.age !== undefined) lines.push(`- Age: ${profile.age} years.`);
  if (profile.heightCm !== undefined) lines.push(`- Height: ${profile.heightCm} cm.`);
  if (profile.weightKg !== undefined) lines.push(`- Weight: ${profile.weightKg} kg.`);
  if (profile.heightCm !== undefined && profile.weightKg !== undefined) {
    const heightM = Number(profile.heightCm) / 100;
    const bmi = Number(profile.weightKg) / (heightM * heightM);
    if (Number.isFinite(bmi)) lines.push(`- BMI reference: ${bmi.toFixed(1)} (context only, never a mental-health score).`);
  }
  if (profile.sleepHours !== undefined) lines.push(`- Average sleep: ${profile.sleepHours} hours/night.`);
  if (profile.exerciseFrequency !== undefined) lines.push(`- Exercise/movement: ${profile.exerciseFrequency}.`);
  if (profile.caffeineCups !== undefined) lines.push(`- Caffeine: ${profile.caffeineCups} cups/day.`);
  if (profile.tobacco !== undefined) lines.push(`- Tobacco/nicotine: ${profile.tobacco}.`);
  if (profile.alcohol !== undefined) lines.push(`- Alcohol: ${profile.alcohol}.`);
  if (profile.medications !== undefined) lines.push(`- User-recorded medications: ${profile.medications}`);
  if (profile.physicalNotes !== undefined) lines.push(`- User-recorded physical notes: ${profile.physicalNotes}`);
  lines.push('- Use these details only when they are genuinely relevant to the user’s current concern, especially sleep, energy, stress, routines, or lifestyle suggestions.');
  lines.push('- Never diagnose from height, weight, BMI, medication names, or lifestyle alone. Never change the mental-health score because of these values. Never recommend starting/stopping/changing medication doses.');
  return lines.join('\n');
}

function buildClientSignalBlock(body: any): { risk?: RiskAssessment; block: string } {
  const risk = sanitizeRisk(body?.riskAssessment);
  const semantic = body?.semanticProfile;
  const lines: string[] = [];

  const emotionTop = semantic?.emotions?.top;
  const topScore = finite(emotionTop?.score);
  if (emotionTop && typeof emotionTop.label === 'string' && topScore !== null) {
    const spread = (Array.isArray(semantic.emotions.all) ? semantic.emotions.all : [])
      .slice(0, 3)
      .map((e: any) => `${e?.label} ${Math.round((finite(e?.score) ?? 0) * 100)}%`)
      .join(', ');
    const distress = finite(semantic.emotions.distressWeight);
    lines.push(
      `- Emotion classifier (7-class Ekman, on-device) on this answer: dominant "${emotionTop.label}" at ${Math.round(
        topScore * 100
      )}%${spread ? `; full distribution — ${spread}` : ''}${
        distress !== null ? `; distress-family mass ${Math.round(distress * 100)}%` : ''
      }.`
    );
  }

  const sentiment = semantic?.sentiment;
  const valence = finite(sentiment?.score);
  if (typeof sentiment?.label === 'string' && valence !== null) {
    const magnitude = finite(sentiment.magnitude);
    // The label must reflect which engine actually produced this reading — it
    // is usually the NeuroScope DistilBERT tone now (see sentimentFromNeuroScope
    // client-side), with the supporting hub RoBERTa model only as a fallback
    // while NeuroScope is still downloading. Mislabeling a NeuroScope-derived
    // reading as "RoBERTa" here would make it look like independent
    // corroborating evidence when it is actually the same primary signal
    // already stated above in the PRIMARY CLINICAL AUTHORITY block.
    const sentimentSourceLabel: Record<string, string> = {
      neuroscope: 'NeuroScope DistilBERT tone read',
      'neuroscope+lexicon': 'NeuroScope DistilBERT tone read (blended with lexicon)',
      ensemble: 'NeuroScope DistilBERT × RoBERTa ensemble tone read',
      'ensemble+lexicon': 'NeuroScope DistilBERT × RoBERTa ensemble tone read (blended with lexicon)',
      ensemble3: 'NeuroScope DistilBERT × RoBERTa × Groq three-way ensemble tone read',
      'ensemble3+lexicon': 'NeuroScope DistilBERT × RoBERTa × Groq three-way ensemble tone read (blended with lexicon)',
      groq: 'Groq LLM tone read (transformers were still loading)',
      transformer: 'supporting RoBERTa model (fallback — NeuroScope was still loading)',
      hybrid: 'supporting RoBERTa model + lexicon (fallback — NeuroScope was still loading)',
      lexicon: 'offline lexicon (no transformer was ready)',
      'lexicon+question': 'deterministic direct-answer read against this question',
    };
    const sourceLabel = sentimentSourceLabel[sentiment.source as string] || 'on-device sentiment head';
    lines.push(
      `- Tone reading (${sourceLabel}): label "${sentiment.label}", valence ${valence.toFixed(2)} (range -1 severe to +1 calm)${
        magnitude !== null ? `, intensity ${magnitude.toFixed(2)}` : ''
      }.`
    );
  }

  const similarity = finite(semantic?.riskSimilarity);
  if (similarity !== null) {
    lines.push(
      `- Cosine similarity to the explicit crisis-language bank: ${similarity.toFixed(
        3
      )} (higher = closer to how crisis language reads).`
    );
  }

  if (risk) {
    const topSignals = risk.signals
      .filter((s) => s.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 3);
    lines.push(
      `- Rate-of-change risk tracker across this run: level "${risk.level}", score ${Math.round(
        risk.score
      )}/100, tone slope ${risk.toneTrend >= 0 ? '+' : ''}${risk.toneTrend.toFixed(2)} over ${risk.samples} answers.${
        topSignals.length ? ` Leading signals — ${topSignals.map((s) => `${s.kind} (${s.detail})`).join('; ')}.` : ''
      }`
    );
    if (risk.level === 'critical' || risk.level === 'high') {
      lines.push(
        `  Safety framing: this run has crossed into ${risk.level} risk on the client's own dynamic triggers. Take the pain seriously, keep the tone steady rather than alarmed, state concrete support options plainly, and do not minimize or rush past it.`
      );
    }
  }

  const primaryBlock = buildNeuroScopePromptBlock(sanitizeNeuroScopeReadings(body?.neuroscopeReadings));
  const measurementBlock =
    lines.length === 0
      ? ''
      : `ON-DEVICE MEASUREMENTS (supporting transformer readings this client's browser computed for THIS run and THIS answer — treat them as evidence about this specific person, not as generic background; when a measurement and the words themselves disagree, trust the words):\n${lines.join(
          '\n'
        )}`;
  const wellnessBlock = buildWellnessProfileBlock(body?.wellnessProfile);
  const block = [primaryBlock, measurementBlock, wellnessBlock].filter(Boolean).join('\n\n');
  return { risk, block };
}

/** Resolves the research theme and the evidence passages for one answer. Uses
 * the client's semantically retrieved passages when it sent any, otherwise
 * retrieves them here so AI grounding and local composition share one source. */
function resolveGrounding(
  body: any,
  answerText: string,
  category?: string,
  neuroscope?: SanitizedNeuroScopeReading | null
): { theme: ResearchTheme; passages: RetrievedPassage[] } {
  const theme = detectResearchTheme(answerText || '', category || '', neuroscope || undefined);
  const clientPassages = sanitizePassages(body?.researchPassages);
  return {
    theme,
    passages: clientPassages.length > 0 ? clientPassages : retrievePassagesLexical(answerText || '', theme),
  };
}

function sanitizePsycheExamples(input: unknown, limit = 6): PsycheExample[] {
  if (!Array.isArray(input)) return [];
  const out: PsycheExample[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const text = typeof p.text === 'string' ? p.text.slice(0, 900) : '';
    const sampleReply = typeof p.sampleReply === 'string' ? p.sampleReply.slice(0, 900) : '';
    if (!text || !sampleReply) continue;
    out.push({
      id: typeof p.id === 'string' ? p.id.slice(0, 80) : `psyche-${out.length}`,
      text,
      primaryEmotion: typeof p.primaryEmotion === 'string' ? p.primaryEmotion.slice(0, 80) : '',
      secondaryEmotion: typeof p.secondaryEmotion === 'string' ? p.secondaryEmotion.slice(0, 80) : '',
      emotion: typeof p.emotion === 'string' ? p.emotion.slice(0, 80) : '',
      domain: typeof p.domain === 'string' ? p.domain.slice(0, 120) : '',
      screeningCategory: typeof p.screeningCategory === 'string' ? p.screeningCategory.slice(0, 160) : '',
      cognitiveDistortion: typeof p.cognitiveDistortion === 'string' ? p.cognitiveDistortion.slice(0, 120) : '',
      somaticTags: typeof p.somaticTags === 'string' ? p.somaticTags.slice(0, 160) : '',
      riskLevel: typeof p.riskLevel === 'string' ? p.riskLevel.slice(0, 40) : '',
      primaryNeed: typeof p.primaryNeed === 'string' ? p.primaryNeed.slice(0, 160) : '',
      responseStrategy: typeof p.responseStrategy === 'string' ? p.responseStrategy.slice(0, 240) : '',
      technique: typeof p.technique === 'string' ? p.technique.slice(0, 180) : '',
      tool: typeof p.tool === 'string' ? p.tool.slice(0, 100) : '',
      reflection: typeof p.reflection === 'string' ? p.reflection.slice(0, 500) : '',
      sampleReply,
      searchText: typeof p.searchText === 'string' ? p.searchText.slice(0, 1800) : text,
      retrievalScore: typeof p.retrievalScore === 'number' && Number.isFinite(p.retrievalScore) ? p.retrievalScore : undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

function buildPsycheExamplesBrief(examples: PsycheExample[]): string {
  if (!examples.length) return 'No dataset examples were retrieved for this answer.';
  return examples.map((e, i) =>
    `Example ${i + 1} (semantic match ${typeof e.retrievalScore === 'number' ? e.retrievalScore.toFixed(2) : 'n/a'}):\n` +
    `User-pattern: ${e.text}\n` +
    `Emotion/need: ${[e.primaryEmotion, e.secondaryEmotion, e.primaryNeed].filter(Boolean).join(' / ')}\n` +
    `Strategy metadata: ${[e.responseStrategy, e.technique, e.tool].filter(Boolean).join(' / ')}\n` +
    `Reference response style: ${e.sampleReply}`
  ).join('\n\n');
}

// Primary Assessment Endpoint
app.post('/api/assess', async (req, res) => {
  const { answers, preferredProvider } = req.body;
  const psycheExamples = sanitizePsycheExamples(req.body.psycheExamples, 8);
  const psycheBrief = buildPsycheExamplesBrief(psycheExamples);

  if (!answers || !Array.isArray(answers) || answers.length === 0) {
    return res.status(400).json({ error: 'Answers array is required' });
  }

  const allText = answers
    .map((a: { answer?: string }) => a?.answer || '')
    .filter(Boolean)
    .join('\n');
  const { theme, passages } = resolveGrounding(req.body, allText, answers[0]?.category || '');
  const clientIntel = buildClientSignalBlock(req.body);

  const promptContext = answers
    .map(
      (a: { questionId: number; questionText: string; category: string; answer: string }) =>
        `[Category: ${a.category}] Q${a.questionId}: "${a.questionText}"\nUser's Typed Answer: "${a.answer || 'Not provided'}"`
    )
    .join('\n\n');

  const systemInstruction = `You are a warm, experienced, licensed clinical psychologist reviewing a client's screening responses and writing up your impressions for them directly, in your own natural voice — not an automated report generator. Write the way a genuinely caring human expert would explain things to a client they've been listening to closely: plain language first, technical terms only when they add real understanding, and always explained simply when used.
Your goal is to evaluate the user's responses across the 5 mental health categories:
1. Mood and Emotional State
2. Daily Functioning and Physical Well-being
3. Thought Patterns and Perception of Reality
4. Stress, Coping, and Impulse Control
5. Social Connections and Relationships

Provide:
1. An overall verdict (e.g., 'Flourishing & Resilient', 'Mild Transient Strain', 'Moderate Mood/Anxiety Disruption', 'Substantial Psychological Fatigue', 'Acute Distress').
2. severityLevel: one of 'optimal', 'mild', 'moderate', 'high', 'critical'. If self-harm (Q15) or acute harm is indicated, set severityLevel to 'critical'.
3. A warm, compassionate, validating verdictSummary explaining their state without harsh medical labels.
4. Dimensional scores for all 5 categories (score 0-100 where 100 is best, status 'Optimal' | 'Mild Strain' | 'Moderate Concern' | 'Severe Strain', and brief summary).
5. 3 to 4 concrete, scientifically backed personalized solutions uniquely tailored to the user's specific lowest-scoring dimensions and expressed symptoms across the 20 screening questions (e.g., circadian protocols if sleep is impaired, behavioral activation for anhedonia, DBT TIPP for emotional volatility, cognitive defusion for rumination, social co-presence for loneliness, workplace boundaries for burnout). For each solution, provide matchedTrigger (e.g. "⚡ Calibrated to Question #5: Sleep Onset Disturbance"), neuroTarget (e.g. "Ventrolateral Preoptic Nucleus & Adenosine Clearance"), timeEstimate (e.g. "2 min", "Evening Routine"), and interactiveToolType ("breathing", "timer", "grounding", or "journal"). NEVER return a generic, identical set of solutions.
6. A heartfelt, uplifting, and empowering motivational message (especially if the user is in slight or moderate distress), reminding them of their neuroplasticity, inherent worth, and potential for gentle recovery.
7. If critical safety issues or self-harm are detected, set isCritical: true and provide crisis helpline advice.
8. Ground the solutions (and the verdictSummary where it fits) in the ANSWER-SPECIFIC EVIDENCE and ON-DEVICE MEASUREMENTS below whenever they genuinely apply — name the finding in plain language ("sleep research finds...", "trauma research shows...") without turning the response into a bibliography, and never invent a study or a source that is not listed there.`;

  const assessEvidence = `${buildResearchBrief(theme, passages)}\n\n${psycheBrief}\n\nDATASET-GROUNDING RULE: Use retrieved examples only to improve empathy, specificity, and strategy selection. Never copy their wording, diagnose by similarity, or mention the dataset.${clientIntel.block ? `\n\n${clientIntel.block}` : ''}`;

  // preferredProvider lets a caller pin to one provider ('groq' | 'gemini');
  // any other value (including 'auto'/unset) uses the full communication
  // chain: Groq (primary key) -> Groq (secondary key) -> Gemini -> local
  // Phi-4-mini, so the assessment practically never comes back empty.
  const skip: Array<'groq' | 'gemini' | 'local'> =
    preferredProvider === 'gemini' ? ['groq', 'local'] : preferredProvider === 'groq' ? ['gemini', 'local'] : [];

  const groqPrompt = `Evaluate the following mental health screening assessment responses:\n\n${promptContext}\n\n${assessEvidence}\n\nRespond strictly in valid JSON format matching:
{
  "overallVerdict": "...",
  "severityLevel": "optimal" | "mild" | "moderate" | "high" | "critical",
  "verdictSummary": "...",
  "motivationalMessage": "...",
  "dimensionalScores": [{"category": "...", "score": 85, "status": "Optimal", "summary": "..."}],
  "personalizedSolutions": [{"id": "sol-1", "title": "...", "category": "...", "difficulty": "Quick 2-min", "actionSteps": ["..."], "scientificRationale": "..."}],
  "isSafetyCritical": false,
  "safetyGuidance": "..."
}`;
  const geminiContents = `Evaluate the following mental health screening assessment responses:\n\n${promptContext}\n\n${assessEvidence}\n\nCommunicate the primary classifier's findings (see PRIMARY CLINICAL AUTHORITY above) as a caring human clinician would — plain language, no model jargon.`;
  const assessSchema = {
    type: Type.OBJECT,
    properties: {
      overallVerdict: { type: Type.STRING },
      severityLevel: {
        type: Type.STRING,
        description: "One of 'optimal', 'mild', 'moderate', 'high', 'critical'",
      },
      verdictSummary: { type: Type.STRING },
      motivationalMessage: { type: Type.STRING },
      dimensionalScores: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            score: { type: Type.NUMBER },
            status: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
          required: ['category', 'score', 'status', 'summary'],
        },
      },
      personalizedSolutions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            category: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            actionSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            scientificRationale: { type: Type.STRING },
            matchedTrigger: { type: Type.STRING },
            neuroTarget: { type: Type.STRING },
            timeEstimate: { type: Type.STRING },
            interactiveToolType: { type: Type.STRING },
          },
          required: ['id', 'title', 'category', 'difficulty', 'actionSteps', 'scientificRationale'],
        },
      },
      isSafetyCritical: { type: Type.BOOLEAN },
      safetyGuidance: { type: Type.STRING },
    },
    required: [
      'overallVerdict',
      'severityLevel',
      'verdictSummary',
      'motivationalMessage',
      'dimensionalScores',
      'personalizedSolutions',
    ],
  };

  try {
    const { text, providerUsed } = await callAIWithFallback({
      prompt: groqPrompt,
      systemPrompt: systemInstruction + langDirective(req),
      temperature: 0.6,
      json: true,
      timeoutMs: 20000,
      deadlineMs: 22000,
      geminiContents,
      geminiSchema: assessSchema,
      skip,
    });
    const parsed = sanitizeParsedDimensionScores(applyPrimarySeverityFloor(JSON.parse(text), req.body));

    return res.json({
      ...parsed,
      assessment: parsed,
      providerUsed,
      timestamp: new Date().toISOString(),
      riskAssessment: clientIntel.risk,
      evidenceSources: summarizeSources(passages),
      safetyAlert: parsed.isSafetyCritical || clientIntel.risk?.level === 'critical' || hasPrimaryCritical(req.body)
        ? {
            isCritical: true,
            guidance: parsed.safetyGuidance || 'Immediate support is available. Please reach out to trusted professionals.',
            helplineNumbers: CRISIS_HELPLINES,
          }
        : undefined,
    });
  } catch (err) {
    console.warn('All AI providers failed for /api/assess:', err);
  }

  // Fallback to client-safe signal so client uses robust local wellness engine
  return res.json({
    fallbackToLocal: true,
    message: 'Using built-in psychological screening rubric.',
  });
});

// Real-Time Dynamic Feeling Solution Endpoint (Per-Question Feedback)
app.post('/api/feeling-solution', async (req, res) => {
  const { questionId, questionText, category, userAnswer, questionNumber, totalQuestions } = req.body;
  const psycheExamples = sanitizePsycheExamples(req.body.psycheExamples, 6);
  const psycheBrief = buildPsycheExamplesBrief(psycheExamples);

  const userText = (userAnswer || '').trim();

  // Deterministic tone check first (same lexicon-based logic as the live
  // "Tone:" indicator on the client). Severe and calm readings are handled
  // directly here — reliably, and without depending on an LLM call — so a
  // severe answer always leads with support resources, and a calm answer
  // always gets appreciation instead of an unnecessary "fix-it" solution.
  let tone = analyzeSentiment(userText);
  const userSnippetForTone = userText ? (userText.length > 80 ? `${userText.slice(0, 77)}...` : userText) : '';

  // The client's dynamic risk tracker (rate of change + high-risk semantic
  // markers across the whole run) can override a single reassuring answer:
  // once a run has crossed the critical band, one calm-sounding reply must not
  // route the user away from support. When the client sent nothing, this is
  // exactly the old single-answer threshold.
  const clientIntel = buildClientSignalBlock(req.body);
  // The PRIMARY classifier's read of THIS answer joins the dynamic risk band
  // in deciding whether this answer is treated as severe: the trained model
  // is the clinical authority, so its high/critical band escalates the tone
  // family even when the lexicon read came back mild (recall-first design).
  const nsHere = sanitizeNeuroScopeReadings(req.body?.neuroscopeReadings, 24);
  const nsCurrent = nsHere.length ? nsHere[nsHere.length - 1] : null;
  const severeBand =
    clientIntel.risk?.level === 'critical' ||
    (nsCurrent ? nsCurrent.band === 'critical' || nsCurrent.band === 'high' : false);
  // Prefer the reading the client computed for THIS specific answer
  // (semanticProfile.neuroscope) over the last entry of the run history,
  // falling back to nsCurrent when the per-answer profile wasn't sent.
  const nsForThisAnswer = sanitizeNeuroScopeReading(req.body?.semanticProfile?.neuroscope) || nsCurrent;
  const emotionForThisAnswer = req.body?.semanticProfile?.emotions;
  const dominantEmotion =
    emotionForThisAnswer && emotionForThisAnswer.source === 'transformer' ? emotionForThisAnswer.top?.label : undefined;
  const dominantEmotionScore =
    emotionForThisAnswer && emotionForThisAnswer.source === 'transformer' ? emotionForThisAnswer.top?.score : undefined;
  const { theme, passages } = resolveGrounding(req.body, userText, category, nsForThisAnswer);

  // Pre-quoted snippet of the user's own words + research-grounded paragraph
  // composers for the three core sections (empathy / nervous system / reframe),
  // shared by the deterministic branches below and mirrored on the client.
  const directAnswer = readDirectAnswer(userText);
  const questionShort =
    (questionText || '').length > 90 ? `${String(questionText).slice(0, 87)}...` : questionText || '';
  const quoteSnippet = userText
    ? directAnswer.matched
      ? `"${userText}" (your answer to "${questionShort}")`
      : `"${userSnippetForTone}"`
    : '';
  const composeCore = (themeOverride?: ResearchTheme) => {
    const qRec = QUESTION_POOL.find((q) => q.id === questionId);
    const input: ResearchComposeInput = {
      theme: themeOverride || theme,
      userSnippet: quoteSnippet,
      questionText: questionText || '',
      category: category || '',
      focus: (qRec?.keywords || []).slice(0, 2).join(' and '),
      toneLabel: tone.label,
      toneMagnitude: tone.magnitude,
      questionNumber: questionNumber || 1,
      seedText: String(questionId ?? ''),
      retrieved: passages,
      neuroscope: nsForThisAnswer || undefined,
      dominantEmotion,
      dominantEmotionScore,
    };
    return {
      conversationalEmpathy: composeEmpatheticParagraph(input),
      detailedAnalysis: composeNervousSystemParagraph(input),
      perspectiveShift: composePerspectiveShiftParagraph(input),
    };
  };

  // Time budget for the lighter, three-paragraph AI call below. Kept well
  // under the client's abort timeout so severe/calm/neutral answers — which
  // used to skip AI entirely — still return quickly.
  const CORE_SECTIONS_BUDGET_MS = 6500;

  const CORE_STYLE_BY_FAMILY: Record<'severe' | 'calm' | 'neutral', string> = {
    severe:
      'The user is describing real distress. Be warm, validating and grounding — never clinical or distant. Do not include crisis-line phone numbers yourself; that is handled separately.',
    calm: 'The user sounds steady or resilient right now. Reflect that strength back genuinely and specifically, without inventing a problem to solve.',
    neutral:
      'The user sounds even/neutral — neither struggling nor thriving. Treat that "fine" baseline as real and worth building on, without exaggerating in either direction.',
  };

  /**
   * Generates the three core sections — Empathetic Assessment & Reflection,
   * What Is Happening In Your Nervous System, and Cognitive Perspective Shift
   * — through Gemini/Groq, grounded on the retrieved research-paper and book
   * passages (`buildResearchBrief`), so a severe/calm/neutral answer reads as
   * fresh writing instead of the fixed slot-filled template pool. Falls back
   * to the local research-only composer (`composeCore`, unchanged) when both
   * providers are absent, fail, or run past budget — every other field in
   * the response (helplines, immediate steps, interactive tool, etc.) is
   * completely untouched by this.
   */
  const generateCoreSections = async (
    toneFamily: 'severe' | 'calm' | 'neutral'
  ): Promise<{ conversationalEmpathy: string; detailedAnalysis: string; perspectiveShift: string; providerUsed: 'groq' | 'groq2' | 'gemini' | 'local' }> => {
    const local = () => ({ ...composeCore(toneFamily), providerUsed: 'local' as const });

    const corePrompt = `A person is completing a mental-health check-in.
Screening category: "${category || 'Emotional State'}"
Question: "${questionText || 'How have you been feeling?'}"
Their answer: """${userText || '(no answer text captured)'}"""
Reading of their tone: ${tone.label} (magnitude ${tone.magnitude.toFixed(2)})

${buildResearchBrief(toneFamily, passages)}

${psycheBrief}

DATASET-GROUNDING RULE: Use these examples only as response-pattern references. Do not copy their wording, mention the dataset, or imply that a similar example means the user has the same condition. Generate original language for this person.

${CORE_STYLE_BY_FAMILY[toneFamily]}

Write exactly three cohesive paragraphs grounded in the research grounding above. Quote or closely paraphrase the user's own words at least once across the three paragraphs, and make sure the wording, structure and specific detail differ from anything generic or previously written:
1. "conversationalEmpathy" (110-160 words): an empathetic assessment and reflection of their exact answer.
2. "detailedAnalysis" (100-145 words): what is happening in their nervous system and psychology behind this exact experience, grounded in the research above, ending by separating physiology from identity.
3. "perspectiveShift" (60-100 words): a cognitive reframe grounded in the research lens, ending with one concrete forward-looking sentence.
No bullet points, no headers, no line breaks inside a paragraph.`;

    const coreSystemInstruction = `You are a warm, experienced licensed clinical psychologist writing three short reflective notes for a client after one check-in answer. Sound like a real, attentive human, never a template or a chatbot. Vary your sentence structure and phrasing every time — never reuse a stock opening line.${langDirective(req)}`;
    const coreSchema = {
      type: Type.OBJECT,
      properties: {
        conversationalEmpathy: { type: Type.STRING },
        detailedAnalysis: { type: Type.STRING },
        perspectiveShift: { type: Type.STRING },
      },
      required: ['conversationalEmpathy', 'detailedAnalysis', 'perspectiveShift'],
    };
    const groqCorePrompt = `${corePrompt}\n\nRespond strictly with a valid JSON object with exactly these fields: conversationalEmpathy, detailedAnalysis, perspectiveShift.`;

    try {
      const { text, providerUsed } = await callAIWithFallback({
        prompt: groqCorePrompt,
        systemPrompt: coreSystemInstruction,
        temperature: 0.8,
        json: true,
        timeoutMs: 5800,
        deadlineMs: CORE_SECTIONS_BUDGET_MS,
        geminiContents: corePrompt,
        geminiSchema: coreSchema,
      });
      const parsed = JSON.parse(text);
      if (!parsed.conversationalEmpathy || !parsed.detailedAnalysis || !parsed.perspectiveShift) {
        throw new Error(`${providerUsed} returned incomplete core sections`);
      }
      return { ...parsed, providerUsed };
    } catch (err) {
      console.warn(`AI providers failed for ${toneFamily} core sections, using local research composer:`, err);
      return local();
    }
  };

  if (tone.label === 'severe' || severeBand) {
    const core = await generateCoreSections('severe');
    return res.json({
      emotionalStateLabel: 'What You Shared Sounds Really Heavy',
      neuralRegion: 'Stress Response System',
      sentimentTone: 'distressed',
      toneLevel: 'severe',
      highlightedPill: `Support Right Now #${questionNumber || 1}`,
      userQuoteAnalysis: userSnippetForTone
        ? `Thank you for being honest about "${userSnippetForTone}" — that takes real courage to put into words.`
        : `What you're describing sounds like a genuinely heavy moment.`,
      conversationalEmpathy: `${core.conversationalEmpathy} If things ever feel unsafe or like too much to handle by yourself, please reach out to one of the support lines below — free, confidential, and staffed by real people ready to listen, any hour. In the meantime, here's something small you can do right now to help your body feel steadier.`,
      detailedAnalysis: core.detailedAnalysis,
      perspectiveShift: core.perspectiveShift,
      immediateSolutionTitle: 'A Few Things That Can Help Right Now',
      immediateActionRightNow: 'Place a hand on your chest, and take one slow breath in through your nose and out through your mouth.',
      immediateSolutionSteps: [
        'Take five slow breaths — in for 4 seconds, out for 6 seconds — to help your body settle.',
        'Name three things you can see around you right now, to bring your mind back to the present.',
        "If you can, reach out to someone you trust — a friend, family member, or one of the helplines below — and let them know how you're feeling.",
        'Be as gentle with yourself as you would be with a close friend going through this.',
      ],
      practicalStepToday: 'If it feels safe to do so, tell one person in your life how you are really doing today.',
      scientificRationale: "Slow, extended-exhale breathing helps calm the body's stress response, and naming things you can see helps bring an overwhelmed mind back to the present moment.",
      interactiveTool: {
        type: 'breathing_sigh',
        title: 'Slow Steady Breathing',
        instructions: 'In for 4 seconds, out for 6 seconds. Let your shoulders drop with every exhale.',
      },
      affirmation: 'This feeling is real, and so is the possibility of things getting lighter. Support is available, and reaching for it is a strong thing to do.',
      helplines: CRISIS_HELPLINES.slice(0, 4).map((hl) => ({ name: hl.name, contact: hl.contact, region: hl.region })),
      suggestedFollowUps: [
        'What can I do if this feeling gets worse tonight?',
        'How do I tell someone close to me how I really feel?',
        'What does a support helpline call actually look like?',
      ],
      providerUsed: core.providerUsed,
      evidenceSources: summarizeSources(passages),
      timestamp: new Date().toISOString(),
    });
  }

  if (tone.label === 'calm' && tone.magnitude >= 0.15 && !severeBand) {
    const core = await generateCoreSections('calm');
    return res.json({
      emotionalStateLabel: 'Steady, Grounded, and Doing Well',
      neuralRegion: 'Balanced Nervous System',
      sentimentTone: 'resilient',
      toneLevel: 'calm',
      isAppreciation: true,
      highlightedPill: `Nice Check-In #${questionNumber || 1}`,
      userQuoteAnalysis: userSnippetForTone
        ? `Reflecting on "${userSnippetForTone}": that's a genuinely good sign — you're in a settled, steady place right now.`
        : `Your answer reflects a calm, settled state of mind.`,
      conversationalEmpathy: core.conversationalEmpathy,
      detailedAnalysis: core.detailedAnalysis,
      perspectiveShift: core.perspectiveShift,
      immediateSolutionTitle: 'Keep This Going',
      immediateActionRightNow: 'Take a moment to actually notice how this steadiness feels in your body.',
      immediateSolutionSteps: [
        'Take a slow breath and notice what "feeling okay" feels like right now — so you can recognize it again later.',
        'Think of one small thing that helped get you here, and consider doing more of it.',
        'If you feel like it, share this good moment with someone close to you.',
      ],
      practicalStepToday: 'Keep up whatever routine, habit, or mindset has been working for you lately.',
      scientificRationale: 'Consciously noticing positive states helps the brain reinforce and return to them more easily over time.',
      affirmation: 'You are doing well, and that is worth recognizing. Keep going.',
      suggestedFollowUps: [
        'What habits have been helping me feel this way?',
        'How do I hold onto this feeling during a stressful week?',
        'What is one small thing I can do to keep this momentum going?',
      ],
      providerUsed: core.providerUsed,
      evidenceSources: summarizeSources(passages),
      timestamp: new Date().toISOString(),
    });
  }

  // Neutral tone: not distressing, but not especially uplifting either.
  // The three core paragraphs below are attempted through Gemini/Groq first
  // (grounded on the same research corpus) and only fall back to the local
  // composer if both providers are unavailable or fail — everything else
  // about this reply (the appreciation framing, the concrete tips) stays
  // exactly as before, so a neutral answer never goes unanswered.
  if (tone.label === 'neutral' && !severeBand) {
    const core = await generateCoreSections('neutral');
    return res.json({
      emotionalStateLabel: 'Steady, With Room To Build',
      neuralRegion: 'Baseline Reward & Regulatory Network',
      sentimentTone: 'seeking_balance',
      toneLevel: 'neutral',
      highlightedPill: `Positivity Boost #${questionNumber || 1}`,
      userQuoteAnalysis: userSnippetForTone
        ? `Reflecting on "${userSnippetForTone}": this reads as fairly even — a stable, workable place to build from.`
        : `Your answer reads as fairly even right now — a stable, workable place to build from.`,
      conversationalEmpathy: core.conversationalEmpathy,
      detailedAnalysis: core.detailedAnalysis,
      perspectiveShift: core.perspectiveShift,
      immediateSolutionTitle: 'Three Small Ways To Add A Little More Light Today',
      immediateActionRightNow: 'Think of one tiny thing that reliably makes you smile, and do it in the next 10 minutes if you can.',
      immediateSolutionSteps: [
        'Do one small thing today purely because you enjoy it, not because it is productive.',
        'Reach out to one person just to say something appreciative, funny, or kind.',
        'Write down one thing, however small, that went okay today.',
        'Get 10 minutes of daylight or movement — both reliably lift baseline mood.',
      ],
      practicalStepToday: 'Pick one of the ideas above and actually do it today, rather than just reading it.',
      scientificRationale: 'Deliberately engaging in small positive-affect activities (behavioral activation) reliably raises baseline mood and reward signaling, even when nothing is "wrong" to begin with.',
      interactiveTool: {
        type: 'dopamine_spark',
        title: 'Micro-Joy Spark',
        instructions: 'Think of the smallest possible thing that would make the next hour 5% better, and do it.',
      },
      affirmation: 'I do not need to wait for a hard moment to invest in my own wellbeing.',
      suggestedFollowUps: [
        'What are some small things that reliably boost my mood?',
        'How can I build more positive moments into an ordinary day?',
        'What is behavioral activation and why does it work?',
      ],
      providerUsed: core.providerUsed,
      evidenceSources: summarizeSources(passages),
      timestamp: new Date().toISOString(),
    });
  }

  const prompt = `The user is participating in an interactive mental health evaluation and is currently answering Question #${questionNumber || 1} of ${totalQuestions || 20}:
Screening Category: "${category || 'Emotional State'}"
Question: "${questionText || 'How have you been feeling?'}"

User's Raw Personal Expressed Feeling / Answer:
"""${userText || 'I am having trouble putting my exact feelings into words, but I am feeling stressed and overwhelmed.'}"""

${buildResearchBrief(theme, passages)}

${psycheBrief}

DATASET-GROUNDING RULE: Treat retrieved examples as style/strategy references, not diagnoses or scripts. Never copy them verbatim or mention the dataset.
${clientIntel.block ? `\n${clientIntel.block}` : ''}

${buildSectionFormatRules()}

TASK:
Respond the way a real, licensed clinical psychologist would in an actual session — someone warm, present, and genuinely paying attention, not a chatbot reciting a script.
Your response must NOT be vague, robotic, generic, or over-technical.
1. Directly address the user in the second person ("you").
2. Validate their emotional experience with real empathy and attunement — reflect their exact words or phrases back to them naturally, the way a therapist would when showing they were truly listening.
3. Deliver the empathetic assessment ('conversationalEmpathy') as ONE cohesive, high-detail, medium-length paragraph (110-160 words) that makes them feel genuinely heard, understood, and safe — plain, human language first, not a lecture.
4. Explain what is happening in their nervous system ('detailedAnalysis') as ONE cohesive, high-detail, medium-length paragraph (100-145 words): the psychology AND body-level mechanism behind their exact reported experience, grounded in the RESEARCH GROUNDING above and expressed in plain language, ending by separating physiology from identity.
5. Offer the cognitive perspective shift ('perspectiveShift') as ONE cohesive paragraph (60-100 words) that dispels self-judgment using the research lens and ends with one concrete forward-looking sentence.
6. Provide a concrete, highly specific immediate solution ('immediateActionRightNow' and 3-4 detailed 'immediateSolutionSteps') tailored specifically to what they expressed, plus a realistic step for the rest of today ('practicalStepToday').
7. Propose 3 intuitive, thought-provoking follow-up questions ('suggestedFollowUps') they can ask you next.`;

  const systemInstruction = `You are a warm, experienced, licensed clinical psychologist speaking directly with a client during a check-in. You have deep, genuine knowledge of psychology and neuroscience, but you never lead with jargon or sound like an AI reciting facts — you sound like a real, caring human expert who is actually paying attention to what this specific person said.
When someone shares a struggle, you respond the way a skilled therapist does in the room: warm, unhurried, validating, specific to their exact words — never a generic template, never clinical detachment, never toxic positivity.
Keep clinical or neuroscience terms only where they genuinely help the person understand themselves, and always explain them in plain, human language rather than jargon for its own sake.
Your goal is for the user to feel like they are talking with the most attentive, emotionally intelligent human expert they've ever spoken with — not a machine.`;

  // Total time we are willing to spend on AI providers for one answer. The client
  // gives up (and uses the instant local generator) shortly after this, so there is
  // no point in any provider running past it.
  const AI_BUDGET_MS = 8500;
  const isUsableSolution = (o: any) =>
    o && typeof o === 'object' && o.immediateSolutionTitle && o.immediateSolutionSteps;

  {
    const feelingSolutionSchema = {
              type: Type.OBJECT,
              properties: {
                emotionalStateLabel: {
                  type: Type.STRING,
                  description: "Precise psychological state name, e.g., 'Acute Emotional Exhaustion with Amygdala Hyper-Reactivity'",
                },
                neuralRegion: {
                  type: Type.STRING,
                  description: "Specific neural circuits involved, e.g., 'Anterior Cingulate Cortex, Amygdala & Vagus Nerve'",
                },
                sentimentTone: {
                  type: Type.STRING,
                  description: "One of 'anxious', 'fatigued', 'distressed', 'disconnected', 'resilient', 'seeking_balance'",
                },
                userQuoteAnalysis: {
                  type: Type.STRING,
                  description: "Direct reflection quoting what they shared and explaining why their reaction is completely valid.",
                },
                conversationalEmpathy: {
                  type: Type.STRING,
                  description:
                    "Exactly ONE cohesive paragraph, 110-160 words: empathetic assessment and reflection that mirrors the user's own words, validates the lived experience, normalizes it without minimizing, and closes with alliance. High detail, no bullets, no line breaks.",
                },
                detailedAnalysis: {
                  type: Type.STRING,
                  description:
                    "Exactly ONE cohesive paragraph, 100-145 words: what is happening in their nervous system and psychology behind their exact reported experience, grounded in the research grounding (polyvagal state ladder / neuroception, PROMIS distress continuum, CAT-DI subdomains, TIP 57 adaptation lens) in plain language, ending by separating physiology from identity. No bullets, no line breaks.",
                },
                perspectiveShift: {
                  type: Type.STRING,
                  description:
                    "Exactly ONE cohesive paragraph, 60-100 words: a transformative cognitive reframe that lifts guilt, shame, or despair, backed by the research lens, ending with one concrete forward-looking sentence. No bullets, no line breaks.",
                },
                immediateSolutionTitle: {
                  type: Type.STRING,
                  description: "Specific, captivating title for their personalized coping strategy.",
                },
                immediateActionRightNow: {
                  type: Type.STRING,
                  description: "A precise, soothing action they can do in the next 60 seconds right at their seat.",
                },
                immediateSolutionSteps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "3 to 4 detailed, concrete steps that actually solve or relieve this exact state.",
                },
                practicalStepToday: {
                  type: Type.STRING,
                  description: "A gentle, low-friction micro-step for later today.",
                },
                scientificRationale: {
                  type: Type.STRING,
                  description: "Evidence-based neuroscience or psychological research supporting this solution.",
                },
                interactiveTool: {
                  type: Type.OBJECT,
                  properties: {
                    type: {
                      type: Type.STRING,
                      description: "One of 'breathing_sigh', 'grounding_54321', 'cognitive_defusion', 'somatic_release', 'dopamine_spark'",
                    },
                    title: { type: Type.STRING },
                    instructions: { type: Type.STRING },
                  },
                  required: ['type', 'title', 'instructions'],
                },
                affirmation: {
                  type: Type.STRING,
                  description: "A deeply resonant, realistic affirmation without toxic positivity.",
                },
                highlightedPill: {
                  type: Type.STRING,
                  description: "Short badge e.g. '✨ AI Real-Time Calibrated Solution'",
                },
                suggestedFollowUps: {
                  type: Type.ARRAY,
                  items: { type: Type.STRING },
                  description: "3 smart follow-up prompts the user can click to ask you next.",
                },
              },
              required: [
                'emotionalStateLabel',
                'neuralRegion',
                'sentimentTone',
                'userQuoteAnalysis',
                'conversationalEmpathy',
                'detailedAnalysis',
                'perspectiveShift',
                'immediateSolutionTitle',
                'immediateActionRightNow',
                'immediateSolutionSteps',
                'practicalStepToday',
                'scientificRationale',
                'interactiveTool',
                'affirmation',
                'highlightedPill',
                'suggestedFollowUps',
              ],
    };

    const groqFeelingPrompt = `${prompt}\n\nRespond strictly with a valid JSON object matching the fields: emotionalStateLabel, neuralRegion, sentimentTone, userQuoteAnalysis, conversationalEmpathy (one cohesive 110-160 word paragraph), detailedAnalysis (one cohesive 100-145 word paragraph), perspectiveShift (one cohesive 60-100 word paragraph), immediateSolutionTitle, immediateActionRightNow, immediateSolutionSteps (array of strings), practicalStepToday, scientificRationale, interactiveTool (type, title, instructions), affirmation, highlightedPill, suggestedFollowUps (array of 3 strings).`;

    try {
      const { text, providerUsed } = await callAIWithFallback({
        prompt: groqFeelingPrompt,
        systemPrompt: systemInstruction + langDirective(req),
        temperature: 0.7,
        json: true,
        timeoutMs: 8000,
        deadlineMs: AI_BUDGET_MS,
        geminiContents: prompt,
        geminiSchema: feelingSolutionSchema,
      });
      const parsed = JSON.parse(text);
      if (!isUsableSolution(parsed)) throw new Error(`${providerUsed} returned an incomplete solution`);
      return res.json({
        ...parsed,
        providerUsed,
        evidenceSources: summarizeSources(passages),
        psycheExamplesUsed: psycheExamples.length,
        timestamp: new Date().toISOString(),
      });
    } catch (err) {
      console.warn('AI providers failed for feeling-solution, using local generator:', err);
    }
  }

  return res.json({
    fallbackToLocal: true,
    message: 'Using built-in dynamic neuro-solution generator.',
  });
});

// Interactive AI Follow-Up Endpoint (chat with the AI about this specific feeling/solution)
app.post('/api/solution-followup', async (req, res) => {
  const { questionText, userAnswer, solutionContext, userFollowUp, history } = req.body || {};

  if (!userFollowUp || typeof userFollowUp !== 'string') {
    return res.status(400).json({ error: 'Follow-up query is required' });
  }

  // Accept both naming styles for the context the client sends.
  const ctx = solutionContext || {};
  const stateLabel = ctx.emotionalState || ctx.emotionalStateLabel || '';
  const solutionTitle = ctx.title || ctx.immediateSolutionTitle || '';
  const neuro = String(ctx.neurobiology || '').slice(0, 500);
  const clip = (t: any, n: number) => String(t ?? '').slice(0, n);

  // Last few turns only (keeps tokens low, keeps the conversation coherent).
  const turns: Array<{ role: 'user' | 'assistant'; content: string }> = (Array.isArray(history) ? history : [])
    .filter((m: any) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-6)
    .map((m: any) => ({ role: m.role, content: clip(m.content, 700) }));

  // Keep the conversation grounded in the same evidence the solution used.
  const { theme, passages } = resolveGrounding(
    req.body,
    `${questionText || ''} ${userAnswer || ''} ${userFollowUp}`
  );
  const wellnessBlock = buildWellnessProfileBlock(req.body?.wellnessProfile);

  // PRIMARY classifier framing for the chat: when the client's semantic profile
  // carries a NeuroScope reading, the reply must stay consistent with it.
  const nsChat = sanitizeNeuroScopeReading(req.body?.semanticProfile?.neuroscope);
  const nsChatDirective = nsChat
    ? `\nPRIMARY READING (on-device fine-tuned NeuroScope DistilBERT — the clinical authority you are communicating): this answer classified as "${nsChat.topStatus}" (${Math.round(
        nsChat.pTop * 100
      )}% confidence, risk probability ${Math.round(nsChat.pRisk * 100)}%, band ${nsChat.band}). Stay consistent with that read: support without dismissing when the band is elevated/high/critical; encourage without inventing problems when it reads Normal.`
    : '';

  const systemInstruction = `You are a warm, perceptive, licensed clinical psychologist chatting with a client during a mental-health check-in — a real human expert having a genuine conversation, not a bot following a script.

WHAT THEY TOLD YOU EARLIER
- Check-in question: "${clip(questionText || 'Mental health check-in', 300)}"
- Their own words: "${clip(userAnswer || 'not provided', 800)}"
${stateLabel ? `- Emotional state identified: ${clip(stateLabel, 120)}\n` : ''}${solutionTitle ? `- Technique already suggested to them: ${clip(solutionTitle, 160)}\n` : ''}${neuro ? `- Background insight: ${neuro}\n` : ''}
HOW TO REPLY
- Answer THEIR latest message directly and specifically. Refer to their actual situation and words; never reply with a generic template.
- Use the conversation so far; do not repeat advice you already gave, build on it.
- Warm, natural, conversational: 2-4 short paragraphs (about 80-180 words). Give 1-3 concrete, practical steps that fit what they said. Ask at most one gentle question, and only if it helps.
- No lecturing, no boilerplate disclaimers, no diagnoses. If they mention self-harm or being unsafe, respond with care and urge them to contact local emergency services or a crisis line right now.
${nsChatDirective}
${wellnessBlock ? `\n${wellnessBlock}` : ''}
${buildResearchBrief(theme, passages)}
Draw on a finding above only where it genuinely helps answer THEIR latest message, in plain language, never as a citation list.`;

  const userTurn = clip(userFollowUp, 1500);

  // Same idea as AI_BUDGET_MS in /api/feeling-solution: without an explicit
  // budget here, callAIWithFallback defaults to a 30s-per-model Groq timeout
  // (and a 22s Gemini deadline) with no overall cap — fine on a long-running
  // local dev server, but on Vercel's serverless functions (10s default
  // execution limit) the whole function gets killed before that chain can
  // ever finish, so the client sees a failed fetch and falls back to the
  // offline/local reply even when the keys are configured correctly.
  const FOLLOWUP_BUDGET_MS = 8500;

  try {
    // Plain-text mode: json_object mode would force JSON output.
    const { text, providerUsed } = await callAIWithFallback({
      prompt: userTurn,
      systemPrompt: systemInstruction + langDirective(req),
      temperature: 0.8,
      json: false,
      history: turns,
      timeoutMs: 8000,
      deadlineMs: FOLLOWUP_BUDGET_MS,
    });
    const reply = text.trim();
    if (reply) {
      return res.json({ reply, providerUsed, timestamp: new Date().toISOString() });
    }
  } catch (err) {
    console.warn('All AI providers failed for solution-followup:', err);
  }

  // No remote AI provider configured/reachable — still specific to what the user asked.
  const chatEmotions = req.body?.semanticProfile?.emotions;
  const localReply = generateDynamicFollowUpReply(userFollowUp, {
    questionText,
    userAnswer,
    solutionTitle,
    emotionalStateLabel: stateLabel,
    neurobiology: neuro,
    dominantEmotion: chatEmotions && chatEmotions.source === 'transformer' ? chatEmotions.top?.label : undefined,
    riskBand: nsChat?.band,
  });

  return res.json({
    reply: localReply.reply,
    suggestedAction: localReply.suggestedAction,
    providerUsed: 'local',
    timestamp: new Date().toISOString(),
  });
});

// Custom Re-Assessment Endpoint (When user expresses additional feelings)
app.post('/api/reassess', async (req, res) => {
  const { answers, customFeedback, previousVerdict } = req.body;
  const psycheExamples = sanitizePsycheExamples(req.body.psycheExamples, 8);
  const psycheBrief = buildPsycheExamplesBrief(psycheExamples);

  if (!customFeedback || typeof customFeedback !== 'string') {
    return res.status(400).json({ error: 'Custom feedback is required' });
  }

  const { theme, passages } = resolveGrounding(req.body, customFeedback);
  const clientIntel = buildClientSignalBlock(req.body);

  const prompt = `The user completed their 20-question mental health evaluation, where their preliminary verdict was: "${previousVerdict || 'Initial Assessment'}".
However, the user has submitted their personal custom expression at the end, and DEMANDS A COMPLETELY FRESH, RECALIBRATED CLINICAL REPORT that directly reflects their real-time state:
"${customFeedback}"

Prior screening highlights:
${(answers || []).slice(0, 5).map((a: { questionText: string; answer: string }) => `- ${a.questionText}: ${a.answer}`).join('\n')}

${buildResearchBrief(theme, passages)}\n\n${psycheBrief}\n\nDATASET-GROUNDING RULE: Retrieved examples are references for empathy and strategy only. Do not copy them or infer a diagnosis from similarity.${clientIntel.block ? `\n\n${clientIntel.block}` : ''}

CRITICAL RECALIBRATION MANDATES:
1. GENERATE A BRAND NEW REPORT. Do NOT repeat previous text.
2. The 'overallVerdict' title MUST be brand new, specific to their custom expression, and formatted as: "Recalibrated: <Specific State Based on Feedback>" (for example, if they expressed heartbreak or grief, use "Recalibrated: Acute Relational Heartbreak & Emotional Decompression"; if burnout, "Recalibrated: Cumulative Physiological Burnout & Rest Recovery").
3. The 'verdictSummary' MUST quote and directly analyze their custom words: "${customFeedback}". Explain with neuroscience and psychology why they feel this way and validate their emotional experience deeply.
4. The 'motivationalMessage' MUST be freshly composed, deeply empathetic, and directly speak to what they wrote.
5. In 'dimensionalScores', adjust the category scores and summaries so they accurately reflect their custom expression (e.g. drop Social Connections or Mood score if they express heartbreak, grief, or loneliness).
6. In 'personalizedSolutions', provide 3 to 4 actionable, evidence-based neuro-calibrated solutions tailored specifically to their exact expressed concern. The first 1-2 solutions MUST be bespoke interventions addressing their exact dilemma (e.g. heartbreak somatic soothing, academic working memory shield, workplace boundary containment). For each solution, set matchedTrigger (e.g. '✨ Dynamically Calibrated to your words: "${customFeedback.slice(0, 35)}..."'), neuroTarget, timeEstimate, and interactiveToolType ('breathing' | 'timer' | 'grounding' | 'journal').
7. If the user expresses thoughts of self-harm, severe crisis, or suicide, set 'isSafetyCritical' to true.`;

  const systemInstruction = `You are a warm, experienced, licensed clinical psychologist who has just heard your client say more about how they're really feeling, and you're revising your impression of them accordingly — the way a real therapist naturally updates their understanding of someone, not a system regenerating a template. Listen closely to what the user expressed, validate their emotions with genuine warmth and care in plain human language, and write a truly fresh, specific response to what they actually said. Respond strictly in valid JSON.`;

  const reassessSchema = {
    type: Type.OBJECT,
    properties: {
      overallVerdict: { type: Type.STRING },
      severityLevel: {
        type: Type.STRING,
        enum: ['optimal', 'mild', 'moderate', 'high', 'critical'],
      },
      verdictSummary: { type: Type.STRING },
      motivationalMessage: { type: Type.STRING },
      dimensionalScores: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            category: { type: Type.STRING },
            score: { type: Type.NUMBER },
            status: { type: Type.STRING },
            summary: { type: Type.STRING },
          },
          required: ['category', 'score', 'status', 'summary'],
        },
      },
      personalizedSolutions: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            id: { type: Type.STRING },
            title: { type: Type.STRING },
            category: { type: Type.STRING },
            difficulty: { type: Type.STRING },
            actionSteps: {
              type: Type.ARRAY,
              items: { type: Type.STRING },
            },
            scientificRationale: { type: Type.STRING },
            matchedTrigger: { type: Type.STRING },
            neuroTarget: { type: Type.STRING },
            timeEstimate: { type: Type.STRING },
            interactiveToolType: { type: Type.STRING },
          },
          required: ['id', 'title', 'category', 'difficulty', 'actionSteps', 'scientificRationale'],
        },
      },
      isSafetyCritical: { type: Type.BOOLEAN },
      safetyGuidance: { type: Type.STRING },
    },
    required: ['overallVerdict', 'severityLevel', 'verdictSummary', 'motivationalMessage', 'dimensionalScores', 'personalizedSolutions'],
  };

  try {
    // The client (handleCustomReassess in App.tsx) already shows an instant
    // local result and aborts this fetch after 3.5s, so — same reasoning as
    // FOLLOWUP_BUDGET_MS above — an unbounded call here just burns Vercel
    // execution time on a response nobody is still waiting for. Keep it well
    // under the client's own abort window.
    const { text, providerUsed } = await callAIWithFallback({
      prompt,
      systemPrompt: systemInstruction + langDirective(req),
      temperature: 0.6,
      json: true,
      geminiSchema: reassessSchema,
      timeoutMs: 2800,
      deadlineMs: 3000,
    });
    const parsed = sanitizeParsedDimensionScores(applyPrimarySeverityFloor(JSON.parse(text), req.body));
    const assessmentData = {
      ...parsed,
      providerUsed,
      isCustomRevised: true,
      customFeedbackNote: customFeedback,
      timestamp: new Date().toISOString(),
      riskAssessment: clientIntel.risk,
      evidenceSources: summarizeSources(passages),
      safetyAlert: parsed.isSafetyCritical || clientIntel.risk?.level === 'critical' || hasPrimaryCritical(req.body)
        ? {
            isCritical: true,
            guidance: parsed.safetyGuidance || 'Immediate support is available. Please reach out to trusted professionals.',
            helplineNumbers: CRISIS_HELPLINES,
          }
        : undefined,
    };
    return res.json({
      ...assessmentData,
      assessment: assessmentData,
    });
  } catch (e) {
    console.warn('All AI providers failed for /api/reassess:', e);
  }

  // Fallback
  return res.json({
    fallbackToLocal: true,
    message: 'Using built-in wellness engine for recalibration.',
  });
});

/* ------------------------------------------------------------------
 * Per-dimension deep dive (dropdown on each Biopsychosocial card)
 * ------------------------------------------------------------------
 * Combines THREE ingredients into one brief:
 *   1. Gemini  — independent structured draft
 *   2. Groq    — independent structured draft
 *   3. The project research corpus (papers + books) — the numbered evidence
 *      both models are grounded on, also shown back to the person as sources.
 * When both models answer, a synthesis pass reconciles the two drafts against
 * the same evidence (with a deterministic merge if that pass fails). If only
 * one provider works it is used alone; if none does, a research-only local
 * composition is returned, so the dropdown never opens empty.
 */

const DIMENSION_GEMINI_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    headline: { type: Type.STRING },
    conditionSummary: { type: Type.STRING },
    keyObservations: { type: Type.ARRAY, items: { type: Type.STRING } },
    strengths: { type: Type.ARRAY, items: { type: Type.STRING } },
    watchPoints: { type: Type.ARRAY, items: { type: Type.STRING } },
    researchInsight: { type: Type.STRING },
    nextSteps: { type: Type.ARRAY, items: { type: Type.STRING } },
    whenToSeekSupport: { type: Type.STRING },
    usedSources: { type: Type.ARRAY, items: { type: Type.NUMBER } },
  },
  required: [
    'headline',
    'conditionSummary',
    'keyObservations',
    'strengths',
    'watchPoints',
    'researchInsight',
    'nextSteps',
    'whenToSeekSupport',
    'usedSources',
  ],
};

function sanitizeDimension(input: any): DimensionScore | null {
  if (!input || typeof input !== 'object') return null;
  const category = typeof input.category === 'string' ? input.category.trim().slice(0, 120) : '';
  const score = coerceScore(input.score);
  if (!category || score === null) return null;
  return {
    category,
    score: Math.max(0, Math.min(100, Math.round(score))),
    status: statusForScore(Math.max(0, Math.min(100, Math.round(score))), input.status),
    summary: typeof input.summary === 'string' ? input.summary.slice(0, 400) : '',
  };
}

function sanitizeAnswerRecords(input: any): AnswerRecord[] {
  if (!Array.isArray(input)) return [];
  return input
    .slice(0, 60)
    .filter((a) => a && typeof a === 'object')
    .map((a: any) => ({
      questionId: Math.round(finite(a.questionId) ?? 0),
      questionText: String(a.questionText ?? '').slice(0, 300),
      category: String(a.category ?? '').slice(0, 120),
      answer: String(a.answer ?? '').slice(0, 800),
    }));
}

app.post('/api/dimension-insight', async (req, res) => {
  const body = req.body || {};
  const dimension = sanitizeDimension(body.dimension);
  if (!dimension) {
    return res.status(400).json({ error: 'A dimension with a category and score is required' });
  }

  const allAnswers = sanitizeAnswerRecords(body.answers);
  const dimAnswers = answersForCategory(allAnswers, dimension.category);
  const risk = sanitizeRisk(body.riskAssessment);
  const clientIntel = buildClientSignalBlock(body);
  const neuroscopeReadings = sanitizeNeuroScopeReadings(body.neuroscopeReadings);
  const others = (Array.isArray(body.otherDimensions) ? body.otherDimensions : [])
    .map(sanitizeDimension)
    .filter((d: DimensionScore | null): d is DimensionScore => !!d)
    .slice(0, 8);
  const overallVerdict = typeof body.overallVerdict === 'string' ? body.overallVerdict.slice(0, 200) : undefined;
  const severityLevel = typeof body.severityLevel === 'string' ? body.severityLevel.slice(0, 20) : undefined;
  const customFeedback = typeof body.customFeedback === 'string' ? body.customFeedback.slice(0, 500) : undefined;

  // Ingredient 3: research corpus (papers + books), ranked for THIS dimension.
  // Passages the browser already retrieved semantically get a ranking boost.
  const ranked = retrieveDimensionPassages({
    category: dimension.category,
    answers: dimAnswers,
    score: dimension.score,
    riskLevel: risk?.level,
    candidates: sanitizePassages(body.researchPassages, 8),
    limit: 6,
  });
  const passages = mergePassageLists(ranked, [], 6);

  const promptInput: DimensionPromptInput = {
    dimension,
    answers: dimAnswers,
    otherDimensions: others,
    overallVerdict,
    severityLevel,
    riskLevel: risk?.level,
    passages,
    customFeedback,
  };

  const system = buildDimensionSystemPrompt() + langDirective(req);
  // The primary classifier's run-wide reading is appended to the user prompt so
  // both model drafts (and the synthesis) are framed by the trained model.
  const user = `${buildDimensionUserPrompt(promptInput)}\n\n${buildNeuroScopePromptBlock(neuroscopeReadings)}${clientIntel.block ? `\n\n${clientIntel.block}` : ''}`;
  const hasGemini = !!process.env.GEMINI_API_KEY;
  // Dimension insight is a communication-layer route (drafts an explanation),
  // so it draws from the communication Groq pool, same as the solution routes.
  const hasGroq = COMM_GROQ_KEYS.length > 0;

  // Ingredients 1 + 2 run in parallel — independent drafts on identical evidence.
  // Groq internally tries its primary key, then its secondary key, before
  // this draft counts as unavailable.
  const [geminiOutcome, groqOutcome] = await Promise.allSettled([
    hasGemini
      ? (async () => {
          const ai = getGeminiClient();
          if (!ai) throw new Error('Gemini client unavailable');
          const { response } = await generateGeminiContentWithFallback(ai, {
            fast: true,
            timeoutMs: 13000,
            deadlineMs: 14000,
            contents: user,
            config: {
              systemInstruction: system,
              temperature: 0.6,
              responseMimeType: 'application/json',
              responseSchema: DIMENSION_GEMINI_SCHEMA,
            },
          });
          return response.text || '';
        })()
      : Promise.reject(new Error('GEMINI_API_KEY is not set')),
    hasGroq
      ? callGroqWithKeyFallback(user, system, 0.6, true, [], { timeoutMs: 13000, deadlineMs: 14000 }, COMM_GROQ_KEYS).then((r) => r.text)
      : Promise.reject(new Error('No GROQ_API_KEY configured')),
  ]);

  const geminiDraft =
    geminiOutcome.status === 'fulfilled' ? parseInsightDraft(geminiOutcome.value, passages.length) : null;
  const groqDraft =
    groqOutcome.status === 'fulfilled' ? parseInsightDraft(groqOutcome.value, passages.length) : null;
  if (hasGemini && !geminiDraft) {
    console.warn('Dimension insight: Gemini draft unavailable:', (geminiOutcome as any).reason || 'unparseable output');
  }
  if (hasGroq && !groqDraft) {
    console.warn('Dimension insight: Groq draft unavailable:', (groqOutcome as any).reason || 'unparseable output');
  }

  // Neither cloud draft came back (both providers down/unconfigured/rate-limited):
  // try local Phi-4-mini once as a single-model draft before giving up on AI
  // entirely, so this endpoint follows the same "never fails" chain as the rest.
  let localDraft: DimensionInsightDraft | null = null;
  if (!geminiDraft && !groqDraft && LOCAL_LLM_ENABLED) {
    try {
      const raw = await callLocalPhiAPI(user, system, 0.6, true, [], { timeoutMs: 20000 });
      localDraft = parseInsightDraft(raw, passages.length);
    } catch (err) {
      console.warn('Dimension insight: local Phi-4-mini draft unavailable:', err);
    }
  }

  const respond = (draft: DimensionInsightDraft, mode: DimensionInsight['mode'], synthesized: boolean) =>
    res.json({
      insight: finalizeInsight(draft, passages, {
        category: dimension.category,
        mode,
        gemini: !!geminiDraft,
        groq: !!groqDraft,
        synthesized,
      }),
    });

  // Both models answered: reconcile them (one final pass against the same evidence).
  if (geminiDraft && groqDraft) {
    const synthUser = buildSynthesisUserPrompt(promptInput, geminiDraft, groqDraft);
    let finalDraft: DimensionInsightDraft | null = null;

    try {
      const ai = getGeminiClient();
      if (ai) {
        const { response } = await generateGeminiContentWithFallback(ai, {
          fast: true,
          timeoutMs: 9000,
          deadlineMs: 10000,
          contents: synthUser,
          config: {
            systemInstruction: system,
            temperature: 0.4,
            responseMimeType: 'application/json',
            responseSchema: DIMENSION_GEMINI_SCHEMA,
          },
        });
        finalDraft = parseInsightDraft(response.text || '', passages.length);
      }
    } catch (err) {
      console.warn('Dimension insight: Gemini synthesis failed, trying Groq:', err);
    }

    if (!finalDraft) {
      try {
        const raw = await callGroqAPI(synthUser, system, 0.4, true, [], { timeoutMs: 9000, deadlineMs: 10000 });
        finalDraft = parseInsightDraft(raw, passages.length);
      } catch (err) {
        console.warn('Dimension insight: Groq synthesis failed, merging drafts deterministically:', err);
      }
    }

    if (finalDraft) return respond(finalDraft, 'gemini+groq', true);
    return respond(mergeInsightDrafts(geminiDraft, groqDraft), 'gemini+groq', false);
  }

  if (geminiDraft) return respond(geminiDraft, 'gemini', false);
  if (groqDraft) return respond(groqDraft, 'groq', false);
  if (localDraft) return respond(localDraft, 'local', false);

  // No provider available: research-and-answers-only composition.
  return res.json({
    insight: buildLocalDimensionInsight({
      dimension,
      answers: dimAnswers,
      passages,
      riskLevel: risk?.level,
    }),
  });
});

export default app;
export { app };