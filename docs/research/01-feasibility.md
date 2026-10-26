# Family Screen Time and Rewards Platform: Feasibility Assessment

## Status of this document

This was the first report. Several of its recommendations were later replaced. Where this document conflicts with `docs/brief/build-prompt.md`, `02-v1-research.md` or `03-motivation.md`, those win. See `00-read-me-first.md` for the full list.

Replaced decisions.

- **The custom iPad app ("Time Bank") is out of scope.** There is no paid Apple Developer account, so FamilyControls, ManagedSettings and DeviceActivity cannot be used. Enforcement moved to AdGuard Home DNS blocking.
- **Blockchain is back in scope** as a local private Besu chain for learning, behind a ledger interface with a Postgres ledger as the default.
- **The kiosk is an old Amazon Fire tablet**, not an iPad.
- **The core economics changed.** Screen time is now an agreed weekly allowance, not mainly an earned prize. See `03-motivation.md`.

Still valid and useful: everything about Apple's Screen Time constraints, why "Ask For More" cannot be automated, the parent PWA and web push findings, kiosk mode options, UK money and crypto considerations, and the existing-products survey.

---

You can build most of this platform with Claude Code, but not the version that reads and auto-approves Apple's native Screen Time limits, because Apple provides no API for either. The workable design is a self-hosted points ledger with a kiosk and a parent PWA, plus a small custom iPad app that enforces its own limits through Apple's FamilyControls framework and unlocks apps against the earned balance.

## TL;DR

- Requirements 2, 3, 4, 5 and 6 are fully achievable on your existing self-hosted stack. Requirement 1 is achievable only for limits your own iPad app enforces, not for native Screen Time limits. Requirement 7 is not possible against native "Ask For More" requests, but you can get the same result by replacing native app limits with your own FamilyControls shields that unlock against the balance.
- The critical path is a native Swift app on your son's iPad. It needs a paid Apple Developer Program membership and a Mac with Xcode, and it depends on FamilyControls and DeviceActivity. In Apple Developer Forums thread 811305 (Feedback FB21450954) a developer reports that on iOS 26.2 `eventDidReachThreshold` "fires intermittently... even when iOS Screen Time shows 0 minutes", and an Apple DTS engineer has called this "a known issue that is currently being investigated." Run a two-week spike on that app before you commit to the full build.
- Do not use a blockchain. A hash-chained, append-only ledger in PostgreSQL gives you tamper evidence with no fees, no privacy exposure and no regulatory questions. UK crypto exchanges such as Coinbase and Kraken require users to be 18 or over. Pay out money manually at first, then automate with the Starling personal access token API or Monzo pots if you want to.

## Key Findings

### Apple constraints in summary

| Capability | Possible? | Notes |
|---|---|---|
| Read native Screen Time per-app usage or remaining time | No | Usage data is sandboxed in the DeviceActivityReport extension and cannot leave it |
| Send Screen Time usage data to a server or a second device | No (direct) / Partial (inferred) | You can infer usage from DeviceActivityMonitor threshold events, at the granularity you choose |
| Programmatically approve "Ask For More" | No | There is no public API. Approval needs a parent device, Messages, a notification or the Screen Time passcode |
| Enforce your own limits with FamilyControls and ManagedSettings | Yes | Needs a paid developer account and the Family Controls entitlement |
| Auto-unlock apps against a server-backed balance | Yes, with workarounds | Only through your own shields, not native App Limits or Time Allowances |
| MDM control of Screen Time time limits | No | MDM can disable Screen Time or block apps, but has no time-limit payloads |
| Shortcuts control of Screen Time limits | No | Shortcuts has no actions that change Screen Time limits |

### Feasibility rating per requirement

| # | Requirement | Rating | Reason |
|---|---|---|---|
| 1 | Show remaining allocated time per app | Possible with workarounds | Native Screen Time data cannot leave the device. Your iPad app can track usage against its own allowances with threshold events and sync the totals, grouped by labels you define rather than real app names |
| 2 | Off-tablet tasks that parents mark complete, adding time | Fully possible | This is pure server-side ledger logic |
| 3 | Build a balance and trade it for tablet time or money | Fully possible (ledger) / Possible with workarounds (money automation) | The ledger is simple. Payouts can be manual or semi-automated through bank APIs. Blockchain is possible but not recommended |
| 4 | Kiosk on a spare tablet for spending choices | Fully possible | Guided Access or Single App Mode on iPad, or Fully Kiosk Browser on Android |
| 5 | Tasks restricted to money-only, time-only or both | Fully possible | Use tagged point buckets in the ledger |
| 6 | Parent admin from iPhone Safari | Fully possible | A Home Screen PWA with web push, supported from iOS 16.4 |
| 7 | Auto-approve screen time requests up to the balance | Not possible (native Ask For More) / Possible with workarounds (custom shields) | Apple exposes no API for native requests. A custom FamilyControls app can lift its own shields when the balance allows |

