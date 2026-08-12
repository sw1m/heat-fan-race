# Rules implementation notes

The authority used for these interpretations is the [Days of Wonder Heat page](https://www.daysofwonder.com/game/heat/), specifically its linked Basic Game Rules PDF. The official page identifies the game’s basic component counts and links the rulebook; the basic rules recommend the USA board and one lap as a learning race. This document paraphrases the implementation decisions rather than reproducing the rulebook.

## Deck and setup

- Each racer starts with 12 Basic cards: three each of Basic Speed 1, 2, 3, and 4.
- Each racer also receives three Stress cards and the three standard starting cards: starting 0, starting 5, and one extra starting Heat card. The starting cards are in the beginner deck; they are not Garage choices in this V1.
- The selected course supplies the base engine capacity. The USA setup starts with six Heat cards in the engine, while the starting Heat card is shuffled into the beginner deck. That special card works as an additional engine slot, so a USA beginner car has an effective capacity of seven: it starts at `6/7` and can reach `7/7` when the starting Heat is cooled into the engine.
- The deck is shuffled, seven cards are dealt, and the gear starts at 1.
- The extra starter Heat remains a real card throughout the hand, draw-pile, discard-pile, played-card, and engine transitions. The UI reports its current location so an extra card in the draw pile is not mistaken for a removed card.
- Heat in hand clutters the hand: it cannot be played as a speed card while enough playable cards exist. If the hand cannot supply the gear’s card count, Heat can cover the missing slots and the car does not move; the gear resets to 1.

## Round order

Gear changes and card selection are simultaneous. A normal shift changes one gear position. A two-position shift is legal only when the engine can pay one Heat immediately. Each player plays exactly the number of cards shown by the gear, subject to the cluttered-hand exception.

After all selections are locked, players resolve from the car nearest the Race Line to the last car. A car may pass through other cars, but its landing space may not contain more than two cars. Two cars can share a space only by occupying its two lanes; a full space is blocked. When blocked, the engine searches backward for the closest legal landing space and uses the Race Line lane whenever it is open. Spinouts apply the same occupancy rule while scanning backward from the first space before the corner, so simultaneous spinouts cannot create an overfilled space.

## Speed, Stress, Boost, and Heat

Cooldown uses the player's effective engine capacity: the selected course's base capacity plus one slot for each special Heat card in that player's deck. The USA starter deck therefore reports `6/7` at setup and permits the seventh Heat card to enter the engine. The available supply is seven Heat cards at setup. After an Adrenaline choice, the normal gear reaction window remains available; a gear-3/4 car may Boost when it has engine Heat.

Basic and the starting 0/5 contribute their printed speed when played normally. A Stress card reveals cards from that player’s draw deck until a Basic Speed card appears; non-Basic reveals, including starting 0/5 and Heat, are discarded and do not supply the Stress speed. Boost pays one engine Heat, reveals by the same Basic-Speed process, adds that speed, and moves again. Heat paid from the engine goes to discard; it is not removed from the game.

Gear 1 provides up to three Cooldown and gear 2 up to one Cooldown. Cooldown moves Heat cards from hand back to the six-card engine, and cannot overfill it. V1 exposes Boost in gears 3–4 and Cooldown in gears 1–2, matching the basic player-mat access model. Adrenaline is available to the last active car in a two-to-four-player race, or the last two active cars in a five-to-six-player race: it may add one speed and/or one Cooldown, and cannot be saved.

## Corners and Slipstream

Crossed corner lines are evaluated in track order. Corner speed is the sum of normal played speed plus Adrenaline speed and Boost/Stress speed; Slipstream movement does not increase this speed. Each point over a corner limit costs one Heat. If the engine cannot pay, the car spins out at the first available space before that corner, empties remaining engine Heat to discard, resets to gear 1, and receives one Stress in gears 1–2 or two Stress in gears 3–4.

Slipstream is optional, can be used once per turn when the car ends in the same space as another car or immediately behind one, moves two spaces, and cannot cross or be used after the finish line. A car farther ahead does not qualify. The UI makes the choice explicit and offers Pass.

The optional Discard step allows a racer to discard numeric cards from hand before replenishing. Heat and Stress cards cannot be chosen for this optional discard; played cards are discarded automatically as part of ending the turn.

## Finish and ranking

The painted finish marker is a track space, not the finish itself. A car must land in a space beyond that marker to cross the finish line; landing on the marker remains in the race. Normal movement, Adrenaline, Boost, and legal non-finish Slipstream obey landing rules. Once the finish line is crossed, post-finish corner limits are ignored. The UI marks a crossing immediately, while the turn and subsequent rounds continue so the remaining places can be determined. The engine records the first crossing round on `finishRound`; at round cleanup, newly finished cars receive stable ranks using their final landing space number (including any later Boost or Slipstream movement in that reaction), then the inside Race Line lane, then seat order. Finished cars no longer participate in blocking, but their final space and finish turn remain visible for review.

## Determinism and tests

The engine accepts an injected random source. Production uses browser/server randomness; tests use a fixed source. Deck exhaustion reshuffles discard into the draw deck. Tests cover the interpretations above and public projection excludes private card arrays.
