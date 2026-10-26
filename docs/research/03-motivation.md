# Motivating Less Screen Time: Evidence Review and Feature Plan

## Status of this document

Current. This report defines the points economy and the motivation features. It overrides the economics in `01-feasibility.md` and `02-v1-research.md`. The build prompt (`docs/brief/build-prompt.md`, Part 6 and Part 14) turns it into product rules.

---

The most effective lever is to stop treating screen time as the prize. Evidence from food-reward experiments and from two screen-specific studies suggests that earning screen time raises its value. Children cut back most reliably when screen time becomes a fixed, tapering budget agreed with them, when the unused part of that budget is rewarded in a different currency, and when the offline alternatives are made easier, more social and more absorbing. The platform already has most of the plumbing. The main change is to the economics of the ledger and the framing on the kiosk, not to the enforcement layer.

## TL;DR

- **The earn-screen-time design is a risk.** In a University of Guelph study (Tang and Haines, BMC Obesity) of 62 children aged 18 months to 5 years, using screens as a reward or punishment was linked to an average of 20 more minutes a day of screen use at weekends. In 10,048 US 12 to 13 year olds it was linked to higher screen time and more problematic gaming. Both studies are observational, but they agree with experimental food-reward work showing that a reward becomes more liked. Move TIME from "earned prize" to "agreed allowance", and make MONEY and FLEX the main earning currencies.
- **What actually reduces use is modest but real.** A meta-analysis of 204 studies found a small overall effect (SMD 0.116), slightly larger where goals, feedback and planning were used (SMD 0.145). The strongest single-family design is Epstein's 2008 trial. It combined a weekly budget cut by 10% a month down to 50%, a small cash payment for each unused half hour, and parental praise, and held a reduction of about 17.5 hours a week for two years. Build that pattern in. Reward under-use, taper gradually, and let the child set and review goals.
- **The child must feel ownership, and the offline world must compete.** Rules framed with reasons and choices limit reactance. Natural stopping points beat countdown warnings. Parents' own screen use, screens at meals and screens in bedrooms are consistent predictors of higher child use. Ship in V1 an under-budget bonus, a child-set weekly goal, a boredom menu, natural-stopping-point endings, a wind-down mode and a parents' own-screen-time card. Defer leaderboards, streak mechanics and differential app pricing until the pilot shows they are safe.

## Evidence summary

| Approach | Evidence strength | Effect | Age suitability | Key sources |
|---|---|---|---|---|
| Multi-component screen reduction interventions | Strong for existence of effect, weak for size | Small. SMD 0.116 overall, 0.145 with goals, feedback and planning | 0 to 18 | Jones et al. 2021, IJBNPA, 204 studies |
| Preschool interventions, caregiver-delivered | Moderate | g = 0.16 in a 2026 review of 65 RCTs. SMD 0.26 in a 2025 review of 41 RCTs | 0 to 7 | Chandrasekaran et al. 2026. BMC Public Health 2025 |
| School-based curricula | Low certainty | Smaller than earlier estimates, high risk of bias | 5 to 18 | Camh 2025 review, 39 studies |
| Budget plus reward for unused time plus praise | Moderate (one RCT, n = 70) | Intervention fell 17.5 h/week by 6 months and held to 24 months, against 5.2 h/week in controls | 4 to 7 tested, plausible to 10 | Epstein et al. 2008 |
| Screen time contingent on physical activity | Moderate (small RCTs) | Large short-term drops in TV. Raises the risk of screen-as-currency | 8 to 12 | Faith et al. 2001. Goldfield et al. 2006 |
| Using screens as reward or punishment | Moderate (observational, consistent) | Associated with more screen time and more problematic gaming | 1.5 to 5 and 12 to 13 | Tang, Haines et al. 2019. Nagata et al. 2024 |
| Food as reward (analogue) | Strong (experimental) | Repeatedly giving a food as a reward increases preference for it | 2 to 12 | Birch et al. 1980 and 1984. Cooke et al. 2011 |
| Autonomy-supportive rule-setting | Moderate | Better internalisation, less reactance, less concealment | Most important 10+ | Valkenburg et al. 2013. White et al. 2015 |
| Parental monitoring and clear limits | Moderate (observational) | Lower screen time and less problematic use | 9 to 13 | Nagata et al. 2024 |
| One-off Family Media Use Plan | Weak (null RCT) | No change in adolescent rule engagement | 12 to 17 | Moreno et al. 2021 |
| Family-wide short reduction (adults included) | Moderate (one RCT) | 45 min/day more non-sedentary leisure, better SDQ scores after 2 weeks | 4 to 17 | SCREENS trial, Schmidt-Persson et al. 2024 |
| Parental modelling and technoference | Moderate (longitudinal, bidirectional) | Parent device use predicts child externalising behaviour, and the reverse | All ages | McDaniel and Radesky 2018 |
| No devices in bedrooms or at bedtime | Moderate (cross-sectional meta-analysis) | Bedtime use linked to inadequate sleep (OR 2.17) and poor quality (OR 1.46) | 6 to 19 | Carter et al. 2016 |
| Natural stopping points and routines | Emerging (diary study) | Smoother transitions. Two-minute warnings linked to more upset in under-5s | 1 to 5, plausibly older | Hiniker et al. 2016 |
| Rich non-digital play | Emerging | Play with real toys linked to fewer screen tantrums | Preschool | Gavrilova and Veraksa 2024 |
| Gamification for activity | Moderate | Small increase in activity. No effect on sedentary behaviour | 6 to 18 | Wang et al. 2025, 16 RCTs |
| Turning off autoplay and using platform limits | Weak (mechanistic, parent reports) | Removes the default continuation cue | All, essential under 13 | Hiniker 2016, platform documentation |

