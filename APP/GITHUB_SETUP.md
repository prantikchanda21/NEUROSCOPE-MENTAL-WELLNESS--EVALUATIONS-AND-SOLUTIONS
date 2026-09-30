# NeuroScope GitHub + Vercel setup

This folder is the repository root. Upload these files directly to a new GitHub repository (do not put them inside another nested folder).

## Vercel

1. Create a new Vercel project from this repository so the existing NeuroScope website remains untouched.
2. Use the root of this repository as the project root.
3. The included `vercel.json` uses `vite build` and serves the API routes under `/api/*`.
4. Add your real API keys in Vercel Environment Variables. Do not put real keys in `.env.example` or commit a `.env` file.
5. Deploy.

The mobile repository is designed to have its own Vercel deployment. For the hosted mobile site, `/api/*` is same-origin.

For the Android APK, point the build at your new mobile Vercel deployment by setting:
`VITE_API_BASE_URL=https://YOUR-NEW-PROJECT.vercel.app`
when building the app.

## Android

After cloning this repository locally:

```bash
npm install
npm run build:web
npx cap add android
npx cap sync android
npx cap open android
```

The generated `android/` directory can be committed to GitHub after `npx cap add android` if you want the native Android project version-controlled.

## Wellness Profile / Personalization

The mobile build includes an optional post-login Wellness Profile. Users can enable or disable `Use my profile to personalize NeuroScope` before the assessment. When enabled, sanitized profile context is included in relevant communication-layer requests and surfaced in the final results/report. The screening score itself is not recalculated from height, weight, BMI, medication names, or lifestyle fields.

## Separate mobile Vercel deployment

This repository is designed to be deployed as its own Vercel project. On the hosted mobile site, `/api/*` is same-origin by default, so the mobile backend stays separate from `neuroscope-mental-wellness.vercel.app`.

For a Capacitor APK build, set the new mobile Vercel URL before `npm run build:web`:

PowerShell:
```powershell
$env:VITE_API_BASE_URL="https://YOUR-MOBILE-PROJECT.vercel.app"
npm run build:web
npx cap sync android
```

Command Prompt:
```bat
set VITE_API_BASE_URL=https://YOUR-MOBILE-PROJECT.vercel.app
npm run build:web
npx cap sync android
```
