// The server's command line. Run it through ./scripts/ft.sh, which starts it in the api image.
import { AdGuard } from '@family-time/adguard-client';
import { connectionConfig, readSecret, schema, type Db } from '@family-time/db';
import type { ChildStatus } from '@family-time/schemas';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { CliError, ownerInvite, recoveryLink } from './cli/commands.js';
import { addChild, addDevice, adguardSetup, control, resolveTarget, setupDefaults, status, syncServices } from './cli/control.js';

const USAGE = `Usage: ./scripts/ft.sh <command> [options]

First-time setup
  owner-invite --origin https://family.example.com [--name "Your name"] [--family "Family name"]
      Prints a link, valid for 24 hours, to make the first owner's passkey.
  recovery-link [--person "Name"]
      Prints a link, valid for 30 minutes, for an owner to add a new passkey.
  adguard-setup [--yes]
      Shows what will change in AdGuard. With --yes, sets it up: first-time setup, short caching so
      changes land within a minute, 7 days of query log, and the bypass rules.
  child-add --name "Ollie"
  device-add --child "Ollie" --label "Ollie's iPad" --type ipad --id 192.168.1.50 [--id aa:bb:cc:dd:ee:ff]
  setup-defaults --child "Ollie"
      Adds the Video, Games, Social and Chat groups, the starting schedules, and blocks each group
      unless it is planned or allowed.
  services-sync
      Adds YouTube, Roblox and the other usual services from AdGuard's catalogue.

Control (the app does the same; changes take up to a minute)
  allow|block --child "Ollie" (--service "Roblox" | --group "Games" | --everything) --for 30m|1h|until-bedtime|until-tomorrow
  pause --child "Ollie" [--for 30m|1h|until-bedtime]          until you resume, if no --for
  normal --child "Ollie" (--service ... | --group ... | --everything)
  resume --child "Ollie"
  status --child "Ollie"`;

const SWITCHES = new Set(['everything', 'yes']);
const REPEATABLE = new Set(['id']);

function flags(args: string[]): { values: Record<string, string>; lists: Record<string, string[]>; switches: Set<string> } {
  const values: Record<string, string> = {};
  const lists: Record<string, string[]> = {};
  const switches = new Set<string>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (!arg.startsWith('--')) throw new CliError(`Unexpected "${arg}".\n\n${USAGE}`);
    const key = arg.slice(2);
    if (SWITCHES.has(key)) {
      switches.add(key);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new CliError(`${arg} needs a value.\n\n${USAGE}`);
    if (REPEATABLE.has(key)) lists[key] = [...(lists[key] ?? []), value];
    else values[key] = value;
    i++;
  }
  return { values, lists, switches };
}

const time = (d: Date) => d.toLocaleString('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' });

function printStatus(s: ChildStatus): void {
  console.log(`${s.child.name}, at ${time(new Date(s.at))}:`);
  for (const svc of s.services) {
    const state = { allowed: 'Allowed', blocked: 'Blocked', paused: 'Paused' }[svc.state];
    const usage = svc.usageMinutesToday ? `  (about ${svc.usageMinutesToday} min today)` : '';
    console.log(`  ${svc.name.padEnd(14)} ${state.padEnd(8)} ${svc.reason}${svc.inForce ? '' : '  [not confirmed on every device yet]'}${usage}`);
  }
  for (const d of s.devices) {
    const quiet = d.quietSince ? `, quiet since ${time(new Date(d.quietSince))}` : '';
    console.log(`  Device: ${d.label}, AdGuard ${d.sync}${d.confirmedAt ? ` at ${time(new Date(d.confirmedAt))}` : ''}${quiet}`);
  }
}

function adguardFromEnv(): { client: AdGuard; username: string; password: string } {
  const password = readSecret('ADGUARD_PASSWORD');
  if (!password) throw new CliError('No AdGuard password. Run ./scripts/init.sh, which makes secrets/adguard_password.');
  const username = process.env.ADGUARD_USER ?? 'familytime';
  return { client: new AdGuard({ baseUrl: process.env.ADGUARD_URL ?? 'http://adguard:3000', username, password }), username, password };
}