What the evidence means.

- Expect small effects and design for compounding. A home platform is closer to the Epstein model than to a school curriculum.
- Goals, feedback and planning are the active ingredients.
- How a limit is delivered matters as much as the limit. Using screens to control behaviour is linked to more use. Controlling styles predict reactance and concealment, especially in adolescence.
- The family system matters. Parent use, mealtime screens and bedroom screens are among the most consistent predictors.

## 1. Does earning screen time increase its value?

Yes, probably, and the risk is greatest where the platform makes screen time the main or only thing worth earning.

- **Food analogue.** In Birch's laboratory studies, foods given as rewards became more preferred.
- **Screen-specific evidence.** Tang, Haines and colleagues (2019) found parents using screens as rewards or punishments was linked to about 20 minutes more screen use a day at weekends. Nagata et al. (2024, 10,048 adolescents) linked it to higher screen time and greater problematic video game use.
- **Nuance.** Removal as punishment looks worse than reward. Both studies are cross-sectional, so reverse causation is possible.
- **The counter-evidence is about structure, not currency.** Epstein 2008 did not pay children in screen time. It paid them money for unused screen time, inside a shrinking budget, with praise.

**Recommended adjustments to the earn-and-spend core.**

1. Introduce a weekly TIME allowance that is agreed, not earned. Set it with the child in the first family review, based on the baseline.
2. Make MONEY and FLEX the primary earning currencies for chores. Keep a small capped TIME earning route (no more than 15% of the weekly allowance). Never let TIME be the only option for a task.
3. Reward the unused allowance. At the end of the week, convert unused minutes into MONEY or FLEX at a fixed, published rate, capped.
4. Taper gradually and visibly, for example 10% of baseline every four weeks, stopping at a family-agreed floor.
5. Never remove screen time as punishment through the platform. Pause is a household routine tool, not a sanction.
6. Rename the kiosk language. "Spend points on Roblox" becomes "Plan my Roblox time". "Earn time" disappears from the child's view.

## 2. Parental mediation, autonomy and reactance

