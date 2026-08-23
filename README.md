# CONSTRAINT

A precision platformer rendered as a CAD sketch. 600 sheets — six acts and six extra worlds —
in a single self-contained HTML file with no dependencies and no external assets. The GitHub Pages
build makes no third-party requests at all.

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
| WINTER | 474–553 | ice runs fast (4.9), snow drags (2.15), powdered snow swallows you, and it is snowing |
| TRIALS | 554–600 | a 47-rung difficulty ladder used by the ranking test |

## The test

**Take the test** on the menu drops you into trial 24 of 47 and binary searches on how
you actually play. Each sheet is scored against a par time derived from its length and
your death count; do well and it jumps up the ladder, struggle and it drops. Six sheets
places you, and you get a rank from **Beginner** to **Grandmaster**. Giving up on a sheet
counts as a failure and moves you down. Trials are never listed in the sheet list — the only way to meet one is to take the test,
so the ladder cannot be practised. Each run also jitters which rung it picks, so retaking
never walks the same path. They never advance story progression.

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

- **Segments.** Levels are composed from 66 hand-authored 16×18 tile segments (`CHUNKS`).
  Each keeps its outer two columns clear with solid ground beneath, so any segment can follow
  any other and the seam is always walkable. A sheet is just a list of segment ids.
- **Worlds** (41 of them) carry modifiers: `render` (flat / extrude / glitch / drawn / code /
  light), `eat` (cursor speed), `drift`, `phase`, `chaos`, `nodatum`, `allparts`, `sparse`,
  `gravity`, `accel`, `weather`, `winter`, `cold`, `livedraw`, and per-sheet `sup`
  (suppressed abilities).
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
node solvability.js         # bot-plays all 600 sheets, reports any it cannot finish
node solvability.js 0 60    # or just a range
node bounds.js              # asserts the player never leaves the sheet
cd ..
node tools/pokicheck.js poki/index.html   # SDK lifecycle and ad rules
node tools/buildercheck.js                # share codes, remixing, themes
node tools/stress.js                      # everything else, see below
```

`tools/stress.js` drives the whole game from a seeded PRNG — including the game's
own `Math.random` — so anything it finds replays exactly with `--seed N`. Thirteen
phases: every sheet loads with a spawn, an exit and a sane grid; random input
against sheets with invariants checked every frame; random clicks through every
menu; hostile share codes; ghost round trips; daily determinism; the ranking search
terminating; the save surviving garbage; the builder's resize and paint; every
interlude ending by key and by tap; sheets played back to back watching for leaks;
portals not crossing or bouncing; and no start or datum that can kill you while you
stand still.

```bash
node tools/stress.js --seed 7     # a different run
node tools/stress.js --only ui    # one phase
node tools/stress.js --deep       # longer
```

`solvability.js` proves a sheet is *completable*. It does not prove it is fun, fair, or correctly
paced — those still need a human. It also cannot see a hazard that fails to threaten anything,
which is exactly how the harmless-saw bug survived for as long as it did.

## Build mode

A **Build** button sits on the menu from the start (`BUILD_AT` in `game.html`).
Paint a sheet from a 23-tile palette — each swatch is drawn the way the sheet itself draws
that tile, with its name and its rule underneath — size it 32–1088 columns, keep three save
slots, and test-play it in place.

**Remix** opens an official sheet's geometry in the editor to take apart. **Themes** re-skin
your sheet with a world's rules: Blueprint and Cursor are free, and Space, Code, Whiteout,
Winter and Chaos are optional unlocks. The editor is fully usable without unlocking anything.

**Compile** turns the sheet into a share code — `CS2.<cols>.<theme>.<run-length data>`, a few
dozen characters for a typical sheet. Hand it to someone else, they paste it into their copy
and press **Load code**, and they have your level. Codes are treated as hostile input: length
is capped, every run length is checked against the grid size *before* it is expanded, and every
character has to be one you could actually have painted. Older `CS1` codes still load.

## Daily and ghosts

**Daily** composes one sheet from the date with a seeded PRNG, so every copy of the game
builds the same sheet on the same day with nothing sent anywhere. Difficulty rotates across
five tiers; clearing it advances a streak.

**Ghosts** record your best run on a sheet, sampled every third frame and delta encoded to
roughly five characters a sample. Beat your time and it replaces the recording. The last 24
are kept. Trials never record one — the ranking test is meant to be met cold.

## Controls

Arrows or WASD to move · Space/W/Up to jump (hold for height) · Shift/X to dash ·
Down to drop through thin platforms · R restart · Esc pause · M mute

On a touch device the on-screen pad appears automatically and the sheet fills the screen.

## Builds

Three targets come out of the one source:

```bash
node tools/build.js       # game.html -> index.html      (GitHub Pages)
node tools/build-poki.js  # game.html -> poki/index.html (Poki submission)
```

`index.html` is the Pages build: document shell added, dev code and the rev-code box
stripped, zero external requests. `poki/index.html` adds Poki's SDK and a full-screen embed
layout, and is the only build that loads anything from another origin.

Ad handling follows Poki's lifecycle rules rather than any schedule of our own:

- **Frequency is Poki's.** There is no internal timer. `commercialBreak()` is requested at
  every clean sheet transition and their capping decides whether one runs.
- **Only back into gameplay.** A break is never requested on the way to a menu, a daily
  summary, the builder, or an interlude — `nextLevel()` resolves the destination first.
- **`gameLoadingFinished()` before anything else.** The menu stays behind a loading panel
  until `PokiSDK.init()` settles, and `gameplayStart()` cannot fire before it. `init()` races
  an eight second timeout so a blocked SDK cannot strand anyone.
- **Frozen during a break.** Audio off, simulation halted, keyboard and pointer ignored, the
  whole page click-locked, `gameplayStop()` first.
- **Rewards need a real view.** In the Poki build an incomplete or blocked ad grants nothing.
  In the standalone builds there is no ad economy, so the optional unlocks are simply given.
- **A hidden tab is not gameplay** — `visibilitychange` closes the session and pauses.

`node tools/pokicheck.js poki/index.html` runs a built file against a mock SDK that records
call order and asserts all of the above.

## Saves

One `localStorage` key, `constraint.save.v1`: progress, best times, parts, ranks, the daily
streak, ghost recordings and your three builder slots.

In the artifact and Pages builds that is all it is — nothing leaves the browser. **On Poki it
does leave the browser.** Poki's SDK syncs ordinary `localStorage` entries to their cloud for
signed-in players, which is a feature (progress follows you between devices) but it does mean
ghosts and custom sheets are stored on Poki's side too. A key prefixed `poki_ignore` opts out
if that is ever not wanted.

What comes back out is treated as untrusted regardless: own keys only, so a `__proto__` key
cannot re-point the object, and every field coerced to the shape the game expects or dropped.
