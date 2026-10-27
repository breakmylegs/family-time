import { afterEach, describe, expect, it } from 'vitest';
import { testDb, type TestDb } from '../src/testing.js';

let handle: TestDb | undefined;
afterEach(async () => {
  await handle?.close();
  handle = undefined;
});

async function household(h: TestDb) {
  const { rows } = await h.client.query<{ id: string }>(`insert into households (name) values ('Test') returning id`);
  return rows[0]!.id;
}

async function person(h: TestDb, hh: string, role: string, active = true) {
  const { rows } = await h.client.query<{ id: string }>(
    `insert into people (household_id, display_name, role, active) values ($1, $2, $3, $4) returning id`,
    [hh, `${role} person`, role, active],
  );
  return rows[0]!.id;
}

describe('last owner', () => {
  it('cannot be deleted, demoted or deactivated by raw SQL', async () => {
    handle = await testDb();
    const hh = await household(handle);
    const owner = await person(handle, hh, 'owner');
    await expect(handle.client.query(`delete from people where id = $1`, [owner])).rejects.toThrow(/last owner/);
    await expect(handle.client.query(`update people set role = 'parent' where id = $1`, [owner])).rejects.toThrow(/last owner/);
    await expect(handle.client.query(`update people set active = false where id = $1`, [owner])).rejects.toThrow(/last owner/);
  });

  it('can be demoted once another active owner exists', async () => {
    handle = await testDb();
    const hh = await household(handle);
    const first = await person(handle, hh, 'owner');
    await person(handle, hh, 'owner');
    await handle.client.query(`update people set role = 'parent' where id = $1`, [first]);
    const { rows } = await handle.client.query<{ role: string }>(`select role from people where id = $1`, [first]);
    expect(rows[0]?.role).toBe('parent');
  });

  it('does not count an inactive owner as cover', async () => {
    handle = await testDb();
    const hh = await household(handle);
    const owner = await person(handle, hh, 'owner');
    await person(handle, hh, 'owner', false);
    await expect(handle.client.query(`update people set role = 'carer' where id = $1`, [owner])).rejects.toThrow(/last owner/);
  });

  it('does not count an owner in another household', async () => {
    handle = await testDb();
    const mine = await household(handle);
    const theirs = await household(handle);
    const owner = await person(handle, mine, 'owner');
    await person(handle, theirs, 'owner');
    await expect(handle.client.query(`delete from people where id = $1`, [owner])).rejects.toThrow(/last owner/);
  });

  it('leaves other people alone', async () => {
    handle = await testDb();
    const hh = await household(handle);
    await person(handle, hh, 'owner');
    const parent = await person(handle, hh, 'parent');
    await handle.client.query(`update people set active = false where id = $1`, [parent]);
    await handle.client.query(`delete from people where id = $1`, [parent]);
  });
});

describe('audit events', () => {
  it('can be added but never changed, deleted or truncated', async () => {
    handle = await testDb();
    await handle.client.query(`insert into audit_events (actor_label, action) values ('cli', 'test.event')`);
    await expect(handle.client.query(`update audit_events set action = 'changed'`)).rejects.toThrow(/append-only/);
    await expect(handle.client.query(`delete from audit_events`)).rejects.toThrow(/append-only/);
    await expect(handle.client.query(`truncate audit_events`)).rejects.toThrow(/append-only/);
    const { rows } = await handle.client.query<{ n: number }>(`select count(*)::int as n from audit_events`);
    expect(rows[0]?.n).toBe(1);
  });

  it('needs exactly one actor', async () => {
    handle = await testDb();
    await expect(handle.client.query(`insert into audit_events (action) values ('x')`)).rejects.toThrow(/one_actor/);
    const hh = await household(handle);
    const owner = await person(handle, hh, 'owner');
    await expect(
      handle.client.query(`insert into audit_events (actor_person_id, actor_label, action) values ($1, 'cli', 'x')`, [owner]),
    ).rejects.toThrow(/one_actor/);
  });
});

describe('invites', () => {
  it('refuse a join invite with no role, and a recovery invite with no person', async () => {
    handle = await testDb();
    const hh = await household(handle);
    await expect(
      handle.client.query(
        `insert into invites (household_id, kind, token_hash, display_name, expires_at) values ($1, 'join', 'h1', 'Mum', now())`,
        [hh],
      ),
    ).rejects.toThrow(/invites_shape/);
    await expect(
      handle.client.query(`insert into invites (household_id, kind, token_hash, expires_at) values ($1, 'recovery', 'h2', now())`, [hh]),
    ).rejects.toThrow(/invites_shape/);
  });
});
