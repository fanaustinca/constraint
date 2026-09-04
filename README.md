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
| TRIALS | 554–600 | a 47-rung difficulty ladder used by the ranking test, no parts to collect |

The sheet list carries these under an **EXTRA WORLDS** heading — all twenty sets, locked
ones included, so you can see that Space is eighty sheets rather than twenty. The first
sheet of each type — Apoapsis, Threshold, Syntax, Dawn, First Frost — is open on a fresh
save. The acts are a long road, and someone who wants to know what Space or Code actually
*is* should not have to walk all of it first.

From there a side world is its own chain: a sheet opens when the one before it in the same
type has been cleared or skipped, and the chain stops dead at the edge of that type.
`SAVE.unlocked` is a single number walking all 600 sheets in order, which is right for the
acts and wrong for anything beside them — raising it from sheet 314 would hand you every
act in front of it. So clearing a side sheet never touches that number, and clearing an act
sheet never opens a side one.

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
artifact platform supplies those. `index.html` and `crazygames/index.html` are both generated
from it, and are **byte-identical**: the build GitHub Pages serves is the build submitted to
CrazyGames, SDK and all. Testing something other than what you ship is how a problem stays
hidden until the reviewer finds it. **Edit `game.html`, never the generated files.**

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
node tools/crazycheck.js crazygames/index.html   # SDK lifecycle and ad rules
node tools/buildercheck.js                       # share codes, remixing, themes
node tools/stress.js                             # everything else, see below
```

`tools/browsercheck.js` runs the game in headless Chrome — the CrazyGames submission checklist
in twelve phases, 333 assertions, with the SDK intercepted by a mock that records every
lifecycle call in order. It checks what a node sandbox cannot: that the simulation really
freezes and the audio really goes off while an ad is up, that a real key press cannot cut
one short, that a real tab switch closes the gameplay session, that the page never scrolls
on space or the cursor keys, and that every layout from 640x360 to a portrait phone puts
the whole sheet on screen with the controls somewhere a thumb can reach. `--shots DIR`
writes a screenshot of each one.

`tools/stress.js` drives the whole game from a seeded PRNG — including the game's
own `Math.random` — so anything it finds replays exactly with `--seed N`. Twenty
phases: every sheet loads with a spawn, an exit and a sane grid; random input
against sheets with invariants checked every frame; random clicks through every
menu; hostile share codes; ghost round trips; daily determinism; the ranking search
terminating; the save surviving garbage; the builder's resize and paint; every
interlude ending by key and by tap; sheets played back to back watching for leaks;
portals not crossing or bouncing; no start or datum that can kill you while you
stand still; no moving platform that can post you inside the geometry; the world
eater able to reach every tile on its sheet rather than only the solid ones — moving and
unstable platforms included, which are objects with a path rather than tiles and so used to
slide past the sweep entirely; no tile falling through to a generic block in a code world;
and the side worlds — every one of the twenty listed, each type walking its own eighty
sheets to the end and stopping there, without ever moving the main road; and the
builder's viewport being recut for the screen — ten shapes from a 360px landscape box to
a desktop, each as the standalone page and as the embed — without a click ever landing on a
tile other than the one it points at, with the whole sheet on screen wherever it fits and
the menu always taking whichever axis costs the sheet least.

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
Paint a sheet from a 26-tile palette — each swatch is drawn the way the sheet itself draws
that tile, with its name and its rule underneath — size it 32–1088 columns, keep three save
slots, and test-play it in place. A **View** row pans the camera — hold ◀ ▶ to scroll, click
to jump a screen, or go straight to Start or End — because arrow keys are no use on a phone
and the on-screen pads sit underneath the panel.

Play is always a 32×18 window; the builder is not. Holding it to one is what gave a phone in
portrait eighteen rows inside 232px — a 13px tile, too small to aim at. The editor instead
works out the largest tile the space affords and, below **20px**, stops shrinking and starts
cropping: it keeps the tiles legible, shows less of the sheet, and pans to reach the rest on
either axis. A tall phone gets about 21 columns and all 18 rows; a landscape phone gets all
32 columns and pans down. The **View** row grows ▲▼ buttons exactly when there is something
above or below to reach. The stage sits against the top in the builder, since one centred in the full height puts its
lower half behind the panel, and the panel then grows *upward* to meet it — on a tall phone
the level is already as big as the 20px floor allows, so the band under it was simply wasted.

That last part is why the panel's height is never measured to decide the level's size: the
level is sized from the window and a fixed budget instead. Measure the panel and the two
chase each other — the level shrinks because the panel grew because the level shrank. Pausing a sheet you built offers **Back to the builder**
rather than the sheet list.

Three of the palette entries are not tiles but objects with a path: **Platform ↕** and
**Platform ↔** slide as far as the clear space around them allows — a platform boxed in
on both sides quietly becomes the ledge it looks like — and **Unstable** bobs on the spot
and sags under your weight. A horizontal run of the same mark makes one wider platform.
Remixing an official sheet brings its platforms across as these marks.

**Remix** opens an official sheet's geometry in the editor to take apart, one sheet per video —
you want the sheet you liked, not the other seventy-nine in its set. Sets bought outright under
the older whole-world rule still count, so nothing already paid for is lost. **Themes** re-skin
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

On a touch device the on-screen pad appears automatically: left, right, dash and jump as
drawn glyphs, and a pause control at the top right. The key list and the dash button both
hide themselves on sheets where dash is not yours yet.

Where the screen is tall enough to have room to spare — a phone or a tablet held upright —
the pads do not sit on the sheet at all. The sheet is placed in the upper part of the
screen and the pads take the band underneath it: eyes up, thumbs down, and nothing covering
the drawing you are reading. A phone held sideways has no room to spare, so there the pads
overlay the sheet as before, low and to the outside.

## Introductions

Every sheet is scanned on load for the things it contains — abilities, tile types, hazards,
world modifiers — and anything the player has not met before gets a card at the start of the
sheet, once ever. Twenty-two cards across a full run, the first on sheet 1 and the last on
534. The card is not gameplay: the clock, the simulation and CrazyGames' gameplay session all
wait behind it. The ranking test never shows one, because it is meant to be met cold.

## Builds

Two targets come out of the one source, from one generator in `tools/crazyhtml.js`
so they cannot drift apart:

```bash
node tools/build.js        # game.html -> index.html             (GitHub Pages)
node tools/build-crazy.js  # game.html -> crazygames/index.html  (upload this folder)
```

Both are the CrazyGames build: document shell added, dev code and the rev-code box stripped,
the CrazyGames SDK loaded, full-screen embed layout. They are the only builds that request
anything from another origin, and `cmp index.html crazygames/index.html` must report no
difference.

The Claude artifact runs `game.html` directly, so it is the one place the game exists with
`CRAZY_BUILD=false` — no SDK, no ad economy, and the optional unlocks simply granted.

In the CrazyGames build every SDK milestone is stamped to the browser console with a timing —
SDK found, `init()` called, resolved or rejected, `game.loadingStart()`, `game.loadingStop()`,
`game.gameplayStart()`, `game.gameplayStop()`.

Ad handling follows CrazyGames' lifecycle rules, with one schedule of our own on top:

- **Five minutes between ads, at least.** CrazyGames' `ad.requestAd('midgame', …)` plays
  whenever it is asked, with no capping of its own — so `ADS.GAP` is the only thing standing
  between a break and every clean sheet transition. A sheet can be forty seconds long, and an
  interstitial every forty seconds is not a game anyone stays in. A break asked for too soon is
  refused outright and the player walks straight on, and the SDK is not troubled. Over half an
  hour of forty-second sheets that is 5 breaks rather than 45. A rewarded video the player chose
  also pushes the next ad back — it is still a video they just watched.
- **Only back into gameplay.** An ad is never requested on the way to a menu, a daily
  summary, the builder, or an interlude — `nextLevel()` resolves the destination first.
- **`game.loadingStop()` before anything else.** The menu stays behind a loading panel
  until `CrazyGames.SDK.init()` settles, and `gameplayStart()` cannot fire before it. `init()`
  races an eight second timeout so a blocked SDK cannot strand anyone.
- **Frozen during a break.** Audio off, simulation halted, keyboard and pointer ignored, the
  whole page click-locked, `gameplayStop()` first.
- **Every reward is asked for first.** No video ever starts off a bare click: Skip and both
  optional unlocks raise a prompt that names what you get and says plainly that a short video
  ad plays first. Declining costs nothing and returns you where you were.
- **Rewards need a real view.** In the CrazyGames build, `ad.requestAd('rewarded', …)` calling
  `adError` instead of `adFinished` grants nothing. In the standalone builds there is no ad
  economy, so the optional unlocks are simply given.
- **A hidden tab is not gameplay** — `visibilitychange` closes the session and pauses.

`node tools/crazycheck.js crazygames/index.html` runs a built file against a mock SDK that
records call order and asserts all of the above.

## Saves

Progress lives in this browser, on this device, and nowhere else. There is no account and
nothing is sent anywhere. The game says so on the Controls page and again beside *Erase
progress* in the sheet list, so nobody has to guess where their sheets went. Clearing your
browser's site data clears them too, and a private window keeps nothing once it closes.

One `localStorage` key, `constraint.save.v1`: progress, best times, parts, ranks, the daily
streak, ghost recordings and your three builder slots.

That is all it is in every build, CrazyGames included — nothing leaves the browser. Unlike
Poki, CrazyGames does not mirror plain `localStorage` to a signed-in player's account on its
own; that needs the separate `CrazyGames.SDK.data` API, which this build does not use. Cross-
device sync is therefore a known gap versus the old Poki build, not a regression introduced
by this one — the save behaves identically to the artifact and Pages builds everywhere.

What comes back out is treated as untrusted regardless: own keys only, so a `__proto__` key
cannot re-point the object, and every field coerced to the shape the game expects or dropped.
