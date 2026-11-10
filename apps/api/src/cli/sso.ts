// `ft.sh sso-setup`: owner sign-in through Authentik (brief Part 8, docs/setup/authentik.md). The
// issuer and client id are not secret, so they are a household setting; the client secret is the
// file secrets/oidc_client_secret, which only the owner fills in.
import { people, sessions, settings, type Db } from '@family-time/db';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { audit } from '../audit.js';
import { SETTING_OWNER_SSO, type OwnerSso } from '../auth/oidc.js';
import { CALLBACK_PATH } from '../routes/oidc.js';
import { getSetting, setSetting, theHousehold, webOrigin } from '../settings.js';
import { CliError } from './commands.js';

export async function ssoSetup(db: Db, input: { issuer?: string; clientId?: string; off?: boolean }): Promise<string> {
  const hh = await theHousehold(db);
  if (!hh) throw new CliError('Nothing is set up yet. Run owner-invite first.');
  if (input.off) {
    await db.delete(settings).where(and(eq(settings.householdId, hh.id), eq(settings.key, SETTING_OWNER_SSO)));
    const unlinked = await forgetLinks(db, hh.id);
    await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'auth.sso_off', after: { unlinked } });
    return `Sign-in with Authentik is off.${unlinked ? ' Linked owners are signed out everywhere and sign in with their passkey again.' : ''} Passkeys work as before.`;
  }
  if (!input.issuer || !input.clientId) {
    const now = await getSetting<OwnerSso>(db, hh.id, SETTING_OWNER_SSO);
    return now?.issuer ? `Sign-in with Authentik: ${now.issuer}, client ${now.clientId}.` : 'Sign-in with Authentik is off. Give --issuer and --client-id to switch it on.';
  }
  let issuer: URL;
  try {
    issuer = new URL(input.issuer.trim());
  } catch {
    throw new CliError(`"${input.issuer}" is not an address. Copy the OpenID Configuration Issuer from the provider in Authentik.`);
  }
  if (issuer.protocol !== 'https:') throw new CliError('The issuer must start with https://.');
  const clientId = input.clientId.trim();
  if (!/^[\w.-]{1,200}$/.test(clientId)) throw new CliError('That client id has characters Authentik never uses. Copy it again from the provider.');
  const sso: OwnerSso = { issuer: issuer.href, clientId };
  const before = await getSetting<OwnerSso>(db, hh.id, SETTING_OWNER_SSO);
  await setSetting(db, hh.id, SETTING_OWNER_SSO, sso);
  // A new issuer is a new set of accounts: links made with the old one would never match anyway.
  const unlinked = before?.issuer && before.issuer !== sso.issuer ? await forgetLinks(db, hh.id) : 0;
  await audit(db, { householdId: hh.id, actor: { label: 'cli' }, action: 'auth.sso_set', before: before ?? null, after: { ...sso, unlinked } });
  const site = await webOrigin(db, hh.id);
  return [
    `Saved. In Authentik, the provider's redirect URI must be ${site ? `${site.origin}${CALLBACK_PATH}` : `your public address followed by ${CALLBACK_PATH}`}.`,
    'Next: put the client secret in secrets/oidc_client_secret, run ./scripts/update.sh, then link your account in Settings (docs/setup/authentik.md).',
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
