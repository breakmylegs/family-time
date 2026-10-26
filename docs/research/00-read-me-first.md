# Read me first

These documents were written in sequence while the design evolved. Later decisions replaced some earlier recommendations. Use this order of authority when they disagree.

1. `docs/brief/build-prompt.md` (the build prompt). Wins on behaviour, scope and rules.
2. `docs/research/03-motivation.md`. Wins on the points economy and motivation features.
3. `docs/research/02-v1-research.md`. Wins on stack, AdGuard, ledger, UX, AI and MCP detail.
4. `docs/research/01-feasibility.md`. Background on Apple's limits and the first architecture.
5. `docs/design/mock-screens.html`. Wins on visual design. Where it disagrees with the build prompt on behaviour or copy, the build prompt wins.

## Decision log

Listed in the order they were made.

| # | Decision | Replaces |
|---|---|---|
| 1 | No paid Apple Developer account, so no native iOS app. Enforcement is AdGuard Home DNS blocking on home Wi-Fi. Apple Screen Time stays on the iPad as the backstop | The custom "Time Bank" iPad app in 01 |
| 2 | Native "Ask For More" approvals cannot be automated. They stay manual for apps the platform does not manage, using Apple's 15 minute, 1 hour or all day options | Nothing, confirmed constraint |
| 3 | Local private blockchain (Besu) is in scope for learning, behind a ledger interface. A Postgres hash-chained ledger is built first and is the V2 default | "Drop blockchain" in 01 |
| 4 | Kiosk is an old Amazon Fire tablet in Fully Kiosk Browser, LAN only | iPad kiosk options in 01 |
| 5 | YouTube and Roblox first, but the service catalogue is generic (AdGuard built-ins plus custom services plus discovery helper) | Two hardcoded services |
| 6 | Parents can allow, block or pause instantly from a simple screen built for Mum. One control service is the only writer to AdGuard. Fixed precedence order | Nothing |
| 7 | V1 is my family testing. V2 is a public self-hosted release for other families. Generic household model from day one | Single-family design |
| 8 | AI is optional and built in. Bring your own keys for major cloud providers plus local Ollama. The platform is both an MCP client and an MCP server. AI only proposes | Nothing |
| 9 | Points economy reframed. Screen time is an agreed weekly allowance. Chores earn money or flex points. Earned screen time capped at 15% of the allowance. Unused-time bonus, gradual reduction plan, praise-only tasks, no punishments | Earn-screen-time as the core loop in 01 and 02 |
| 10 | Every admin feature has a (?) help icon opening a right-hand panel that explains the feature and, where relevant, why it helps, with an evidence badge | Nothing |
| 11 | Visual design follows the mock, built with the Impeccable and Emil Kowalski skills | Nothing |
| 12 | Kiosk copy correction. DNS cannot see the end of a video, so the kiosk says "New videos won't start after 19:00. The one you're watching can finish." | Earlier mock copy |
