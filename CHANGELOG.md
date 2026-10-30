# Changelog

Release notes the app shows on its System page (from Phase 8). One plain line per change, newest first.

## 0.4.0 (Phase 3, parent app control)

- Control shows what is on for each child and why, the day as a timetable with a Now marker, and one plain sentence about now.
- Allow, Block and Pause everything each take a couple of taps, with real end times to choose from. Pause everything asks first.
- Allow, Block and Normal can be undone for 10 seconds.
- Each app says "Starting" until AdGuard confirms the change, then "Working".
- Control updates by itself when something changes, without a refresh.
- Today lists what happened, and after a block or extra time you can tap how it went: calm, grumble or meltdown.
- Every feature has a (?) that explains what it does and, where there is research, why it helps and how strong the evidence is.
- Alerts on your phone when a change can't be confirmed or a device goes quiet. Turn them on in Settings, from the app on your Home Screen.

## 0.3.0 (Phase 2, control engine and AdGuard)

- Family time works out what each child can use right now, why, and until when, from the schedule, the family's rules and any parent's Allow, Block or Pause.
- An Allow stops at bedtime unless you choose Through bedtime.
- Changes reach the child's devices through AdGuard within a minute, and the app only says it is working once AdGuard has confirmed it.
- If a device stops using home DNS for 30 minutes outside bedtime, it is marked quiet.
- About how many minutes each app was used today, from the home DNS log. Only per-minute counts are kept.

## 0.2.0 (Phase 1, accounts)

- Sign in with a passkey: one tap, then Face ID. No passwords.
- The owner invites people by link, as a parent, carer or another owner, and can remove them.
- There is always at least one owner; the database refuses to remove the last one.
- Every privileged action is recorded in an audit log that cannot be changed.
- If the owner loses their phone, a recovery link from the server lets them add a new passkey.

## 0.1.0 (Phase 0, foundations)

- The server runs the api, worker and database, each with health checks.
- Deploys test themselves first and put the previous version back if the new one is unhealthy.
- A database dump is taken before every update.
