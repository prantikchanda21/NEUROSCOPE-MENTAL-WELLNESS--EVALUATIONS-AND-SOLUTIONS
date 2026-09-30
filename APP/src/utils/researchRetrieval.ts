import { CORPUS_SOURCES, RESEARCH_CORPUS, ResearchPassage } from '../data/researchCorpus.js';
import { RetrievedPassage, ResearchTheme, detectResearchTheme } from './researchKnowledge.js';
import {
  embedCached,
  embedMany,
  cosineSimilarity,
  isModelReady,
  semanticRelevanceScore,
} from './semanticEngine.js';

/**
 * Research retrieval
 * ------------------
 * Matches the user's own words against the project research corpus
 * (four peer-reviewed papers + eleven clinical/neuroscience books —
 * src/data/researchCorpus.ts) so that every generated solution is grounded in
 * passages that actually apply to what this person said.
 *
 * Two retrieval paths, same output shape:
 *  1. Semantic vector search — the answer and every passage are embedded with
 *     all-MiniLM-L6-v2 and ranked by cosine similarity (this is the primary
 *     path, and it is what makes the retrieval topic-aware rather than
 *     keyword-bound: "my chest gets tight before meetings" retrieves the
 *     neuroception passage even though it shares no words with it).
 *  2. Lexicon/keyword overlap fallback — used when the transformer runtime is
 *     unavailable (offline, non-browser, or still warming), so retrieval
 *     never silently returns nothing.
 */

/** How many passages are shipped to the prompt / woven into local paragraphs. */
export const MAX_RETRIEVED_PASSAGES = 4;

const THEME_BONUS = 0.06;
const MIN_PASSAGE_SCORE = 0.12;

/** Precomputed corpus text used for embedding (kept stable so the embedding
 * cache key never changes shape between calls). */
function passageEmbeddingText(p: ResearchPassage): string {
  return `${p.theme.replace(/_/g, ' ')} ${p.text} ${p.keywords.join(' ')}`;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'to', 'of', 'in', 'on', 'for', 'with', 'my', 'me', 'i', 'it', 'that', 'this',
  'have', 'has', 'had', 'do', 'does', 'did', 'not', 'as', 'at', 'by', 'from',
  'so', 'if', 'than', 'then', 'about', 'over', 'feel', 'feeling', 'feels',
]);

function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z']+/g) || []).filter(
    (t) => t.length > 2 && !STOPWORDS.has(t)
  );
}

/** Lexicon overlap score in 0..1 — the offline fallback relevance signal. */
function keywordOverlap(answerTokens: string[], passage: ResearchPassage): number {
  if (answerTokens.length === 0) return 0;
  const haystack = `${passage.text} ${passage.keywords.join(' ')} ${passage.theme}`.toLowerCase();
  let hits = 0;
  for (const token of new Set(answerTokens)) {
    if (haystack.includes(token)) hits += 1;
  }
  return Math.min(1, hits / Math.max(3, answerTokens.length * 0.5));
}

function toRetrieved(passage: ResearchPassage, score: number): RetrievedPassage {
  return {
    id: passage.id,
    source: passage.source,
    sourceShort: CORPUS_SOURCES[passage.sourceKey]?.short,
    kind: passage.kind,
    theme: passage.theme,
    text: passage.text,
    plain: passage.plain,
    score,
  };
}

/** Deterministic, dependency-free retrieval (also the graceful fallback). */
export function retrievePassagesLexical(
  answerText: string,
  theme?: ResearchTheme,
  limit: number = MAX_RETRIEVED_PASSAGES
): RetrievedPassage[] {
  const resolvedTheme = theme || detectResearchTheme(answerText);
  const tokens = tokenize(answerText || '');

  const scored = RESEARCH_CORPUS.map((passage) => {
    let score = keywordOverlap(tokens, passage);
    if (passage.theme === resolvedTheme) score += THEME_BONUS;
    return { passage, score };
  });

  // A theme match alone should still yield grounding even for a one-word
  // answer, so passages are padded by theme when overlap is thin.
  const ranked = scored.sort((a, b) => b.score - a.score);
  const selected = ranked.filter((r) => r.score >= MIN_PASSAGE_SCORE).slice(0, limit);
  if (selected.length < Math.min(2, limit)) {
    for (const candidate of ranked) {
      if (selected.length >= Math.min(2, limit)) break;
      if (!selected.some((s) => s.passage.id === candidate.passage.id)) selected.push(candidate);
    }
  }
  return selected.map((r) => toRetrieved(r.passage, Number(r.score.toFixed(3))));
}

/** Passage vectors are static for the app's lifetime, so they are embedded ONCE
 * (in a few small batches, in the background) and reused for every answer. The
 * previous version embedded the 50+ passages one at a time, back to back, inside
 * the first submit — which is a large part of why that click felt stuck. */
