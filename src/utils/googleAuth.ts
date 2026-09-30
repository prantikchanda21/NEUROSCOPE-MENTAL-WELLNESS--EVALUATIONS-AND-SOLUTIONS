/**
 * Google "Sign in with Google" via Google Identity Services (GIS).
 *
 * Requires a Google OAuth Client ID (from https://console.cloud.google.com/apis/credentials,
 * an "OAuth client ID" of type "Web application") exposed to the client as
 * VITE_GOOGLE_CLIENT_ID — see .env.example. Without it the button area shows
 * a friendly "not configured" message instead of throwing.
 *
 * NOTE ON TRUST: the ID token below is decoded client-side only, which is
 * fine for a client-only prototype like this one (there's no backend of its
 * own to verify against yet — see authStorage.ts). For a production
 * deployment, send `response.credential` to your server and verify it there
 * (e.g. with Google's `google-auth-library`) before trusting the email in it.
 */

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
          prompt: () => void;
        };
      };
    };
  }
}

export interface GoogleProfile {
  email: string;
  name: string;
  picture?: string;
}

export const GOOGLE_CLIENT_ID: string | undefined = (
  import.meta as unknown as { env?: Record<string, string> }
).env?.VITE_GOOGLE_CLIENT_ID;

let scriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (scriptPromise) return scriptPromise;

  scriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('google-identity-script');
    if (existing) {
      existing.addEventListener('load', () => resolve());
      existing.addEventListener('error', () => reject(new Error('script-failed')));
      return;
    }
    const script = document.createElement('script');
    script.id = 'google-identity-script';
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('script-failed'));
    document.head.appendChild(script);
  });

  return scriptPromise;
}

function decodeCredential(credential: string): GoogleProfile | null {
  try {
    const payload = credential.split('.')[1];
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(decodeURIComponent(escape(atob(normalized))));
    if (!json.email) return null;
    return { email: json.email, name: json.name || json.email, picture: json.picture };
  } catch {
    return null;
  }
}

/**
 * Mounts the official Google button into `container`. Calls onSuccess with
 * the decoded profile, or onError with a short user-facing message.
 */
export async function renderGoogleButton(
  container: HTMLElement,
  onSuccess: (profile: GoogleProfile) => void,
  onError: (message: string) => void
): Promise<void> {
  if (!GOOGLE_CLIENT_ID) {
    onError('Google sign-in isn\u2019t configured yet — add VITE_GOOGLE_CLIENT_ID to enable it.');
    return;
  }

  try {
    await loadGoogleScript();
    if (!window.google?.accounts?.id) {
      onError('Google sign-in could not be loaded. Check your connection and try again.');
      return;
    }

    window.google.accounts.id.initialize({
      client_id: GOOGLE_CLIENT_ID,
      callback: (response: { credential?: string }) => {
        const profile = response.credential ? decodeCredential(response.credential) : null;
        if (profile) onSuccess(profile);
        else onError('Could not read your Google profile. Please try again.');
      },
      auto_select: false,
    });

    container.innerHTML = '';
    window.google.accounts.id.renderButton(container, {
      theme: 'filled_black',
      size: 'large',
      shape: 'pill',
      text: 'continue_with',
      logo_alignment: 'center',
      width: Math.min(container.clientWidth || 320, 360),
    });
  } catch {
    onError('Google sign-in could not be loaded. Check your connection and try again.');
  }
}
