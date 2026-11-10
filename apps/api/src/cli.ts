// The server's command line. Run it through ./scripts/ft.sh, which starts it in the api image.
import { AdGuard } from '@family-time/adguard-client';
import { connectionConfig, readSecret, recordBackup, schema, setMaintenance, type Db } from '@family-time/db';
import type { ChildStatus } from '@family-time/schemas';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { audit } from './audit.js';
import { CliError, ownerInvite, recoveryLink } from './cli/commands.js';
import { addChild, addDevice, adguardSetup, allowanceFor, control, ledgerVerify, pilotPhase, resolveTarget, setChildPronouns, setupDefaults, status, syncServices } from './cli/control.js';
import { ledgerCheck, ledgerDeploy, ledgerStatus } from './cli/ledger.js';
import { ssoSetup } from './cli/sso.js';

const USAGE = `Usage: ./scripts/ft.sh <command> [options]

First-time setup
  owner-invite --origin https://family.example.com [--name "Your name"] [--family "Family name"]
      Prints a link, valid for 24 hours, to make the first owner's passkey.
  recovery-link [--person "Name"]
      Prints a link, valid for 30 minutes, for an owner to add a new passkey.
  adguard-setup [--yes]
      Shows what will change in AdGuard. With --yes, sets it up: first-time setup, short caching so
      changes land within a minute, 7 days of query log, and the bypass rules.
  child-add --name "Ollie" [--pronouns he|she|they]
      Pronouns are for the app's help text about the child. Without them it says they.
  child-set --child "Ollie" --pronouns he|she|they
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
  status --child "Ollie"

The weekly allowance and jobs (the app does the rest)
  pilot-phase [--phase baseline|reframe|reward-less|transitions|taper]
      Shows the family's pilot phase, or moves to another. reframe switches on the allowance and
      jobs; reward-less adds the unused-time bonus and the savings goal; taper lets agreed steps apply.
  allowance --child "Ollie" --minutes 420
      Sets the weekly allowance, in 30-minute blocks. It applies from the next week.
  ledger-verify
      Walks the ledger's hash chain and says whether every entry checks out.

The Besu ledger (only with LEDGER_ADAPTER=besu and the ledger-besu profile; docs/setup/besu.md)
  ledger-deploy [--admin 0xADDRESS] < secrets/ledger_admin_key
      Deploys a new ledger contract and replays the whole history onto it. The admin role goes to
      the cold key, which is read from standard input once and never kept; or give its address.
  ledger-check
      Rebuilds every balance from the chain's events and compares it with Postgres.
  ledger-status
      Shows the contract and how the signer's queue stands.

Operations
  maintenance --state on|off [--message "Back by 21:00"]
      While on, the app shows the message and refuses changes; sign-in still works and AdGuard keeps
      what it has.
  backup-recorded --result ok|failed [--bytes 123456] [--snapshot abc123] [--problem "why"]
      backup.sh runs this after each backup, so the System page shows it and owners hear of a failure.

Owner sign-in through Authentik (optional; docs/setup/authentik.md)
  sso-setup [--issuer https://auth.example.com/application/o/family-time/ --client-id ID | --off]
      Shows the setting, saves the provider's issuer and client id, or switches it off. The client
      secret goes in secrets/oidc_client_secret.`;

