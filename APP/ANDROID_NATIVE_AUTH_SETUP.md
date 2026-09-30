# Android Native Voice + Google Sign-In

This mobile repository uses Capacitor 8.

## Install/sync native plugins

```bash
npm install
npm install @capgo/capacitor-speech-recognition @capgo/capacitor-social-login
npm run build:web
npx cap sync android
```

## Voice dictation

`src/components/QuestionCard.tsx` uses `@capgo/capacitor-speech-recognition` for Android. The plugin requests `RECORD_AUDIO`, supports partial results, and supports Android segmented sessions. It is a maintained drop-in successor to the community speech plugin.

## Google Sign-In

`src/utils/googleAuth.ts` uses `@capgo/capacitor-social-login` on Android. Put the **Web application OAuth client ID** in your build environment as `VITE_GOOGLE_CLIENT_ID`.

In Google Cloud Console, create/verify an **Android OAuth client** in the same project:

- Package name: `com.neuroscope.app`
- SHA-1: the certificate used to sign the APK you are testing

Get the local debug SHA-1 with:

```bash
cd android
gradlew.bat signingReport
```

For a Play Store build, also register the Play App Signing SHA-1 from Play Console → App integrity → App signing key certificate.

Do not put the Android client ID into `VITE_GOOGLE_CLIENT_ID`; the native plugin expects the **Web client ID** there. See the plugin's current Android troubleshooting guidance for error 28444 and SHA-1/package mismatches.
