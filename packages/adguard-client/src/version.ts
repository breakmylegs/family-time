// Which AdGuard Home versions Family time works with (ADR 0022). The client is contract-tested
// against TESTED_VERSION in the deploy's test project. AdGuard has kept its 0.107 control API stable
// across patch releases, so a later 0.107 patch is accepted with a note; anything older, or a new
// series (0.108, 1.x), where a breaking change would land, is refused unless the owner opts in.
// Whatever the version, the reconciler reads back every write, so a change in how AdGuard stores
// what Family time writes shows as "Not confirmed" on Control.

export const TESTED_VERSION = '0.107.79';

export type VersionLevel = 'tested' | 'newer-patch' | 'too-old' | 'untested-series' | 'unknown';

export interface VersionCheck {
  /** Whether Family time should go ahead with this AdGuard. */
  ok: boolean;
  level: VersionLevel;
  /** For the owner, in plain words. Empty for the tested version. */
  message: string;
}

function parse(v: string): [number, number, number] | undefined {
  const m = /^v?(\d+)\.(\d+)\.(\d+)/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : undefined;
}

/** `allowUntested`: ADGUARD_ALLOW_UNTESTED=1 in deploy/.state/adguard.env, for a newer series. */
export function checkVersion(version: string, allowUntested = false): VersionCheck {
  const [tMajor, tMinor, tPatch] = parse(TESTED_VERSION)!;
  const v = parse(version);
  if (!v) {
    // Only the characters a version has: this text came over the network and goes to a terminal.
    const shown = version.replace(/[^0-9A-Za-z.+-]/g, '').slice(0, 40);
    return allowUntested
      ? { ok: true, level: 'unknown', message: `AdGuard reported its version as "${shown}", which Family time cannot read. Going ahead because ADGUARD_ALLOW_UNTESTED=1.` }
      : { ok: false, level: 'unknown', message: `AdGuard reported its version as "${shown}", which Family time cannot read. It is tested with v${TESTED_VERSION}.` };
  }
  const [major, minor, patch] = v;
  const shown = `v${major}.${minor}.${patch}`;
  if (major === tMajor && minor === tMinor) {
    if (patch === tPatch) return { ok: true, level: 'tested', message: '' };
    if (patch > tPatch) return { ok: true, level: 'newer-patch', message: `AdGuard is ${shown}, newer than the tested v${TESTED_VERSION} in the same series. That is supported; every change is read back to check it held.` };
  }
  if (major < tMajor || (major === tMajor && minor < tMinor) || (major === tMajor && minor === tMinor && patch < tPatch)) {
    return { ok: false, level: 'too-old', message: `AdGuard is ${shown}, older than v${TESTED_VERSION}, the version Family time is tested with. Update AdGuard Home, then try again.` };
  }
  return allowUntested
    ? { ok: true, level: 'untested-series', message: `AdGuard is ${shown}, a newer series than the tested v${TESTED_VERSION}. Going ahead because ADGUARD_ALLOW_UNTESTED=1: watch Control for devices that show Not confirmed.` }
    : {
        ok: false,
        level: 'untested-series',
        message: `AdGuard is ${shown}, a newer series than the tested v${TESTED_VERSION}, and its API may have changed. Wait for a Family time update, or accept the risk by adding ADGUARD_ALLOW_UNTESTED=1 to deploy/.state/adguard.env.`,
      };
}
