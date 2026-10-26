import { readFileSync } from 'node:fs';

/**
 * Reads NAME_FILE first, then NAME. An unreadable or empty file is an error, never an empty
 * secret: a missing mount must stop the service, not let it start with no password.
 */
export function readSecret(name: string, env: NodeJS.ProcessEnv = process.env): string | undefined {
  const file = env[`${name}_FILE`];
  if (file) {
    let value: string;
    try {
      value = readFileSync(file, 'utf8').trim();
    } catch (err) {
      throw new Error(`${name}_FILE points at ${file}, which cannot be read: ${(err as Error).message}`, { cause: err });
    }
    if (!value) throw new Error(`${name}_FILE points at ${file}, which is empty`);
    return value;
  }
  return env[name] || undefined;
}
