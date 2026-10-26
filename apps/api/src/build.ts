import { latestMigrationTag } from '@family-time/db';
import type { Version } from '@family-time/schemas';

export const APP_NAME = 'family-time';

export interface BuildInfo extends Version {
  /** Set only in images built by scripts/drill-rollback.sh. Readiness then always fails. */
  drillUnready: boolean;
}

/** The build stamp is baked into the image as environment variables and read once at boot. */
export function readBuildInfo(env: NodeJS.ProcessEnv = process.env): BuildInfo {
  return {
    app: APP_NAME,
    commit: env.GIT_COMMIT || 'dev',
    builtAt: env.BUILD_TIME || 'dev',
    schema: latestMigrationTag(),
    drillUnready: env.FT_DRILL_UNREADY === '1',
  };
}
