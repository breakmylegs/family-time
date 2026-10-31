// AI provider keys at rest (brief Part 8, ADR 0016): AES-256-GCM under the master key init.sh made
// (`secrets/master_key`, 32 random bytes as hex). No master key, no AI: this fails closed rather
// than fall back to a key in the code.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const VERSION = 'v1';

export class NoMasterKey extends Error {
  constructor() {
    super('There is no master key, so AI keys cannot be stored. Run ./scripts/init.sh.');
  }
}

/** The 32-byte key from the secret's hex. */
export function masterKeyFrom(hex: string | undefined | null): Buffer {
  const clean = (hex ?? '').trim();
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) throw new NoMasterKey();
  return Buffer.from(clean, 'hex');
}

/** `v1:` then base64 of nonce (12 bytes), tag (16 bytes) and the ciphertext. */
export function seal(key: Buffer, plaintext: string, context: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  // The context (which provider, which field) is authenticated, so a sealed value cannot be
  // copied from one setting to another.
  cipher.setAAD(Buffer.from(context, 'utf8'));
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64')}`;
}

export function open(key: Buffer, sealed: string, context: string): string {
  const [version, data] = sealed.split(':');
  if (version !== VERSION || !data) throw new Error('A stored key is in a form this version cannot read.');
  const raw = Buffer.from(data, 'base64');
  const decipher = createDecipheriv('aes-256-gcm', key, raw.subarray(0, 12));
  decipher.setAAD(Buffer.from(context, 'utf8'));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString('utf8');
}

/** What Settings shows of a key: its last four characters, never more. */
export const lastFour = (key: string): string => key.trim().slice(-4);
