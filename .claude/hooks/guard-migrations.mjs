// PreToolUse hook: refuses an edit to a migration that is already committed. Committed means it
// may already be applied on the server, and changing it there is silent schema drift. Add a new
// migration instead (corepack pnpm --filter @family-time/db generate).
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
if (!file) process.exit(0);

const root = resolve(process.env.CLAUDE_PROJECT_DIR || input.cwd || '.');
const rel = relative(root, resolve(file)).split(sep).join('/');
if (!rel.startsWith('packages/db/migrations/')) process.exit(0);

const isTracked = () => {
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', rel], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};
if (isTracked()) {
  console.error(
    `Blocked: ${rel} is committed, so it may already be applied on the server. ` +
      'Never edit an applied migration. Change packages/db/src/schema.ts and run ' +
      '`corepack pnpm --filter @family-time/db generate` to add a new one.',
  );
  process.exit(2);
}
