# Architecture

## Runtime shape

```text
React/Vite UI
   │ commands + reconcile-after-notification
   ▼
Supabase anonymous auth → Postgres RPC + row locks → filtered room snapshot
   │                                            └→ Realtime room_events notification
   └ local preview fallback when env is absent
```

The front end is a static GitHub Pages artifact. Supabase is the shared backend. Anonymous auth provides a temporary identity without an account flow. A reconnect token is returned for the player seat and persisted by the browser’s Supabase/local session storage.

## State machine

The engine uses explicit phases: `LOBBY`, `DEALING`, `PLANNING`, `WAITING_FOR_PLAYERS`, `RESOLVING_PLAYER`, `PLAYER_REACTION`, `ROUND_CLEANUP`, and `FINISHED`. In V1 the deal is performed during race creation/start, and the runtime normally alternates `PLANNING → PLAYER_REACTION → ROUND_CLEANUP → PLANNING` until `FINISHED`.

Local solo testing uses `src/engine/bot.ts`. The bot policy selects a proposed plan or reaction, then sends it through the same `applyGameAction` reducer as a human command. It has no direct movement, card, Heat, or phase mutation access. `advanceBotTurns` stops as soon as human input is required and has a hard action limit to surface deadlocks during tests.

All plans are submitted before movement. The engine calculates resolution order from public positions (space descending, then inside lane), then opens one active player’s reaction window. Passing is always available so Boost, Cooldown, Slipstream, or Adrenaline cannot deadlock a race.

## Private state boundary

`player_private_state` stores hand, draw deck, discard, played cards, and engine Heat. Opponents receive counts and public car state only. `get_room_snapshot` reconstructs the caller’s player with private arrays and returns empty arrays for other players. Direct reads of `rooms` are intentionally not granted because `game_state` is server-private.

## Command boundary

Room creation, joining, starting, plan submission, and reactions are RPC calls. RPCs lock the room row, check the authenticated anonymous identity, verify room/seat/phase/action nonce/card ownership, and write an event. Realtime is a wake-up signal only; every client refetches the authoritative snapshot after a notification. The TypeScript engine remains the readable deterministic reference and is used by the local preview and tests.

## Deployment shape

Vite derives the GitHub Pages base path from `VITE_BASE_PATH` or `GITHUB_REPOSITORY`. The Pages workflow injects `/${repository}/` so invitation links work from a repository subpath. No server key or database credential is bundled.
