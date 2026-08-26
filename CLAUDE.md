# CONSTRAINT — working notes

A 600-sheet browser precision platformer drawn as a CAD sketch, built for a
Poki.com submission. Single file, no dependencies, no build step at runtime.

This document is for someone picking the project up cold. It covers how the
thing is put together, which invariants matter, how to run the tests, and the
handful of traps that have already cost real time. Read the **Traps** section
before changing anything — several of them look like working code.

---

## 1. Layout, and which file is the source

The repo lives at **`/home/austin/constraint`** (WSL2). GitHub remote:
`fanaustinca/constraint`, branch `main`.

```
/home/austin/constraint/
  game.html            THE SOURCE. ~5800 lines: <style>, markup, one <script>.
  index.html           GENERATED. What GitHub Pages serves.
  poki/index.html      GENERATED. What gets uploaded to Poki.
  build/game.js        GENERATED, gitignored. The <script> body, for node.
  CLAUDE.md            this file
  README.md            player- and design-facing notes
  tools/               build + test scripts
```

**Edit `game.html` only.** `index.html` and `poki/index.html` are written by
`tools/build.js` and `tools/build-poki.js` from a single generator,
`tools/pokihtml.js`, and are **byte-identical to each other on purpose** — so
the public URL and the submission can never drift into being two different
games. `cmp index.html poki/index.html` must always pass.

### The three builds

| build | `POKI_BUILD` | SDK | `DEVCODE` | rev-code box |
|---|---|---|---|---|
| `game.html` (artifact/standalone) | `false` | none | `'AF010114'` | present |
| `index.html` (Pages) | `true` | Poki v2 | `null` | stripped |
| `poki/index.html` (submission) | `true` | Poki v2 | `null` | stripped |

`POKI_BUILD` is the switch for everything ad-related. When it is `false` there
is no ad economy, so unlocks are simply granted; when `true` the SDK is the only
way to earn one and a blocked ad must pay out nothing. Several behaviours branch
on it — check both sides when you touch that code.

### Rebuild after every change to `game.html`

```bash
node tools/extract.js && node tools/build.js && node tools/build-poki.js
```

`extract.js` must run before any harness-based tool, or you are testing the
previous version. This has produced more than one false "verified" in this
project's history.

---

## 2. Running the tests

```bash
node tools/stress.js                 # 5200+ checks, 21 phases   (fast)
node tools/stress.js --only edview   # one phase
node tools/stress.js --seed 7        # different seeded run
node tools/stress.js --deep          # longer
node tools/stress.js --file poki/index.html   # against a built file
node tools/pokicheck.js              # Poki SDK lifecycle, vs a mock SDK
node tools/pokicheck.js index.html   # (defaults to poki/index.html)
node tools/buildercheck.js           # builder palette and unlocks
node tools/bounds.js                 # no out-of-bounds frames, 153 sheets
node tools/solvability.js            # bot plays all 600 — SLOW, unseeded
node tools/lasttest.js               # just the final sheet   (run from tools/)
```

Cadence that works: run `stress`, `pokicheck`, `buildercheck` and `bounds` in
parallel; put `solvability` in the background; only run the full serial battery
before an actual submission.

The 21 `stress` phases, in run order:

```
load  fuzz  ui  codes  ghosts  daily  ranking  save  builder  cuts  marathon
spawnsafe  portals  respawn  intros  hud  platforms  eater  render  tasters  edview
```

Each starts from the same seed, so a failure in one is reproducible without
running the others.

`tools/harness.js` is the shared node sandbox — a stubbed DOM, a canvas proxy
that counts draw calls, and `run(code)` to evaluate inside the game's scope.
`stress.js` has its own richer sandbox and does not use it.

---

## 3. Traps

These are real, each one has already caused a bug or a false pass.

**1. `stress.js`'s `ok()` decides nothing.**

```js
function ok(phase,what){ checks++; }      // records a PASS. Tests nothing.
function bug(phase, what, detail){ ... }  // this is how a failure is reported
```

Writing `ok(condition, message)` type-checks fine, reads like an assertion, and
counts a pass whatever the condition was. The entire `edview` phase was written
that way and asserted **nothing at all** for its whole existence while reporting
thousands of clean checks. It now shadows `ok` locally with a real assertion:

```js
const ok=(c,m)=>{ if(c) pass('edview',m); else bug('edview',m); };
```

Every other phase uses the `ok(phase, msg)` / `bug(phase, msg)` convention
correctly. **If you add assertions, mutation-test them** — break the code
deliberately and confirm the test goes red. Do not trust a green run you have
not seen fail.

