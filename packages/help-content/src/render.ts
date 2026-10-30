import type { ChildWords } from './types.js';

const FORMS = {
  he: { they: 'he', them: 'him', their: 'his' },
  she: { they: 'she', them: 'her', their: 'her' },
  they: { they: 'they', them: 'them', their: 'their' },
} as const;

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Puts the child's name and pronouns into help text. Topics are written so either reads well. */
export function forChild(text: string, child: ChildWords): string {
  const f = FORMS[child.pronouns ?? 'they'];
  return text
    .replaceAll('{child}', child.name)
    .replaceAll('{They}', cap(f.they))
    .replaceAll('{Their}', cap(f.their))
    .replaceAll('{they}', f.they)
    .replaceAll('{them}', f.them)
    .replaceAll('{their}', f.their);
}
