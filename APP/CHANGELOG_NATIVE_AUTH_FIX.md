# Native Android Auth + Speech Fix

- Replaced Android Google Identity Services WebView flow with `@capgo/capacitor-social-login` using Google Credential Manager.
- Configured Google provider explicitly in `capacitor.config.ts`.
- Uses Web OAuth client ID as `webClientId`; Android package/SHA-1 are configured in Google Cloud Console.
- Replaced the Android speech dependency with the maintained `@capgo/capacitor-speech-recognition` package.
- Added segmented-result handling and final-result fallback in `QuestionCard.tsx`.
- Preserves the existing Vercel web Google flow outside native Android.