## Details

### A. Apple Screen Time technical constraints

#### What the Screen Time APIs allow

Apple's Screen Time API has three frameworks. FamilyControls handles authorisation and the app picker, ManagedSettings applies shields and restrictions, and DeviceActivity schedules monitoring windows and usage thresholds. At WWDC21 Apple stated that "your customers' usage data will be invisible outside of their device". It also said that once a guardian approves an app under child authorisation, "it cannot be removed from the device without guardian approval".

The app picker returns only opaque tokens for apps, categories and web domains. Your app can count them but cannot turn them back into "YouTube" or "Minecraft". The only exception is the shield extension, which receives the app's display name so it can draw the block screen.

#### DeviceActivityReport sandboxing

The DeviceActivityReport extension is the only component that sees real per-app usage. It runs in a sandbox that blocks network requests and prevents data from leaving the extension. In the Apple Developer Forums an Apple engineer answered the question directly with "No, moving Device Activity data outside of your extension's sandbox is not possible in order to preserve the user's privacy." Developers also report that App Group writes from the report extension silently fail. The report can draw a chart on the child's iPad, but your app cannot read the figures, so it cannot send them to a server or show them on a kiosk.

Developers also report that a DeviceActivityReport embedded on a parent's device with `users: .children` shows the parent's own data rather than the child's. You should not plan on rendering the child's report on another device.

#### The threshold-event workaround

The recognised workaround is to register many DeviceActivityMonitor threshold events (for example one every 1 to 5 minutes of use of a selection) and record each one as it fires. The monitor extension can write to the shared App Group, and the main app syncs those counters to your server. This gives usage of selections your app is monitoring, at the resolution you choose. It does not give native Screen Time totals.

#### iOS 26.4 usage data access does not help in the UK

iOS 26.4 added a new entitlement, `com.apple.developer.family-controls.app-and-website-usage`, together with an `approvedWithDataAccess` authorisation status and host-app usage reads. Developers report three limits, from forum and GitHub descriptions rather than Apple's own text.

- Customer installs reportedly get data access only on devices located in the EU with an Apple Account configured to an EU country or region. The UK is outside the EU.
- The consent sheet reportedly warns that Screen Time will lose access to this data, because only one app or service can access it at a time.
- All reported successes use individual authorisation, not child authorisation through Family Sharing.

#### "Ask For More" cannot be automated

There is no public API that reads, intercepts or answers native Screen Time "Ask For More" requests. Apple's documented routes all need a human parent. The parent can enter the Screen Time passcode on the child's device, respond from System Settings on a Mac or the Screen Time settings on an iPhone, or tap Approve in a notification or in Messages. Approval options are 15 minutes, 1 hour, or all day. iOS 27 added PermissionKit, but it powers Ask to Browse and parent approval for third-party app communication. It does not expose Screen Time time requests.

#### The alternative pattern (custom enforcement app)

Superseded, because it needs a paid Apple Developer account. Kept for reference. A custom iPad app using FamilyControls with child authorisation could become the sole enforcer of time on chosen apps, lifting ManagedSettings shields when the child spends points and re-applying them when a DeviceActivity threshold fires.

Constraints recorded at the time.

- The Family Controls capability is not available to a free Personal Team. Apple's DTS confirms free provisioning cannot use it. The Apple Developer Program costs US$99 a year.
- TestFlight and the App Store need the Family Controls (Distribution) entitlement, requested separately for the app and every extension. Developers report waits of up to 31 to 33 days.
- Only the extensions run reliably at enforcement time. Silent push is not delivered to force-quit apps.
- Developers report `eventDidReachThreshold` firing intermittently on iOS 26.2, an issue an Apple DTS engineer called known and under investigation. A third-party SDK check reports no Screen Time API changes in the iOS 27.0 SDK.
- If a native App Limit or Time Allowance is exhausted, iOS blocks the app regardless.

#### Shortcuts, Communication Limits and MDM

- **Shortcuts** has no actions to create, change or extend Screen Time limits.
- **Communication Limits** governs who the child can contact. It has no bearing on time balances.
- **MDM** can disable Screen Time settings on supervised devices and enforce restrictions, but has no payload for per-app time limits. Supervision via Apple Configurator wipes the device. Not recommended for a family iPad.

