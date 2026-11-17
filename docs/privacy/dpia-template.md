# Data protection impact assessment: template

For a household running Family time, and the starting point for V2's own DPIA. Fill in the parts in square brackets. The rest describes what the software does as of version 0.12.0; check it against your own set-up.

## 1. What and why

- **Who runs it:** [the parents' names]. Family time runs on [the server], in the home.
- **Purpose:** help the family agree and keep to screen time, with rewards for jobs done and time saved, and a weekly family review.
- **Children:** [first names and age bands]. Children never sign in; they use a kiosk tablet paired to the server.

## 2. What is kept

| What | Where it comes from | How long | Who sees it |
|---|---|---|---|
| Names, roles, age band, pronouns | Parents | Kept; `child-remove --erase` deletes what a child wrote and the notes about them, keeping the points history | Everyone signed in |
| Minutes of use per app | Home Wi-Fi's DNS records (AdGuard Home) | 13 months; AdGuard's own log 7 days | Parents, carers |
| Schedules, rules, allowance, plan | Parents | Until changed | Everyone signed in |
| Jobs, completions, photos of jobs | Child (kiosk), parents | Photos 30 days after a decision | Parents, carers |
| Ledger: pocket money, flex points, time | Approvals and week close | Kept; it is the family's record | Parents; child sees their own totals |
| Ideas, reflections, things done away from screens, skills | Child (kiosk) | Things done 13 months; removed skills 90 days | Parents, carers (not reflections) |
| Questions about rules and answers | Child (kiosk), parents | 13 months after the answer | Parents only |
| Parents' estimates of unmanaged time, monthly mood check | Parents | 13 months | Parents only |
| Sign-ins, passkeys, audit log | Parents | Sessions 30 days; audit 2 years | Owner |
| AI calls (if turned on) | Parents' questions | 13 months | Owner |

The full list, table by table, is in `docs/export.md`; retention is in `packages/db/src/retention.ts`.

## 3. Lawful basis

[For a household: outside UK GDPR as household processing. For V2: decide with advice; likely legitimate interests of the parents, with the child's best interests weighed first.]

## 4. Risks and what reduces them

| Risk | Likelihood, impact | What reduces it |
|---|---|---|
| A child feels watched or controlled | Medium, medium | What Mum and Dad can see on the kiosk; Ask about a rule; rules with reasons; nothing about content, messages or the screen itself |
| Screen time used as punishment | Medium, high | No deductions or sanctions in the software; help topics explain why |
| A sibling sees another child's things | Low, medium | Each child sees only their own page; with more than one child, Me needs the child's own kiosk PIN |
| Someone outside the home reads the data | Low, high | Server on the home network; passkeys; default-deny routes; secrets as files; nightly backups, encrypted by restic |
| Children's words reach an AI provider | Low, medium | AI off by default; children's own words are never sent; AI only proposes to parents |
| Data kept longer than needed | Medium, low | Retention sweep each night, audited |
| Pressure from rewards crowding out the child's own reasons | Medium, medium | Praise only for things the child already enjoys; bonus faded once habits form; no variable rewards |

## 5. The child's view

[How you explained Family time to each child, what they said, and what you changed because of it.]

## 6. Sign-off

- Completed by: [name], [date]
- Review due: [date, at most a year later, and whenever Family time adds what it keeps]