- Autonomy-supportive restriction (giving a rationale and recognising the child's perspective) supports internalisation and avoids reactance. Reactance is more common in adolescence.
- Restrictive mediation in an autonomy-supportive style was linked to lower aggression in adolescents.
- Reactance mediates the unintended effects of restrictive mediation.
- Withdrawing media as punishment was negatively linked to adolescents seeing their parents as autonomy-supportive.
- Rising problematic use predicted more reactive restrictions, so reactive clampdowns are a symptom as much as a cause.
- The AAP Family Media Use Plan RCT found no change. The 2024 AAP revision notes families chose so many rules they could not remember or enforce them.

Implication. Co-creation helps only if it is ongoing, short and revisited. Hold three to five agreed rules, show the reason for each on the kiosk, and revisit them at a weekly review.

## 3. Self-determination theory applied to offline life

- **Autonomy.** Child-set goals, choice of tasks, choice of when to use the allowance, the ability to propose rule changes.
- **Competence.** Skill progression in offline activities recorded as mastery, not points.
- **Relatedness.** Co-play and shared family activities.
- **Self-regulation.** Self-monitoring, goal setting and reflection, with the child setting the goal and parents as coaches.

## 4. Rewarding less use, defaults, friction and commitment

| Mechanism | Verdict | Reasoning |
|---|---|---|
| Unused-allowance bonus in MONEY or FLEX | Use (V1) | Modelled on Epstein 2008 |
| "Interest" compounding on banked unused time | Avoid | Makes screen time a growing asset and invites binge weekends |
| Gradual taper | Use (V1) | Gradual steps limit reactance |
| Child-chosen commitment | Use (V1) | Respects autonomy. Optional and reversible |
| Loss framing (lose points for overuse) | Avoid | Overlaps with punishment |
| Friction (confirm before starting, one tap to stop) | Use (V1) | Low cost, removes the autoplay-style default |
| Default "off" for passive apps outside planned windows | Keep | Acceptable when framed as a family plan |
| Implementation intentions | Use (V1) | Low risk |
| Contingent TV on exercise | Avoid as a core design | Turns screen time into the reward |

Gaming risks to design for. Moving to other screens, saving all allowance for one long session, and inflating chore photos. Mitigate with a single-session cap, a weekly parent estimate of unmanaged screen use, and parent approval of photo tasks.

## 5. Activity substitution and environment design

- **Bedrooms and bedtime.** Bedtime device use was linked to inadequate sleep, poor quality and daytime sleepiness. Even access without use carried risk. Evidence is cross-sectional but consistent.
- **UK guidance.** The UK CMOs (2019) advised screen-free mealtimes and phones outside the bedroom. The March 2026 government guidance for under-fives recommends no more than one hour a day for 2 to 5 year olds, no screens at meals or in the hour before bed, co-viewing, and avoiding fast-paced social media-style videos and AI toys.
- **Whole-family reduction.** SCREENS asked every family member to cut leisure screen use. Children gained 45 minutes a day of non-sedentary leisure.
- **Technoference.** Parent device use during interactions predicts more child externalising behaviour.
- **Boredom menus and real toys.** Play with real toys predicted fewer screen tantrums. Small studies, treat as emerging.

## 6. Engagement-maximising apps and counter-measures

- **Transitions.** Children aged 1 to 5 given a two-minute warning were more upset when screens ended. Routines and natural stopping points made transitions easier. Parents named autoplay as a driver of battles.
- **YouTube.** Supervised accounts let parents disable autoplay so the child cannot turn it back on. Take a Break and Bedtime reminders exist.
- **Roblox.** Since November 2024 parents can manage controls from their own linked account, see average weekly screen time and set a daily limit. Verify in the pilot that the limit actually locks him out.
- **Platform implication.** DNS blocking ends sessions abruptly, the pattern linked to upset. Add session-shape features so endings land on natural stopping points.

## 7. Gamification, what helps and what harms

- Gamification increased activity slightly but did not reduce sedentary behaviour. It will not on its own pull children off screens.
- **Helpful.** Cooperative family goals, skill badges for real mastery, visible progress towards a savings goal, challenges the child chooses.
- **Harmful or risky.** Leaderboards between siblings, loss-framed streaks, variable rewards like loot boxes, frequent notifications.
- **ICO Children's Code.** Probably outside its legal scope for a self-hosted tool, but adopt it as a design benchmark for V2.

## 8. Types of screen use and differential pricing

- UK guidance emphasises context and content over raw minutes.
- Do not build differential pricing in V1. It strengthens the screens-as-currency framing and needs app classification DNS cannot provide.
- In V1, let parents mark some services "outside the allowance" (homework tools, video calls with grandparents).
- In V2, consider co-play windows that do not draw down the allowance when a parent is present.

## 9. Measuring success without Goodhart effects

- Do not make screen minutes the child's score.
- Use a small balanced dashboard for parents. Managed minutes trend, offline activity variety, session-end conflict, sleep timing, and a brief wellbeing check-in.
- **Wellbeing measure.** The Stirling Children's Wellbeing Scale was developed by Stirling Council's Educational Psychology Service for ages 8 to 15. Confirm its licence before embedding it. Use monthly. For under-8s, use a parent-reported mood check.
- **Privacy.** Keep all data on the local server. Do not send mood data, photos or screen logs to AI. Auto-delete chore photos after approval plus 30 days. Tell the child what parents can see.

## Product principles

1. Reward less, not more. Earning routes pay MONEY and FLEX. Unused allowance is rewarded.
2. Screen time is a plan, not a prize.
3. The child sets the goal, parents coach.
4. Fewer rules, with reasons, reviewed weekly.
5. End at a natural stopping point.
6. Make offline easy and social.
7. The whole family plays. Parents' own screen use sits alongside the child's.
8. No punishment through the ledger.
9. Protect sleep first.
10. Measure wellbeing, not compliance.

## Feature list

**V1 must-have**

| Feature | Component | Evidence |
|---|---|---|
| Weekly agreed TIME allowance | Ledger, control service, kiosk | Tang 2019, Nagata 2024, Epstein 2008 |
| Chores earn MONEY and FLEX by default, TIME earning capped | Ledger rules | Food-reward analogue, Deci et al. 1999 |
| Unused-allowance bonus, weekly cap | Ledger, kiosk | Epstein 2008 |
| Gradual taper schedule | Parent app, control service | Epstein 2008, reactance literature |
| Child-set weekly goal and Sunday reflection | Kiosk | Jones 2021 |
| Weekly family review agenda | Parent app | Valkenburg 2013, Moreno 2024 |
| Boredom menu, child-curated | Kiosk | Gavrilova 2024 |
| Natural stopping-point endings, then block | Control service, kiosk | Hiniker 2016 |
| Wind-down mode, entertainment blocked before bedtime | Control service | Carter 2016, UK guidance |
| Parents' own screen time card | Parent app, kiosk | McDaniel and Radesky 2018, SCREENS |
| YouTube autoplay off and Roblox daily limit setup checklist | Parent app onboarding | Hiniker 2016, platform docs |
| No punishment-style removal in child-facing flows | All | Nagata 2024 |

**V1 nice-to-have**

| Feature | Component | Evidence |
|---|---|---|
| Offline activity journal with optional photos, praise not points | Kiosk, parent app | Deci 1999 |
| Skill badges for real mastery | Kiosk | SDT competence |
| Family cooperative challenge | Parent app, kiosk | SCREENS |
| Co-play quests with a parent | Kiosk, parent app | Co-viewing guidance |
| "Outside the allowance" service list | Control service | UK guidance on context |
| Monthly wellbeing check-in | Kiosk, parent app | Stirling scale (licence to confirm) |

**V2**

| Feature | Component |
|---|---|
| AI-suggested offline activities by interest, weather and season | AI service, parent app |
| AI weekly family summary from aggregates | AI service |
| Age-band presets | All |
| Teen self-management mode | All |
| Co-play windows that do not draw down the allowance | Control service |
| ICO Children's Code self-assessment and DPIA template | Documentation |
| Differential pricing, only if pilot data justify | Ledger |

**Evaluated and not recommended.** Compounding interest on banked TIME, sibling leaderboards, hard streaks with loss, countdown warnings as the main transition tool, child-facing AI chat.

## Age bands

| Age band | Allowance and rules | Motivation emphasis | Platform settings |
|---|---|---|---|
| 5 to 7 | Small, parent-set, fixed windows, co-viewing preferred | Praise, co-play, real toys, picture boredom menu | YouTube Kids, autoplay off, wind-down 60 min, parent mood check |
| 8 to 10 | Agreed with the child, child schedules windows | Child-set goals, skill badges, unused bonus, savings goal | Supervised YouTube, Roblox daily limit, monthly check-in, weekly review |
| 11 to 13 | Child proposes allowance and taper, parents approve | Rules with reasons, commitments, reflection | Supervised YouTube, Roblox limits parent-managed under 13, explain monitoring openly |
| 14+ | Teen sets the budget, parent reviews | Self-monitoring, own goals, money management | Summary-only parent view, opt-in features |

## Ethical guardrails

- No punishments in the ledger, no point deductions for overuse.
- No sibling comparison views.
- No system-generated variable or surprise rewards. Surprise praise from parents is fine.
- Child notifications capped and never sent during wind-down.
- The child can always see what parents can see.
- Pause is never a sanction.
- No child data leaves the server for AI processing.
- The child can request a rule change at any time through the kiosk.

## Metrics

| Metric | Source | Cadence | Watch for |
|---|---|---|---|
| Managed screen minutes per week, by service | Control service logs | Weekly | Reductions alongside rising unmanaged use |
| Unused allowance converted | Ledger | Weekly | Hoarding then bingeing |
| Offline activity variety | Journal, boredom menu | Weekly | Diversity over counts |
| Session-end conflict (calm, grumble, meltdown) | Parent app | Each block event | Early signal of transition design |
| Bedtime and wind-down compliance | Control service | Nightly | Sleep first |
| Wellbeing check-in | Kiosk, parent app | Monthly | Discuss any clear drop |
| Child goal set and reviewed | Kiosk | Weekly | Engagement with self-regulation |
| Unmanaged screen use (parent estimate) | Parent app | Weekly | Displacement |

The child-facing view shows three items only: progress towards his own goal, unused minutes converted this week, and his savings goal.

## V1 family pilot plan

| Phase | Weeks | What changes | What to observe | Decision point |
|---|---|---|---|---|
| 0. Setup | 0 | Autoplay off, Roblox daily limit, wind-down, conflict tap | Controls work as documented | Proceed if Roblox lockout and DNS blocks are reliable |
| 1. Baseline | 1 to 2 | Logging only | Weekly minutes, conflict rate, sleep timing, first check-in | Starting allowance at baseline minus no more than 10% |
| 2. Reframe economics | 3 to 4 | Agreed allowance, chores move to MONEY and FLEX, first family review | Reactance, fairness complaints, displacement | Continue if conflict is no worse than baseline |
| 3. Reward under-use and self-goals | 5 to 8 | Unused bonus, child goal and Sunday reflection, boredom menu | Whether he chooses to under-use, hoarding | Keep bonus if unused minutes rise without bingeing |
| 4. Transitions and family | 9 to 12 | Natural stopping-point endings, parents' screen time card, a family challenge | Session-end conflict, parents' own trend | Adopt stopping-point mode if conflict falls |
| 5. Taper and review | 13 to 16 | First 10% taper step if agreed, second check-in | Wellbeing, sleep, displacement | Decide V2 defaults |

Introduce one change at a time. If wellbeing or conflict worsens at any phase, roll back that phase before continuing.

## Risks, dependencies and assumptions

- **Small-sample uncertainty.** One family's pilot is a design test, not evidence.
- **Observational base for the core concern.** Plausible and consistent, not proven.
- **Displacement to unmanaged screens.** DNS blocking only covers managed devices on home Wi-Fi.
- **Reactance if the change feels imposed.** Introduce the new economics in a family conversation.
- **Money for less use could crowd out the child's own reasons.** Pair every payout with praise and reflection, and plan to fade the bonus once habits form.
- **Abrupt DNS blocks** cause conflict until stopping-point features exist.
- Depends on reliable per-device blocking, platform controls behaving as documented, parent consistency, and ten minutes a week for a family review.
- Some product facts come from vendor or secondary sources and should be verified in the pilot.
