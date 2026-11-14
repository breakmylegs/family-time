# The export file

Settings, System, Export (owner only) downloads everything Family time holds about the household as one JSON file, `family-time-export-YYYY-MM-DD.json`. ADR 0017.

## Shape

```json
{
  "format": "family-time-export",
  "version": 1,
  "exportedAt": "2026-11-04T09:00:00.000Z",
  "household": { "id": "…", "name": "…", "timezone": "Europe/London", "…": "…" },
  "tables": { "people": [ … ], "tasks": [ … ], "…": [ … ] },
  "leftOut": [ { "what": "…", "why": "…" } ]
}
```

Times are ISO 8601 in UTC. Ids are UUIDs, except audit events, which are numbered. Each row has the table's columns, named as in `packages/db/src/schema.ts`.

## Tables

| Key | What it holds |
|---|---|
| `people` | Everyone in the family, children included, with their role. Not their passkeys |
| `settings` | The household's settings: the public address, the pilot's rates, the last backup, maintenance |
| `devices`, `services`, `serviceGroups`, `serviceGroupMembers`, `policies`, `schedules` | The rules: what each child's devices are, which apps, the groups, and the timetable |
| `overrides`, `grants` | Every Allow, Block and Pause, and every planned or approved session |
| `usageMinutes`, `sessionEndings` | Minutes of use per app (counts only), and how sessions ended |
| `allowances`, `reductionPlans`, `tasks`, `completions`, `requests`, `goals`, `ideas`, `reflections` | The weekly allowance and its plan, jobs and what was done, requests for time, savings goals, ideas, and the Sunday answers |
| `parentScreenTime`, `familyChallenges`, `challengeTicks` | The parents' own weekly screen time, as they gave it, and the family challenges with who ticked them |
| `journal`, `skills`, `ruleAsks` | What each child said they did away from screens and the praise sent back, the things they are learning or can do, and the rules they asked about with the answers |
| `unmanagedTime`, `moodChecks` | The parents' weekly estimate of screen time away from managed devices, and their monthly mood check for each child |
| `ledgerEntries` | The whole points and money history, each entry with its hash |
| `kioskDevices` | The kiosk tablets, without their tokens |
| `helpFeedback` | Answers to "Was this helpful?" |
| `aiSettings`, `aiCalls`, `proposals`, `oauthClients`, `mcpServers` | AI switches, calls and their cost, suggestions, connected apps and services. Not the keys |
| `auditEvents` | The audit log |

## Left out, and why

The file lists these itself, under `leftOut`:

- Passkeys, sign-ins, invite links and connected-app tokens: they let someone sign in.
- AI keys: they are sealed with this server's master key and are no use anywhere else.
- Photos from the kiosk: they are deleted 30 days after a job is answered, and are kept out of a file that may be shared.
- The blockchain copy of the ledger: the ledger entries are all here.
- AdGuard's own settings and query log: AdGuard holds them; the nightly backup copies its settings.

The export is for keeping or reading, not for restoring: restore from a backup (`docs/setup/backup.md`).
