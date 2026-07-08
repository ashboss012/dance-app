# DANCE-APP — PRD & Roadmap (standing plan)

Execute task by task, in order. Read AGENTS.md first — the privacy rule
there is the product's identity. This plan takes the POC to a real,
ad-supported platform grown with AI-driven marketing.

## 1. Objective

Turn the pose-detection POC into a **public dance-learning platform**.
Users upload a dance video (a TikTok they want to learn, a class
recording), get a skeleton breakdown with step-by-step timeline, and
practice against it. Revenue: ads, once there's traffic. Growth: mostly
behind-the-scenes AI work (SEO content, share assets) rather than paid
acquisition. The privacy angle — *your video never leaves your device* —
is both the architecture and the marketing hook.

## 2. Context

- Working POC: in-browser MediaPipe pose detection, skeleton-only
  render, step timeline with word/lyric tags, Gemini gesture
  suggestions, Supabase anonymous-auth persistence of breakdowns
  (metadata only, never video). Git repo created 2026-07-08, one
  commit, no remote, no deploy.
- Must not break: the video-never-leaves-device rule (AGENTS.md), the
  skeleton-only display, metadata-only persistence.
- No name/brand yet; no domain.

## 3. Success criteria

- [ ] Deployed publicly with a name and domain, loading fast on mobile
- [ ] A first-time visitor can upload a video, get a skeleton +
      timeline, and practice a step loop without instructions
- [ ] Breakdowns can be published to public, SEO-indexable pages
      (skeleton data only — never video), and those pages rank for
      "[song/dance name] tutorial"-style queries
- [ ] Optional accounts exist (email) that upgrade anonymous sessions
      without losing saved breakdowns
- [ ] Analytics show real visitor traffic; ad units render for
      non-creating visitors once traffic justifies it
- [ ] A repeatable AI marketing loop is documented and running (content
      calendar, share assets, SEO pages)

## 4. Constraints

- **Privacy rule is absolute:** no video or frame data to any server,
  ever. Publishing a breakdown publishes skeleton keypoints + steps +
  metadata only.
- Free/near-free infra: Vercel hobby → upgrade only when traffic
  demands; Supabase free tier; Gemini free tier with graceful failure.
- Ads come AFTER the experience works — no ad code before M4. When
  they come: non-intrusive placements, never over the practice view.
- Out of scope for this plan: native mobile apps, video hosting of any
  kind, social feeds/comments, multi-dancer detection.

## 5. Milestones

- **M1 — Practice-worthy core.** Goal: someone can actually learn a
  step from it, on a phone.
- **M2 — Platform foundation.** Goal: named, deployed, accounts,
  publishable breakdowns.
- **M3 — SEO & content engine.** Goal: public pages that earn organic
  traffic (this is the ad inventory).
- **M4 — Monetization & analytics.** Goal: measure everything, turn on
  ads when traffic justifies.
- **M5 — Growth automation.** Goal: the behind-the-scenes AI marketing
  loop runs weekly.

## 6. Task breakdown

### M1 — Practice-worthy core

1. **Practice mode.** Loop playback of a selected step segment with
   speed control (0.25x–1x) on the skeleton view. Files:
   src/app/components/SkeletonViewer.tsx, Timeline.tsx. Done when: a
   step can be looped at half speed smoothly.
2. **Mobile pass.** Verify detection + playback on a real phone;
   fix layout, touch targets, and performance (frame skipping if
   needed). Files: page.tsx, SkeletonViewer.tsx, globals.css. Done
   when: end-to-end flow works on a mid-range phone browser.
3. **Empty/error states.** No-pose-detected, unsupported codec, long
   video warning (suggest trimming), Supabase-unreachable. Files:
   page.tsx, SkeletonViewer.tsx. Done when: each failure path shows a
   human message, never a blank screen.
4. **Mirror toggle.** Flip the skeleton horizontally (learners mirror
   their teacher). Files: SkeletonViewer.tsx. Done when: toggle works
   during playback.

### M2 — Platform foundation

1. **Name + brand basics.** Shortlist names with Ashwin (decision is
   his — do not pick unilaterally), check domain availability, set
   title/OG metadata. Files: layout.tsx, package.json name. Done when:
   name chosen, domain bought, metadata set.
