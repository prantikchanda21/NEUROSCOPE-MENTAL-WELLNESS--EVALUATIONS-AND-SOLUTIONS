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

<div align="center">

*Built with React, Vite, Express, ONNX Runtime, and a Groq/Gemini/local-LLM fallback
chain that never leaves you without an answer.*

</div>


## Mobile app / PWA mode

NeuroScope now uses a mobile-first white UI and is installable as an app-like Progressive Web App. The existing assessment engine, adaptive question flow, research retrieval, results dashboard, multilingual UI, speech input, crisis safeguards, and AI fallback chain remain part of the same application.

### Install on a phone

1. Deploy the built app to an **HTTPS** domain.
2. Open it in a supported mobile browser.
3. Choose the browser's **Add to Home screen / Install app** action, or use the in-app **Install NeuroScope** prompt when it appears.
4. Launch NeuroScope from the home screen for the standalone app experience.

### Download the offline LLM

1. Open NeuroScope while you are online.
2. Tap **Offline AI** in the top-right header.
3. Press **Download** and keep the app open until the progress reaches 100%.
4. The selected local model is cached on the device and can be loaded later without internet.

The current default offline profile is **Llama 3.2 1B q4f16**, approximately **1.3 GB**. The local model is only a supporting tone/chat reader; the deterministic safety layer and NeuroScope/RoBERTa safety reads remain independent of it. WebGPU support and sufficient device memory are required, so some phones or browser versions may report the feature as unavailable.

For a fully offline revisit, open the installed app once after the initial downloads have completed. The service worker caches the app shell and bundled model assets, while the optional LLM is stored separately by the browser's model cache.

## Android APK build (Capacitor)

This project is prepared to wrap the mobile web app in a native Android shell.
The cloud API base defaults to `https://neuroscope-mental-wellness.vercel.app`;
set `VITE_API_BASE_URL` at build time to override it.

```bat
npm install
npm run build
npx cap add android
npx cap sync android
npx cap open android
```

In Android Studio: **Build → Generate Signed Bundle / APK → APK** for a
direct-installable file, or choose **Android App Bundle** for Google Play.

The offline models continue to load from `/models/` inside the app bundle/cache
and run locally on compatible devices; cloud API calls go to the Vercel backend.

## Mobile profile + full chat export

After sign-in, the mobile experience shows an optional Wellness Profile step. It can record age, height, weight, average sleep, exercise frequency, caffeine, tobacco/nicotine, alcohol, medications, and physical notes. The current implementation stores this profile locally on the device and does not require it to run the assessment.

After the assessment finishes, **Download Full Chat** exports a plain-text record containing the wellness profile (when saved), every assessment question and answer, all follow-up AI chat turns, and the final assessment summary.

## Wellness Profile Personalization

After sign-in, NeuroScope can collect optional physical and lifestyle context (such as age, height, weight, sleep, movement, caffeine, tobacco/alcohol choices, medications, and physical notes). The user explicitly controls whether this context is used for personalization.

When enabled, the profile can inform the communication layer for assessment synthesis, per-answer solutions, follow-up chat, dimension insights, and the final report. The core mental-health scoring/classification flow remains separate and these physical values are not used to change the mental-health score. BMI, when available, is shown only as a physical-wellness reference.

Profile data is stored locally on the device. Only the fields the user has opted to use for personalization are sent with relevant AI requests, and the server sanitizes the values before adding them to prompts. Medication changes or diagnoses are never generated from profile values alone.

## Mobile API Isolation

The mobile repository is intended to be deployed to its own Vercel project. Hosted requests use the mobile project's own same-origin `/api/*` routes. For a Capacitor APK, set `VITE_API_BASE_URL` to the mobile Vercel deployment URL before building so the native app calls the separate backend instead of the original website.
