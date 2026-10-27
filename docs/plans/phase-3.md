# Phase 3 plan: parent app control, help panels, Web Push

Branch `phase-3`. Approved to start on 27 October 2026. Nothing here touches your network.

## Goal

The Control screen from the mock, working: Mum sees what is on and why, allows, blocks and pauses in a couple of taps, and every feature explains itself through a (?) panel.

## Exit criteria

1. Here: Playwright drives the Control screen end to end (Allow with the sheet, Undo, Block, Pause everything with its confirmation, Resume, Normal) and the help panel (open, related, back, close by button, Escape and tapping outside, deep link). WebKit screenshots of every new screen at 390 by 844, light and dark. Impeccable's critique, audit and polish and Emil's review-animations run, and their findings are fixed.
2. On your phones, later: Mum allows, blocks and pauses unaided, and opens and understands three help topics. Alerts arrive on the installed app.

## Decisions

| # | Decision | Why |
|---|---|---|
| 1 | Bottom tab bar with Control and Settings only. Approvals, Tasks and Family appear in Phase 4, when they do something | No empty screens |
| 2 | The server sends the day's blocks, the headline ("Free time now. Wind-down starts at 19:30.") and each duration's end time. The app never works out times itself | One clock, one time zone, one set of rules |
| 3 | Optimistic UI with a 10-second Undo toast for Allow, Block and Normal. Undo ends the override just made. Confirmation sheets only for Pause everything (and refunds, Phase 4) | Brief Part 9 |
| 4 | Live updates by Server-Sent Events at `/api/events`, with 30-second polling as the fallback. The worker tells the api about confirmations through Postgres `NOTIFY`, so "Working on his iPad now" appears without a refresh | The worker and api are separate processes |
| 5 | Help content in `packages/help-content`: one Markdown file per topic, frontmatter, `sources.yaml`, bundled at build. A small parser of our own for the frontmatter and the sources file. The build fails on a (?) pointing at a missing topic, an evidence badge with no source, a dash, or the child's name written in (it must be `{child}`). Topics beyond Appendix A are marked needs review | Brief Part 10 |
| 6 | The help panel and the sheets use Radix Dialog for focus trapping, Escape and focus return, styled to the mock. That is the primitive shadcn/ui builds on; I add the shadcn pieces themselves as they are needed | Accessibility done once, properly |
| 7 | Web Push: VAPID keys are made by `init.sh` (openssl, P-256) as a secret. A small hand-written service worker handles push and opens the deep link. Payloads use the Declarative Web Push shape, which the worker's own handler also reads | Brief Part 12. A hand-written worker is a few dozen lines; vite-plugin-pwa would add Workbox |
| 8 | Alerts in this phase: a device "Not confirmed" and a device gone quiet. Approvals, the weekly review and backups add theirs in their phases | They are the only events that exist yet |
| 9 | Permission is asked only after a tap on "Turn on alerts" in Settings, and only in the installed app; in Safari the button explains how to add it to the Home Screen first | iOS allows push only for installed web apps |
| 10 | The conflict tap: after something ends (an Allow, a planned session, or a Block starting), Today history shows calm, grumble or meltdown as one optional tap | Brief Part 9, for the pilot metrics |
| 11 | Fonts self-hosted from `@fontsource/lora` and `@fontsource/poppins`, as the design README suggests. The parent app uses the iPhone font; Lora only in the help panel | Brief Part 18 |
| 12 | Dev and e2e server: the real api on PGlite with a fake AdGuard and the reconciler running in-process, and a frozen clock (Monday 26 October 2026, 18:32), so screenshots match the mock and are repeatable | |

## Dependencies

In Part 17: `web-push` 3.6.7. New, asking now: `@radix-ui/react-dialog` 1.3.1 (shadcn/ui's dialog primitive), `@fontsource/lora` and `@fontsource/poppins` 5.3.0 (the design README's own suggestion), `@types/web-push` (types only).

## Files

- `packages/db`: migration `0004`: push subscriptions, help feedback, session endings.
- `packages/help-content`: topics, `sources.yaml`, build and checks.
- `apps/api`: day and durations in the status, end an override by id, today's history, conflict tap, `/api/events`, push key and subscribe, help feedback.
- `apps/worker`: `NOTIFY` after each reconcile and usage run; alerts on Not confirmed and quiet.
- `apps/parent`: tab bar, Control, sheets, toast, help panel, Settings (People, Devices, Alerts, Help icons), service worker, manifest, icons.
- `e2e/`: control and help specs.
