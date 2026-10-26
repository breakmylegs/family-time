// Finds statements that would stop the previous image from running on the new schema.
// update.sh rolls back images only, never the database, so every migration must be additive.

const FORBIDDEN: [RegExp, string][] = [
  [/\bDROP\s+(TABLE|COLUMN|INDEX|TYPE|CONSTRAINT|SCHEMA|VIEW|FUNCTION|TRIGGER)\b/i, 'drops something'],
  [/\bALTER\s+COLUMN\s+"?\w+"?\s+(SET\s+DATA\s+)?TYPE\b/i, 'changes a column type'],
  [/\bRENAME\b/i, 'renames something'],
  [/\bSET\s+NOT\s+NULL\b/i, 'makes an existing column NOT NULL'],
  // A TRUNCATE statement, not a trigger that guards against one (`BEFORE TRUNCATE ON x`).
  [/(^|;|\n)\s*TRUNCATE\b/i, 'truncates a table'],
  [/(^|;|\n)\s*DELETE\s+FROM\b/i, 'deletes rows'],
];

export function additiveProblems(sql: string): string[] {
  const problems: string[] = [];
  for (const statement of sql.split('--> statement-breakpoint')) {
    const text = statement.replace(/--.*$/gm, '').trim();
    if (!text) continue;
    for (const [pattern, why] of FORBIDDEN) {
      if (pattern.test(text)) problems.push(`${why}: ${text.slice(0, 120)}`);
    }
    // A NOT NULL column added to an existing table needs a default, or the old image's inserts fail.
    const added = /\bADD\s+COLUMN\b([\s\S]*)/i.exec(text);
    if (added?.[1] && /\bNOT\s+NULL\b/i.test(added[1]) && !/\bDEFAULT\b/i.test(added[1])) {
      problems.push(`adds a NOT NULL column with no default: ${text.slice(0, 120)}`);
    }
  }
  return problems;
}
