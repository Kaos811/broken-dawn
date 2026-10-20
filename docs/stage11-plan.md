# Stage 11 plan: Accounts, server saves and Alliances (PLAN ONLY, no code, no sign-ups, no spending)

Today Broken Dawn is a static Phaser + Vite build on GitHub Pages. Everything lives in `localStorage` (save v11), and the world, events and battles run in the client behind swappable services (`LocalWorldService`, `EventService` on a fixed UTC calendar). Stage 11 adds a backend without breaking that: **the game must still boot and play fully offline as a guest**, and an account is something you link later.

## 1. Backend options

| | **Supabase** (recommended) | Firebase | Neon + small API (e.g. Cloudflare Workers) |
|---|---|---|---|
| What you get | Postgres, Auth (incl. **anonymous sign-ins**, Google, Apple, email), Realtime (chat, presence, row changes), Edge Functions, Row Level Security | Auth (anonymous + providers), Firestore (document DB), Cloud Functions, FCM push | Postgres only; auth, chat and functions are separate pieces we build or add |
| Fits our data | Relational: players, alliances, members, help requests, chat, event scores. **SQL + RLS is a natural fit** | Document model; leaderboards, joins and alliance totals need denormalising and many reads | Same SQL fit as Supabase, more glue to write |
| Static-site friendly | Yes: JS client from the browser, RLS enforces access, Edge Functions for trusted logic | Yes | Yes, through the Worker |
| Free tier (checked Oct 2026) | 50K MAU, 500 MB DB, 5 GB egress, 500K function calls, 2M realtime messages, **200 peak realtime connections**; **pauses after 1 week idle** | 50K MAU auth; Firestore 1 GiB, 50K reads/day, 20K writes/day; functions need Blaze (pay-as-you-go) | Neon free ~0.5 GB + Workers free 100K requests/day; auth and chat not included |
| Paid entry | Pro **$25/mo**: 100K MAU, 8 GB DB, 250 GB egress, 2M function calls, 5M realtime messages, 500 peak connections (then $10 per 1,000) | Blaze: usage-based | Neon paid ~$19/mo+, Workers paid $5/mo; plus an auth provider |
| Lock-in | Low (it's Postgres; we can export) | Higher (Firestore-specific) | Lowest |

**Recommendation: Supabase.** It covers auth (with guest → linked account built in), the database, realtime alliance chat and server-side checks in one place, with SQL we can carry elsewhere later. Firebase works but its read/write billing gets awkward for chat and leaderboards. Neon plus an API is the most flexible but means building auth and chat ourselves.

### Rough monthly cost
Assumptions: ~1 cloud save every 2 minutes while playing plus on pause, about 5 KB per save (compressed JSON); 30–45 minutes a day per active player; chat about 20 messages per active player per day; 5–10% of players online at peak.

| Players (monthly active) | Supabase | Firebase (Blaze) | Neon + Workers |
|---|---|---|---|
| Testing (≤50) | **$0** (Free; note the idle pause) | $0 | $0 |
| ~1K | **$25** (Pro: needed for no-pause + backups; usage sits inside the quotas: ~50–100 peak connections, ~0.6M realtime messages) | ~$5–20 (reads/writes past the daily free quota) | ~$5–25 (+ an auth service) |
| ~10K | **~$35–60** (Pro $25; peak 500–1,000 realtime connections → +$0–10; maybe Small compute +$5; DB ~1–2 GB fits in the 8 GB) | ~$60–200 (chat + leaderboard reads dominate) | ~$30–70 |

Not counted: the Apple Developer Program ($99/year) if we ship to iOS or use Sign in with Apple outside the web, and an email-sending service for magic links past Supabase's built-in limits (low volume is free).

## 2. Accounts and cloud saves

- **Guest first.** First launch works exactly as today, with no sign-in. When the backend is reachable, the client quietly creates a Supabase **anonymous user**, so even guests get a cloud save and can join an alliance. Offline → pure local play, synced later.
- **Link an account** (More → Settings → Account): Google, Apple, email (magic link). Linking upgrades the anonymous user in place, so the save and alliance stay. Signing in on a second device pulls that save.
- **Cloud save** table `saves(user_id, version, rev, updated_at, device_id, data jsonb, checksum)`:
  - Local save stays the source of truth while playing. Sync on start, every ~2 min, on pause/visibility change, and after big events (upgrade done, pull, alliance actions).
  - Each upload carries the `rev` it was based on. The server accepts only `rev = current + 1` (optimistic concurrency).
  - **Conflicts** (two devices played offline): pick automatically when it's clear-cut (one side has strictly more progress: higher Beacon level, more total Power, later `lastSaved` and no spending). Otherwise show a "Which save do you want to keep?" card with both summaries (Beacon Lv, Power, Cores, last played, device). The losing save is kept as a backup for 30 days.
- **Local → cloud migration:** the first successful sign-in uploads the local v11 save as rev 1 (after the usual `migrate()`), and keeps `brokenDawn.save.v1.backup-cloud` locally. If the account already has a cloud save, use the conflict card above.
- **Anti-cheat basics.** A client-only game can always be edited, so we stage it:
  - **11a (light):** the server stores saves but trusts them. Edge Function sanity checks on upload: resources can't rise faster than the max income since the last save (+ rewards), Cores can't exceed the sum of earned sources, Beacon level can't jump past the build-time minimum. Failures are flagged, not blocked.
  - **Server-authoritative for anything shared** (from 11b on): alliance membership, help, gifts, chests, alliance tech, chat, event and boss scores, and Rift Exchange limits are written only by Edge Functions / RLS-guarded RPCs, never by uploading a save.
  - **Later (stage 12+), if PvP or trading appear:** move timers and resource ledgers server-side (the server stores `started_at` + duration and decides when a job is done).
  - **Stays client-side for now:** base layout, solo battles vs creatures, solo timers, missions, the solo events calendar.

## 3. Alliances

- **Create / join / leave:** name (3–20 chars, profanity filter, unique), 3–4 letter tag, emblem (pick from painted badges), description, language, open or approval-only, minimum Beacon level. Creating costs Energy (not Cores). 50 members max (60 with tech). After leaving, a 12 h cooldown before joining another alliance.
- **Ranks:** R5 Leader (1), R4 Officers (up to 4), R3 / R2 / R1 Members. Permissions: R5/R4 accept, kick (lower ranks), edit info, start the boss, mute in chat. Leader transfer; if the leader is inactive for 7 days, auto-transfer to the most active R4.
- **Member list:** name, rank, Power, Beacon level, last online, contribution this week. Sort and filter; tap for a profile card.
- **Chat:** Supabase Realtime channel per alliance; the last 200 messages are stored. Moderation basics: rate limit (5 messages / 10 s), length limit, profanity filter, report button, R4+ mute (1 h / 24 h), delete own message, a block list per player, and a server log for review. A system feed posts joins, leaves, help, boss results.
- **Alliance help:** a running upgrade or research gets a **Help** button. Each member's tap cuts the timer by **1% of the total or 60 s (whichever is larger), max 10 helps per job** (11 with tech). Helping is free; you get a few Alliance Points per help (daily cap). The server records helps and applies them when your client syncs (via `speedUpConstruction` / `speedUpResearch`).
- **Gifts and chest:** when a member opens the Beacon Call x10, finishes a boss, or reaches milestones, every member gets a small gift (Energy, Alloy, speed-ups through the item registry, rarely a Core). Gifts fill an **Alliance Chest** meter; at full it opens a bigger reward for everyone. Gifts expire after 24 h.
- **Alliance tech / perks:** funded by Alliance Points + donated resources. 6–8 perks: +build speed, +research speed, +helps per job, +gift value, +member cap, +boss damage, +Rift Exchange stock. Officers pick the current tech.
- **Co-op Rift Boss:** a weekly alliance event (new UTC window, e.g. Tue 6 PM MT to Thu 6 PM MT). The boss has shared HP on the server. Each member gets 3 attacks/day using their squads; damage is computed **server-side** from the squad snapshot, using the same `resolveBattle` code shipped as a shared module. Tier rewards by total damage, personal rewards by contribution. Leaderboard across alliances.
- **How existing services plug in:**
  - `EventService` already reads a weekly UTC calendar behind an interface. Add a `RemoteEventService` that loads the calendar and alliance-scoped event state from Supabase, and falls back to the local calendar offline.
  - `LocalWorldService` keeps solo creature hunts. A later `RemoteWorldService` (stage 12) can own shared world maps / PvP marches using the same entity + march model, with the server ticking marches.
  - The item registry (stage 10b) carries alliance gifts as `it_<id>` bundles, so rewards need no new UI.

## 4. Rollout

| Sub-stage | What | Testable without real users |
|---|---|---|
| **11a: Accounts + cloud save** | Supabase client behind a `Backend` interface (local stub by default); anonymous sign-in; Settings → Account (link Google / Apple / email); cloud save sync, conflict card, local → cloud migration; upload sanity checks (flag only) | A local Supabase (CLI + Docker) in CI; scripted second "device" to force conflicts; offline tests (network blocked) must still pass 100% |
| **11b: Alliances core** | Create / join / leave, ranks, member list, profile cards, alliance tab in the nav or More | Seed script: 5 fake alliances × 20 bot players with varied Power/levels; e2e uses 2 browser contexts as two players |
| **11c: Chat + moderation** | Realtime chat, system feed, rate limits, filter, report / mute / block | Bot chatters at set rates; tests for rate limit, mute, block, reconnect |
| **11d: Help + gifts + chest** | Help requests and taps, Alliance Points, gifts, chest meter | Bots that auto-help and send gifts on a timer; check that timer cuts apply exactly once |
| **11e: Alliance tech** | Perks, donations, officer selection | Seeded points; perk effects verified in store mods |
| **11f: Co-op Rift Boss** | Server-side boss HP + battle resolution, tiers, leaderboard | Bot alliances attacking on a schedule; deterministic battle seeds compared client vs server |

Each sub-stage ships behind a feature flag. The game is fully playable with the flag off.

**What Jason has to do himself** (the build can't do these for him):
1. Create the Supabase account / organisation and project (choose region, e.g. US West), and decide when to move from Free to Pro ($25/mo).
2. Put the project URL + publishable (anon) key in the repo config. These are public by design. **The service-role key never goes in the repo**; it goes into GitHub Actions / Supabase secrets.
3. **Google sign-in:** create an OAuth client in Google Cloud Console (consent screen, authorised domain `kaos811.github.io`, redirect URL from Supabase).
4. **Apple sign-in:** Apple Developer Program ($99/year) for a Services ID + key. It's required if an iOS app version offers other social logins; optional on web. We can ship Google + email first.
5. Email sender for magic links (Supabase's built-in sender is fine for testing; a custom SMTP sender like Resend or Postmark later).
6. **Privacy policy + terms** pages (needed for Google/Apple sign-in and app stores): what we store (account id, email if given, save data, chat), retention, deletion. Plus an **in-game "Delete my account"** button (required by Apple and Google Play).
7. A minimum age / chat policy decision (chat with strangers usually means 13+ and moderation duties).

## 5. Open questions

1. OK to plan on **Supabase**, starting free and moving to **Pro $25/mo** around the first ~100 real players (or sooner, to avoid the 1-week idle pause)?
2. Which sign-ins at launch: **Google + email** first, Apple later (needs the $99/yr account), or all three at once?
3. Is a **mobile app (iOS / Android)** planned? That changes the Apple requirements and store policies.
4. Alliance size: **50** (60 with tech) OK?
5. Chat: global chat too, or alliance chat only? Minimum age / chat filter strictness?
6. Should alliances be **one shared server** for everyone, or regional servers / "kingdoms" later (matters for the world PvP plan)?
7. Anti-cheat level for now: **flag-only** sanity checks (proposed), or block suspicious saves right away?
8. Help tuning: **1% or 60 s per help, 10 helps per job** OK?
9. Where should the Alliance tab live: replace a nav slot, or under More?
