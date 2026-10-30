---
name: add-help-topic
description: Add or change a help topic for a (?) button in the family-time parent app, with its evidence badge and sources. Use when a new parent-facing feature needs a help topic, or when help text changes.
---

# Add a help topic

Every feature a parent configures or acts on has a (?) button that opens one topic. Read `docs/brief/build-prompt.md` Part 10 and Appendices A and B before writing one.

## Steps

1. Create `packages/help-content/topics/<topic-id>.md`. The file name is the id: lower case, digits and hyphens. Frontmatter, one `key: value` per line:
   - `id`, `title`
   - `evidence`: `strong`, `moderate`, `early`, or `none` for explanation-only topics (no badge)
   - `evidenceNote`: the badge's one line, for example `One well-run trial of 70 families.` Required with a badge, not allowed without one
   - `sources: [a, b]`: ids in `packages/help-content/sources.yaml`. Required with a badge or a research section
   - `lastReviewed: 2026-10-30`, `related: [other-topic]`
   - `status: needs-review` unless the owner has approved the text (only the brief's seed text starts as `reviewed`)
2. Sections are `## ` headings, in this order, leaving out any that do not apply: In short (required), How to use it (a numbered list), How it works, Why it helps (required with a badge), What {child} sees, Watch out for, The research. Right now, Related and Was this helpful come from the app.
3. Write for Mum: plain English, second person, short sentences. Never a real name or a guessed pronoun: write `{child}`, `{they}`, `{them}`, `{their}` (or `{They}`, `{Their}` at the start of a sentence). Make sentences read well with he, she or they: use `{child}` as the subject where a verb would have to agree. "Linked to" unless a trial showed cause. No em or en dashes.
4. Every research claim must come from `docs/research/` and a source in `sources.yaml` (`citation`, `design`, `finding`). Never generate a research claim. If the research docs do not support it, leave it out and tell the owner.
5. Point the (?) button at it: `<HelpButton topic="<topic-id>" label="..." />` in `apps/parent/src`. Topic ids are a TypeScript type built from the files, so a button naming a missing topic fails `typecheck`. Live values for Right now go in `apps/parent/src/help/rightNow.ts`.
6. `corepack pnpm --filter @family-time/help-content build` runs the checks: a badge with no source, an unknown source or related topic, a dash, a child's name or pronoun written in, or sections out of order fail it. A topic not reviewed for 12 months warns.
7. Run the `help-content-reviewer` subagent, then `corepack pnpm gate`.