**2. A media query and a `vh` unit describe the window, not the box.**

On Poki the game runs in a container the site sizes. At 640×360 inside a taller
page, every `@media (max-height: …)` misses. Layout decisions are therefore made
in JS from a *measured* box (`edSpace()`), which sets classes on `<body>`
(`tightv`, `shortv`, `narrowv`, `sidep`, `building`) that the stylesheet reads.
This is the same fault that once drew the sheet stretched after an ad break.
**Never reintroduce a size-based media query for layout.**

**3. `typeof` does not protect against a temporal dead zone.**

`fit()` runs at load, above several `let`/`const` declarations. `typeof ED !==
'undefined'` still throws if `ED` is in its TDZ. Use `try{ … }catch(e){}`.
Two shipped-black-page bugs came from this.

**4. `solvability.js` uses an unseeded bot.** Results churn between roughly
595 and 598 of 600 run to run. Only a *consistent* failure is signal.

**5. There is no canvas backend or headless browser on this machine.** Every
visual claim in this repo's history was verified numerically, never seen. Layout
geometry can be computed and asserted; *appearance* cannot. Say so rather than
implying otherwise.

**6. `stress.js` ignores bare arguments.** `node tools/stress.js edview` runs
everything. The phase filter is `--only edview`.

---

## 4. Game systems

### Constants

```
COLS=96  ROWS=18  TS=24          a sheet is 96×18 tiles of 24px
VCOLS=32 VW=768   VH=432         the play viewport is always 32×18
CW=16    PW=14    PH=18          player collision box
GRAV=0.62                        BUILD_AT=1  (sheets cleared before the builder opens)
```

Play is **always** 32 columns by 18 rows. The builder is not — see §7.

### Level data

`LEVELS` is 600 entries of `{w, name, chunks}` (trials also carry `rank`).
`chunks` is a list of named generator pieces (`"st"`, `"stair"`, `"gap"`,
`"float"`, `"mesa"`, `"ex"` …) assembled by `loadLevel(i)` into `G.grid0`.
Sheets are generated from these recipes, not stored as tile maps.

`WORLDS` is 41 entries of `{act, code, name, hint, ab}` where `ab` is the
ability set for that world: `{dj, wall, inv, dash}`.

### Act structure

| act | sheets | worlds |
|---|---|---|
| 1 | 40 | FIXED OFFSET TANGENT MIRROR DRIVEN |
| 2 | 40 | REBUILD SUPPRESSED UNDER-DEF ASSOCIATIVE TOLERANCE |
| 3 | 24 | FLATTENED PROJECTION SILHOUETTE |
| 4 | 24 | EXTRUDED ISOMETRIC SECTION |
| 5 | 24 | SYSTEM32 FRAGMENT RECOVERY |
| 6 | 1 | AUTHORED |
| 7 | 80 | ORBIT VACUUM TIDE APOGEE — *space* |
| 8 | 80 | THRESHOLD PAIRED RECURSION EXIT — *portals* |
| 9 | 80 | SYNTAX COMPILE RUNTIME DEPLOY — *code* |
| 10 | 80 | DAWN GLARE NOON WHITEOUT — *whiteout* |
| 11 | 80 | FROST THAW BLIZZARD DEEPFREEZE — *winter* |
| 12 | 47 | TRIAL — the ranking ladder, hidden unless `SAVE.dev` |

Acts 1–6 are the story road (153 sheets). Acts 7–11 are the **side worlds**
(400 sheets, four sets of twenty each). Act 12 is the ranking test.

`ACTSTART = {1:0, 2:40, 3:80, 4:104, 5:128, 6:152, 7:153, 8:233, 9:313,
10:393, 11:473, 12:0}` — 0-based first sheet of each act.

### Modifiers

`G.mod` per world changes physics and rendering: `gravity`, `accel`, `drift`,
`chaos`, `phase`, `weather`, `winter`, `cold`, `livedraw`, `allparts`,
`nodatum`, and `render` (`flat` / `glitch` / `code` / `light`). `G.rmode`
selects the renderer. A code-world sheet draws itself as its own source, which
is why there is a `render` stress phase checking no tile falls through to a
generic block there.

### Tiles

26 palette entries, `PALETTE[ch, name, desc]`:
`#` solid, `S` polished, `I` ice, `n` snow, `=` thin, `~` crumbling,
`M`/`H` moving platforms, `u` unstable, `^`/`v` spikes, `w` powder, `B` spring,
`W` updraft, `G` mirror pad, `p`/`q` portals, `T`/`t` phase, `K` key, `D` door,
`o` part, `C` datum, `P` spawn, `X` exit, `.` erase.

