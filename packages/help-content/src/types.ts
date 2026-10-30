export const EVIDENCE = ['strong', 'moderate', 'early'] as const;
export type Evidence = (typeof EVIDENCE)[number];

/** The panel's sections, in the order the brief sets (Part 10). Right now and Related come from the app. */
export const SECTIONS = ['In short', 'How to use it', 'How it works', 'Why it helps', 'What {child} sees', 'Watch out for', 'The research'] as const;
export type SectionName = (typeof SECTIONS)[number];

export interface Topic<Id extends string = string> {
  id: Id;
  title: string;
  /** Null for explanation-only topics, which show no badge. */
  evidence: Evidence | null;
  /** The badge's one line: "One well-run trial of 70 families." */
  evidenceNote: string | null;
  sources: string[];
  /** ISO date. */
  lastReviewed: string;
  related: Id[];
  /** Topics beyond the brief's seed text stay `needs-review` until the owner approves them. */
  status: 'reviewed' | 'needs-review';
  inShort: string;
  howToUse: string[] | null;
  howItWorks: string[] | null;
  whyItHelps: string[] | null;
  /** In the kiosk's font, as the child would read it. */
  childSees: string | null;
  watchOutFor: string[] | null;
  research: string[] | null;
}

export interface Source {
  id: string;
  /** "Epstein LH and others, 2008, Archives of Pediatrics and Adolescent Medicine." */
  citation: string;
  /** What kind of study, from the research docs: "Randomised trial, 70 families". */
  design: string;
  /** What it found, in a sentence. */
  finding: string;
}

export interface Content<Id extends string = string> {
  topics: Record<Id, Topic<Id>>;
  sources: Record<string, Source>;
}

/** The child, as help text names them. Pronouns default to they. */
export interface ChildWords {
  name: string;
  pronouns?: 'he' | 'she' | 'they' | null;
}