let corpusVectors: Map<string, Float32Array> | null = null;
let corpusPromise: Promise<Map<string, Float32Array> | null> | null = null;

export function warmResearchEmbeddings(): Promise<Map<string, Float32Array> | null> {
  if (corpusVectors) return Promise.resolve(corpusVectors);
  if (!corpusPromise) {
    const texts = RESEARCH_CORPUS.map(passageEmbeddingText);
    corpusPromise = embedMany(texts, 20000)
      .then((vectors) => {
        if (!vectors || vectors.length !== texts.length) return null;
        const map = new Map<string, Float32Array>();
        RESEARCH_CORPUS.forEach((passage, idx) => map.set(passage.id, vectors[idx]));
        corpusVectors = map;
        return map;
      })
      .catch(() => null)
      .then((result) => {
        if (!result) corpusPromise = null; // allow a later retry
        return result;
      });
  }
  return corpusPromise;
}

/**
 * Semantic retrieval: embeds the answer and ranks passages by cosine
 * similarity against precomputed corpus vectors, with the theme match added
 * as a small tie-breaker. Falls back to `retrievePassagesLexical` whenever the
 * embedding runtime cannot serve a vector in time.
 */
export async function retrievePassages(
  answerText: string,
  options: {
    theme?: ResearchTheme;
    category?: string;
    limit?: number;
    timeoutMs?: number;
  } = {}
): Promise<RetrievedPassage[]> {
  const limit = options.limit ?? MAX_RETRIEVED_PASSAGES;
  const theme = options.theme || detectResearchTheme(answerText || '', options.category || '');

  const queryText = (answerText || '').trim() || `${theme.replace(/_/g, ' ')} ${options.category || ''}`.trim();
  if (!queryText) return retrievePassagesLexical(answerText, theme, limit);

  const timeoutMs = options.timeoutMs ?? 6000;
  try {
    let vectors = corpusVectors;
    if (!vectors) {
      if (!isModelReady('embedding')) return retrievePassagesLexical(answerText, theme, limit);
      // Normally finished long before now (started when the check-in began); if not,
      // give it a short, bounded moment instead of holding the click.
      vectors = await Promise.race([
        warmResearchEmbeddings(),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 1500)),
      ]);
      if (!vectors) return retrievePassagesLexical(answerText, theme, limit);
    }

    const queryVector = await embedCached(queryText, timeoutMs);
    if (!queryVector) return retrievePassagesLexical(answerText, theme, limit);

    const scored: Array<{ passage: ResearchPassage; score: number }> = [];
    for (const passage of RESEARCH_CORPUS) {
      const vector = vectors.get(passage.id);
      if (!vector) continue;
      const cos = cosineSimilarity(queryVector, vector);
      // Same blend as before: cosine + theme tie-breaker (60%), stretched
      // semantic relevance (40%).
      const base = Math.max(0, cos) + (passage.theme === theme ? THEME_BONUS : 0);
      scored.push({ passage, score: base * 0.6 + semanticRelevanceScore(cos) * 0.4 });
    }

    if (scored.length === 0) return retrievePassagesLexical(answerText, theme, limit);

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => toRetrieved(s.passage, Number(s.score.toFixed(3))));
  } catch (err) {
    console.info('Research retrieval fell back to lexical matching:', err);
    return retrievePassagesLexical(answerText, theme, limit);
  }
}

/** Normalizes passages that arrived over the wire (client -> server) so they
 * can be trusted as prompt input: shape-checked, capped, and length-limited. */
export function sanitizePassages(input: unknown, limit: number = MAX_RETRIEVED_PASSAGES): RetrievedPassage[] {
  if (!Array.isArray(input)) return [];
  const out: RetrievedPassage[] = [];
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue;
    const p = raw as Record<string, unknown>;
    const text = typeof p.text === 'string' ? p.text.slice(0, 700) : '';
    const plain = typeof p.plain === 'string' ? p.plain.slice(0, 400) : '';
    if (!text) continue;
    out.push({
      id: typeof p.id === 'string' ? p.id.slice(0, 80) : `passage-${out.length}`,
      source: typeof p.source === 'string' ? p.source.slice(0, 220) : 'Project research corpus',
      sourceShort: typeof p.sourceShort === 'string' ? p.sourceShort.slice(0, 80) : undefined,
      kind: p.kind === 'book' ? 'book' : 'paper',
      theme: typeof p.theme === 'string' ? p.theme.slice(0, 40) : 'general',
      text,
      plain: plain || text.slice(0, 220),
      score: typeof p.score === 'number' && Number.isFinite(p.score) ? p.score : undefined,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/** Short human-readable citation list, e.g. for a "grounded in" footnote. */
export function summarizeSources(passages: RetrievedPassage[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of passages) {
    const label = p.sourceShort || p.source;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}
