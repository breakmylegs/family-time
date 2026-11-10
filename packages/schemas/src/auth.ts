import { z } from 'zod';

export const InvitableRole = z.enum(['owner', 'parent', 'carer']);
export const PersonRole = z.enum(['owner', 'parent', 'carer', 'child']);

/** A token from an invite or recovery link. */
export const InviteToken = z.string().regex(/^[A-Za-z0-9_-]{40,60}$/, 'That link is not complete. Copy the whole link and try again.');

export const InviteLookupRequest = z.object({ token: InviteToken });
export const InviteLookup = z.object({
  kind: z.enum(['join', 'recovery']),
  householdName: z.string(),
  /** The name the person was invited as, or the person a recovery link is for. */
  displayName: z.string(),
  role: PersonRole,
});
export type InviteLookup = z.infer<typeof InviteLookup>;

/** WebAuthn JSON from the browser. SimpleWebAuthn checks its contents; this only checks the shape. */
const WebAuthnJson = z.looseObject({ id: z.string().min(1).max(1024), type: z.literal('public-key') });

export const RegisterOptionsRequest = z.object({ token: InviteToken });
export const RegisterVerifyRequest = z.object({
  token: InviteToken,
  challengeId: z.uuid(),
  response: WebAuthnJson,
  /** What the person calls this device, for example "Mum's iPhone". */
  label: z.string().trim().min(1).max(60).optional(),
});

export const LoginVerifyRequest = z.object({ challengeId: z.uuid(), response: WebAuthnJson });

export const Me = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: PersonRole,
  capabilities: z.array(z.string()),
  householdName: z.string(),
});
export type Me = z.infer<typeof Me>;

export const AuthState = z.object({
  /** `needs-owner` until the first owner has joined. */
  setup: z.enum(['needs-owner', 'ready']),
  me: Me.nullable(),
  /** The sign-in screen offers "Sign in with Authentik": set up on the server, and an owner has linked it. */
  sso: z.boolean(),
});
export type AuthState = z.infer<typeof AuthState>;

export const CreateInviteRequest = z.object({
  displayName: z.string().trim().min(1, 'Add their name.').max(60),
  role: InvitableRole,
});

/** An open invite. Its link is shown once, when it is made: only a hash of the token is kept. */
export const OpenInvite = z.object({ id: z.uuid(), expiresAt: z.string(), displayName: z.string(), role: InvitableRole });
export type OpenInvite = z.infer<typeof OpenInvite>;
export const Invite = OpenInvite.extend({ link: z.string() });
export type Invite = z.infer<typeof Invite>;

export const Person = z.object({
  id: z.uuid(),
  displayName: z.string(),
  role: PersonRole,
  passkeys: z.number().int(),
  isMe: z.boolean(),
});
export type Person = z.infer<typeof Person>;

export const ChangeRoleRequest = z.object({ role: InvitableRole });

/** Every error body: a code for the app, and a sentence for the person. */
export const ApiError = z.object({ error: z.string(), detail: z.string().optional() });
export type ApiError = z.infer<typeof ApiError>;