#### iOS 18, 26 and 27 changes that matter

- **iOS 18** added app locking and hiding.
- **iOS 26.2** added the Declared Age Range API and introduced the threshold regressions described above.
- **iOS 26.4** added `approvedWithDataAccess`, reportedly restricted to EU customers.
- **iOS 27** (released 14 September 2026) overhauled parental controls. App Limits became Time Allowances, set per category with an overall total. Downtime is now part of a daily Schedule. The parent dashboard can pause access or extend it for a set period. The new experience requires every device in the Family Sharing group to run version 27 software. None of this adds third-party write access to Time Allowances or approvals.

### B. Existing products (build vs buy)

#### Earn-screen-time apps on iOS

All of these sit on the same FamilyControls APIs and inherit the same reliability limits.

| Product | Model | Relevance |
|---|---|---|
| ChoreTime | Chore points buy usage-based time that pauses, resumes and re-shields | Closest to requirement 7 |
| Earn Screen Time: Kids Chores | Tasks with minute rewards and parent approval, iCloud sync | Early reviews report a child's phone locked by a bug |
| ScreenEarn | Chores of 15 minutes or more, parent approval, apps unlock automatically | Similar pattern |
| ScreenTreat | Blocks the device until must-do chores are done | Good fit for "tasks first" |
| Habyts | Tasks earn points redeemable for screen time or non-screen rewards | Closest to "time or other rewards" |
| Screen Time (Screen Time Labs) | Per-app limits plus tasks and rewards | Weaker controls on iOS |
| OurPact | Blocking and scheduling with earn features | Traditional control |

None of these combine time, real money and a self-hosted kiosk.

#### UK pocket money apps

- **GoHenry** has task and chore payments and savings goals. Barclays has agreed to acquire GoHenry's UK business.
- **NatWest Rooster Money** has chores, a star chart and a prepaid card. NatWest's June 2026 Pocket Money Index reports children aged 6 to 17 averaging £9.74 a week.
- **Starling Kite** is a spending space on the parent's Starling account.
- None combine chores, pocket money and screen time, and none expose a public API for third parties. Treat them as payout destinations, not the system of record.

#### Self-hostable starting points

- **KidsChores (Home Assistant)** has chores, points, rewards and approvals, but one point currency.
- **Donetick** has a points system and webhooks but no reward economy.
- **Grocy chores** has no rewards.
- Recommendation was to build our own ledger and reuse ideas, not code.

### C. Architecture notes still relevant

- Parent PWA. Web push works on iPhone from iOS 16.4, but only for a web app added to the Home Screen and opened from its icon, and permission must be requested in response to a user action. Declarative Web Push arrived in iOS 18.4.
- Kiosk on Android. Screen pinning is easy to escape. Fully Kiosk Browser PLUS costs a one-time €8.90 per device, gives true lockdown, motion wake, screen scheduling and a JavaScript and REST API.
- Kiosk shows balances, today's tasks, remaining time and spend options. Money conversions above a threshold need a parent approval.

### D. Money and blockchain

#### UK legal and regulatory points

- Major UK exchanges require users to be adults. Any crypto held for a child would be held in a parent's name.
- Cryptoasset promotions have been inside the FCA financial promotions regime since 8 October 2023. The FCA's new cryptoasset regime is expected to come into force on 25 October 2027.
- A private points ledger redeemable only within the family is household bookkeeping, not a cryptoasset or e-money product. Keep it that way by never letting points be transferred to or redeemed by anyone outside the family.

#### Converting points to real money

| Option | How | Fit |
|---|---|---|
| Manual transfer | Parent pays the owed balance weekly and records it | Best starting point |
| Starling personal access token | Can initiate payments to existing payees only. Production access limited to your own account | Automate later, with caps and approval |
| Monzo Developer API | Personal-use API with pots and webhooks, not for public apps. No outbound payment endpoint listed | Ring-fence owed money in a pot |
| Rooster Money or GoHenry | No public API | Destination for funds only |

## Risks recorded at the time

- Abrupt endings and displacement to unmanaged screens.
- Children gaming the system (fake task claims, kiosk escape). Mitigate with parent-only approval, kiosk passcode, audit trail and daily caps.
- Single point of failure in the home lab. Mitigate with offsite backups and alerting.
- Behavioural design risk of turning all activity into transactions. Keep some screen-free play unrewarded and review the rules with the child monthly.
