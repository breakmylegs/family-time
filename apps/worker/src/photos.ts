// Photos from "I did it" are kept only until 30 days after a parent decided on the job (the help
// text promises this), or 30 days after it was logged if nobody ever did. Run with each economy
// tick; one statement, usually deleting nothing.
import type { Db } from '@family-time/db';
import { sql } from 'drizzle-orm';

export const PHOTO_DAYS = 30;

export async function prunePhotos(db: Db, now: Date): Promise<number> {
  const before = new Date(now.getTime() - PHOTO_DAYS * 86_400_000).toISOString();
  const gone = await db.execute(sql`
    delete from completion_photos p using completions c
    where c.id = p.completion_id and coalesce(c.decided_at, c.logged_at) < ${before}
    returning p.completion_id`);
  return (gone as unknown as { rows?: unknown[] }).rows?.length ?? (Array.isArray(gone) ? gone.length : 0);
}
