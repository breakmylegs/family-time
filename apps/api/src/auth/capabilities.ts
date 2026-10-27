import type { Role } from '@family-time/db';

/**
 * Everything a signed-in person can be allowed to do. A closed list: a new capability must be
 * placed in the role table below on purpose, or nobody but the owner has it.
 */
export const CAPABILITIES = [
  'status.view', // see what is allowed and blocked now, and the week
  'control.pause', // Pause everything
  'control.change', // Allow, Block and Normal
  'approvals.decide', // approve completions and requests within the plan
  'rules.edit', // tasks, schedules, policies, allowance and taper
  'people.view',
  'people.manage', // invite, remove and change roles
  'system.manage', // devices, AdGuard, AI keys, MCP clients, backups, ledger screen
] as const;
export type Capability = (typeof CAPABILITIES)[number];

const ROLE_CAPABILITIES: Record<Exclude<Role, 'child'>, readonly Capability[]> = {
  owner: CAPABILITIES,
  parent: ['status.view', 'control.pause', 'control.change', 'approvals.decide', 'rules.edit', 'people.view'],
  // Grandparents: see, pause and approve within the plan. No rule changes.
  carer: ['status.view', 'control.pause', 'approvals.decide'],
};

/** Children never sign in, so they have no capabilities. */
export function can(role: Role, capability: Capability): boolean {
  if (role === 'child') return false;
  return ROLE_CAPABILITIES[role].includes(capability);
}

export function capabilitiesOf(role: Role): Capability[] {
  return role === 'child' ? [] : [...ROLE_CAPABILITIES[role]];
}

/** Roles a person can be invited as. Children are profiles, never accounts. */
export const INVITABLE_ROLES = ['owner', 'parent', 'carer'] as const;
export type InvitableRole = (typeof INVITABLE_ROLES)[number];
