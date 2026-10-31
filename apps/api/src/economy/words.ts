// How amounts and times read in the app: "50p", "£1.20", "30 min", "5 h 30", "today at 17:05".
import { civilDate, clockLabel } from '@family-time/domain';

export function pence(p: number): string {
  const sign = p < 0 ? '-' : '';
  const a = Math.abs(p);
  return a < 100 ? `${sign}${a}p` : `${sign}£${(a / 100).toFixed(a % 100 ? 2 : 0)}`;
}

export function minutes(m: number): string {
  const sign = m < 0 ? '-' : '';
  const a = Math.abs(m);
  const h = Math.floor(a / 60);
  const r = a % 60;
  // "63 min", not "1 h 3": under two hours, anything but whole half-hours reads as minutes.
  if (!h || (a < 120 && a % 30)) return `${sign}${a} min`;
  return `${sign}${h} h${r ? ` ${r}` : ''}`;
}

export function points(n: number): string {
  return `${n} ${Math.abs(n) === 1 ? 'point' : 'points'}`;
}

export function rewardLabel(type: string, amount: number): string {
  if (type === 'money') return pence(amount);
  if (type === 'flex') return points(amount);
  if (type === 'time') return minutes(amount);
  return 'Praise only';
}

/** "today at 17:05", "yesterday at 19:10", or "Tue 07:00" further back. */
export function when(at: Date, now: Date, timeZone: string): string {
  const day = civilDate(at, timeZone);
  const today = civilDate(now, timeZone);
  const label = clockLabel(at, now, timeZone);
  if (day.year === today.year && day.month === today.month && day.day === today.day) return `today at ${label}`;
  const y = civilDate(new Date(now.getTime() - 86_400_000), timeZone);
  if (day.year === y.year && day.month === y.month && day.day === y.day) return `yesterday at ${label.replace(/^\w{3} /, '')}`;
  return label;
}

const FORMS = { he: ['he', 'him', 'his'], she: ['she', 'her', 'her'], they: ['they', 'them', 'their'] } as const;

/** The child's pronouns for server-made sentences. Unset reads as they. */
export function pronounsOf(p: 'he' | 'she' | 'they' | null | undefined) {
  const [they, them, their] = FORMS[p ?? 'they'];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  return { they, them, their, They: cap(they), has: p === 'they' || !p ? 'have' : 'has' };
}

/** Suggested notes, three per item: thanks for jobs, curiosity for things done for love. */
const PHRASES = {
  job: ['Thank you, that really helped', 'You did it without being asked', 'That made a real difference', 'I noticed how carefully you did that', 'That saved me a job, thank you'],
  praise: ['Love what you made', 'How did you work that out?', 'Can you show me later?', 'You kept going until it worked', 'Tell me about it at tea'],
};

export function suggestions(kind: 'job' | 'praise', seed: string): string[] {
  const pool = PHRASES[kind];
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return [0, 1, 2].map((i) => pool[(h + i) % pool.length]!);
}