---

## 5. Progression — the part most likely to be got wrong

`SAVE.unlocked` is **one number walking all 600 sheets in order**. That is right
for the acts and wrong for anything beside them.

- **The road (acts 1–6, 12):** a sheet is open when `i+1 <= SAVE.unlocked`.
  `win()` raises it, but *only if you were already on the road*:

  ```js
  if(i+1<=SAVE.unlocked) SAVE.unlocked=Math.max(SAVE.unlocked, Math.min(600, i+2));
  ```

  The guard exists because sheet 314 is the first Code sheet — without it,
  clearing a taster would open every act in front of it.

- **The side worlds (acts 7–11):** their own chain, read from what you have
  *cleared*, never from the counter. `sideOpen(i)` returns true if `i` is a
  taster, or if the sheet before it **in the same act** has been cleared or
  skipped. The chain stops dead at the act edge.

- **Tasters:** the first sheet of each of the five side acts (0-based 153, 233,
  313, 393, 473) is open on a fresh save, so a player can see what Space or Code
  *is* without walking the whole road first.

- `sheetOpen(i)` is the single entry point: `i+1<=SAVE.unlocked || sideOpen(i)`.

The picker lists **all twenty** side-world sets, locked ones included — hiding
unreached ones made Space look like twenty sheets rather than eighty.

The `tasters` stress phase holds all of this: each act reachable to its end
across four sets, no spill past the act edge, the road still moving on
`SAVE.unlocked` alone.

---

## 6. Ads and the Poki SDK

All of it lives in the `ADS` object (`game.html` ~line 1840).

**Lifecycle rules Poki checks for**, all asserted in `pokicheck.js`:

- `PokiSDK.init()` before anything; `ADS.init()` polls for `window.PokiSDK` for
  ~3s (via `setTimeout` recursion — `setInterval` does not exist in the
  sandboxes) and logs diagnostics to the console in the Poki build.
- `gameLoadingFinished()` once, when loading is done.
- `gameplayStart()` **from player interaction**, `gameplayStop()` at the end.
  The main loop derives this from state, so a pause, a tab switch and an ad
  break each close the session:
  ```js
  const live = (G.state==='play' && !ADS.inAd);
  if(live!==ADS.playing){ live ? ADS.playStart() : ADS.playStop(); }
  ```
- `gameplayStop()` before every ad. No input, audio or simulation while one is
  up (`ADS.lock(true)` sets `body.adlock`, kills input and audio).

**Frequency.** Poki caps ads itself; on top of that there is a floor of
`ADS.GAP = 5 minutes`, checked at the end of a sheet. This is a *retention*
decision, not a fix for broken capping. A refused break still walks the player
straight on and asks the SDK for nothing. A rewarded video pushes the next
break back too.

**Rewards.** Every video is opt-in behind a prompt (`askAd`) that names the
price out loud — the shipped build appends "A short video ad plays first." to
the prompt and labels the button "🎬 Watch a video". Nothing starts a video
without that prompt; `pokicheck` has a phase asserting exactly that.

```js
if(!window.PokiSDK){ then(!POKI_BUILD); return; }   // blocked ad pays out nothing when shipped
```

**Remix economy.** Remixing is bought one sheet at a time (`SAVE.unl.lr[i]`).
`SAVE.unl.wr[world]` is legacy — a whole set bought under an older rule — and is
still honoured but never written. Clearing a sheet makes it *eligible*, never
opens it; the card tag names the price (`▸ video to open`, or `▸ open in
builder` in the artifact) and an owned one says `✓ unlocked`. `pokicheck`'s
`remix` phase clears forty sheets and asserts none of them became owned.

---

## 7. The builder viewport — the most-revised code in the project

Play is a fixed 32×18. The builder has no such contract: it must fit a title
strip, a sheet worth drawing on, and a menu worth using into whatever box it is
handed, down to 640×360.

```
edSpace()          measures the real box (never the window)
edDensity(w,h)     sets body classes from it: tightv (h<=430), shortv (h<=560),
                   narrowv (w<=560), building (G.state==='edit')
edLayout(bw,bh)    decides WHERE the panel goes and what the sheet gets
edView()           → EDVW/EDVH, how much of the sheet is visible, in world units
fit()              sizes the stage box and the canvas; runs on resize,
                   orientationchange, a ResizeObserver on .sheet, and on
                   entering/leaving the builder
setBacking(cssW…)  sizes the canvas backing store
edFillPanel(h)     grows a bottom panel into the band under the sheet (-1 = side)
clampCam()         bounds G.cam / G.camY
edTile(e)          turns a click back into a column — must invert drawEditor exactly
```

