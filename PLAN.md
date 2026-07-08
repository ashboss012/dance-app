# DANCE-APP — PRD & Roadmap (standing plan, v2 — post-viability-vet)

Execute task by task, in order. Read AGENTS.md first — the privacy rule
is the product's identity. This plan replaced v1 on 2026-07-08 after a
viability audit; the audit's findings are baked in as gates below.

## 1. Objective

A consumer platform for **learning any dance from any video** — aimed
at non-typical dancers, not studio kids. Two entry doors, same user:
someone chasing a trending TikTok dance, and someone who got sent a
video they MUST learn for an event (wedding sangeet, culture show,
flash mob). The deadline crowd is the beachhead because their pain is
acute and every event group is 6–10 users sharing one link — but the
destination is the mass market of social dance learners.

**Where the money is (stated honestly, in order of arrival):**
1. **Pro tier** (small monthly or one-time price): unlimited/longer
   breakdowns, team spaces. Arrives at M4. This is the first real
   revenue.
2. **Ads** on public content pages — ONLY at scale. Display ads pay
   ~$2–5 per 1,000 views; 100k monthly views ≈ $200–500/mo. Ads are a
   scale prize, not a launch strategy. Gate: M5.
3. **Team/studio plans** — later, after organic teams appear.

Growth engine: the product markets itself — skeleton-breakdown clips
posted to TikTok/Reels (novel visual, native to where dance discovery
happens) + group-share links that recruit whole event parties at once.
"AI marketing" = generating that content pipeline, not SEO alone.

## 2. Context

- Working POC (see AGENTS.md): in-browser MediaPipe pose detection,
  skeleton render, step timeline, Gemini gesture tags, breakdown
  persistence via anonymous Supabase auth. Build green. No deploy, no
  name, no remote yet.
- **Audit findings that shape this plan:**
  - The skeleton as a LEARNING aid is unproven — learners may get more
    from the original video slowed/mirrored/looped. Hedge: always show
    the original video side-by-side with the skeleton (the video is
    local to their device anyway — privacy rule intact).
  - Choreography is copyrightable (Hanagami v. Epic). Public content
    pages use permissioned or self-created breakdowns; do not
    mass-publish skeletons of others' choreo once money is involved.
  - Ad math (above) means traffic gates, not hope, decide when ads go
    live.
- Must not break: video never leaves the device; metadata-only
  persistence; anonymous → account upgrade must preserve breakdowns.

## 3. Success criteria (each stage gates the next)

- [ ] **G0 Validation:** ≥5 real deadline-dancers used a breakdown on
      their own video; ≥2 forwarded it to their group unprompted; at
      least one said the practice view beat re-watching the raw video
- [ ] MVP live on a public URL; a first-time phone visitor completes
      upload → practice loop with zero instructions
- [ ] 10 active groups (event parties or campus teams) in the first
      season
- [ ] Pro tier live with ≥1 paying user (any amount — proves the rail)
- [ ] Ads live ONLY after sustained meaningful traffic (Ashwin sets
      the number at M5 start), on content pages only
- [ ] The TikTok content loop runs weekly on ≤5 hrs/week of Ashwin's
      time

## 4. Constraints

- **Privacy rule is absolute** — no video/frames to any server, ever.
  Published pages carry skeleton keypoints + steps only.
- Free/near-free infra until revenue exists (Vercel hobby, Supabase
  free, Gemini free tier with graceful failure).
- No ads before the M5 gate; never on the create/practice views.
- Public/published breakdowns: own recordings or permissioned ones
  only once the site is commercial.
- Solo-shippable on the known stack; no new paradigms without a
  stated reason.
- Out of scope this plan: native apps, video hosting, social
  feeds/comments, multi-dancer scoring, studio marketplace.

## 5. Milestones

- **M0 — Validation sprint (zero dollars, ~2 weeks).** Prove practice
  value + group sharing before building more. Kill-gate G0.
- **M1 — Practice-worthy core.** Side-by-side player, loop/speed/
  mirror, mobile-solid.
- **M2 — Shareable platform.** Name, deploy, share links, optional
  accounts.
- **M3 — Content engine.** The weekly TikTok/clip pipeline + public
  pages for permissioned content.
- **M4 — First revenue.** Pro tier + analytics.
- **M5 — Scale monetization.** Ads (traffic-gated) + team plans.

## 6. Task breakdown

