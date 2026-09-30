/**
 * Google Sign-In for NeuroScope.
 *
 * Android (Capacitor): uses @capgo/capacitor-social-login + Google Credential
 * Manager. Web: keeps the existing Google Identity Services button.
 *
 * For Android, VITE_GOOGLE_CLIENT_ID must be the WEB application OAuth client
 * ID. The Android OAuth client is configured only in Google Cloud using the
 * package name + SHA-1 of the signing certificate.
 */

import { Capacitor } from '@capacitor/core';
import { SocialLogin } from '@capgo/capacitor-social-login';

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: Record<string, unknown>) => void;
          renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
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

let nativeInitialized = false;
let webScriptPromise: Promise<void> | null = null;

function loadGoogleScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.google?.accounts?.id) return Promise.resolve();
  if (webScriptPromise) return webScriptPromise;

  webScriptPromise = new Promise((resolve, reject) => {
    const existing = document.getElementById('google-identity-script');
    if (existing) {
      existing.addEventListener('load', () => resolve(), { once: true });
      existing.addEventListener('error', () => reject(new Error('script-failed')), { once: true });
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

  return webScriptPromise;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function profileFromNativeResult(result: any): GoogleProfile | null {
  const profile = result?.profile;
  if (profile?.email) {
    return {
      email: String(profile.email),
      name: String(profile.name || [profile.givenName, profile.familyName].filter(Boolean).join(' ') || profile.email),
      picture: profile.imageUrl ? String(profile.imageUrl) : undefined,
    };
  }

  const claims = result?.idToken ? decodeJwtPayload(String(result.idToken)) : null;
  const email = typeof claims?.email === 'string' ? claims.email : '';
  if (!email) return null;

  return {
    email,
    name: typeof claims?.name === 'string' ? claims.name : email,
    picture: typeof claims?.picture === 'string' ? claims.picture : undefined,
  };
}

async function renderNativeGoogleButton(
  container: HTMLElement,
  onSuccess: (profile: GoogleProfile) => void,
  onError: (message: string) => void,
): Promise<void> {
  if (!GOOGLE_CLIENT_ID) {
    onError('Google sign-in is not configured. Add VITE_GOOGLE_CLIENT_ID.');
    return;
  }

  try {
    if (!nativeInitialized) {
      await SocialLogin.initialize({
        google: {
          webClientId: GOOGLE_CLIENT_ID,
          mode: 'online',
        },
      });
      nativeInitialized = true;
    }

    container.innerHTML = '';
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Continue with Google');
    button.style.width = '100%';
    button.style.minHeight = '46px';
    button.style.border = '1px solid #d1d5db';
    button.style.borderRadius = '9999px';
    button.style.background = '#ffffff';
    button.style.color = '#111827';
    button.style.fontSize = '14px';
    button.style.fontWeight = '700';
    button.style.cursor = 'pointer';
    button.textContent = 'Continue with Google';

    button.onclick = async () => {
      button.disabled = true;
      button.textContent = 'Signing in…';
      try {
        const response = await SocialLogin.login({
          provider: 'google',
          options: {
            scopes: ['openid', 'email', 'profile'],
            filterByAuthorizedAccounts: false,
            autoSelectEnabled: false,
            style: 'standard',
          },
        });

        const profile = profileFromNativeResult(response.result);
        if (!profile) {
          throw new Error('Google did not return a usable profile.');
        }
        onSuccess(profile);
      } catch (error: any) {
        console.error('Native Google Sign-In failed:', error);
        const message = String(error?.message || error || 'Google sign-in failed.');
        if (/28444|developer console|sha-?1|client.?id|credential/i.test(message)) {
          onError('Google setup error: check the Android package name/SHA-1 and Web OAuth client ID in Google Cloud.');
        } else if (/cancel/i.test(message)) {
          onError('Google sign-in was cancelled.');
        } else {
          onError('Google sign-in failed. Please try again.');
        }
      } finally {
        button.disabled = false;
        button.textContent = 'Continue with Google';
      }
    };

    container.appendChild(button);
  } catch (error) {
    console.error('Native Google Sign-In setup failed:', error);
    onError('Google sign-in could not be initialized. Check Google Cloud configuration.');
  }
}

export async function renderGoogleButton(
  container: HTMLElement,
  onSuccess: (profile: GoogleProfile) => void,
  onError: (message: string) => void,
): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    await renderNativeGoogleButton(container, onSuccess, onError);
    return;
  }

  if (!GOOGLE_CLIENT_ID) {
    onError('Google sign-in is not configured yet — add VITE_GOOGLE_CLIENT_ID to enable it.');
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
        const claims = response.credential ? decodeJwtPayload(response.credential) : null;
        const email = typeof claims?.email === 'string' ? claims.email : '';
        if (!email) {
          onError('Could not read your Google profile. Please try again.');
          return;
        }
        onSuccess({
          email,
          name: typeof claims?.name === 'string' ? claims.name : email,
          picture: typeof claims?.picture === 'string' ? claims.picture : undefined,
        });
      },
      auto_select: false,
    });

    container.innerHTML = '';
    window.google.accounts.id.renderButton(container, {
      theme: 'outline',
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
