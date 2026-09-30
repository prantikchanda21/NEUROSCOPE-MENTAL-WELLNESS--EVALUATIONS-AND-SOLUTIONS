<div align="center">

# 🧠 NeuroScope
### Mental Wellness Evaluation & Solution

**Adaptive free-text screening · Fine-tuned DistilBERT · Safety-aware actions · Offline AI · Web + Android**

A research-grounded, multilingual mental-wellness screening application that turns a short,
conversational check-in into structured status/risk signals, personalised actions,
interactive practices and a safety-aware follow-up path.

> **Scope:** NeuroScope is a screening, self-reflection and triage aid. It is **not a diagnosis,
> crisis service, or substitute for professional care**. Safety logic is deterministic and
> downstream communication must not override a critical safety reading.

</div>

---

## Table of contents

- [1. Context & value proposition](#1-context--value-proposition)
- [2. Product highlights](#2-product-highlights)
- [3. Architecture & system design](#3-architecture--system-design)
- [4. End-to-end execution flow](#4-end-to-end-execution-flow)
- [5. Model pipeline](#5-model-pipeline)
- [6. Safety design](#6-safety-design)
- [7. Personalisation layer](#7-personalisation-layer)
- [8. Offline AI & offline-first behavior](#8-offline-ai--offline-first-behavior)
- [9. Android app](#9-android-app)
- [10. Installation & configuration](#10-installation--configuration)
- [11. Environment variables](#11-environment-variables)
- [12. API surface](#12-api-surface)
- [13. Usage examples](#13-usage-examples)
- [14. Testing & QA](#14-testing--qa)
- [15. Reliability, performance & maturity](#15-reliability-performance--maturity)
- [16. Troubleshooting & known limitations](#16-troubleshooting--known-limitations)
- [17. Security & privacy](#17-security--privacy)
- [18. Repository structure](#18-repository-structure)
- [19. Deployment](#19-deployment)
- [20. Updates](#20-updates)
- [21. Governance, contribution & license](#21-governance-contribution--license)
- [22. References](#22-references)

---

# 1. Context & value proposition

## The problem

Mental-wellness screening is often static, score-first and disconnected from a user's own
language. Users may receive a label or score without a useful next action, while high-risk
answers require immediate and explicit safety support.

## The NeuroScope approach

NeuroScope uses a **50-item adaptive free-text question pool** across five wellbeing areas.
Users can answer in their own words or by voice. A fine-tuned **DistilBERT primary classifier**
provides status/risk signals; RoBERTa, emotion/semantic models and bounded Groq tone analysis
add supporting context. A deterministic risk engine controls safety-critical behavior, while
Groq/Gemini are used downstream for communication and evidence-grounded explanation.

The same product is available as a responsive web experience and an Android app packaged with
Capacitor. The Android build adds native Google Sign-In and native speech recognition rather than
relying on browser-only WebView behavior.

## Target users

- Students and early-career professionals under sustained stress.
- People looking for a private first step before seeking professional support.
- Users who prefer conversational free-text or voice input over rigid forms.
- Users who benefit from multilingual and offline-capable experiences.

## Value proposition

**Screen → understand → act → track → escalate safely when needed.**

NeuroScope is intentionally model-first rather than LLM-first: the primary screening model and
local safety logic anchor status/risk, while cloud AI communicates the findings instead of defining
the clinical state.

---

# 2. Product highlights

| Capability | What it does |
|---|---|
| 🧠 Adaptive assessment | 50-item pool with Quick / Balanced / Full modes (5 / 10 / 20 questions) |
| 🎯 Primary model | Fine-tuned DistilBERT with 7 status classes + binary risk head |
| 🧩 Supporting signals | RoBERTa, emotion signals, MiniLM semantic relevance, deterministic lexical fallbacks |
| 🛡️ Safety engine | Mandatory safety item, explicit crisis markers and deterministic overrides |
| ✍️ AI communication | Groq/Gemini generate explanations, reflections and solution steps downstream of model/risk results |
| 📚 Research grounding | Question design and communication draw from the project psyche/research corpus and referenced papers/books |
| 🌐 Multilingual UX | Runtime translation across 140 languages, including 40 Indian languages and RTL handling |
| 📡 Offline AI | Optional on-device LLM download; local fallback for supported AI interactions |
| 🧑‍💻 Wellness Profile | Optional age/height/weight/sleep/exercise/caffeine/lifestyle context for relevant personalisation |
| 📄 Reporting | Printable A4 report + full-chat text export |
| 📱 Android | Capacitor 8 wrapper with native Android Google Sign-In and native speech recognition |
| 🔒 Privacy-first storage | Browser/device-local profile, history and streak data; no user database in the supplied architecture |

---

# 3. Architecture & system design

## High-level architecture

```text
                              ┌──────────────────────────────┐
                              │        Landing / Download    │
                              │             site             │
                              │          (Netlify)           │
                              └──────────────┬───────────────┘
                                             │
                         ┌───────────────────┴──────────────────┐
                         │                                      │
                         ▼                                      ▼
                Open NeuroScope web                    Download Android APK
                         │
                         ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         NeuroScope client                                    │
│                                                                             │
│ React 19 + TypeScript + Vite + Tailwind + Motion                           │
│                                                                             │
│  Auth / profile / assessment / results / chat / tools / export              │
│                │                                                            │
│                ├── localStorage: profile, history, translations, streaks    │
│                │                                                            │
│                └── local inference: DistilBERT / semantic workers / fallbacks│
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │ HTTPS / same-origin API
                                  ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Server / API layer                                  │
│                              Express                                        │
│                                                                             │
│ /api/assess · /api/feeling-solution · /api/tone-analysis                    │
│ /api/dimension-insight · /api/translate · /api/reassess · /api/health       │
└─────────────────────────────────┬───────────────────────────────────────────┘
                                  │
              ┌───────────────────┼─────────────────────┐
              ▼                   ▼                     ▼
        Groq tone pool     Groq communication     Gemini fallback
        KEY 1 → KEY 2      KEY 3 → KEY 4           communication
              │                   │
              └──────────────┬────┘
                             ▼
                    local/template fallbacks

Android path:

Web bundle → Capacitor 8 → Android WebView shell
                         ├── native Google Sign-In
                         └── native speech recognition
```

## Service boundaries

| Boundary | Responsibility |
|---|---|
| React client | UX, state, routing, local storage, local model execution, presentation |
| DistilBERT local runtime | Primary status/risk inference from user free text |
| Supporting model workers | Sentiment, emotion and semantic relevance signals |
| Risk engine | Safety markers, bands, trend logic and deterministic overrides |
| Express API | Assessment synthesis, tone, solutions, insights, translation and reassessment |
| Groq | Bounded tone signal + communication fallback/primary communication rung depending on route |
| Gemini | Communication fallback |
| Offline LLM | Local supporting communication for supported non-critical flows |
| Capacitor Android layer | Native packaging, speech recognition and Google Sign-In |

---

# 4. End-to-end execution flow

```text
1. User signs in
       │
2. Optional Wellness Profile
       │  age / height / weight / sleep / lifestyle
       │  explicit personalisation control
       ▼
3. Choose language + assessment mode
       │
4. Answer by text or native Android voice
       │
       ▼
5. Primary DistilBERT inference
       │
       ├── status probabilities
       └── risk probability
       │
       ├───────────────► supporting tone / emotion / semantic signals
       │
       ▼
6. Deterministic safety + adaptive engine
       │
       ├── crisis override if triggered
       ├── mandatory safety coverage
       ├── category balance
       └── next-question selection
       │
       ▼
7. Repeat until selected mode is complete
       │
       ▼
8. Final synthesis
       │  assessment evidence + approved profile context
       ▼
9. Results dashboard
       │  dimensions + insights + actionable solutions
       │
       ├── follow-up chat
       ├── interactive tools
       ├── printable A4 report
       └── full chat export
```

### Adaptive selection

Each next item is selected from the 50-question pool using semantic relevance, sentiment/category
signals, bounded variation and category constraints. The mandatory safety question is retained
across assessment modes.

---

# 5. Model pipeline

## Primary classifier

- Base architecture: `distilbert-base-uncased`.
- Fine-tuned on the cleaned **SENTIMENT ANALYSIS FOR MENTAL HEALTH** Kaggle dataset used by the project.
- Training set documented in the project: **51,067 statements**.
- Output: **7 status classes + binary risk flag**.
- Deployment: quantized ONNX through Transformers.js for local inference.
- The model is a **screening/triage aid**, not a diagnostic instrument.

### Status taxonomy

```text
Normal
Depression
Suicidal
Anxiety
Bipolar
Stress
Personality Disorder
```

## Supporting signals

```text
DistilBERT          → primary status + risk
RoBERTa             → sentiment / tone support
Emotion model       → affective signal
MiniLM              → semantic relevance
Groq tone analysis  → bounded contextual tone signal
Lexicon / TF overlap→ deterministic fallbacks
```

## Held-out metrics documented by the project

| Metric | Value |
|---|---:|
| Status macro-F1 | 0.792 |
| Status weighted-F1 | 0.818 |
| Risk recall @ 0.22 | 0.916 |
| Risk AUC | 0.967 |
| Risk precision | 0.761 |

These are project-reported held-out evaluation figures and should **not** be interpreted as
clinical validation or evidence of equal performance across populations or languages.

## Model hierarchy

**DistilBERT anchors status/risk → supporting models enrich context → deterministic safety logic
governs safety → Groq/Gemini communicate findings.**

Cloud communication cannot override a deterministic critical safety reading.

---

# 6. Safety design

Safety-critical behavior is intentionally not dependent on a cloud LLM call.

### Core guarantees

1. A mandatory safety item is present in every assessment mode.
2. Explicit crisis/self-harm language can trigger a deterministic override.
3. Critical-band readings bypass ordinary AI communication paths.
4. The on-device LLM is not used to downgrade severe/high/critical safety states.
5. Immediate-support UI can appear before the assessment ends when a high-risk signal is detected.
6. The final report preserves the safety signal.

```text
User answer
    │
    ├── explicit crisis markers? ── YES ──► deterministic critical path
    │                                          │
    │                                          └── immediate support
    │
    └── NO ──► model + supporting signals ──► risk engine ──► normal flow
```

> Safety behavior is deterministic at the decision boundary, but no software-only detector can
> guarantee detection of every high-risk situation.

---

# 7. Personalisation layer

NeuroScope now supports an optional **Wellness Profile** collected after sign-in.

### Example fields

- Age
- Height
- Weight
- Average sleep
- Exercise / movement frequency
- Caffeine intake
- Tobacco / nicotine
- Alcohol
- Medications
- Physical notes

### Design rule

Profile data is **context**, not a replacement for the screening model.

```text
Wellness Profile
      │
      ▼
Personalisation context
      │
      ├── assessment synthesis
      ├── dynamic solutions
      ├── follow-up chat
      ├── dimension insights
      └── final report

NOT:

Wellness Profile ──X──► mental-health score / classifier label
```

Height and weight may produce a local BMI reference for display, but BMI is not used to change the
mental-health score.

Users explicitly control whether profile context is used for personalisation. The implementation
stores the profile locally and sanitises profile values before adding approved context to AI prompts.

---

# 8. Offline AI & offline-first behavior

## Two offline layers

### 1. Core local screening

The quantized NeuroScope DistilBERT model runs locally through Transformers.js / ONNX. The
assessment's core model and deterministic risk path therefore do not depend on a live API call.

### 2. Optional local communication model

The app provides an **Offline AI** model download. The documented profiles are:

| Profile | Model | Approx. size | Intended use |
|---|---|---:|---|
| `fast` | Llama 3.2 1B q4f16 | ~1.3 GB | Faster local communication |

The selected model is downloaded once and cached locally for reuse. It can support tone/chat/solution
rewrites where the safety path permits it.

### Offline-first web behavior

The service worker caches the app shell and the bundled local model assets. API routes under
`/api/*` are intentionally not intercepted by the service worker.

### Device limits

Offline LLM availability depends on device memory, browser/WebView capabilities and WebGPU support.
The project documentation does not establish universal Android-device compatibility; treat the
feature as capability-dependent and expose a clear unavailable state when local inference cannot start.

---

# 9. Android app

NeuroScope is wrapped as an Android application using **Capacitor 8**.

## Android-specific upgrades

### Native voice recognition

Android uses `@capgo/capacitor-speech-recognition` instead of the browser-only Web Speech API.
The implementation supports native permissions, partial/segmented results and final-result handling.

### Native Google Sign-In

Android uses `@capgo/capacitor-social-login` and Google's Credential Manager path instead of loading the
Google Identity Services JavaScript flow inside the WebView.

Required Google Cloud configuration:

```text
Web OAuth client
  → used as webClientId / VITE_GOOGLE_CLIENT_ID

Android OAuth client
  → package: com.neuroscope.app
  → SHA-1: certificate used to sign the installed APK/AAB
```

For Play Store distribution, the Play App Signing certificate SHA-1 must also be registered.

## Build flow

```bash
npm install
npm run build:web
npx cap add android        # first Android setup only
npx cap sync android
npx cap open android
```

For command-line debug APK generation on Windows:

```bat
cd android
gradlew.bat assembleDebug
```

Release builds should use a protected signing key. Do not commit keystores, passwords or signing
secrets to GitHub.

---

# 10. Installation & configuration

## Prerequisites

### General

- Node.js **22.x recommended** (Node 20+ may be compatible with parts of the stack, but this repository's current deployment/runtime guidance is Node 22.x).
- npm
- Git
- Modern browser with WebAssembly support

### Android

- Android Studio
- Android SDK / platform tools
- JDK 21-compatible Android Studio toolchain as supplied by the installed Android Studio setup
- A Windows/macOS/Linux environment suitable for Gradle builds

### Optional local LLM development

- Hardware with enough memory/storage for the selected local model.
- WebGPU/accelerator support where required by the browser/runtime.
- Ollama or LM Studio only if using the server-side local-model fallback.

## Clone + install

```bash
git clone <YOUR_GITHUB_REPOSITORY_URL>
cd neuroscope
npm install
```

## Configure environment

macOS/Linux:

```bash
cp .env.example .env
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env
```

Never commit `.env`.

## Run locally

```bash
npm run dev
```

The local server entry point is `server.ts`. Use:

```text
http://localhost:3000
```

## Build web

```bash
npm run build:web
```

## Build the full production artifact

```bash
npm run build
```

## Start the bundled server

```bash
npm start
```

---

# 11. Environment variables

The repository's `.env.example` is the source of truth for available variables. The matrix below
summarises the documented configuration without exposing secrets.

| Variable | Type | Default | Required? | Purpose |
|---|---|---|:---:|---|
| `GROQ_API_KEY` | string | empty | No | Tone-pool Groq key 1 |
| `GROQ_API_KEY_2` | string | empty | No | Tone-pool Groq key 2 / fallback |
| `GROQ_API_KEY_3` | string | empty | No | Communication-pool Groq key 1 |
| `GROQ_API_KEY_4` | string | empty | No | Communication-pool Groq key 2 / fallback |
| `GEMINI_API_KEY` | string | empty | No | Gemini communication fallback |
| `VITE_GOOGLE_CLIENT_ID` | string | empty | Android/web auth dependent | **Web OAuth client ID**; safe for client embedding, not a secret |
| `VITE_API_BASE_URL` | URL | same-origin in web | Android build | Mobile app backend base URL; point to the separate Vercel project |
| `LOCAL_LLM_ENABLED` | boolean | `false` | No | Enables optional local server-side LLM fallback |
| `LOCAL_LLM_URL` | URL | empty | No | Ollama / LM Studio local endpoint |
| `LOCAL_LLM_MODEL` | string | empty | No | Local server-side model name |

### Production secret rules

- Put `GROQ_*` and `GEMINI_API_KEY` in Vercel/Netlify/server environment variables.
- Never place provider API keys in the Android app bundle.
- Never commit `.env`.
- `VITE_*` values are bundled into the client at build time; treat them as public configuration.

---

# 12. API surface

The Express app is shared across local Node, Vercel and Netlify entry points.

| Route | Method | Purpose |
|---|---|---|
| `/api/health` | GET | Reports provider/fallback availability |
| `/api/assess` | POST | Final assessment synthesis / report generation |
| `/api/feeling-solution` | POST | Dynamic actionable solution generation |
| `/api/tone-analysis` | POST | Contextual tone/emotion signal |
| `/api/dimension-insight` | POST | Detailed wellbeing-dimension insight |
| `/api/translate` | POST | Runtime UI/answer translation |
| `/api/reassess` | POST | Follow-up / re-assessment support |

The complete request/response logic currently lives in `server-app.ts` and the Vercel entry point is
`api/index.ts`.

> **API documentation gap:** no OpenAPI/Swagger specification was supplied with the repository.
> For technical review, the authoritative implementation is `server-app.ts`; an OpenAPI contract
> can be added later without changing the route architecture.

### Health check

```bash
curl https://YOUR-VERCEL-DOMAIN.vercel.app/api/health
```

For local development:

```bash
curl http://localhost:3000/api/health
```

---

# 13. Usage examples

## Start a local session

```bash
npm install
npm run dev
```

Open:

```text
http://localhost:3000
```

## Build Android after a frontend change

```bash
npm run build:web
npx cap sync android
```

Do **not** run `npx cap add android` again once the `android/` directory exists.

## Generate a debug APK (Windows)

```bat
cd android
gradlew.bat assembleDebug
```

Output:

```text
android\app\build\outputs\apk\debug\app-debug.apk
```

## Print / PDF report

Use the result screen's report/print action. The implementation opens a standalone printable A4
report rather than printing the interactive dashboard container.

## Full chat export

Use **Download Full Chat** after the assessment to export the profile context (when saved),
assessment questions/answers, AI follow-up turns and final summary as a text file.

---

# 14. Testing & QA

## Available commands

```bash
npm run lint
npm run test:rules
```

The rule tests cover the tone-rule and local-LLM ensemble logic.

## Recommended technical-review sequence

```bash
npm install
npm run lint
npm run test:rules
npm run build:web
npx cap sync android
cd android
gradlew.bat assembleDebug
```

## Manual smoke-test checklist

### Web

- [ ] Login / account flow
- [ ] Wellness Profile save/skip/edit behavior
- [ ] 5 / 10 / 20-question modes
- [ ] Adaptive next-question behavior
- [ ] Text answer input
- [ ] Voice input in supported browser environments
- [ ] Live risk display / safety flow
- [ ] Results dashboard
- [ ] Dimension insight cards
- [ ] AI follow-up chat
- [ ] Offline AI download / reload behavior
- [ ] Runtime language translation + RTL language
- [ ] Print → Save as PDF
- [ ] Download Full Chat

### Android

- [ ] Native microphone permission
- [ ] Native speech recognition
- [ ] Google Sign-In with matching package + SHA-1
- [ ] Vercel API connectivity
- [ ] Offline AI on a compatible device
- [ ] Report export / file handling

### Current badge truthfulness

This repository does **not** include a hosted CI workflow or instrumented code-coverage pipeline in the
supplied materials. The badges at the top deliberately show those states instead of claiming green
builds or a coverage percentage that has not been measured.

---

# 15. Reliability, performance & maturity

## Maturity status

**MVP / hackathon-ready implementation.** The supplied repository demonstrates an integrated web +
Android architecture, but it should not be treated as clinically validated production software.

## Documented model performance

See [Model pipeline](#5-model-pipeline) for held-out classification figures.

## Runtime performance notes

The project includes several performance optimisations:

- Model inference moved to Web Workers where supported.
- Warm-up passes reduce first-response overhead after model load.
- Download progress updates are throttled.
- Heavy decorative animations were trimmed for lower-end hardware.
- Local and cloud fallbacks prevent most communication features from hard-failing when one provider is unavailable.

**Formal end-to-end latency/throughput benchmarks are not included in the supplied repository.**
Do not quote a single production latency or throughput number without running a controlled benchmark.

## Reliability strategy

```text
Groq tone pool
  GROQ_1 → GROQ_2 → Gemini

Communication pool
  GROQ_3 → GROQ_4 → Gemini → local Phi fallback → template/local fallback
```

Provider errors and rate limits are handled by the fallback chain where a route permits fallback.
Safety-critical routing remains independent of provider availability.

---

# 16. Troubleshooting & known limitations

| Problem | Likely cause | Fix / workaround |
|---|---|---|
| `npx cap open android` cannot find Android Studio | Android Studio path not configured | Install Android Studio or open `android/` manually; configure `CAPACITOR_ANDROID_STUDIO_PATH` if needed |
| Gradle download timeout | Network cannot reach `services.gradle.org` | Retry on a stable network or use a locally available Gradle distribution; avoid committing machine-specific wrapper paths |
| Gradle cannot delete files under `OneDrive` | OneDrive/Windows file locks generated build files | Build from a local path such as `C:\NeuroScopeMobile`, then rerun `gradlew.bat clean` |
| `QuestionCard` module not found | File placed in wrong path | Ensure `src/components/QuestionCard.tsx` matches the import in `App.tsx` |
| Android Google Sign-In says authorization failed | OAuth package/SHA-1/web client mismatch | Verify Android OAuth client uses `com.neuroscope.app` + the installed APK certificate SHA-1; keep the Web client ID in `VITE_GOOGLE_CLIENT_ID` |
| Google Sign-In works on web but not APK | Web GIS flow used inside WebView | Use the native Capacitor social-login implementation for Android |
| Voice button listens but returns no text | Speech result lifecycle issue | Use the native Capacitor speech plugin and handle segmented/final results |
| `/api/*` returns 404 on Vercel | Serverless route/rewrites not deployed | Verify `vercel.json` and `api/index.ts`; check `/api/health` |
| APK calls wrong backend | `VITE_API_BASE_URL` not set at build time | Set it to the mobile Vercel deployment, then `npm run build:web && npx cap sync android` |
| Offline LLM unavailable | Device/WebGPU/memory limitation | Use a compatible device/runtime or continue with the local deterministic / template fallbacks |
| Printed report is clipped | Old dashboard print CSS or stale build | Rebuild web assets and regenerate the standalone report from the current version |
| Text appears low-contrast | Old utility classes override foreground colors | Use the latest mobile stylesheet/contrast layer and rebuild |

### Important deployment trade-off

The mobile Android app is intentionally isolated from the original website backend by using a separate
Vercel deployment and a build-time `VITE_API_BASE_URL`. This reduces the risk of changing the public
site while iterating on the mobile app.

---

# 17. Security & privacy

## Data handling model

The supplied architecture uses browser/device-local storage for authentication state, assessment
history, translations and streaks rather than a central user database.

Cloud AI requests may receive the minimum context required for the selected feature, including
user-approved wellness context when personalisation is enabled.

### Secrets

- Provider API keys belong on the server/hosting platform.
- API keys must never be bundled into the Android client.
- Google `VITE_GOOGLE_CLIENT_ID` is configuration, not an API secret.
- Signing keys/keystores are private credentials and must not be committed.

### Android Google authentication

The Android client is tied to:

```text
package = com.neuroscope.app
certificate SHA-1 = signing key fingerprint
```

Use separate debug/release/Play App Signing fingerprints as appropriate.

### Vulnerability reporting

For a public GitHub repository:

1. Use **GitHub Security → Advisories** / private vulnerability reporting if enabled.
2. Do not post credentials, API keys, signing keys or exploitable details in a public issue.
3. Include affected version/commit, reproduction steps, impact and any safe mitigation.
4. Rotate exposed secrets immediately if a credential is accidentally committed.

### Security limitations

This README documents the current architecture; it does not claim a formal penetration test,
formal privacy certification, clinical regulatory approval or independent security audit.

---

# 18. Repository structure

```text
neuroscope/
├── src/
│   ├── App.tsx
│   ├── components/
│   │   ├── QuestionCard.tsx
│   │   ├── OfflineModelMenu.tsx
│   │   ├── HeaderNav.tsx
│   │   ├── DynamicSolutionCard.tsx
│   │   └── ...
│   ├── data/questions.ts
│   ├── utils/
│   │   ├── riskEngine.ts
│   │   ├── semanticEngine.ts
│   │   ├── clinicalEngine.ts
│   │   ├── localLlm.ts
│   │   ├── toneRules.ts
│   │   ├── semanticTransport.ts
│   │   └── ...
│   ├── workers/
│   │   ├── semanticCore.ts
│   │   ├── semantic.worker.ts
│   │   ├── localLlm.worker.ts
│   │   └── ...
│   └── sw/
│       └── service-worker.js
├── public/
│   ├── models/
│   │   └── neuroscope-distilbert/
│   └── manifest.webmanifest
├── data/
│   └── neuroscope_psyche_dataset.csv
├── api/
│   └── index.ts
├── scripts/
├── server-app.ts
├── server.ts
├── translate-service.ts
├── vite.config.ts
├── vite-plugin-sw.ts
├── vercel.json
├── netlify.toml
├── capacitor.config.ts
├── package.json
├── .env.example
└── README.md
```

---

# 19. Deployment

## Vercel

The repository contains a Vercel serverless entry point and `/api/*` rewrites.

Recommended mobile deployment pattern:

```text
Original NeuroScope site
        │
        └── keep unchanged

Separate mobile repository/project
        │
        └── separate Vercel project
                 │
                 └── Android APK uses VITE_API_BASE_URL
```

### Vercel setup

1. Import the GitHub repository into a new Vercel project.
2. Add the server-side environment variables.
3. Add `VITE_GOOGLE_CLIENT_ID` if Google auth is required in the built frontend.
4. Redeploy after environment changes.
5. Verify:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/api/health
```

## Netlify

`netlify.toml` and the shared Express logic support Netlify deployment through a function wrapper.

## Self-hosted Node

```bash
npm run build
npm start
```

---

# 20. Updates

## 📌 Android + personalisation + reporting update

### 01 — Android application layer

**What changed**
- Added Capacitor 8 configuration and Android project support.
- Added a clean, white mobile UI with bold black typography.
- Added a separate mobile Vercel backend path so the existing public website can remain isolated.

**Why**
- Package the existing NeuroScope experience as an Android app without rewriting the product from scratch.
- Keep mobile deployment independent of the original website.

### 02 — Native voice recognition

**What changed**
- Replaced the Android WebView/browser speech path with `@capgo/capacitor-speech-recognition`.
- Added native Android microphone permissions.
- Added segmented/partial-result handling plus final-result fallback.

**Why**
- Make voice answers appropriate for Android rather than depending on browser-only Web Speech behavior.

### 03 — Native Google authentication

**What changed**
- Replaced the WebView Google Identity Services flow for Android with `@capgo/capacitor-social-login`.
- Configured Google through the native Android Credential Manager path.
- Kept the Web OAuth client ID as `webClientId` / `VITE_GOOGLE_CLIENT_ID`.
- Added Android package + SHA-1 configuration requirements.

**Why**
- Use an Android-native sign-in flow instead of a browser authentication library inside a WebView.

### 04 — Wellness Profile personalisation

**What changed**
- Added optional age, height, weight, sleep, movement, caffeine, tobacco/nicotine, alcohol,
  medication and physical-note fields.
- Added explicit user control over using profile data for personalisation.
- Added local BMI reference calculation.
- Wired approved profile context into assessment synthesis, dynamic solutions, follow-up chat,
  dimension insights and final reporting.

**Why**
- Add useful personal context without turning physical measurements into the mental-health score.

### 05 — Full-chat export + printable report

**What changed**
- Added **Download Full Chat**.
- Export includes assessment Q&A, follow-up chat turns, final summary and saved profile context when applicable.
- Reworked print output into a standalone A4 report with stable pagination.

**Why**
- Give users a portable record and a clean PDF-friendly report instead of printing the interactive dashboard.

### 06 — Contrast / readability pass

**What changed**
- Forced primary app typography to solid black and heavier weights.
- Removed remaining transparent/white text treatments that became unreadable on the clean white mobile UI.

**Why**
- Improve readability on phones and during screen recording/demo use.

### 07 — Landing / download entry point

A separate static landing page was prepared for Netlify with:

- NeuroScope branding/logo
- Project overview
- Open-app CTA
- Android APK download CTA
- Project features and safety scope
- Configurable links to the separate Vercel app and Google Drive APK

This landing site is intentionally independent from the application backend.

---

# 21. Governance, contribution & license

## Contribution guidelines

1. Create a feature/fix branch from the current default branch.
2. Keep safety-critical logic changes isolated and clearly documented.
3. Do not commit `.env`, API keys, private certificates or keystores.
4. Run at minimum:

```bash
npm run lint
npm run test:rules
npm run build:web
```

5. For Android changes, run:

```bash
npx cap sync android
```

and record any native setup changes in a `CHANGELOG_*.md` file.

## Code style

- TypeScript for application code.
- Prefer small, focused utility functions.
- Keep provider calls behind the server/API boundary.
- Keep deterministic safety logic independent of model availability.
- Treat user profile data as explicit, opt-in context.
- Do not silently change the model/risk hierarchy when editing communication prompts.
  

# 22. References

The project materials identify these core research references as informing screening/question design
and evidence-grounded communication:

- Porges (2007) — *The Polyvagal Perspective*, Biological Psychology.
- Pilkonis et al. (2011) — *PROMIS Emotional Distress Item Banks*, Assessment.
- Gibbons et al. (2012) — *Computerized Adaptive Test for Depression*, Archives of General Psychiatry.
- SAMHSA (2014) — *TIP 57, Trauma-Informed Care*.

The repository also contains a broader research/clinical reading corpus and the project psyche dataset.
See `RESEARCH_GROUNDED_ADDITIONS.md` and `public/models/neuroscope-distilbert/MODEL_CARD.md` for the
project-specific details supplied with the codebase.

---

## Quick command reference

```bash
# Local web development
npm install
npm run dev

# Quality checks
npm run lint
npm run test:rules

# Web production build
npm run build:web

# Capacitor / Android
npx cap sync android
npx cap open android

# Windows debug APK
cd android
gradlew.bat assembleDebug
```

---

<div align="center">

### NeuroScope
**From screening to understanding. From understanding to action.**

Built with React, TypeScript, Vite, Transformers.js, ONNX Runtime, Express, Groq/Gemini fallbacks,
Capacitor and native Android capabilities.

</div>

