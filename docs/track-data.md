# USA starter track data

The supplied board photograph is now used as the visual reference for the V1
USA course. The renderer draws a simplified CSS/SVG course centerline; it does
not include, trace, or ship the board photograph or any official artwork.

The basic rules identify USA as the recommended first track. V1 keeps the
learning-race configuration at one lap. The course data now uses the physical
board's 69 numbered spaces and the four visible corner limits:

| Marker                | Space line | Speed limit |
| --------------------- | ---------: | ----------: |
| Turn 1                |          6 |           7 |
| Turn 2                |         20 |           3 |
| Turn 3                |         26 |           3 |
| Turn 4                |         52 |           2 |
| Painted finish marker |         69 |           — |

The corner line is the boundary between the space immediately before the
corner and the speed-limit space. The engine therefore checks a corner when a
move crosses `lineSpace`; the UI places its marker at `lineSpace - 0.5` so the
marker is visually between landing spaces. A car finishes only after landing
beyond the painted finish marker, so post-finish spaces remain visible for
same-turn distance tie breaks.

The `visual.centerline` in `src/engine/constants.ts` is now an intentionally
geometric top-down snake made from five long horizontal runs and alternating
end connectors. It is a presentation aid only; it does not claim to reproduce
the physical board. The supplied photograph does not expose enough resolution to
prove every numbered lane cell, exact grid offset, or the exact pixel position
of each corner line. Verify those values against an owned physical board or an
authorized machine-readable track reference before calling this exact-fidelity
data.

The six course Heat slots are separate from the seven Heat cards in the
starter deck. See `docs/rules-implementation.md` for the Heat accounting.
