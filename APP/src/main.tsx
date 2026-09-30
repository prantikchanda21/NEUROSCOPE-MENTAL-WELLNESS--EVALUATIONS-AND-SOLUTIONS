import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageProvider';
import './index.css';
import { registerServiceWorker } from './utils/registerServiceWorker';

// Hosted mobile builds use their own same-origin /api/* routes. Native builds
// are pointed at the new mobile Vercel backend by setting VITE_API_BASE_URL at
// build time. This keeps the existing production website completely isolated.
const runtimeOrigin = typeof window !== 'undefined' ? window.location.origin : '';
const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || runtimeOrigin).replace(/\/$/, '');

const originalFetch = window.fetch.bind(window);
window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
  const rawUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
  if (rawUrl.startsWith('/api/')) {
    const absoluteUrl = `${API_BASE_URL}${rawUrl}`;
    if (input instanceof Request) {
      return originalFetch(new Request(absoluteUrl, input), init);
    }
    return originalFetch(absoluteUrl, init);
  }
  return originalFetch(input, init);
}) as typeof window.fetch;

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);

registerServiceWorker();