async function run(db: Db, command: string, args: ReturnType<typeof flags>): Promise<number> {
  const { values, lists, switches } = args;
  const need = (key: string) => {
    const v = values[key];
    if (!v) throw new CliError(`${command} needs --${key}.\n\n${USAGE}`);
    return v;
  };
  const now = new Date();
  switch (command) {
    case 'owner-invite': {
      const r = await ownerInvite(db, { origin: need('origin'), ...(values.name ? { ownerName: values.name } : {}), ...(values.family ? { familyName: values.family } : {}) }, now);
      console.log(`Open this link on your iPhone to make your passkey. It works once, until ${time(r.expiresAt)}:\n\n  ${r.link}\n`);
      return 0;
    }
    case 'recovery-link': {
      const r = await recoveryLink(db, values.person ? { person: values.person } : {}, now);
      console.log(`Recovery link for ${r.for}. It works once, until ${time(r.expiresAt)}:\n\n  ${r.link}\n`);
      return 0;
    }
    case 'child-add':
      await addChild(db, need('name'));
      console.log(`Added ${values.name}. Next: device-add, then setup-defaults.`);
      return 0;
    case 'device-add': {
      const d = await addDevice(db, { child: need('child'), label: need('label'), type: values.type ?? 'other', ids: lists.id ?? [] });
      console.log(`Added. AdGuard will know it as ${d.adguardName} within a minute, once AdGuard is set up.`);
      return 0;
    }
    case 'setup-defaults': {
      const done = await setupDefaults(db, need('child'));
      console.log(done.length ? done.map((d) => `  added ${d}`).join('\n') : 'Nothing to add: the defaults are already there.');
      return 0;
    }
    case 'services-sync': {
      const r = await syncServices(db, adguardFromEnv().client);
      console.log(r.added.length ? `Added: ${r.added.join(', ')}.` : 'Nothing new to add.');
      if (r.missing.length) console.log(`Not in this AdGuard's catalogue: ${r.missing.join(', ')}.`);
      return 0;
    }
    case 'adguard-setup': {
      const ag = adguardFromEnv();
      const apply = switches.has('yes');
      const steps = await adguardSetup(db, ag.client, { username: ag.username, password: ag.password }, apply);
      if (!steps.length) {
        console.log('AdGuard is already set up. Nothing to change.');
        return 0;
      }
      console.log(apply ? 'Changed in AdGuard:' : 'This would change in AdGuard:');
      for (const s of steps) console.log(`  ${s.what}: ${s.from} -> ${s.to}`);
      console.log(
        apply
          ? '\nNothing on your router or devices has changed. See docs/setup/network.md for that step.'
          : '\nNothing has changed yet. To apply it: ./scripts/ft.sh adguard-setup --yes',
      );
      return 0;
    }
    case 'allow':
    case 'block':
    case 'pause':
    case 'normal': {
      const target =
        command === 'pause' && !values.service && !values.group
          ? ({ kind: 'everything' } as const)
          : await resolveTarget(db, { ...(values.service ? { service: values.service } : {}), ...(values.group ? { group: values.group } : {}), everything: switches.has('everything') });
      const s = await control(db, { child: need('child'), type: command, target, ...(values.for ? { duration: values.for } : {}) }, now);
      printStatus(s);
      console.log('\nTakes up to a minute to reach the devices.');
      return 0;
    }
    case 'resume':
      printStatus(await control(db, { child: need('child'), type: 'resume' }, now));
      return 0;
    case 'status':
      printStatus(await status(db, need('child'), now));
      return 0;
    default:
      throw new CliError(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

async function main(): Promise<number> {
  const [command, ...rest] = process.argv.slice(2);
  if (!command || command === 'help' || command === '--help') {
    console.log(USAGE);
    return command ? 0 : 2;
  }
  const args = flags(rest);
  const pool = new pg.Pool({ ...connectionConfig(), max: 1 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  try {
    return await run(db, command, args);
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
