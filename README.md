# CONSTRAINT

A precision platformer rendered as a CAD sketch. 153 sheets across six acts, in a single
self-contained HTML file with no dependencies, no build step and no external assets.

**Play:** https://fanaustinca.github.io/constraint/

## The premise

You are geometry in someone's drawing. In Act I you learn to move. At the end of it, a cursor
arrives, selects you, and tries to delete you — and fails, because you are *fully constrained*.
So it deletes everything else instead. Each act after that is another thing it does to the sheet
because it cannot do that thing to you: it erases it, flattens it to one dimension, extrudes it
into three, and finally deletes the machine the sheet lives on. The last act is the sheet you
draw back.

| Act | Sheets | What changes |
|-----|--------|--------------|
| I · the basics | 1–40 | jump → double jump → wall jump → gravity mirror → dash |
| II · revision b | 41–80 | a cursor deletes the sheet while you play it |
| III · revision c | 81–104 | the sheet is one-dimensional — every block is a line |
| IV · revision d | 105–128 | the sheet is solid, you are still flat; no checkpoints |
| V · recovery | 129–152 | corruption, every file mandatory, no checkpoints |
| VI · authored | 153 | one sheet, 24 screens, every block in the library |

Then five **extra worlds**, 80 sheets each, sitting outside the story:

| Extra world | Sheets | What it adds |
|---|---|---|
| SPACE | 154–233 | real low gravity — jumps 2.4x higher and 10.9 tiles long |
| PORTALS | 234–313 | a linked tile pair that teleports you |
| CODE | 314–393 | the sheet renders as source glyphs; you are a blinking caret |
| LIGHT | 394–473 | the whole sheet composited to inverse — white ground, dark geometry |
| WINTER | 474–553 | ice runs fast (4.9), snow drags (2.15), and it is snowing |

## Layout

`game.html` is the source of truth — it has no `<!doctype>` or `<head>` because the Claude
artifact platform supplies those. `index.html` is generated from it by `tools/build.js`, which
adds the document shell, charset and viewport meta that standalone hosting needs. **Edit
`game.html`, never `index.html`.**

```bash
node tools/build.js     # game.html -> index.html   (run before every commit)
node tools/extract.js   # game.html -> build/game.js (for the test harness)
```

## Architecture

The game itself is one file, `game.html`.

- **Segments.** Levels are composed from 34 hand-authored 16×18 tile segments (`CHUNKS`).
  Each keeps its outer two columns clear with solid ground beneath, so any segment can follow
  any other and the seam is always walkable. A sheet is just a list of segment ids.
- **Worlds** carry modifiers: `render` (flat / extrude / glitch / drawn), `eat` (cursor speed),
  `drift`, `phase`, `chaos`, `nodatum`, `allparts`, and per-sheet `sup` (suppressed abilities).
- **Physics** is fixed-timestep at 60Hz with substepped AABB collision, coyote time, jump
  buffering and variable jump height. Tuning constants are grouped near the top of the script.

## Testing

The game runs headless in Node against a stubbed DOM, which is how essentially every real bug
in it was found — unbounded run speed that let the player tunnel through walls, saws that never
reached the player's hitbox, a gravity-flip exploit that trivialised a whole act, and a level
gated behind a 39-second deadline that could not be met.

```bash
node tools/extract.js       # game.html -> build/game.js
cd tools
node solvability.js         # bot-plays all 153 sheets, reports any it cannot finish
node bounds.js              # asserts the player never leaves the sheet
```

`solvability.js` proves a sheet is *completable*. It does not prove it is fun, fair, or correctly
paced — those still need a human. It also cannot see a hazard that fails to threaten anything,
which is exactly how the harmless-saw bug survived for as long as it did.

## Build mode

Finish all 153 sheets (or enter the dev code) and a **Build** button appears on the menu.
Paint a sheet from the full block palette, size it 32–192 columns, keep three save slots,
and test-play it in place.

**Compile** turns the sheet into a share code — `CS1.<cols>.<run-length data>`, a few dozen
characters for a typical sheet. Hand it to someone else, they paste it into their copy and
press **Paste code**, and they have your level. No tile character is a digit, so run lengths
parse unambiguously; decoding validates the column count and total tile count and refuses
anything malformed.

## Controls

Arrows or WASD to move · Space/W/Up to jump (hold for height) · Shift/X to dash ·
Down to drop through thin platforms · R restart · Esc pause · M mute
