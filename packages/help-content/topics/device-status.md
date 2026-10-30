---
id: device-status
title: Is it working yet?
evidence: none
lastReviewed: 2026-10-30
related: [allow-block-normal, device-gone-quiet, alerts]
status: needs-review
---

## In short

After a change, each app says when it has really reached {child}'s devices.

## How it works

Your home server tells AdGuard, the home Wi-Fi filter, what to block, then reads it back to check. Until then the app says "Starting. Takes up to a minute". Once AdGuard has it, it says "Working on" and the device's name.

If the check fails three times in a row, the app says the device hasn't picked up the change, and parents get an alert. The server keeps trying every minute, so it often sorts itself out.

Blocking only stops new connections. A video or game that's already running can carry on for a while.

## Watch out for

A change that still hasn't been picked up after a few minutes. It usually means AdGuard or the home server needs a look. Ask whoever set up Family time.