**`edLayout` is the key idea.** The panel has to come out of one axis or the
other, and which one is not a matter of taste. On 1920×1080 a 400px bottom strip
costs 37% of the height and draws the sheet at 1.47×; a 380px right-hand column
costs 20% of the width and draws it at 2.01×. It computes both and keeps
whichever draws the sheet bigger, so the panel becomes a **side column**
(`body.sidep`) on wide boxes and a **bottom strip** otherwise.

**Tight boxes** (`h <= 430`): the menu collapses to a single sideways-scrolling
row — palette, theme, pan, save, test all on one strip — costing a flat
`TIGHTROW = 58`px, and the tile floor drops from `MINTILE = 20` to
`TIGHTTILE = 12` so the whole 18-row sheet fits rather than eight rows of it.

Measured results (all show 18/18 rows and 32/32 columns):

```
box          panel        stage box    dead margin
640x360      bottom 58px  455x256      185px  (forced: 32×18 at 640 wide needs all 360)
740x360      side  240px  500x281      0px
1280x720     side  307px  973x547      0px
1920x1080    side  380px  1540x866     0px
412x915      bottom 400px 412x360      0px    (portrait: 20.6 of 32 cols, pans)
```

**No feedback loops.** `edView()` must never measure the panel: the panel is
about to be grown to fill what the sheet leaves over, so a size derived from
measuring it would chase itself. `edPanelBudget()` is a pure function of the box
height, and `edFillPanel` writes `minHeight` only on change.

**Canvas resolution.** The backing store is sized from the box actually on
screen, `cssW * devicePixelRatio`, bounded at `MAXBACK = 2560` device pixels
across. It is bounded by a *pixel count*, not by clamping the ratio — clamping
the ratio to 2 undersamples a dpr-3 phone. Before this it was a flat
`768 * dpr`, stretched over whatever width the box was, which is why it looked
pixelated on a monitor.

**The key strip** (`.cmd`) is the only place a keyboard player is told the
controls, including double jump — the intro card shows once ever. It must never
be hidden for the box being small; it hides for the *builder* only
(`body.building`). `pokicheck` parses the built stylesheet and asserts no rule
hides `.cmd` for `tightv`/`shortv`/`narrowv`.

---

## 8. Save format

`localStorage['constraint.save.v1']`, one JSON object:

```
unlocked  number, 1..600      best     {sheet: seconds}
parts     {sheet: count}      skipped  {sheet: 1}
cuts      {gate: 1}           rank     0..64
daily     {…} or null         ghosts   {key: {t, d}}  (max 24, 4200 chars each)
dev       0|1                 mute     bool
unl       {th:{}, wr:{}, lr:{}}   builds  {name: string}   seen  {featureKey: 1}
```

**Everything out of `localStorage` is treated as hostile** — it is the one input
another script on the origin could have written, and parts of it are
concatenated into the sheet list as markup. `loadSave()` copies own keys only
(never `Object.assign`, which routes through `[[Set]]` and would let a JSON
`__proto__` re-point the prototype), skips `__proto__` explicitly, and coerces
every field through `numMap` / `strMap` / `flagMap`, dropping anything that will
not coerce. The `save` stress phase covers this — keep it that way.

Poki writes a signed-in player's cloud save into `localStorage` during `init()`,
so `loadSave()` is called **again** after the SDK initialises; the first read can
be a stale local copy.

---

## 9. Other systems, briefly

- **Intro cards** (`showIntro`, `INTROS`, 29 keys): anything new on a sheet gets
  a card, once ever, max 5 at a time. `G.state='intro'` is not `'play'`, so the
  clock, the simulation and the Poki gameplay session all wait. Never during the
  ranking test — that is meant to be met cold.
- **Ranking test** (`TEST`, `startTest`): drops you into trial 24 of 47 and
  binary-searches on whether you clear each one. Result is `SAVE.rank` 0..64.
- **Daily** (`playDaily`, `G.lvl === -2`): a date-seeded sheet, recorded in
  `SAVE.daily`.
- **Ghosts**: best-run replays, capped at 24 stored.
- **Cutscenes** (`startCut`, gates at sheets 40/80/104/128/152/153).
- **World eater** (`stepEater`): the cursor that consumes the sheet; the `eater`
  stress phase checks it can reach every tile, moving platforms included.
