import type { Me } from '@family-time/schemas';
import { startAuthentication, startRegistration, WebAuthnError } from '@simplewebauthn/browser';
import { api, ApiFailure } from './api';

type Options<T> = { challengeId: string; options: T };

/** Sign in with a passkey already on this device. Face ID or the passcode unlocks it. */
export async function signInWithPasskey(): Promise<Me> {
  const { challengeId, options } = await api<Options<Parameters<typeof startAuthentication>[0]['optionsJSON']>>('POST', '/api/auth/login/options', {});
  const response = await ask(() => startAuthentication({ optionsJSON: options }));
  return api<Me>('POST', '/api/auth/login/verify', { challengeId, response });
}

/** Make a passkey from an invite or recovery link, and sign in with it. */
export async function joinWithPasskey(token: string, label?: string): Promise<Me> {
  const { challengeId, options } = await api<Options<Parameters<typeof startRegistration>[0]['optionsJSON']>>('POST', '/api/invites/register/options', { token });
  const response = await ask(() => startRegistration({ optionsJSON: options }));
  return api<Me>('POST', '/api/invites/register/verify', { token, challengeId, response, ...(label ? { label } : {}) });
}

/** Turns the browser's passkey errors into a sentence. Cancelling is not an error worth shouting about. */
async function ask<T>(prompt: () => Promise<T>): Promise<T> {
  try {
    return await prompt();
  } catch (err) {
    const name = err instanceof WebAuthnError ? (err.cause as Error | undefined)?.name : (err as Error).name;
    if (name === 'NotAllowedError' || name === 'AbortError') {
      throw new ApiFailure(0, 'cancelled', 'Cancelled. Try again when you are ready.');
    }
    if (name === 'InvalidStateError') {
      throw new ApiFailure(0, 'already_registered', 'This device already has a passkey for Family time. Sign in instead.');
    }
    throw new ApiFailure(0, 'passkey_error', 'This browser could not make or use a passkey. On an iPhone, use Safari.');
  }
}
