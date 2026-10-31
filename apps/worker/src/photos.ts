// Photos from "I did it" are kept only until 30 days after a parent decided on the job (the help
// text promises this). Run with each economy tick; a cheap query that is usually empty.
import { completionPhotos, completions, type Db } from '@family-time/db';
import { and, inArray, isNotNull, lt } from 'drizzle-orm';

export const PHOTO_DAYS = 30;

export async function prunePhotos(db: Db, now: Date): Promise<number> {
  const before = new Date(now.getTime() - PHOTO_DAYS * 86_400_000);
  const old = await db
    .select({ id: completions.id })
    .from(completions)
    .where(and(isNotNull(completions.decidedAt), lt(completions.decidedAt, before)));
  if (!old.length) return 0;
  const gone = await db
    .delete(completionPhotos)
    .where(inArray(completionPhotos.completionId, old.map((o) => o.id)))
    .returning({ id: completionPhotos.completionId });
  return gone.length;
}
