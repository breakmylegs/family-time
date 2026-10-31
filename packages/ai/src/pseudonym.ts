// Children's names never go to a cloud model (brief Part 13, data level 2): each is replaced by
// "Child A", "Child B" on the way out, and put back on the way in.

export interface Pseudonyms {
  /** "Ollie" to "Child A". */
  hide: (text: string) => string;
  /** "Child A" back to "Ollie". */
  show: (text: string) => string;
  /** "Child A" to Ollie's id, for a proposal. */
  idOf: (label: string) => string | undefined;
  labels: { id: string; label: string }[];
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function pseudonyms(children: { id: string; name: string }[]): Pseudonyms {
  // Longest first, so "Ollie-May" is replaced before "Ollie".
  const sorted = [...children].sort((a, b) => b.name.length - a.name.length);
  const label = new Map(children.map((c, i) => [c.id, `Child ${String.fromCharCode(65 + i)}`]));
  return {
    hide: (text) => sorted.reduce((t, c) => t.replace(new RegExp(`\\b${escape(c.name)}\\b`, 'gi'), label.get(c.id)!), text),
    show: (text) => children.reduce((t, c) => t.replace(new RegExp(`\\b${escape(label.get(c.id)!)}\\b`, 'g'), c.name), text),
    idOf: (l) => children.find((c) => label.get(c.id) === l.trim())?.id,
    labels: children.map((c) => ({ id: c.id, label: label.get(c.id)! })),
  };
}

/** Untrusted text (anything a child typed, a domain name, an MCP result) as quoted data, never instructions. */
export function asData(name: string, value: string): string {
  const clean = value.replace(/<\/?data[^>]*>/gi, '').slice(0, 2000);
  return `<data name="${name}">\n${clean}\n</data>`;
}