2. **Push to GitHub + deploy to Vercel.** Set env vars, custom domain.
   Done when: production URL serves the app; detection works in prod.
3. **Optional email accounts.** Supabase email auth as an upgrade path
   from anonymous (linkIdentity / convert flow) so existing anonymous
   breakdowns survive signup. Files: src/lib/supabase.ts, breakdowns.ts,
   new auth UI component. Done when: an anonymous user with saved
   breakdowns signs up and still sees them.
4. **Publish flow + schema.** Add is_public flag + slug + title/song
   fields to breakdowns; a "Publish" action with a clear notice of
   exactly what becomes public (skeleton + steps, never video). RLS:
   public rows readable by anyone, writable by owner only. Files:
   breakdowns.ts, new migration SQL, page.tsx. Done when: a published
   breakdown is visible logged-out; private ones are not.

### M3 — SEO & content engine

1. **Public breakdown pages.** /d/[slug] server-rendered pages:
   title, song, step list, skeleton preview animation (from stored
   keypoints — requires storing keypoint frames for published
   breakdowns; still no video). Files: new src/app/d/[slug]/page.tsx,
   schema addition for keypoint data on published rows. Done when: a
   published page renders its animated skeleton with no source video
   present.
2. **SEO plumbing.** Sitemap, per-page metadata, OG image per
   breakdown (skeleton still frame), robots.txt. Files:
   src/app/sitemap.ts, og route. Done when: pages indexed (verify in
   Search Console).
3. **Seed content.** Create 10–20 quality public breakdowns of
   popular/trending dances (Ashwin records or sources his own input
   videos — the videos still never upload; only breakdowns publish).
   Done when: 10+ live public pages exist.
4. **Landing page.** Real homepage: privacy hook front and center,
   demo GIF of skeleton, browse public breakdowns. Files: page.tsx
   restructure (move tool to /create). Done when: a visitor
   understands the product in 5 seconds.

### M4 — Monetization & analytics

1. **Privacy-respecting analytics.** Vercel Analytics (or Plausible)
   — page views, create-flow completion, practice-mode usage. No
   video-related data collected, consistent with the brand. Done when:
   dashboard shows real events.
2. **Consent + ads.** AdSense (or similar) on public breakdown pages
   and landing only — never the create/practice tool views. Consent
   banner where required. Files: layout for ad slots, public page.
   Done when: ads render for logged-out visitors on content pages
   only. GATE: do not start until analytics shows meaningful organic
   traffic (Ashwin's call on the number).
3. **Performance budget.** Lighthouse pass on public pages (ads are
   heavy — keep content pages fast anyway). Done when: mobile score
   stays >80 with ads mounted.

### M5 — Growth automation (behind-the-scenes AI work)

1. **Content pipeline doc.** A written weekly loop: pick 3 trending
   dances → create breakdowns → publish → generate share assets. Files:
   docs/growth-playbook.md in repo. Done when: playbook exists and one
   full cycle has been run manually.
2. **Share asset generation.** Auto-generate a short skeleton-preview
   clip/GIF + caption per published breakdown for socials (client-side
   render capture). Files: new export utility in the viewer. Done
   when: one click yields a postable asset.
3. **Programmatic SEO expansion.** Template pages per song/style built
   from the breakdown library as it grows. Done when: song/style index
   pages exist and are indexed.

## 7. Handoff notes

- The privacy rule is the moat AND the constraint: every M3+ feature
  must be checked against "does any video/frame leave the device?" If
  yes, redesign it (store keypoints, not pixels).
- Anonymous → account upgrade (M2.3) is the trickiest task: read the
  Supabase docs on converting anonymous users before coding; test the
  breakdown-survival case explicitly.
- MediaPipe runs on the main thread today; if mobile perf (M1.2) is
  bad, move detection to a Web Worker before adding features.
- Decisions reserved for Ashwin: the name (M2.1), pricing/traffic gate
  for ads (M4.2), which dances to seed (M3.3).
- Work milestones strictly in order — ads before content (M4 before
  M3) would poison the brand; content before practice quality (M3
  before M1) earns traffic that bounces.
- After each session: build + lint, then run project-handoff.