- **Builder** (`openBuild`, `ED`): opens after `BUILD_AT` sheets. Custom sheets
  are `G.lvl < 0` and record no progress.

---

## 10. Where each build goes

Three destinations, two of them the same bytes. Nothing here is uploaded
automatically — Pages follows a `git push`, the other two are manual.

| destination | file | how it gets there |
|---|---|---|
| **Poki submission** | `/home/austin/constraint/poki/index.html` | **upload this file by hand** in the Poki developer dashboard |
| **GitHub Pages** | `/home/austin/constraint/index.html` | `git push` — Pages serves repo root on `main` |
| **Claude artifact** | `/home/austin/constraint/game.html` | published via the Artifact tool |

**The Poki upload is a single self-contained HTML file.** No folder, no assets,
no `build/`, no `tools/` — everything is inline except the SDK, which is pulled
from `https://game-cdn.poki.com/scripts/v2/poki-sdk.js`. That CDN script tag is
the only external request the game makes.

`poki/` holds nothing else, so uploading that directory and uploading the one
file are the same thing. Never upload the repo root — it carries `game.html`,
`tools/`, and `README.md`, none of which belong in a submission.

**Test on Pages, not on `file://`.** https://fanaustinca.github.io/constraint/
is byte-identical to `poki/index.html`, so it is the submission. Opening
`poki/index.html` from `file://` renders the game but the SDK will not load, so
nothing ad-related is real there. Point the Poki Inspector at the Pages URL.

That identity is recent and was bought the hard way. Until `8f499fa` the
repo-root `index.html` was the *standalone* build — no SDK, `POKI_BUILD` false,
its own document shell — so the public URL exercised the one half of the code
that could not reproduce an SDK complaint at all. `tools/pokihtml.js` now
writes both files from one generator, and `cmp` is what proves it. If `cmp`
ever reports a difference, stop and fix the generator; do not hand-edit either
output.

From Windows the tree is at `\\wsl$\<distro>\home\austin\constraint` —
useful for dragging `poki\index.html` into the Poki dashboard's file picker.

After any change: rebuild, confirm the two are identical, push, and wait for
Pages to actually serve the new bytes before retesting.

```bash
cd /home/austin/constraint
node tools/build.js && node tools/build-poki.js   # both read game.html directly
cmp index.html poki/index.html                   # must be silent
node tools/extract.js                            # only the node tests need this
git add -A && git commit -m "…" && git push
# then confirm Pages has caught up (it lags a minute or two):
until curl -s https://fanaustinca.github.io/constraint/ -o /tmp/live.html \
      && cmp -s /tmp/live.html index.html; do sleep 15; done; echo served
```

A cached copy is indistinguishable from an unfixed one — **hard-refresh**
(Ctrl+Shift+R) when retesting, and say so to whoever else is testing.

## 11. State of play

Green at last check: `stress` 5243/0, `pokicheck` all clear on both builds,
`buildercheck` all clear, `bounds` 0 out-of-bounds frames across 153 sheets.

### Known open items

1. **Sheet 4 (FIXED / "Chamfer") fails the solvability bot on every single
   run.** The bot is unseeded so the rest of its output churns 595–598/600, but
   this one is consistent and is the only real signal in that tool. Not
   investigated. Worth a look before submission.
2. **Winter's taster** — the original design named only Space, Portals, Code and
   Whiteout; all five side acts currently get one. Never resolved either way.
3. **Nothing visual has ever been looked at.** No canvas backend, no headless
   browser. The one-row tight menu and the side column are new *arrangements*
   whose geometry is asserted but whose appearance is unverified. If you can
   open a browser, that is the highest-value thing you can do here.

### Recent history

```
57cf911  Keep the key strip on a short box
d22e939  Take the menu out of the axis that costs the sheet least
018d566  Say what the remix costs, not what it gives
9ce574b  Measure the box, not the window, and fill the pixels it has
7a46c02  Give a landscape phone its sheet back
3a1ea68  Walk the side worlds as their own chain
c867060  Five minutes between breaks, not every sheet
```

### Before submitting

```bash
node tools/extract.js && node tools/build.js && node tools/build-poki.js
cmp index.html poki/index.html          # must be silent
node tools/stress.js && node tools/pokicheck.js && \
node tools/pokicheck.js index.html && node tools/buildercheck.js && node tools/bounds.js
node tools/solvability.js               # slow; expect 595-598/600, sheet 4 always
```

Then open the Pages URL in the Poki Inspector and walk the SDK checklist by
hand. The lifecycle is asserted against a *mock* SDK; only a real one proves it.
