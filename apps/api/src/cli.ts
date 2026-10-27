// The server's command line. Run it through ./scripts/ft.sh, which starts it in the api image.
//
//   ./scripts/ft.sh owner-invite --origin https://family.example.com [--name "Dad"] [--family "The Smiths"]
//   ./scripts/ft.sh recovery-link [--person "Dad"]
import { connectionConfig, schema, type Db } from '@family-time/db';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { CliError, ownerInvite, recoveryLink } from './cli/commands.js';

const USAGE = `Usage:
  owner-invite --origin https://family.example.com [--name "Your name"] [--family "Family name"]
      First-time setup. Prints a link, valid for 24 hours, to make the first owner's passkey.
  recovery-link [--person "Name"]
      Prints a link, valid for 30 minutes, for an owner to add a new passkey.`;

function flags(args: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) throw new CliError(`Unexpected "${arg}".\n${USAGE}`);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new CliError(`${arg} needs a value.\n${USAGE}`);
    out[arg.slice(2)] = value;
    i++;
  }
  return out;
}

const time = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const options = flags(rest);
  const pool = new pg.Pool({ ...connectionConfig(), max: 1 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  try {
    if (command === 'owner-invite') {
      if (!options.origin) throw new CliError(`owner-invite needs --origin.\n${USAGE}`);
      const result = await ownerInvite(db, { origin: options.origin, ...(options.name ? { ownerName: options.name } : {}), ...(options.family ? { familyName: options.family } : {}) }, new Date());
      console.log(`Open this link on your iPhone to make your passkey. It works once, until ${time(result.expiresAt)}:\n\n  ${result.link}\n`);
      return 0;
    }
    if (command === 'recovery-link') {
      const result = await recoveryLink(db, options.person ? { person: options.person } : {}, new Date());
      console.log(`Recovery link for ${result.for}. It works once, until ${time(result.expiresAt)}:\n\n  ${result.link}\n`);
      return 0;
    }
    throw new CliError(`Unknown command "${command}".\n${USAGE}`);
  } finally {
    await pool.end();
  }
}

main().then(
  (code) => process.exit(code),
  (err) => {
    console.error(err instanceof CliError ? err.message : `Failed: ${(err as Error).message}`);
    process.exit(1);
  },
);
