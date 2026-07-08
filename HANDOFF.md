# dance-app — Handoff

**As of:** 2026-07-08. Git repo is one day old; docs committed; NO
remote yet (PLAN M2.2 creates it alongside the deploy).

## Read this first

AGENTS.md → the one absolute rule: the video never leaves the device.
Pose detection is in-browser (MediaPipe); Supabase stores breakdown
metadata and steps only, via anonymous auth.
PLAN.md → the standing roadmap (v2, rewritten 2026-07-08 after a
viability vet): M0 zero-dollar validation sprint with a hard G0
kill-gate → practice core (side-by-side original + skeleton) →
share-link platform → content engine → Pro tier revenue → ads only
at a traffic gate. Money order is Pro → ads → teams.

## Current state

- Working POC, `npm run build` green: upload video → skeleton render →
  step timeline with word/lyric tags → Gemini gesture suggestions →
  save/restore breakdowns (metadata only).
- No practice mode, no mobile pass, no name/domain, no deploy, no
  public pages. That is the plan, in order.

## Rough edges / worth knowing

- Restoring a saved breakdown requires re-uploading the matching local
  video (we never store it) — preserve this flow in any persistence
  change.
- MediaPipe runs on the main thread; if mobile performance is bad in
  M1.2, move detection to a Web Worker before adding features.
- Decisions reserved for Ashwin: product name/domain, ad-traffic gate,
  which dances to seed.

## Next up

PLAN.md → M0 task 1: the validation sprint (skeleton clips posted,
5 deadline-dancer tests, share-rate count). Building M1 before G0 has
numbers is explicitly forbidden by the plan.
