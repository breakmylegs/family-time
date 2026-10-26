---
name: add-help-topic
description: Add or change a help topic for a (?) button in the family-time parent app, with its evidence badge and sources. Use when a new parent-facing feature needs a help topic, or when help text changes.
---

# Add a help topic

Status: outline. The help system arrives in Phase 3; finish this skill then, with real file paths.

Every feature a parent configures or acts on has a (?) button that opens one topic. Read `docs/brief/build-prompt.md` Part 10 and Appendices A and B before writing one.

## Steps

1. Create one Markdown file in `packages/help-content/topics/<topic-id>.md` with frontmatter: `id`, `title`, `evidence` (strong, moderate, early, or none for explanation-only topics), `sources` (ids in `sources.yaml`), `lastReviewed`, `related`, and `status: needs-review` unless the owner has approved the text.
2. Sections, in this order, leaving out any that do not apply: In short, How to use it, How it works, Why it helps, What your child sees, Watch out for, Right now, The research, Related.
3. Write for Mum: plain English, second person, short sentences. Use the child's name placeholder, never a real name. "Linked to" unless a trial showed cause. No em or en dashes.
4. Every research claim must come from `docs/research/` and a source in `sources.yaml`. Never generate a research claim. If the research docs do not support it, leave it out and tell the owner.
5. Point the (?) button at the topic id. The build fails if a button names a missing topic, or a topic with an evidence badge has no source.
6. Run the `help-content-reviewer` subagent, then `corepack pnpm gate`.
