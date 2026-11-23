// `ft.sh sso-setup`: owner sign-in through the household's OpenID Connect provider, such as
// Authentik or Authelia (brief Part 8, docs/setup/owner-sign-in.md). The issuer, client id and the
// name the app shows are not secret, so they are a household setting; the client secret is the file
// secrets/oidc_client_secret, which only the owner fills in.
import { people, sessions, settings, type Db } from '@family-time/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { audit } from '../audit.js';
import { SETTING_OWNER_SSO, ssoName, type OwnerSso } from '../auth/oidc.js';
import { CALLBACK_PATH } from '../routes/oidc.js';
import { getSetting, setSetting, theHousehold, webOrigin } from '../settings.js';
import { CliError } from './commands.js';

/** A name the app can show as is: letters, digits, spaces and a few marks, like "Authelia" or "Home sign-in". */
const NAME = /^[\p{L}\p{N}][\p{L}\p{N} .'&-]{0,39}$/u;

export async function ssoSetup(db: Db, input: { issuer?: string; clientId?: string; name?: string; off?: boolean }): Promise<string> {
  const hh = await theHousehold(db);
  if (!hh) throw new CliError('Nothing is set up yet. Run owner-invite first.');
  const before = await getSetting<OwnerSso>(db, hh.id, SETTING_OWNER_SSO);
  if (input.off) {
    await db.delete(settings).where(and(eq(settings.householdId, hh.id), eq(settings.key, SETTING_OWNER_SSO)));
    const unlinked = await forgetLinks(db, hh.id);
    await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'auth.sso_off', after: { unlinked } });
    return `Sign-in with ${ssoName(before)} is off.${unlinked ? ' Linked owners are signed out everywhere and sign in with their passkey again.' : ''} Passkeys work as before.`;
  }
  const name = input.name?.trim();
  if (name !== undefined && !NAME.test(name)) throw new CliError('--name is what the app calls your sign-in service, like "Authelia": up to 40 letters, digits and spaces.');
  // Only the name: the issuer and client stay as they are, and nobody is signed out.
  if (name !== undefined && !input.issuer && !input.clientId) {
    if (!before?.issuer) throw new CliError('Set the sign-in service up first: --issuer, --client-id and, if you like, --name.');
    const sso: OwnerSso = { ...before, name };
    await setSetting(db, hh.id, SETTING_OWNER_SSO, sso);
    await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'auth.sso_set', before, after: sso });
    return `Saved. The app now says "Sign in with ${name}".`;
  }
  if (!input.issuer || !input.clientId) {
    return before?.issuer
      ? `Sign-in with ${ssoName(before)}: ${before.issuer}, client ${before.clientId}.`
      : 'Owner sign-in through a sign-in service is off. Give --issuer and --client-id (and --name) to switch it on.';
  }
  let issuer: URL;
  try {
    issuer = new URL(input.issuer.trim());
  } catch {
    throw new CliError(`"${input.issuer}" is not an address. Use the issuer your sign-in service gives: Authelia's root address, or the OpenID Configuration Issuer in Authentik.`);
  }
  if (issuer.protocol !== 'https:') throw new CliError('The issuer must start with https://.');
  const clientId = input.clientId.trim();
  if (!/^[\w.~-]{1,200}$/.test(clientId)) throw new CliError('That client id has characters a client id never has. Copy it again from your sign-in service.');
  const sso: OwnerSso = { issuer: issuer.href, clientId, ...(name ? { name } : before?.name ? { name: before.name } : {}) };
  await setSetting(db, hh.id, SETTING_OWNER_SSO, sso);
  // A new issuer is a new set of accounts: links made with the old one would never match anyway.
  const unlinked = before?.issuer && before.issuer !== sso.issuer ? await forgetLinks(db, hh.id) : 0;
  await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'auth.sso_set', before: before ?? null, after: { ...sso, unlinked } });
  const site = await webOrigin(db, hh.id);
  return [
    `Saved. In ${ssoName(sso)}, the client's redirect URI must be ${site ? `${site.origin}${CALLBACK_PATH}` : `your public address followed by ${CALLBACK_PATH}`}.`,
    'Next: put the client secret in secrets/oidc_client_secret, run ./scripts/update.sh, then link your account in Settings (docs/setup/owner-sign-in.md).',
    ...(name ? [] : ['The app calls it "your sign-in service". To show its name instead: ./scripts/ft.sh sso-setup --name "Authelia".']),
    ...(unlinked ? ['The issuer changed, so earlier links are gone: link again in Settings.'] : []),
  ].join('\n');
}

/** Clears every owner's link and signs those owners out everywhere. Returns how many there were. */
async function forgetLinks(db: Db, householdId: string): Promise<number> {
  const linked = (await db.select({ id: people.id }).from(people).where(and(eq(people.householdId, householdId), isNotNull(people.oidcSubject)))).map((p) => p.id);
  if (!linked.length) return 0;
  await db.update(people).set({ oidcSubject: null }).where(inArray(people.id, linked));
  await db.delete(sessions).where(inArray(sessions.personId, linked));
  return linked.length;
}
