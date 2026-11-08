# Changelog

Release notes the app shows on its System page (from Phase 8). One plain line per change, newest first.

## 0.10.0 (Phase 9, the whole brief)

- Time to find a stopping point: from the pilot's transitions phase, when a planned session or an Allow ends on its own, the app stays allowed for a few more minutes (5 unless you change it) so your child can finish a level or a video. Never into wind-down or bedtime, and Pause and Block still start within a minute.
- The whole family on the Family screen: each parent's own screen time this week, beside your child's, and one family challenge at a time, such as screen-free tea, that anyone can tick, on the phone or the kiosk.
- Set-up in Settings for the owner: add, change and remove devices, set each child's rule for each group of apps, move apps between groups, and change the family's schedules. Most changes no longer need the command line.
- Alerts when blocking stops because AdGuard isn't answering or its protection is off, and when it's working again, plus a reminder an hour before the week resets that the family review is ready.
- Optional matching on a savings goal: you add a share of the pocket money your child earns each week, shown as Matched by Mum and Dad.
- Optional local AI in the stack, with no data leaving the house (the ai-local profile).
- The server's health check now covers AdGuard and, when it is on, the Besu ledger. Only the ledger's own account can write to the chain, and the admin key isn't made again once it has been used.

## 0.9.0 (Phase 8, ready for the pilot)

- Nightly backups, encrypted, with the family's data, settings and keys kept apart. Each one can be restored into a scratch copy to prove it works.
- A System page for the owner: version, health, the last backup, what the pilot phase has switched on, how long data is kept, the audit log and these notes.
- Export the family's data as one file.
- Old data is cleared on schedule: sign-ins after 30 days, measures after 13 months, the audit log after two years. The points history is kept.
- Pilot measures on Family, week by week, with a spreadsheet download.
- Maintenance mode, so the app can say "back soon" while the server is worked on. Allow, Block and Pause still work; what is already set keeps working.
- An alert to owners when a backup fails or none has run for a day and a half.
- Brothers and sisters sharing the kiosk can each have a four-number PIN, set by the owner in Settings, Kiosk.
- Easier to use with a screen reader, with larger text, and in dark mode on the kiosk: clearer reward tags, text boxes with visible edges, and a clear message when a time won't fit.

## 0.8.0 (Phase 7, AI and connected apps)

- Optional AI, off until the owner switches it on: type what you want on Control, get job ideas, or a short note on the week. Every suggestion is a card a parent approves.
- An assistant such as Claude can connect with a parent's say-so, see what each child can use now, and suggest changes as cards on Approvals.
- AI keys are locked away on the server, each feature has a monthly spending limit, and children's names are replaced before anything is sent to the AI provider.

## 0.7.0 (Phase 6, the kiosk)

- Your child's own screen on a tablet at home: what's on now, the week, planning time, jobs with an "I did it" button, asking a grown-up, a savings goal and ideas for things to do.
- A photo can go with a job, and is deleted 30 days after you answer.
- Sunday questions for the family review, seen only by parents.

## 0.6.0 (Phase 5, the Besu ledger)

- The points history can also be written to a small private blockchain on your server, and checked against it every night.
- The owner's Ledger screen shows every entry and where it is on the chain.

## 0.5.0 (Phase 4, the weekly allowance and jobs)

- A weekly screen time allowance, agreed with your child, given at the start of each week.
- Jobs that earn pocket money or flex points, and things done for love that get praise only. Screen time from jobs is capped at 15% of the allowance.
- Approvals: approve a job with a short note, say not yet, or send praise. Answer requests for time. Each can be undone for 10 seconds.
- Screen time left at the end of the week turns into pocket money, up to a weekly cap.
- A reduction plan that lowers the allowance a step at a time, only after you tick it agreed at the family review.
- Family: what each child has, pocket money to mark as paid, flex points to convert, a savings goal, and an agenda for the weekly review.
- A session you block part way through gives the lost minutes back.
- The points history is kept as a chain that can be checked, and nobody can take points away as a punishment.

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
