# Architecture

## Runtime shape

```text
React/Vite UI
   â”‚ commands + reconcile-after-notification
   â–¼
Supabase anonymous auth â†’ Postgres RPC + row locks â†’ filtered room snapshot
   â”‚                                            â””â†’ Realtime room_events notification
   â”” local preview fallback when env is absent
```

The front end is a static GitHub Pages artifact. Supabase is the shared backend. Anonymous auth provides a temporary identity without an account flow. A reconnect token is returned for the player seat and persisted by the browserâ€™s Supabase/local session storage.

## State machine

The engine uses explicit phases: `LOBBY`, `DEALING`, `PLANNING`, `WAITING_FOR_PLAYERS`, `RESOLVING_PLAYER`, `PLAYER_REACTION`, `ROUND_CLEANUP`, and `FINISHED`. In V1 the deal is performed during race creation/start, and the runtime normally alternates `PLANNING â†’ PLAYER_REACTION â†’ ROUND_CLEANUP â†’ PLANNING` until `FINISHED`.

All plans are submitted before movement. The engine calculates resolution order from public positions (space descending, then inside lane), then opens one active playerâ€™s reaction window. Passing is always available so Boost, Cooldown, Slipstream, or Adrenaline cannot deadlock a race.

## Private state boundary

`player_private_state` stores hand, draw deck, discard, played cards, and engine Heat. Opponents receive counts and public car state only. `get_room_snapshot` reconstructs the callerâ€™s player with private arrays and returns empty arrays for other players. Direct reads of `rooms` are intentionally not granted because `game_state` is server-private.

## Command boundary

Room creation, joining, starting, plan submission, and reactions are RPC calls. RPCs lock the room row, check the authenticated anonymous identity, verify room/seat/phase/action nonce/card ownership, and write an event. Realtime is a wake-up signal only; every client refetches the authoritative snapshot after a notification. The TypeScript engine remains the readable deterministic reference and is used by the local preview and tests.

## Deployment shape

Vite derives the GitHub Pages base path from `VITE_BASE_PATH` or `GITHUB_REPOSITORY`. The Pages workflow injects `/${repository}/` so invitation links work from a repository subpath. No server key or database credential is bundled.

