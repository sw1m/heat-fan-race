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

Local solo testing uses `src/engine/bot.ts`. The bot policy scores legal plans using projected movement, corner Heat cost, blocking, Stress risk, and finish distance. It protects Heat more strongly early in the lap, projects the next replenished hand and legal next gear to reserve Heat for the next corner, and becomes increasingly willing to spend Heat for extra distance near the finish. Finish-line scoring uses the actual landing space and prefers a larger post-line margin while reducing remaining available Heat when that can be achieved legally. Reactions use a cloned engine preview, so Boost is favored when it adds finish distance and spends Heat. The bot sends the selected plan or reaction through the same `applyGameAction` reducer as a human command and has no direct movement, card, Heat, or phase mutation access. `advanceBotTurns` stops as soon as human input is required and has a hard action limit to surface deadlocks during tests.

Leaving is an explicit command. Local rooms remove their browser-persisted room record. Remote rooms call the transactional `leave_room` RPC: lobby departures release the seat and transfer host ownership when needed, while departures during a race mark the existing seat disconnected so hidden state and turn ordering remain stable for rejoin. During the lobby, only the host can remove another player; local removal releases the lowest-numbered seat for reuse, and remote removal uses the row-locked `remove_lobby_player` RPC. Finished races use a separate restart path: local rooms rebuild a fresh game while preserving seats and colors, and remote rooms reset private decks, selections, positions, and finish results in the row-locked `start_race` RPC when the existing game phase is `FINISHED`.

All plans are submitted before movement. The engine calculates resolution order from public positions (space descending, then inside lane), then opens one active player’s reaction window. Passing is always available so Boost, Cooldown, Slipstream, or Adrenaline cannot deadlock a race. `TrackConfig.engineHeatCapacity` is the course base capacity; `engineHeatCapacityForPlayer` adds special Heat slots from that player's deck, and `summarizeHeat` reports both values plus the current Heat locations. This keeps the USA starter setup at `6/7` until the extra card is cooled into the engine, then permits `7/7`. Crossing the finish line marks the car immediately and records `finishRound` so the UI can show the in-race finish banner and final crossing turn, while the same-round distance tiebreak and winner are finalized at cleanup. `FINISHED` is withheld until every racer has crossed so the remaining places stay playable and visible.

## Private state boundary

`player_private_state` stores hand, draw deck, discard, played cards, and engine Heat. Opponents receive counts and public car state only. `get_room_snapshot` reconstructs the caller’s player with private arrays and returns empty arrays for other players. Direct reads of `rooms` are intentionally not granted because `game_state` is server-private.

## Command boundary

Room creation, joining, starting, plan submission, and reactions are RPC calls. RPCs lock the room row, check the authenticated anonymous identity, verify room/seat/phase/action nonce/card ownership, and write an event. Realtime is a wake-up signal only; every client refetches the authoritative snapshot after a notification. The TypeScript engine remains the readable deterministic reference and is used by the local preview and tests.

## Deployment shape

Vite derives the GitHub Pages base path from `VITE_BASE_PATH` or `GITHUB_REPOSITORY`. The Pages workflow injects `/${repository}/` so invitation links work from a repository subpath. No server key or database credential is bundled.
