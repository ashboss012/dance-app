# dance-app — Handoff

**As of:** 2026-07-08. Git repo is one day old; docs committed; NO
remote yet (PLAN M2.2 creates it alongside the deploy).

## Read this first

AGENTS.md → the one absolute rule: the video never leaves the device.
Pose detection is in-browser (MediaPipe); Supabase stores breakdown
metadata and steps only, via anonymous auth.
PLAN.md → the standing roadmap: POC → practice-worthy core → named,
deployed platform with optional accounts → SEO content engine (public
skeleton pages are the ad inventory) → ads + analytics → weekly AI
marketing loop.

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

PLAN.md → M1 task 1: practice mode (loop a step segment with 0.25x–1x
speed control). Then M1 in order.
