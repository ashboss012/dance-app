# DANCE-APP — Project Context

Read this before writing any code. (CLAUDE.md imports this file.)
The standing implementation plan (what to build next, task by task)
is PLAN.md — work it in order.

## What this is

A dance-learning product being built from POC toward a consumer
platform (see PLAN.md v2 for the vetted goals: non-typical dancers
learning from any video, group-share growth, Pro tier then ads).
Upload a dance video, run pose detection **in the browser**, show a
white skeleton figure alongside the local video. The user builds a
step-by-step breakdown on a timeline (steps tagged with a word/lyric),
and an AI helper suggests what gesture a word maps to. The codebase is
still POC-grade — favor the simplest thing that works, but do not
break the privacy rule below, and do not build past the current
PLAN.md milestone gate.

## The hard rule: the video never leaves the device

Pose detection runs client-side via @mediapipe/tasks-vision. The
original video is never uploaded, never stored, and never shown — only
the skeleton render. Supabase stores breakdown metadata and steps
(title, video_name, chunk_size, steps), NOT video or frames. Any
feature that would send video or raw frames to a server is the wrong
feature — stop and ask.

## Stack

- Next.js 16 App Router, `src/` directory, React 19, TypeScript strict
- Tailwind CSS v4 (PostCSS plugin, no config file); dark UI
  (bg-zinc-950, white text) styled with inline Tailwind classes
- @mediapipe/tasks-vision for in-browser pose detection
- Supabase (browser client only, src/lib/supabase.ts) with
  **anonymous auth** — ensureSignedIn() in src/lib/breakdowns.ts calls
  signInAnonymously() on demand; there is no login UI and no server
  Supabase client
- Gemini 2.0 Flash via raw fetch() (no SDK) in the one API route
- Not a git repo yet; no deployment set up

## Repository map

```
src/app/page.tsx                     # Single page: upload + saved list
src/app/components/SkeletonViewer.tsx  # Pose detection + skeleton render
src/app/components/Timeline.tsx        # Step breakdown timeline (Step type)
src/app/api/suggest-meaning/route.ts   # word/lyric → gesture phrase
                                       # (Gemini, server-side key)
src/lib/breakdowns.ts                # Supabase CRUD for breakdowns
                                     # + ensureSignedIn() anon auth
src/lib/supabase.ts                  # createBrowserClient factory
```

## Environment

- `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` —
  required for saving/loading breakdowns
- `GEMINI_API_KEY` — server-side only, used by /api/suggest-meaning;
  the route returns a clean JSON error if unset

## Conventions

- Keep AI calls server-side in API routes with the raw fetch() pattern;
  the Gemini key never reaches the client.
- API errors: `NextResponse.json({ error: string }, { status })` —
  validate inputs and fail with a readable message, don't crash.
- Saved breakdowns restore by re-uploading the matching local video
  (since we never stored it) and picking the saved entry — preserve
  this flow in any persistence changes.
- Supabase tables in use: `breakdowns` (and its steps). If you add a
  table, note it here.

## Definition of done

- [ ] `npm run build` and `npm run lint` pass clean
- [ ] No video data, frames, or pose source footage is sent to any
      server — verify anything you touched in the upload/detection path
- [ ] The app still works with Supabase env vars missing except for a
      clear error on save/load (POC courtesy, not silent crash)
- [ ] This file updated if stack, tables, or flows changed