const SWITCHES = new Set(['everything', 'yes', 'off']);
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
    const until = svc.until ? ` until ${new Date(svc.until).toLocaleTimeString('en-GB', { timeZone: 'Europe/London', hour: '2-digit', minute: '2-digit' })}` : '';
    const state = { allowed: 'Allowed', blocked: 'Blocked', paused: 'Paused' }[svc.state] + until;
    const usage = svc.usageMinutesToday ? `  (about ${svc.usageMinutesToday} min today)` : '';
    console.log(`  ${svc.name.padEnd(14)} ${state.padEnd(22)} ${svc.reason}${svc.inForce ? '' : '  [not confirmed on every device yet]'}${usage}`);
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
      await addChild(db, need('name'), values.pronouns);
      console.log(`Added ${values.name}. Next: device-add, then setup-defaults.`);
      return 0;
    case 'child-set':
      await setChildPronouns(db, { child: need('child'), pronouns: need('pronouns') });
      console.log(`Updated ${values.child}.`);
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
    case 'pilot-phase': {
      const p = await pilotPhase(db, values.phase);
      const on = Object.entries(p.features).filter(([, v]) => v).map(([k]) => k);
      console.log(`Pilot phase: ${p.phase}. Switched on: ${on.length ? on.join(', ') : 'nothing yet (logging only)'}.`);
      return 0;
    }
    case 'allowance': {
      const minutes = Number(need('minutes'));
      await allowanceFor(db, { child: need('child'), minutes });
      console.log(`${values.child}'s allowance is ${minutes} minutes a week, from the next week.`);
      return 0;
    }
    case 'ledger-verify': {
      const v = await ledgerVerify(db);
      if (v.ok) {
        console.log(`The ledger checks out: ${v.checked} entries, every hash in order.`);
        return 0;
      }
      console.log(`The ledger does not check out at entry ${v.brokenAt}: ${v.problem}`);
      return 1;
    }
    case 'ledger-deploy': {
      const adminKey = values.admin || process.stdin.isTTY ? undefined : await stdinText();
      const r = await ledgerDeploy(db, { ...(values.admin ? { admin: values.admin } : {}), ...(adminKey ? { adminKey } : {}) });
      console.log(`Deployed the ledger contract at ${r.address} (block ${r.block}). Admin: ${r.admin}.`);
      console.log(`${r.queued} entries are queued to replay onto it; the worker sends them over the next minutes.`);
      console.log('Now move secrets/ledger_admin_key somewhere offline (docs/setup/besu.md). Nothing here needs it again.');
      return 0;
    }
    case 'ledger-check': {
      const c = await ledgerCheck(db);
      if (c.ok) {
        console.log(`The chain matches Postgres: ${c.entries} entries, ${c.events} on chain${c.waiting ? `, ${c.waiting} still on their way` : ''}, and every balance adds up.`);
        return 0;
      }
      console.log(`The chain does not match Postgres (${c.problems.length} problems):`);
      for (const p of c.problems.slice(0, 20)) console.log(`  ${p}`);
      return 1;
    }
    case 'ledger-status': {
      const s = await ledgerStatus(db);
      if (!s.contract) {
        console.log('No ledger contract is deployed. Run ./scripts/ft.sh ledger-deploy.');
        return 0;
      }
      console.log(`Contract ${s.contract.address}, version ${s.contract.version}, deployed at block ${s.contract.deployedBlock}, read up to block ${s.contract.indexedBlock ?? 'none'}.`);
      const q = s.queue!;
      console.log(`Queue: ${q.mined} confirmed, ${q.sent} sent, ${q.pending} waiting${q.failed ? `, ${q.failed} refused by the chain` : ''}.`);
      return q.failed ? 1 : 0;
    }
    case 'maintenance': {
      const state = need('state');
      if (state !== 'on' && state !== 'off') throw new CliError('maintenance needs --state on or --state off.');
      const message = values.message?.trim().slice(0, 200) || null;
      await setMaintenance(db, { on: state === 'on', message }, now);
      await audit(db, { actor: { label: 'cli' }, action: `maintenance.${state}`, after: { message } });
      console.log(state === 'on' ? `Maintenance mode is on. The app shows${message ? ` "${message}"` : ' a notice'} and refuses changes until: ./scripts/ft.sh maintenance --state off` : 'Maintenance mode is off. Changes work again.');
      return 0;
    }
    case 'backup-recorded': {
      const result = need('result');
      if (result !== 'ok' && result !== 'failed') throw new CliError('backup-recorded needs --result ok or --result failed.');
      const bytes = values.bytes ? Number(values.bytes) : null;
      await recordBackup(db, { ok: result === 'ok', bytes: Number.isFinite(bytes) ? bytes : null, snapshot: values.snapshot ?? null, problem: values.problem?.slice(0, 300) ?? null }, now);
      await audit(db, { actor: { label: 'backup' }, action: result === 'ok' ? 'backup.done' : 'backup.failed', after: { bytes, snapshot: values.snapshot ?? null, problem: values.problem ?? null } });
      console.log(`Recorded the backup as ${result === 'ok' ? 'done' : 'failed'}.`);
      return 0;
    }
    case 'sso-setup': {
      console.log(await ssoSetup(db, { ...(values.issuer ? { issuer: values.issuer } : {}), ...(values['client-id'] ? { clientId: values['client-id'] } : {}), off: switches.has('off') }));
      return 0;
    }
    default:
      throw new CliError(`Unknown command "${command}".\n\n${USAGE}`);
  }
}

/** Everything piped in on standard input, for a key that should never be a command argument. */
async function stdinText(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
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
