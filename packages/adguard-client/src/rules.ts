// Our block of AdGuard user rules. We own only the lines between the two markers and never touch
// a rule outside them. If the markers are not exactly one begin followed by one end, we refuse to
// write anything rather than guess where our block is.

export const BEGIN = '! family-time: begin (managed, do not edit by hand)';
export const END = '! family-time: end';

export class MarkerError extends Error {}

export interface Split {
  before: string[];
  ours: string[];
  after: string[];
}

/** Splits the user rules into the parts before, inside and after our block. No block: all in `before`. */
export function splitRules(rules: string[]): Split {
  const begins = rules.flatMap((r, i) => (r.trim() === BEGIN ? [i] : []));
  const ends = rules.flatMap((r, i) => (r.trim() === END ? [i] : []));
  if (begins.length === 0 && ends.length === 0) return { before: rules, ours: [], after: [] };
  if (begins.length !== 1 || ends.length !== 1 || ends[0]! < begins[0]!) {
    throw new MarkerError(
      `AdGuard's custom rules have ${begins.length} family-time begin marker(s) and ${ends.length} end marker(s)` +
        (begins.length === 1 && ends.length === 1 ? ', in the wrong order' : '') +
        '. Nothing was written. Fix them in AdGuard (Filters, Custom filtering rules): there should be one of each, begin first.',
    );
  }
  const b = begins[0]!;
  const e = ends[0]!;
  return { before: rules.slice(0, b), ours: rules.slice(b + 1, e), after: rules.slice(e + 1) };
}

/** The full rules list with our block replaced by `ours`. Everything else is kept, in order. */
export function withOurRules(rules: string[], ours: string[]): string[] {
  const { before, after } = splitRules(rules);
  return [...before, BEGIN, ...ours, END, ...after];
}

/** AdGuard client names we generate are plain, so they need no escaping inside `$client`. */
const SAFE_NAME = /^ft-[a-z0-9-]{1,60}$/;
const SAFE_DOMAIN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/** Rules that block a custom service's domains (and their subdomains) for one device. */
export function blockRules(clientName: string, domains: string[]): string[] {
  if (!SAFE_NAME.test(clientName)) throw new Error(`Unexpected AdGuard client name "${clientName}"`);
  return [...new Set(domains.map((d) => d.trim().toLowerCase()))]
    .filter((d) => {
      if (!SAFE_DOMAIN.test(d)) throw new Error(`"${d}" is not a domain name`);
      return true;
    })
    .sort()
    .map((d) => `||${d}^$client='${clientName}'`);
}

/** The client name we give a device in AdGuard: `ft-` and a short id. */
export function clientNameFor(deviceId: string): string {
  return `ft-${deviceId.replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 12)}`;
}