### M0 — Validation sprint (do NOT skip to M1)

1. **Skeleton clips test.** Use the POC to make 3–5 breakdowns of
   trending dances; screen-record; Ashwin posts to TikTok/Reels.
   Done when: posted, and saves/"link?" comments tallied after 7 days.
2. **Deadline-dancer test.** Find 5 people with a real event dance
   (campus teams, family weddings). Make each a breakdown of THEIR
   video; watch at least one practice with it live.
   Done when: 5 sessions logged with notes on whether they used the
   skeleton, the loop, or just the original video.
3. **Share test.** Count unprompted forwards to groupmates.
   Done when: the G0 boxes can be answered yes/no with numbers, and
   the verdict is written into this file. **If G0 fails, stop and
   rethink with Ashwin — do not proceed to M1 on momentum.**

### M1 — Practice-worthy core

1. **Side-by-side player.** Original video and skeleton in one
   practice view (video stays local). Files: SkeletonViewer.tsx,
   page.tsx. Done when: both stay in sync during playback on desktop
   and phone.
2. **Practice mode.** Loop a selected step segment, 0.25x–1x speed.
   Files: SkeletonViewer.tsx, Timeline.tsx. Done when: a step loops
   smoothly at half speed.
3. **Mirror toggle.** Files: SkeletonViewer.tsx. Done when: flips both
   video and skeleton during playback.
4. **Mobile pass.** Real phone test; move detection to a Web Worker if
   the main thread janks. Files: SkeletonViewer.tsx, globals.css.
   Done when: full flow works on a mid-range phone.
5. **Error states.** No-pose, bad codec, long-video warning, Supabase
   down. Done when: every failure shows a human message.

### M2 — Shareable platform

1. **Name + domain.** Shortlist with Ashwin (his call), set metadata.
   Done when: chosen, bought, deployed under it.
2. **GitHub remote + Vercel deploy.** Private repo, env vars, custom
   domain. Done when: production URL works end to end.
3. **Share links.** is_public flag + slug; a read-only breakdown page
   (skeleton + steps + counts, NO video) any groupmate can open from a
   link. RLS: public read, owner write. Files: breakdowns.ts, new
   migration, new /d/[slug] page. Done when: a logged-out phone user
   can practice from a shared link.
4. **Optional accounts.** Supabase email auth upgrading anonymous
   sessions without losing breakdowns. Done when: the survival case is
   tested explicitly.

### M3 — Content engine

1. **Share-asset export.** One click renders a skeleton preview
   clip/GIF + caption for socials from any breakdown. Done when: one
   click yields a postable asset.
2. **Weekly pipeline doc.** docs/growth-playbook.md: 3 dances/week →
   breakdown → post → link in bio, sized to ≤5 hrs/wk. Done when: one
   full cycle run and timed.
3. **Public library page.** Browse permissioned/own public breakdowns;
   per-page metadata + OG image; sitemap. Done when: pages indexed.

### M4 — First revenue

1. **Analytics.** Vercel Analytics or Plausible: visits, create
   completion, practice usage, share opens. Done when: dashboard live.
2. **Pro tier.** Free: N breakdowns / length cap. Pro (price = Ashwin's
   call): unlimited + longer videos + team space grouping. Stripe or
   Lemon Squeezy checkout. Done when: a real card can pay and limits
   enforce server-side.

### M5 — Scale monetization (traffic-gated)

1. **Ads on content pages** once the agreed traffic bar is hit;
   consent banner; never on create/practice. Done when: ads render on
   public pages only and mobile Lighthouse stays >80.
2. **Team plan probe.** If ≥3 organic teams exist, interview captains;
   scope a team plan with Ashwin. Done when: written scope, decision
   made.

## 7. Handoff notes

- The G0 gate is the whole point of v2 — a cheaper model must not
  "helpfully" start M1 because the tasks look clear. Numbers first.
- The skeleton is the marketing hook and maybe the learning aid; the
  side-by-side hedge (M1.1) means the product works either way.
- Privacy rule doubles as brand: check every public-page feature
  against "does any video/frame leave the device?"
- Money order is Pro → ads → teams. Anyone reordering that needs
  Ashwin's sign-off.
- Decisions reserved for Ashwin: name/domain, Pro price, ad-traffic
  bar, which dances get published publicly.
- After each session: build + lint, update HANDOFF.md, commit (run
  the project-handoff skill).
