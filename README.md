<div align="center">

# 🧠 NeuroScope
### Mental Wellness Evaluation & Solution

A web app that turns a short, conversational check-in into a grounded, research-backed
mental-wellness assessment — with real-time risk detection, an empathetic AI write-up,
and support in 140 languages.

</div>

**Jump to:** [What it does](#1-what-this-app-actually-does) ·
[Features](#2-features-at-a-glance) ·
[How a check-in flows](#3-how-one-assessment-flows-end-to-end) ·
[Quick start](#4-quick-start) ·
[Architecture](#5-high-level-architecture) ·
[AI fallback chain](#6-the-ai-fallback-chain--two-independent-groq-pools) ·
[Languages](#7-multilingual-support-140-languages) ·
[Project layout](#8-project-layout-the-parts-youll-actually-touch) ·
[The model](#9-the-screening-model) ·
[Deploying](#10-deploying) ·
[Tech stack](#11-tech-stack) ·
[FAQ](#12-faq)

---

## 1. What this app actually does

You answer a set of adaptive questions. Under the hood, three independent "judges" look
at every answer and vote:

```
                 YOUR ANSWER
                      │
          ┌───────────┼───────────┐
          ▼           ▼           ▼
     ● DistilBERT  ● RoBERTa   ● Groq (LLM)
     (fine-tuned    (general    (reads live
      on 51k mental  sentiment)  tone/emotion)
      health texts)
          │           │           │
          └─────┬─────┴─────┬─────┘
                ▼           ▼
           MAJORITY VOTE + SAFETY OVERRIDE
        (explicit crisis language always wins,
         no matter what the models say)
                      │
                      ▼
            risk level: low → elevated → high → critical
```

That risk level drives everything downstream: which coping tools you're shown, whether a
crisis helpline is surfaced, and the tone of the AI-written feedback. Nothing about the
safety-critical logic (crisis detection, helpline triggers) depends on an external AI
call — it's deterministic and works even fully offline.

---

## 2. Features at a glance

| | |
|---|---|
| 🩺 **50-question adaptive assessment** | Questions adjust based on how you've been answering — not a static form |
| 🧠 **3-way risk ensemble** | On-device DistilBERT + RoBERTa + Groq LLM vote on every answer, with a hard safety override |
| ✍️ **Per-answer AI writing** | Empathetic reflection, "what's happening in your nervous system," and a cognitive reframe — freshly written per answer, not templated |
| 📊 **Biopsychosocial report** | 5 dimension score-cards, each with an expandable AI + research-backed deep dive |
| 🌐 **140 languages** | Full UI + AI-answer translation, including 40 Indian languages and RTL support |
| 🆘 **Deterministic crisis detection** | Explicit self-harm/suicide language always forces a critical-risk response, independent of any model or API call |
| 📡 **Works fully offline** | Every AI-backed feature has a local, template-based fallback — zero API keys required to run the app |
| 📄 **Research-grounded** | Answers are drawn from a corpus of real papers and clinical books, not free-floating LLM output |

---

## 3. How one assessment flows, end to end

```
 1. You answer a question
          │
          ▼
 2. On-device DistilBERT + RoBERTa read it            (runs in your browser)
          │
          ▼
 3. Groq LLM reads the same answer for tone/nuance     ← tone-pool keys
          │
          ▼
 4. Three-way vote → risk level (low/elevated/high/critical)
    Explicit crisis language ALWAYS overrides the vote  ← safety net
          │
          ▼
 5. Risk level shown live on the question card,
    next question adapts to it
          │
          ▼
      ... repeat for all 50 questions ...
          │
          ▼
 6. Final report requested → server drafts:
      • Empathetic Assessment & Reflection
      • What's Happening In Your Nervous System
      • Cognitive Perspective Shift
      • 5 Biopsychosocial dimension scores            ← communication-pool keys
          │
          ▼
 7. You can open any dimension's "Detailed insight" dropdown
    → Gemini + Groq + research corpus combine into one
      cross-checked, source-cited brief
```

---

## 4. Quick start

```bash
npm install
cp .env.example .env      # or .env.local — fill in whichever keys you have
npm run dev                # → http://localhost:3000
```

You don't need **any** API key to run the app — see the fallback chain below. More
keys just mean fresher, less repetitive AI writing.

---

## 5. High-level architecture

```
┌─────────────────────────────┐        ┌──────────────────────────────┐
│           BROWSER            │        │         SERVER (Express)      │
│                               │        │                                │
│  React UI (App.tsx)           │        │  server-app.ts                │
│   • Landing → Questions       │  HTTP  │   /api/assess                 │
│   • 3D landscape scene        │◄──────►│   /api/feeling-solution       │
│   • Results dashboard         │  JSON  │   /api/tone-analysis          │
│                               │        │   /api/dimension-insight      │
│  In-browser AI (ONNX.js)      │        │   /api/translate               │
│   • DistilBERT model runs      │        │   /api/reassess                │
│     locally, no server round-  │        │   /api/health                  │
│     trip, works offline        │        │                                │
│                               │        │  ── AI fallback chain ──►      │
│  localStorage                 │        │  Groq → Groq(2nd key) →        │
│   • assessment history        │        │  Gemini → local Phi-4-mini →   │
│   • cached translations        │        │  offline template composer    │
└─────────────────────────────┘        └──────────────────────────────┘
```

**Three ways to run the server side**, all sharing the exact same route logic:

```
server-app.ts  (shared Express app, all routes live here)
      │
      ├── server.ts     → long-running Node process   (npm run dev / npm start)
      ├── api/index.ts  → Vercel serverless function
      └── netlify func  → Netlify function
```

---

## 6. The AI fallback chain — two independent Groq "pools"

Every AI-backed route calls one function, `callAIWithFallback()`, which tries
providers **in order** and only skips to the next one if a key is missing, errored, or
rate-limited:

```
  TONE POOL  ●───────────────────────────────────●
  (reads live emotion — /api/tone-analysis only)
      GROQ_API_KEY ──► GROQ_API_KEY_2 ──► Gemini
      (skips local model — stays fast during a live check-in)

  COMMUNICATION POOL  ●───────────────────────────────●
  (drafts the empathetic write-up — every other route)
      GROQ_API_KEY_3 ──► GROQ_API_KEY_4 ──► Gemini ──► Local Phi-4-mini
                                                        (your own PC)
```

Two separate pools mean a burst of traffic on one job can never eat into the other's
rate limit. **None of the four Groq keys are required** — every rung degrades
gracefully, and with zero keys configured the app still runs fully offline using a
templated local composer. Check `GET /api/health` any time to see which rungs are live.

---

## 7. Multilingual support (140 languages)

```
 User's page loads in English (the one stable source of truth)
                     │
        AutoTranslate walks the rendered DOM
                     │
         batches text ──► POST /api/translate
                     │
     Groq → Groq(2nd) → Gemini → local Phi-4 → echo (no key)
                     │
      swapped in place + cached in localStorage per language
```

40 Indian languages (Kannada, Hindi, Tamil, Telugu, Marathi, Bengali, Tulu, Konkani…)
and 100 international ones, including automatic right-to-left layout for
Arabic/Urdu/Hebrew/Persian.

---

## 8. Project layout (the parts you'll actually touch)

```
neuroscope/
├── src/
│   ├── App.tsx                 # main app shell / routing between screens
│   ├── components/             # UI: landing page, question cards, results, modals
│   ├── data/questions.ts       # the 50 assessment questions
│   ├── utils/
│   │   ├── riskEngine.ts       # crisis-language detection + risk scoring
│   │   ├── semanticEngine.ts   # 3-way sentiment ensemble
│   │   ├── clinicalEngine.ts   # maps answers → 5 biopsychosocial dimensions
│   │   └── researchKnowledge.ts# grounds AI answers in real papers/books
│   └── i18n/                   # language switcher + auto-translate engine
├── public/models/neuroscope-distilbert/   # the fine-tuned model (ONNX, runs in-browser)
├── data/neuroscope_psyche_dataset.csv     # training data reference
├── server-app.ts                # ALL API routes live here (shared everywhere)
├── server.ts                    # local dev / Node server entry point
├── api/index.ts                 # Vercel serverless entry point
└── .env.example                 # every environment variable, explained inline
```

---

## 9. The screening model

- **Base:** `distilbert-base-uncased`, fine-tuned on **51,067** labeled mental-health
  statements.
- **Predicts:** 7 categories (Normal, Depression, Suicidal, Anxiety, Bipolar, Stress,
  Personality Disorder) + a binary risk flag, from one shared encoder.
- **Measured performance:** 79% macro-F1 on classification; 91.6% recall on the risk
  flag (tuned to catch true risk over avoiding false alarms — a deliberate trade-off).
- **Important:** this is a screening/triage aid, not a diagnostic tool, and it always
  routes concerning results to real human-support resources rather than making a final
  call on its own.

Full details: `public/models/neuroscope-distilbert/MODEL_CARD.md`.

---

## 10. Deploying

The app is set up to deploy as-is to any of these — pick one:

| Platform | Notes |
|---|---|
| **Vercel** | `vercel.json` rewrites `/api/*` to `api/index.ts` |
| **Netlify** | `netlify.toml` + a Netlify Function wrapping `server-app.ts` |
| **Your own server** | `npm run build && npm start` runs the bundled Node server |

Environment variables are the same everywhere — see `.env.example` for the full,
annotated list (Groq keys, Gemini key, optional local-LLM settings, Google Sign-In).

---

## 11. Tech stack

```
Frontend    React 19 · Vite · TypeScript · Tailwind CSS · Framer Motion
On-device AI Transformers.js (ONNX Runtime) — runs the DistilBERT model in-browser
Backend     Express (shared across Node / Vercel / Netlify entry points)
AI providers Groq · Google Gemini · local Phi-4-mini/Phi-3 (Ollama / LM Studio)
Storage     Browser localStorage (history, cached translations) — no user database
Deploy      Vercel, Netlify, or a plain Node server — pick any one
```

---

## 12. FAQ

**Do I need any API keys to try it?**
No. Every AI-backed feature has an offline fallback. Keys just make the AI-written
sections fresher and less repetitive — see [section 6](#6-the-ai-fallback-chain--two-independent-groq-pools).

**Why two Groq key pools instead of one?**
So a burst of traffic on the solution-writing routes can never eat into the rate limit
the live tone reading needs mid-assessment, and vice versa.

**Can the AI override a crisis reading?**
No. Explicit self-harm/suicide language triggers a deterministic, code-level override
before any model or API is even consulted — that path never depends on a network call.

**Is this a diagnostic tool?**
No — it's a screening/triage aid meant to support reflection and point toward real
human help. See the model card at `public/models/neuroscope-distilbert/MODEL_CARD.md`.

**How do I check which AI providers are currently active?**
Hit `GET /api/health` — it reports exactly which of the four fallback rungs are
configured and reachable right now.

---

<a id="updates"></a>

## 13. 🚀 What's new — update log

This round of updates makes NeuroScope **work without internet, run faster, and feel
smoother**. Three changes, each explained below with *what* changed, *why*, and *where*
in the code to find it.

### 📌 Update highlights at a glance

| # | Update | What you get | Theme |
|---|---|---|---|
| 1 | [Offline AI on your own device](#update-1--offline-ai-on-your-own-device) | A downloadable on-device model for tone, chat and solution cards | 📡 Offline |
| 2 | [Installable, offline-first app](#update-2--installable-offline-first-app-service-worker) | After one visit the whole app runs with no internet | 📡 Offline |
| 3 | [Web Workers + lighter animations](#update-3--web-worker-inference--animation-cleanup) | Models run off the UI thread; the interface feels faster | ⚡ Performance |

---

### 📡 Offline & on-device AI

#### Update 1 — Offline AI on your own device

A small **Offline AI** dropdown now lives in the header. One download and a model runs
entirely in the browser — no internet, no API keys, no data leaving the device.

| Where it helps | What the on-device model does |
|---|---|
| 🎯 **Tone ensemble** | Fills the LLM slot when Groq gives nothing (offline, rate-limited, providers down); returns a JSON tone reading only |
| 💬 **"Chat with AI about this feeling"** | Cloud answer first; if none, the on-device model writes the reply; if it isn't ready, the template reply is used |
| 🃏 **Solution card** | The built-in card shows instantly, then the on-device model rewrites title, empathy, nervous-system note, perspective, first move, steps, "later today" and affirmation in place |

**Two model profiles** (`LOCAL_LLM_PROFILE` in `localLlm.ts`):

| Profile | Model | Size | Default |
|---|---|---|:---:|
| `fast` | Llama 3.2 1B | ~1.3 GB | ✅ |
| `quality` | Phi-3 mini | ~2.3 GB | |

After switching profile: dropdown → **Remove from this device** → reload → download again.

**It obeys the same rules as the tuned transformers** (one shared spec in
`src/utils/toneRules.ts`, used by both the Groq and the on-device prompts):

1. **Same taxonomy and scales** — `severe / distressed / neutral / calm`, `-1…1`, `0…1`.
2. **Repair before use** — values are clamped; if label and score disagree, the *more
   severe* one wins; truncated replies are salvaged; unusable ones are dropped.
3. **Safety bypass first** — never consulted for critical-band / Suicidal readings or
   imminent-risk language, and never used to write text for severe / high / critical risk.
4. **Sticky severity** — it can escalate a reading, never talk a severe one down.
5. **Minority weight** — `LOCAL_LLM_VOTE_PROFILE` (0.25–0.45) versus Groq's
   `GROQ_VOTE_PROFILE` (0.55–0.8); the tuned transformers keep the majority.

**Limits:** desktop Chrome/Edge with WebGPU and ≥4 GB memory; phones, Safari and most
Firefox builds show "not available on this device". Each tone reading is bounded to 10 s.
Replies written on-device end with *"(Written on your device by the offline AI.)"*.

🧪 New test scripts: `npm run test:rules` (tone-rule and local-LLM-ensemble tests).

📁 `src/utils/localLlm.ts` · `src/utils/toneRules.ts` · `src/workers/localLlm.worker.ts` · `src/workers/localLlmProtocol.ts` · `src/components/OfflineModelMenu.tsx` · `src/components/HeaderNav.tsx` · `src/components/DynamicSolutionCard.tsx` · `src/utils/dynamicFeelingSolutions.ts` · `scripts/test-tone-rules.ts` · `scripts/test-local-llm-ensemble.ts`

---

#### Update 2 — Installable, offline-first app (service worker)

After **one online visit**, the whole app opens and runs with no network — shell, the
NeuroScope DistilBERT model and all local fallbacks.

| Layer | What's cached | When |
|---|---|---|
| **Precache** | `index.html`, hashed JS/CSS, icons, landscapes, manifest (files ≤ 2 MB) | At install |
| **Warm cache** | The ~66 MB ONNX model, tokenizer/config, any chunk > 2 MB | Background, ~10 s after load |
| **Left alone** | Hugging Face models and the on-device LLM (transformers.js manages its own cache) | — |

- Navigation is **network-first (3 s)**, falling back to the cached `index.html`.
- `/api/*` is **never intercepted**.
- New deploys install in the background and take over once all tabs are closed — no
  mid-session file swaps.
- A web app manifest (`manifest.webmanifest`) makes the app installable, and registration
  requests persistent storage so browsers don't evict the models.
- Production builds only — `npm run dev` never registers the worker.

**Quick test:** `npm run build && npx vite preview` → open `http://localhost:4173` once,
wait ~30 s → DevTools → Application → Service Workers → tick **Offline** → reload.

📁 `src/sw/service-worker.js` · `vite-plugin-sw.ts` · `src/utils/registerServiceWorker.ts` · `public/manifest.webmanifest` · `vite.config.ts` · `netlify.toml` · `vercel.json`

---

### ⚡ Performance

#### Update 3 — Web Worker inference + animation cleanup

**Web Workers.** All model loading and inference moved off the UI thread.

```
   MAIN THREAD (UI)                     WORKERS
   ┌──────────────────┐         ┌──────────────────────────────────────┐
   │ semanticEngine   │         │ primary : NeuroScope DistilBERT only │
   │  caches, timeouts│◄───────►│           (clinical read never waits) │
   │  risk logic      │         │ support : RoBERTa sentiment,          │
   │  (softmax, bands,│         │           DistilRoBERTa emotions,     │
   │   crisis override)│        │           MiniLM embeddings           │
   └──────────────────┘         └──────────────────────────────────────┘
```

- Tokenization now happens off-thread too.
- Embeddings return as **transferred `Float32Array` buffers** — no copying or boxing.
- Download-progress events are throttled to ~8/s, so a 65 MB download no longer re-renders
  the UI on every chunk.
- Each model runs one **warm-up pass** on load, so the first real answer is already fast.
- The old smoke-test and retry path (extra inference at load, up to 12 s) was removed.
- **Safe fallback:** if a worker can't start or crashes, that role runs on the main thread
  exactly as before. `getSemanticRuntimeModes()` reports `'worker' | 'inline'` per role.

**Animations trimmed** so the interface stays smooth on modest hardware:
- Removed: 90 infinitely twinkling stars, drifting particles, unused aurora keyframes,
  `HelixWaveEffect`, `SpiralVortexEffect`, decorative pulsing dots/flames, and the
  staggered landing entrances.
- Day/night crossfade shortened **1000 ms → 300 ms**.
- Heavy 3D flip / blur / scale / slide entrances → a simple **~120–150 ms fade**.
- **Kept on purpose:** spinners and skeletons, the mic-recording pulse, the crisis card,
  progress bars, the breathing-exercise animation and modal open/close.

📁 `src/workers/semanticCore.ts` · `src/workers/semantic.worker.ts` · `src/utils/semanticTransport.ts` · `src/utils/semanticEngine.ts` · `src/components/RealisticGreeneryLandscape.tsx` · `vite.config.ts`

---

### 🧾 Summary of these updates

<details>
<summary><b>⚙️ Configuration & scripts</b></summary>

| Item | Change |
|---|---|
| `LOCAL_LLM_PROFILE` | **New** in-code switch: `'fast'` (default) or `'quality'` |
| `npm run test:rules` | **New** script — tone-rule and local-LLM ensemble tests |
| `/sw.js` | **New** — generated at build time by `vite-plugin-sw.ts` (no new npm packages) |
| `netlify.toml`, `vercel.json` | Updated so the service worker is never served from a stale HTTP cache |
| `vite.config.ts` | `worker.format = 'es'` for the model workers |

</details>

<details>
<summary><b>📂 New files added</b></summary>

| Area | Files |
|---|---|
| Offline AI | `src/utils/localLlm.ts`, `src/utils/toneRules.ts`, `src/workers/localLlm.worker.ts`, `src/workers/localLlmProtocol.ts`, `src/components/OfflineModelMenu.tsx` |
| Service worker | `src/sw/service-worker.js`, `vite-plugin-sw.ts`, `src/utils/registerServiceWorker.ts`, `public/manifest.webmanifest` |
| Web Workers | `src/workers/semanticCore.ts`, `src/workers/semantic.worker.ts`, `src/workers/offlineFetchGuard.ts`, `src/utils/semanticTransport.ts` |
| Tests | `scripts/test-tone-rules.ts`, `scripts/test-local-llm-ensemble.ts` |
| Docs | `CHANGELOG_OFFLINE_PHI3.md`, `CHANGELOG_OFFLINE_CHAT.md`, `CHANGELOG_SERVICE_WORKER.md`, `CHANGELOG_WEB_WORKERS.md` |

</details>

<details>
<summary><b>🗑️ Removed</b></summary>

`HelixWaveEffect.tsx` overlay, `SpiralVortexEffect.tsx`, the twinkling-star and
particle animations, and the old model smoke-test / retry-at-load path.

</details>

<details>
<summary><b>🛡️ Safety guarantees that did not change</b></summary>

- Explicit crisis language still triggers a deterministic, code-level override before any
  model or API is consulted.
- The on-device AI is never used for critical-band / Suicidal readings or to write text
  for severe / high / critical risk, and it can never talk a `severe` reading back down.
- Web Workers fall back to the main thread if they fail, so nothing safety-related
  depends on a worker being available.
- `/api/*` is never intercepted by the service worker, so live AI and crisis logic are
  unaffected by caching.

</details>

> 📄 Full details live in `CHANGELOG_OFFLINE_PHI3.md`, `CHANGELOG_OFFLINE_CHAT.md`, `CHANGELOG_SERVICE_WORKER.md` and `CHANGELOG_WEB_WORKERS.md` at the project root.

---

<div align="center">

*Built with React, Vite, Express, ONNX Runtime, and a Groq/Gemini/local-LLM fallback
chain that never leaves you without an answer.*

</div>
