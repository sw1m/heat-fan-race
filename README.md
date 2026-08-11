# Heat Fan Race

Heat Fan Race is an unofficial, noncommercial, browser-based fan implementation for private games among friends. It uses temporary nicknames, short room codes, anonymous Supabase sessions, a deterministic rule engine, and a desktop-first React table. It intentionally uses emoji, text, CSS shapes, and no official or generated artwork.

This project is not affiliated with or endorsed by Days of Wonder, Asmodee, Asmodee Entertainment, or Asger Granerud and Daniel Skjold Pedersen. “Heat: Pedal to the Metal” and related names are trademarks of their respective owners. Users should own the physical game before playing this fan implementation.

## V1 scope

V1 supports two to four human racers in one private USA one-lap learning race. It includes the basic speed deck, Stress, the three standard starting cards (0, 5, and the extra Heat), six engine Heat, seven-card hands, gears 1–4, normal and paid two-position shifting, simultaneous planning, ordered movement, Adrenaline, Boost, Cooldown, Slipstream, corner checks, blocking, spinouts, reshuffling, finish ranking, refresh/rejoin storage, and a host-controlled lobby. Garage upgrades, Weather, Road Conditions, Events, Championship mode, Legends, AI, chat, sound, and multiple tracks are intentionally out of scope.

## Run locally

```powershell
npm install
Copy-Item .env.example .env.local
npm run dev
```

Without Supabase values, the app runs in local preview mode. That mode is useful for checking the UI and engine but cannot make a room visible to another computer. Add valid Supabase values for shared rooms.

Useful checks:

```powershell
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

## Create the free Supabase backend

1. Create a Supabase project at [supabase.com](https://supabase.com/).
2. In Authentication → Providers, enable Anonymous sign-ins.
3. Apply `supabase/migrations/202608100001_initial.sql` in the SQL editor or with the Supabase CLI.
4. Confirm Realtime is enabled and the migration’s `room_players` and `room_events` tables are present in the `supabase_realtime` publication.
5. Copy the project URL and public anon key into `.env.local` using `.env.example`.

Never put a service-role key in `.env.local`, the browser bundle, GitHub Actions logs, or the repository. The frontend only needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.

## GitHub Pages deployment

The Pages workflow builds with `VITE_BASE_PATH=/${repository-name}/`, so a repository subpath is supported. In repository Settings → Secrets and variables → Actions, add:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

Push to `main`. The workflow in `.github/workflows/pages.yml` builds and deploys the `dist/` artifact to GitHub Pages. In Settings → Pages, choose “GitHub Actions” as the source. The URL is normally `https://<owner>.github.io/<repository>/`.

## Friends joining

The host visits the public URL, enters a temporary nickname, and creates a race. The host shares the six-character code or the Copy Invite Link URL. Friends enter nicknames and the code. Anonymous authentication is performed behind the scenes; no account form is shown. The reconnect token is held in browser storage and is used when the same browser refreshes.

## Architecture

The pure rule engine lives under `src/engine/` and is independent of React and Supabase. The UI submits commands through `src/lib/supabase.ts`; the SQL migration locks a room row, checks membership/card ownership/phase/duplicate nonces, and returns a filtered snapshot. Private state is held in `player_private_state`, and the browser only receives its own private hand/deck plus public opponent summaries. See [docs/architecture.md](docs/architecture.md).

## Known limitations

- The exact USA board space sequence could not be recovered from machine-readable official text without reproducing the board artwork. The functional starter circuit is isolated in `src/engine/constants.ts` and documented in [docs/track-data.md](docs/track-data.md); it must be checked against a physical USA board before claiming exact geometry.
- The remote SQL action boundary currently records and authorizes reactions; the readable TypeScript engine is the reference for resolving the complete game. A production hardening milestone should move the complete resolver into a versioned Supabase Edge Function or a shared server package before public non-demo use.
- The local preview seats are placeholders for UI smoke tests, not computer opponents.
- There is no account recovery, public room list, spectator mode, chat, mobile-first layout, audio, or monetization.

## Verify a deployment

Open the Pages URL in two separate browsers. Create a room in one, join with the code in the other, refresh both during lobby/planning, and check that the same phase/round/player summaries appear. Then run the browser and unit suites against a configured Supabase project. If the backend is not configured, the landing page will explicitly say “Local preview mode” rather than pretending to provide shared multiplayer.

## Source availability notice

This repository contains original application code and a rules implementation based on publicly available basic-game rules. It does not include official artwork, logos, fonts, card illustrations, board scans, or generated images. The project is intended for private, noncommercial use by people who own the physical game.
