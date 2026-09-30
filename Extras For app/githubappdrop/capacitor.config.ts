import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.neuroscope.app',
  appName: 'NeuroScope',
  webDir: 'dist',
  android: {
    backgroundColor: '#ffffff',
  },
  server: {
    cleartext: false,
  },
  plugins: {
    SocialLogin: {
      providers: {
        google: true,
        facebook: false,
        apple: false,
        twitter: false,
      },
      logLevel: 1,
    },
  },
};

export default config;
