// What the kiosk calls the grown-ups (Phase 12). Every household is different: "Mum and Dad",
// "Dad", "Mum and Mum", "Nana and Grandad". The owner sets it; the pilot family keeps the default.
import type { Db } from '@family-time/db';
import { eitherOf, type KioskWords } from '@family-time/schemas';
import { getSetting, setSetting } from '../settings.js';

export const SETTING_KIOSK_WORDS = 'kiosk_words';
export const DEFAULT_GROWN_UPS = 'Mum and Dad';

export { eitherOf };

export async function kioskWords(db: Db, householdId: string): Promise<KioskWords> {
  const saved = await getSetting<{ both?: unknown }>(db, householdId, SETTING_KIOSK_WORDS);
  const both = typeof saved?.both === 'string' && saved.both ? saved.both : DEFAULT_GROWN_UPS;
  return { both, either: eitherOf(both) };
}

export async function setKioskWords(db: Db, householdId: string, typed: string): Promise<KioskWords> {
  // A capital first letter, as a name has, so a sentence that starts with it reads properly.
  const both = typed.charAt(0).toUpperCase() + typed.slice(1);
  await setSetting(db, householdId, SETTING_KIOSK_WORDS, { both });
  return { both, either: eitherOf(both) };
}
