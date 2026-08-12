# USA starter track data

The official basic rules identify the USA track as the recommended first track and recommend one lap for a learning race. The official board’s exact space-by-space lane geometry is visual board data, not available in machine-readable text on the linked page. This repository therefore does **not** claim the following values are an exact transcription of the physical USA board.

The V1 functional starter circuit in `src/engine/constants.ts` uses 40 numbered spaces, two lanes, a six-space starting grid, four data-driven corners, and six course-provided engine Heat slots:

| Marker                | Space | Limit |
| --------------------- | ----: | ----: |
| Turn 1                |    10 |     4 |
| Turn 2                |    20 |     3 |
| Turn 3                |    29 |     5 |
| Turn 4                |    36 |     4 |
| Painted finish marker |    40 |     — |

These values are a short, playable approximation selected to exercise straightaways, multiple corners, blocked spaces, and a final sprint without importing or tracing official board art. Space 40 is the painted finish marker; the engine treats spaces 41 and beyond as the first finish-line-crossing spaces so cars can remain visibly separated after the line. Before an exact-fidelity release, compare this configuration to an owned physical USA board or an authorized machine-readable track reference and update the configuration plus its tests. No other track should be added until this data is verified.
