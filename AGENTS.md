# AGENTS.md

## Repository map

- `src/engine/` — pure TypeScript cards, track data, state machine, rules-following bot policy, and tests. Do not import React, Supabase, DOM APIs, or browser storage here.
- `src/lib/` — Supabase command/read adapter, local preview persistence, and small room policy helpers.
- `src/ui/` — React views and CSS table presentation. UI dispatches commands; it does not mutate authoritative game state directly.
- `supabase/migrations/` — schema, RLS, Realtime publication, start/reset RPCs, and the transactional state-commit boundary.
- `supabase/functions/submit-game-action/` — authenticated server-side action adapter. It reconstructs private state, calls the pure engine, and commits through the locked RPC. Never move the service-role key into `src/` or the browser bundle.
- `docs/` — architecture, rule interpretations, track provenance, and deployment notes.
- `tests/e2e/` — Playwright smoke tests. A configured backend is required for the multi-context race test.
- `.github/workflows/` — CI and GitHub Pages deployment.

## Commands

```powershell
npm run dev
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
```

## Architectural boundaries

The engine is deterministic when given an injected random source. State changes go through `applyGameAction` locally or the `submit-game-action` Edge Function plus `commit_game_state` remotely. The client may request actions, but it must not choose a deck draw, move a car directly, or write another player’s cards. Supabase table reads do not expose `rooms.game_state`; RPC snapshots filter private arrays to the caller’s own seat.

## Rule-engine conventions

- Use immutable input/output at the public `applyGameAction` boundary; internal helpers may mutate a cloned state.
- Keep card kinds explicit. Do not infer Heat or Stress from presentation colors.
- Treat `position.space` and `position.lane` as data; lane `0` is closest to the Race Line and breaks ties.
- Keep corner lines, limits, finish, and grid in `TrackConfig`.
- Add a focused unit test for every rule change, especially card movement, Heat movement, corner crossing, finish order, and a hidden-information projection.
- Do not add official artwork, logos, fonts, board scans, or remote image dependencies.

## Testing expectations

Run typecheck, lint, unit tests, and production build for every change. Run Playwright when browsers and a configured Supabase project are available. If the Supabase CLI/Deno toolchain is available, deploy or serve the Edge Function with `--use-api`/the project environment before remote smoke tests. Tests should exercise both successful and rejected commands. Prefer seeded random sources for rule tests.

## Definition of done

A feature is done only when it has a pure engine path, a server command boundary where the feature changes shared state, a private/public projection review, UI feedback for unavailable actions, tests, and documentation. Preserve unrelated work and do not commit `.env.local`, Supabase service-role keys, or generated assets.
