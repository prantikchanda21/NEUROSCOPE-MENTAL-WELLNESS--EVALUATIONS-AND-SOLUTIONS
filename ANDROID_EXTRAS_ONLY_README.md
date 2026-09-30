NeuroScope Android App Extras
===========================

This ZIP contains ONLY files added or modified for the Android/mobile extras compared with the original NeuroScope repository.

Included changes:
- Capacitor Android configuration
- Native Android Google Sign-In integration
- Native Android speech recognition integration
- Wellness/physical profile + local storage
- Full-chat export
- Mobile install/PWA UI pieces
- Mobile/print/font/API integration changes required by those features

HOW TO USE
1. Start from your original NeuroScope repository.
2. Extract this ZIP over the repository root, preserving folders.
3. Allow overwrite when Windows asks.
4. Run: npm install
5. Run: npm run build:web
6. Run: npx cap sync android
7. Build/open the Android project as usual.

IMPORTANT
- package.json contains the Android-native plugin dependencies.
- Do not put Groq/Gemini secrets in the frontend. Keep them in Vercel environment variables.
- VITE_GOOGLE_CLIENT_ID must be the Web OAuth client ID.
- Google Cloud also needs the Android OAuth client with package com.neuroscope.app and the SHA-1 of the signing certificate used by the APK.
- This ZIP does not include node_modules, dist, Android build caches, or generated signing keys.
