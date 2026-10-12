# PLUSH PANIC: engine and level API

An online party brawler for the portfolio (`#/plush`). Squishy plush toys ("Stitchlings") meet in the Loft,
then play a Show: short rounds that shrink the field until one toy wins the crown. This folder holds the
whole game. It is lazy-loaded on its route, and Rapier physics loads only when a game starts.

You can add a level **without reading the engine**. Write one module, register it, and you're done. This
document covers everything a level can see and do, then gives a worked example.

```
plush/
  Plush.tsx          page: menu, stage, Quick Play / Show / online launch
  Hud.tsx            in-game overlay (React): cards, timer, trick bar, gallery, Loft panel, results
  Forms.tsx          your toy (name, kind, tint) and Show settings
  levels/
    index.ts         the registry (LEVELS)
    loft.ts          the hub (type 'hub'): runs the four hidden games and the corners below
    loft/            the Loft's parts: zones.ts (four corners), atmos.ts (god-rays, motes, string lights,
                     notice board, Sewing Table podium and mirror), ambience.ts (zone sound), station.ts
                     (queues), freeze.ts vine.ts bowling.ts claw.ts (hidden games), records.ts (high scores),
                     kit.ts (batching, cached canvas textures), layout.ts (where things stand), ui.ts
    cookie-cutter.ts logic: trace a biscuit (free pointer, seated toys, lots of tricks)
    music-box.ts     survival: move while the music plays (synced phases, WebAudio, a key pickup)
    top-sumo.ts      survival: ride balls on a shrinking stool (ball mode, custom hazard, shrinking floor)
    yarn-tug.ts      team: tug of war on the beat, best of three (seated toys, animOverride, side camera)
    pillow-fort.ts   team: tear down their cushion fort, steal the flag (grabbable walls, throws, rebuild)
    tidy-up.ts       team: carry toys to your basket, push big ones over your line (live-count scoring)
    sock-hoops.ts    team: basketball with a sock (aimed throws, passes, dunks, blocks, moving hoops)
    egg-hunt.ts      team: search plants for eggs, carry them home, decoys pop (pooled props)
    team-kit.ts      shared helpers for the team pack (textures, baskets, carrying bots, throws)
    robo-vac.example.ts  the worked example below (compiles, not registered)
  board/             Toy Box Trail, the board mode (see "Game modes and duels" below)
    trail.ts         the rules: turns, dice, tiles, items, cards, duels, bots, sync, camera (a LevelDef)
    layout.ts        the board graph: tiles, forks, ladder, slide (pure data, also drawn by the mini-map)
    items.ts         the bag of tricks and the surprise deck (pure data)
    view.ts          the visuals: canvas-painted cards, mirror pond, ladder, slide, cookie jar, foam dice
    TrailPanel.tsx   its HUD panel: turn, timer, dice, players, bag, choices, mini-map, turn log
  engine/
    types.ts         THE LEVEL API: LevelDef, LevelCtx, TrickDef, Contestant, FxApi, LevelHud
    game.ts          the engine: renderer, rounds, Show flow, online sync, HUD state, test hooks
    toy.ts           a toy's body and moves (Pad, run/jump/dive/grab/shove, stun)
    rig.ts           a toy's visuals (animation, tint, squash, attachment API for cosmetics)
    physics.ts       Rapier loader + Phys helpers (box, cylinder, trimesh, walls, raycasts)
    hazards.ts       shared hazards (rotating bar, pusher, falling tiles, shrinking disc, conveyor, bouncy pad)
    sabotage.ts      tricks, costs, grudges, Bubble Wrap, peanut gallery, bot sabotage
    show.ts          Show planner, round sizes, awards, buttons, saved profile
    helpers.ts       attic backdrop, spawn layouts, signs, timers
    bots.ts          bot steering helpers
    camera.ts        chase / overhead / fixed camera rig with collision and shake
    input.ts audio.ts fx.ts rng.ts net.ts assets.ts
  wardrobe/
    catalog.ts       the Sewing Table's items: ten slots, rarities, prices, unlocks (pure data)
    fit.ts           measures each toy kind's head, face, back, hands and feet from its skinned mesh
    dress.ts         builds and attaches an outfit (model cosmetics + primitives), fabric patterns, trails
    store.ts         what this browser owns and has earned
    Wardrobe.tsx     the Sewing Table drawer (try on, buy, wear)
```

## Adding a level in five steps

1. Copy `levels/robo-vac.example.ts` to `levels/<your-id>.ts` and rename it.
2. Fill in `build` (colliders and visuals), `init` (state), `spawn`, `tick` (rules), `bot`, `pack`/`unpack`
   (what clients need) and `visual` (draw from state).
3. Declare `tricks` (and maybe `throwables`, `canThrow`, `onThrow`).
4. Add it to `LEVELS` in `levels/index.ts`. The Show planner and Quick Play pick it up from there.
5. Test it: `npm run build`, open `/?snap#/plush?auto=loft`, then in the console call
   `__plush.forceRound('<your-id>'); __plush.simulate(30); __plush.debug()`.

Rules of thumb:

- **Only `ctx.rng` in `build` and `init`.** Every screen builds the level from the same seed, so layouts
  match without being sent. Never use `Math.random()` there.
- **The host owns the rules.** `tick`, `bot`, tricks' `apply`, `onFall`, `onTimeUp`, `onThrow` and `retry`
  run only on the host (or in solo). Clients get your state through `pack`/`unpack`.
- **Draw from state.** `visual` runs on every screen, every frame. Move meshes to match the state there.
  Effects from `visual`/`onEvent` go through `ctx.fxLocal`, because each screen runs them itself. Effects from
  host code go through `ctx.fx`, which mirrors them to clients.
- **Mutate state in place.** The engine keeps the object `init` returned. `unpack` should overwrite its fields
  rather than replace it.
- **Units**: metres and seconds. Y is up. A toy is about 1 m tall. Yaw 0 faces +Z, and forward is
  `(sin yaw, cos yaw)`.

## Lifecycle

| Hook | Where it runs | When |
| --- | --- | --- |
| `build(ctx)` | every screen | the round is created: colliders and static visuals |
| `init(ctx) → state` | every screen | after the toys exist (`ctx.toys` is filled but not placed) |
| `spawn(ctx, s, toy, i, n) → Spawn` | every screen | place toy *i* of *n* (feet position + yaw) |
| `setup(ctx, s)` | every screen | after spawning: seats, body modes |
| `start(ctx, s)` | host | the countdown ends |
| `tick(ctx, s, dt)` | host, 60 Hz | during play: the rules |
| `bot(ctx, s, toy, dt)` | host, 60 Hz | per bot: write `toy.pad` |
| `visual(ctx, s, dt)` | every screen, every frame | animate from state |
| `pack(ctx, s)` / `unpack(ctx, s, data)` | host / clients | ~20 Hz snapshot of your state |
| `onEvent(ctx, s, data)` | every screen | after `ctx.emit(data)` on the host |
| `rank(ctx, s) → Toy[]` | host (and HUD) | active toys best first: the leader, timeouts, Quick Play placings |
| `onTimeUp(ctx, s)` | host | the round timer runs out |
| `onFall(ctx, s, toy)` | host | a toy drops below `fallY` |
| `retry(ctx, s, toy, reason)` | host | Quick Play: what `ctx.fail()` does instead of eliminating |
| `hud(ctx, s, me) → LevelHud` | every screen | meters, status pill, prompt, chips |
| `cameraUpdate(ctx, s, cam, dt) → boolean` | every screen | place the camera yourself (return true) |
| `pointerHome` / `pick` | every screen | free-pointer levels: where the stick needle starts, which rival a click picks |
| `canThrow` / `onThrow` | host | peanut-gallery throwables |
| `dispose(ctx, s)` | every screen | free anything not under `ctx.root` |
| `onAction(ctx, s, toy, text, c)` | host | a player's choice from a level's own panel (`game.levelAction`) |
| `onDuelEnd(ctx, s, result)` | host | a duel this level started with `ctx.startDuel` is over |
| `results(ctx, s)` | host | a game mode's final placings (instead of the Show / Quick Play results) |

Round phases: `intro` (4.5 s card + fly-round) → `countdown` (3 s) → `play` (`duration` s) → `end` (4 s
summary). In the Loft, the phase stays at `play`. `ctx.time` is negative during the countdown and counts up
from 0 during play.

## LevelDef: what a level declares

```ts
defineLevel<State>({
  id, name, type,           // type: 'race' | 'survival' | 'team' | 'logic' | 'final' | 'hidden' | 'hub'
  blurb, howTo: string[],   // intro card
  accent: '#hex',
  players: [min, max],
  duration: 90,             // seconds
  canBeFinal?: true,        // a survival level that can crown a winner if no 'final' level fits
  bodyMode?: 'walk' | 'ball' | 'seated',
  runSpeed?: 5.6,           // top speed (m/s) for this level
  pointer?: 'look' | 'free',// 'free' keeps the mouse visible (tracing, clicking plates)
  pointerPlaneY?: 0,        // height of the plane the free pointer is projected onto
  camera?: { kind: 'chase', dist, height } | { kind: 'overhead', height, back } | { kind: 'fixed', pos, look },
  introOrbit?: { radius: 15, height: 9, center?: [x, y, z] },  // the fly-round behind the intro card
  sprinkles?: { start: 1, name?: 'Sprinkles' },
  tricks?: TrickDef<State>[],
  throwables?: ['crumb', 'paper', 'feather'],
  fallY?: -8,
  keepFailed?: false,       // leave eliminated toys in the scene (Cookie Cutter's slumped losers)
  sky?: { color, fogNear, fogFar },
  duel?: false | { seconds?: 30 },  // as a board duel / mini-game: opt out, or set its length
  ...hooks
})
```

### How a round ends (Show mode)

- `ctx.qualify(toy)` puts a toy through, and `ctx.fail(toy, reason)` knocks it out. Failed toys join the peanut gallery.
- The engine ends the round when `qualifiedCount >= target`, or when `qualified + active <= target` (enough
  have dropped out: everyone still standing goes through), or when you call `ctx.end()`.
- When time runs out, `onTimeUp` runs if you define it. Otherwise, survival levels put every active toy
  through (in a final, the top of `rank()` wins), and other types fill the remaining places by `rank()`.
- In a final, `target` is 1. The winner gets the crown, which is attached to the head bone.
- Quick Play has no eliminations. `fail()` calls your `retry()`, and the round ends on the timer or when
  everyone has qualified.
- Team levels (below) end with `ctx.winTeam(team)` instead: in a Show the losing team is eliminated.

## Team levels

Round 3 of a Show is drawn from the `team` and `logic` types. A team level sets `teams` and the engine does the
rest of the bookkeeping:

```ts
defineLevel<State>({
  id: 'yarn-tug', type: 'team',
  teams: {
    names: ['Purl', 'Knit'], colors: ['#e11d48', '#0ea5e9'], // default: Buttons (red) and Bobbins (blue)
    scoreName: 'sets',                                     // what the HUD calls the score
    friendlyFire: { shove: false, dive: false, grab: true }, // the default; `true` turns everything on
  },
  ...
})
```

- **Teams**: the host splits the field into two balanced random teams (people spread across both sides first,
  sizes differ by at most one) and sends them with the round, so every screen agrees. `toy.team` is 0 or 1
  (-1 in levels without teams) and is set before `init`/`spawn`, so you can lay teams out by side.
- **Looks**: each toy keeps its own tint but wears a team sash, its foot ring and name tag turn the team colour,
  and the intro card says which team you are on. `toy.animOverride` (any rig animation) lets a level pose toys,
  e.g. holding a rope; set it from `visual()` so every screen agrees.
- **Scores**: `ctx.teams` is `[{ idx, name, color, score }, ...]`, synced to clients and shown under the timer.
  Use `ctx.addTeamScore(team, n, why?, by?)` for events (a basket) or `ctx.setTeamScore(team, n)` for a live
  count (eggs in the nest).
- **Rivals**: `ctx.sameTeam(a, b)`, `ctx.rivalsOf(toy)`, `ctx.teammatesOf(toy)`, `ctx.teamToys(team)`. A
  `'rival'` trick only ever targets the other team (the crosshair, Tab, auto-targeting and bot sabotage skip
  teammates). Teammates never become your grudge. Shove and dive pass through teammates unless the level allows
  friendly fire; grabbing a teammate (to carry or throw them) is on by default.
- **Winning**: `ctx.winTeam(team, note?)` ends the round. In a Show every active toy on that team goes through and
  the rest are eliminated together (one "team out" line in the feed, not eight). In Quick Play the winners are
  marked through. If time runs out and `onTimeUp` doesn't pick a winner, the higher score wins (then the side
  with more toys standing, then a coin toss on the round seed). If one side has nobody left standing, the
  other side wins.
- **Bots**: `bots.ts` adds `nearestMate(ctx, toy)` and `teamRank(ctx, toy, score)` (this toy's rank among its
  teammates by any score, for sharing out jobs: the two nearest the ball chase it, one guards, the rest get
  open). `nearestRival` skips teammates. `levels/team-kit.ts` has carrying helpers (`fetch`, `carryTo`,
  `holdChanges` to see who let go of what, `throwBody` for aimed throws) used by the five team levels.
- **Sizes**: the planner can hand a team level any field from 2 up, so make 1-v-1 work too.

## LevelCtx: what a level can use

Read-only facts: `root` (add visuals here; it is cleared between rounds), `scene`, `phys`, `assets`, `rng`, `seed`,
`mode` ('show' | 'quick' | 'hub'), `role`/`isHost`, `difficulty` (0–2), `spice` (0 mild, 1 normal, 2 mean),
`quality` ('low' | 'high'), `toys`, `me`, `target`, `round` {index,total,final}, `time`, `timeLeft`,
`phase`, `pointer` (this screen's free pointer), `cam`, `music`, `hazards`, `THREE`, `RAPIER`, `duel` (set in a
duel round) and `session` (survives between rounds). Game modes also get `startDuel(spec)` and `duelLevels(n)`
(see "Game modes and duels").

Results (host): `qualify(toy, note?)`, `fail(toy, reason)`, `end()`, `active()`, `qualifiedCount()`.

Teams (see Team levels): `teams`, `teamOf`, `sameTeam`, `rivalsOf`, `teammatesOf`, `teamToys`, `addTeamScore`,
`setTeamScore`, `winTeam(team, note?)`.

Toys (host): `knock(toy, {x,y,z}, stun, by?)` (a velocity change plus a stun; `by` gets the grudge),
`respawn(toy, at?, stun?)`, `setBodyMode(toy, 'walk'|'ball'|'seated')`, `blame(victim, by)`,
`addSprinkles(toy, n, why?)`.

Sync: `emit(data, toToy?)` sends to `onEvent` on every screen, or on one toy's screen. `syncProp(body, mesh)`
streams a dynamic body to clients. `grabbable(body, mesh)` does the same, and toys can pick the body up with E.

Effects: `fx` and `fxLocal`, each with `puff(pos, 'dust'|'stuff'|'spark'|'crumbs'|'milk', n)`, `confetti(pos)`,
`shake(amount, toy?)`, `sfx(name, pos?, toy?)`, `say(text, color, secs, toy?)` (the big banner), `feed(text)`,
`popup(toy, text, color)` and `hitStop(secs)`. Sound names: boop squeak pop crunch crack cheer whoosh thud
ding coin buzz zap tick snip slam splash wind boing throw out go count.

Helpers: `spawnGrid(n, {x,z,yaw,spacing,cols})`, `spawnRing(n, {x,z,radius,faceIn})`, `nearest(pos, filter?)`,
`leader(except?)`.

## Toys

A `Toy` is one contestant's body for one round. Its body origin is the capsule centre, 0.5 m above the feet
(`toy.feet` gives the ground height under it). Fields a level commonly reads or writes:

- `pos`, `vel`, `yaw`, `grounded`, `facing()`
- `status` ('play' | 'qualified' | 'failed'), `doneAt`, `doneNote`
- `pad`: the controls for this tick. Bots write it: `mx, mz` (world-space stick, length up to 1), `jump`,
  `dive`, `shove` (one-shots), `grab` (held), `act` (level action key R / Y), `px, pz, down` (free pointer), `emote`
- `mode` ('walk' | 'ball' | 'seated'), `seat` (where a seated toy sits), `runSpeed`, `frozen` (cannot act)
- `stun`, `dive`, `holding`, `grabbedBy`, `holdingProp`, `popped` (ball mode: no grip)
- Sabotage: `sprinkles`, `busy` (tied up after a trick), `cooldowns`, `usedOnce`, `grudge`, `bubble`
- `team` (-1, or 0/1 in team levels), `friendly` (which moves hit teammates), `animOverride` (force a pose)
- `data`: per-level scratch space (bot memory). It is not synced.
- `c`: the `Contestant` (name, kind, tint, human, stats)
- `rig`: the visual `ToyRig` (see Cosmetics)

The shared moves work in every level: run, jump, dive (a belly-flop lunge that knocks over whoever it hits), grab
(hold a toy, who can wriggle free, or a `grabbable` object, and throw it by letting go), shove (a short push in
front), and stuns. In `ball` mode, toys ride a bouncy ball: input sets acceleration, dive is a dash,
and `popped` toys lose grip.

## Tricks and the sabotage system

```ts
{
  id: 'crumb', name: 'Crumb Flick', icon: 'crumb',
  cost: 1, cooldown: 3, busy: 0.5,        // busy: seconds the user is tied up (Cookie Cutter: needle lifted)
  target: 'rival' | 'self' | 'none',
  range?: 6, minSpice?: 1, once?: true, blockable?: true,
  desc: 'What it does to them', counter: 'How they fight back',
  hidden?: (ctx, s, user) => boolean,     // e.g. only the key holder sees "Stop the Music"
  can?: (ctx, s, user, target) => true | 'reason',
  apply: (ctx, s, user, target) => { ... },   // host only
  botUse?: (ctx, s, user) => Toy | null | false,
}
```

The engine handles all of these, so you never write them yourself: the wallet and price checks, cooldowns,
once-per-round tricks, `busy`, and the target (one the player picked, the one under the crosshair, their
grudge, or the nearest rival in front). It also handles **grudges**: whoever hits you becomes your grudge, and
**revenge on them costs half (rounded down)**. **Bubble Wrap** (`bubbleWrap(cost)` from `sabotage.ts`) blocks the
next trick and bounces it back. The engine also records stats for the awards (Biggest Menace, Most Betrayed,
Revenge Served, Saint), writes feed lines, and runs bot sabotage at a rate set by difficulty and spice. Bots
use `botUse` if you give it. Otherwise they go after their grudge, the leader, or a random rival.

**Peanut gallery**: eliminated contestants get crumbs, paper balls and feathers every round. By default a hit
gives a small nudge. Customise it with `throwables`, `canThrow` (Music Box blocks throws while the ballerina is
looking) and `onThrow` (Cookie Cutter turns a crumb into a crumb on the line).

## Hazards and helpers

`ctx.hazards` creates hazards that are pure functions of the round clock, so every screen animates them
identically. Stateful ones sync themselves.

```ts
ctx.hazards.rotatingBar({ x, y, z, length, speed, thick?, twoSided? })
ctx.hazards.pusher({ from: [x,y,z], to: [x,y,z], size: [w,h,d], period, phase? })
ctx.hazards.fallingTiles({ x, y, z, cols, rows, size, delay?, respawn? })
const disc = ctx.hazards.shrinkingDisc({ x, y, z, radius, visual? }); disc.shrink(to, atTime, seconds)
const belt = ctx.hazards.conveyor({ x, y, z, width, length, rotY?, speed }); belt.setDir(-1)
ctx.hazards.bouncyPad({ x, y, z, radius, power })
ctx.hazards.add({ update(ctx, t, dt) {...}, affect(ctx, toy, dt) {...}, predict?, pack?, unpack? })  // your own
```

Physics (`ctx.phys`) provides `box(pos, half, opts)`, `cylinder(pos, halfH, r)`, `ball`, `trimesh(mesh)`,
`walls(cx, cz, hx, hz)`, `kinematic(pos)` and `dynamic(pos)` (then `attach(body, ColliderDesc)`),
`cast(from, dir, max)` and `groundBelow(pos, max)`. Opts take `friction`, `restitution`, `rotY`, `sensor` and
`groups` (`WORLD_GROUPS`, `PROP_GROUPS`).

`helpers.ts` has these. `buildAttic(root, assets, phys, { hw, hd, ridge, knee, lights, quality })` builds the
attic shell every level sits in (floorboards, roof slopes, rafters, round window with god-rays, string
lights). `textSprite(text, {bg})` makes signs. `every(memo, key, interval, t)` and `countdown(s)` are timers.
`spawnGrid`/`spawnRing` lay out spawn points.
`assets.ts` has `prop(assets, 'musicbox', size, 'height'|'width'|'max')`, which scales a model to a size, and
`tiledMaterial`/`discMaterial` for the textures. Models: musicbox ballerina top chest scissors tin crown horse
boxes sewing armchair. Textures: floor biscuit stool tinlid.

`bots.ts` has `skill(ctx)` (reaction, accuracy, pace, blunder and aggression by difficulty), `steerTo`,
`hopObstacles`, `avoidWalls`, `keepInside`, `nearestRival` and `bully`.

## Game modes and duels

The engine can run a level as a **timed duel** and then go back to whatever started it. Toy Box Trail uses this
for its duels and its whole-table mini-games, and any level can do the same. All of it is additive: a level
that doesn't use these hooks behaves exactly as before.

```ts
// Host: pause this level, play Spinning Top Sumo as a 30 s duel between contestants 0 and 2, then come back.
ctx.startDuel({ levelId: 'top-sumo', toys: [0, 2], seconds: 30, party: false, tag: 'duel' })
// When it ends the engine rebuilds this level (state from ctx.session, no intro) and calls:
onDuelEnd(ctx, s, result) // { levelId, levelName, tag, party, toys, order: [best first], winner }
```

- **The duel round** is a `quick` round (fails retry, nobody is eliminated) with `ctx.duel = { seconds, party,
  tag }` and the round timer set to `seconds`. A duel (`party: false`) ends as soon as one toy is through. A
  table mini-game (`party: true`) ends when everyone is through or time runs out. The placings are: through
  first (by time), then the level's `rank()`, then everyone else. Levels can read `ctx.duel` if they want a
  short form of their own. Everyone not in the duel watches from the peanut gallery and can throw things.
- **Which levels** can be a duel: `ctx.duelLevels(n)` lists registered levels (not hub or hidden) whose player
  range fits `n` and that don't set `duel: false`. New levels join automatically. Set `duel: { seconds }` if
  30 s is wrong for yours, or `duel: false` to opt out.
- **`ctx.session`** is a plain object that survives from round to round until the Loft or a new game. Keep a
  mode's game in it so a duel in between doesn't lose it. Each screen has its own copy (clients refill theirs
  from `unpack`).
- **`onAction(ctx, s, toy, text, contestant)`** (host): a player's choice from a level's own HUD panel. The
  page calls `game.levelAction('roll')` on any screen and the text arrives here on the host (it travels as
  the `lv:<text>` action).
- **`results(ctx, s) → { order, buttons?, title?, crown? }`** (host): a game mode's final placings. The engine
  adds the usual awards (Biggest Menace, Most Betrayed, Revenge Served, Saint, plus the crown award, renamed by
  `crown`), adds `buttons`, shows the results card and saves the player's earnings.
- **`LevelHud.extra`** carries any data a level-specific panel needs. `Hud.tsx` shows Toy Box Trail's panel
  when the round's mode is `board`.
- **`toy.pose`** forces an animation (`'jump'`, `'sit'`, `'cheer'`…) while set. The board drives its seated
  toys tile to tile this way.
- **Game modes** live in `MODES` in `levels/index.ts` (found by `levelById`, never drawn by the Show or Quick
  Play). A mode starts with its own `PlayMode`: `board` is one long round that skips the countdown and only
  ends when the level calls `ctx.end()`.

Page and test API: `game.startBoard(size?)`, `game.runDuel(spec)` (the same as `ctx.startDuel`; from the Loft
it returns to the Loft), `game.levelAction(text)`, `game.session`.

## Toy Box Trail

The board mode for 2 to 6 toys (people first, bots fill the table). Start it from the menu ("Play Toy Box
Trail"), from the Loft (the button, or hop on the board-game box beside the toy chest), or with
`#/plush?auto=board`. It is one long `board` round of the `toy-box-trail` level.

- **The board** (`board/layout.ts`): 57 tiles, 40 to 47 hops from the start to the cookie jar. Two forks: across
  the hand-mirror pond on bottle caps (short, with a slippery cap that splashes you back) or round it (long, with
  a shop), and through the sock drawer (short: a duel, the slide and sticky tape) or along the skirting board
  (long, with a shop). A popsicle-stick ladder over a book stack skips nine tiles; the slide sends you back seven.
- **A turn**: a moment to use one trick from your bag, then roll the big foam die (a real Rapier body, read by
  which face ends up on top; Double Die throws two). Hop tile to tile, pick a way at forks, then the tile acts:
  Button Stash +3, Hole in the Pocket -3, Surprise Card (14 funny events), Button Shop, Duel (pick a rival),
  Sticky Tape (miss a turn), Slippery Cap, Ladder, Slide. Landing on another toy starts a 1v1 (or 1v1v1) duel,
  at most once every other table round (otherwise you bump them and pinch a button). A duel tile is a duel
  once per table round.
- **Duels** play a registered level for 30 s (the bag cycles through every level that fits, so Cookie Cutter,
  Spinning Top Sumo and Music Box Freeze all come up). The winner takes 6 buttons from each loser, or swaps
  places with the loser furthest ahead. Losers get a grudge on the winner.
- **Every third table round** the whole table plays a 35 s mini-game: 10, 6, 4, 2, 1, 1 bonus buttons by placing.
- **Bag of tricks** (three slots, bought at shops): Squeaky Hammer (6, a rival back 3 tiles), Mousetrap (4, set on
  your tile or two ahead of a rival; the next rival onto it stops and pays you 4), Jack-in-the-Box (7, pop out
  next to a random toy), Bubble Wrap (4, blocks the next trick and bounces it back: the sender goes back 3),
  Double Die (5), Magnet Spool (7, reel the leader back to your tile). **Grudges**: whoever hit you last;
  hitting them back refunds half the trick's price (half-price revenge). Stats feed the usual awards.
- **Winning**: first to the jar. Results order the rest by distance to the jar, then buttons. Everyone keeps half
  their board buttons on top of the placing and award buttons, saved to their profile.
- **Bots** decide after a short think: tricks by difficulty (hammer the leader or their grudge, trap in front of
  the leader, magnet or jack when far behind, double die when far out), shortest way at forks, shopping by
  need, swap only when it gains four or more tiles.
- **Online**: the host runs the rules. The whole game (`TrailData`, about 1 KB) goes in each snapshot, so a late
  or dropped packet heals itself; the dice are synced props. Clients send `roll`, `item:<slot>:<arg>`,
  `fork:<k>`, `buy:<id>`, `done`, `pick:<c>`, `stake:buttons|swap` through `game.levelAction`. Everyone's
  camera follows the active toy and the dice (or "Whole board"). A 15 s turn timer (10 s for choices, 16 s in
  the shop) plays a sensible default for an idle player; a silent player's seat is played by the bot hook after
  3 s; a player who leaves becomes a bot.

## Online, in one paragraph

The host's browser runs every round. About 20 times a second it sends a snapshot: phase, clock, toys,
`pack()`, hazards, synced props and gallery ammo, plus effect events. Clients send their pad about 30 times a
second, plus one-shot actions (`trick:<id>:<target>`, `throw:<kind>:<target>`, `jump`, …). Clients predict
their own toy with a local physics world built by the same `build()`. Other toys are kinematic puppets. The
host trusts a client's reported position unless that toy is being pushed around. If a player leaves, a bot
takes over. If a player goes silent for 3 s mid-round (hidden tab, dropped link), your `bot()` hook drives
their toy until their input comes back. Your level only has to keep `pack()` small (numbers and short arrays) and make `visual()` draw
purely from state.

## Cosmetics: the attachment API

Every toy shares one rig, so a cosmetic mesh fits every toy:

```ts
const off = toy.rig!.attach('head', hatMesh, { offset: [0, 0.15, 0], rotation: [0, 0, 0], scale: 1 })
off() // remove it again
```

The slots are `head`, `face`, `back`, `chest`, `hips`, `handR`, `handL`, `footR` and `footL`, or you can pass any
bone name. Sizes are in metres at toy scale: the rig's 0.01 armature scale is cancelled for you. The crown
on the Show winner uses this, and so does the Sewing Table (below).

The rig also offers, for cosmetics: `rig.settle()` (pose the idle's first frame; fit and attach in that pose),
`rig.animators` (per-frame hooks: a spinning propeller, a turning key), `rig.cosmetics` / `rig.takeOff(slot)`
(the crown takes a hat off), `rig.trail` (a flair trail the engine draws behind a running toy),
`rig.setFabric(pattern, colour)` (a pattern over the knit: `FABRICS` in rig.ts) and `rig.model`.
Geometries and materials marked `userData.keep = true` survive rig disposal and round teardown, so shared
cosmetic pieces can be cached.

## The Sewing Table (wardrobe)

Ten trait slots: **fabric, colour, eyes, mouth, hat, face, back, hand, feet, flair**. `wardrobe/catalog.ts`
lists every item with its slot, rarity (**Common, Stitched, Embroidered, Golden Thread**) and how you get it:
free, bought with buttons, Button Claw only, or a challenge (a test over your saved stats and Loft records).
An outfit is `{ [slot]: itemId }`; it is part of `Look`, `Contestant` and `RosterRow` (all optional, so older
peers still talk to newer ones) and saved in the profile with `owned`. Bots get random outfits.

`dress.ts` builds each piece. Four are real models (`public/plush/cosmetics/`: wizard hat, propeller beanie
with its propeller split off so it spins, pipe-cleaner glasses turned from +x to face +z, paper wings turned
to span x) plus the crown prop; the rest are primitives merged into one vertex-coloured mesh per piece, with
small canvas textures. Placement never uses hand offsets: `fit.ts` measures each toy kind once from its
skinned vertices in the idle pose (the head's dome ignoring ears, tufts and spikes, the face surface as a grid,
the back profile, hand and foot centres), with a small per-kind table for where the stitched eyes and mouth
are. To add an item: add it to `ITEMS`, then a `case` in the slot's builder in `dress.ts`.

On screen: stepping on the tape-measure podium opens the drawer; the toy turns on the podium and the camera
frames it (`loftUi.wardrobe`); trying something on changes your look for everyone until you close the drawer.
Unlocked emotes (Twirl, Backflip, Disco Fever) join the Loft's number keys.

## The Loft and its hidden games

The Loft (`levels/loft.ts`) is one hub round. Its four corners each hide a game that runs inside that round
rather than as a level, so the room keeps going around it: other players watch, and queue with R (Act).

| Corner | Game | Rules |
| --- | --- | --- |
| Disco Closet | Freeze Dance (`loft/freeze.ts`) | Anyone on the light-up floor plays. Dance while the music plays, stop dead when it cuts; still moving after a short grace and you're booped off. Clean stops build a combo, the tempo creeps up, 20 in a row unlocks Disco Fever. Bots join in. |
| Houseplant Jungle | Vine Swing (`loft/vine.ts`) | One player. A pendulum on each vine; Space lets go, Space again grabs the next fresh leaf. Leaves wilt after you leave them. Metres in 60 s; a miss drops you into the planter. |
| Bathtub Beach | Bath Bomb Bowling (`loft/bowling.ts`) | One player. Slide to aim, Space at full power, steer the spin while it rolls. Ten frames, real scoring, Rapier pins; strikes and spares send bubbles floating across the Loft. |
| Cardboard Arcade | Button Claw (`loft/claw.ts`) | One player. Steer for 15 s, drop, hope it holds to the chute. A capsule wins a random cosmetic once a day (decided on the winner's own screen); later goes are practice. |

Each game implements `LoftActivity` (`loft/station.ts`): `build`, `init`, `tick` (host), `visual` (every
screen), `pack`/`unpack`, `hud`, and optionally `camera`, `onEvent` and `bot`. The Loft packs all four into
its snapshot. A finished game (or a new Freeze Dance combo) emits a `score` event: every screen records it
on its local board (`loft/records.ts`, localStorage `pp-loft`), and the player's own screen signals the page
(`loft-score:<game>:<score>:<fin>`, `loft-claw:<seed>`), which pays buttons and grants prizes and challenge
unlocks. The notice board on the back wall shows your stats (shows, crowns, Biggest Menace awards) and the
top scores this browser has seen.

Zone ambience (`loft/ambience.ts`) is WebAudio mixed by camera distance: the disco groove (which is Freeze
Dance's music and cuts out on the freeze), jungle birds and a trickle, bathwater waves and squeaks, arcade
chiptune. Levels get the audio context through `ctx.sound`.

### Engine changes for the Loft and the wardrobe (all backward compatible)

- `ANIMS` gained `spin`, `flip`, `boogie` and `hang` at the end (snapshot indices of the old ones are
  unchanged); `EMOTES` lists the emote keys; `Pad.emote` takes any of them.
- `toy.animHint`: a level-chosen pose that wins over everything except being held (set it from `visual()`).
- `ctx.sound` (WebAudio context and bus for level-made sound).
- Looks change in place: `setLook` and `pp-look` re-dress the toy (`restyle`) and send `pp-roster`, instead
  of rebuilding the whole Loft. Clients re-dress toys whose look changed when a roster arrives.
- `game.setEmotes(list)` sets the Loft's number keys; `game.onReward` (preferred over `onEarn`) hands the page
  a Show's reward so it can merge into its current profile (`ProfilePatch` can be a function).
- `game.debugLook(contestant, look)` for tests.


## Worked example: Robo-Vac Sweep

From the design catalogue: a robot vacuum hunts the rug, and getting sucked up puts you out. The full file is
`levels/robo-vac.example.ts`, and it compiles and plays. These are the important parts:

```ts
interface VacState {
  vacs: { x: number; z: number; yaw: number; lure: number; lureT: number }[] // synced
  meshes: THREE.Object3D[]                                                    // visuals (not synced)
}

export default defineLevel<VacState>({
  id: 'robo-vac', name: 'Robo-Vac Sweep', type: 'survival',
  blurb: 'A robot vacuum hunts the rug. Get sucked up and you are out.',
  howTo: ['It chases whoever is closest', 'Jump over its bumper to escape', 'Throw lint to lure it onto a rival'],
  accent: '#22d3ee', players: [2, 16], duration: 90, sprinkles: { start: 2 },

  tricks: [
    {
      id: 'lint', name: 'Lint Lure', icon: 'star', cost: 2, cooldown: 10, busy: 0.5, target: 'rival',
      desc: 'Every vacuum chases them for 4 seconds.', counter: 'Run behind someone else, or jump the bumper.',
      apply: (ctx, s, _user, target) => { for (const v of s.vacs) { v.lure = target!.idx; v.lureT = ctx.time + 4 } },
    },
    bubbleWrap<VacState>(2),
  ],

  build(ctx) {                       // every screen, same seed
    buildAttic(ctx.root, ctx.assets, ctx.phys, { hw: 16, hd: 16, ridge: 16, knee: 4, lights: 40, quality: ctx.quality })
    // ...a purple rug mesh under ctx.root
  },
  init(ctx) {                        // state + meshes (two vacuums; the second wakes at 45 s)
    const st = { vacs: [{ x: 0, z: 0, yaw: 0, lure: -1, lureT: 0 }], meshes: [vacMesh(), vacMesh()] }
    for (const m of st.meshes) ctx.root.add(m)
    return st
  },
  spawn: (ctx, _s, _toy, i, n) => ctx.spawnRing(n, { x: 0, z: 0, radius: 7.5, faceIn: true })[i],

  tick(ctx, s, dt) {                 // host only: steer each vacuum at its quarry, suck up anyone on the ground
    if (ctx.time > 45 && s.vacs.length < 2) s.vacs.push({ x: 0, z: -8, yaw: 0, lure: -1, lureT: 0 })
    for (const v of s.vacs) {
      // ...turn towards quarry(ctx, v) and drive forward
      for (const t of ctx.toys)
        if (t.status === 'play' && Math.hypot(t.pos.x - v.x, t.pos.z - v.z) < 1.2 && t.feet < 0.45) ctx.fail(t, 'sucked up')
    }
  },
  bot(ctx, s, toy) {                 // host only: run away, stay on the rug, hop the bumper
    // ...steerTo(toy, awayX, awayZ, { pace: skill(ctx).pace }); avoidWalls(ctx, toy); maybe toy.pad.jump = true
  },
  pack: (_c, s) => s.vacs.map((v) => [v.x, v.z, v.yaw]),            // keep it small
  unpack: (_c, s, d) => (d as number[][]).forEach((row, i) => { s.vacs[i] ??= { x: 0, z: 0, yaw: 0, lure: -1, lureT: 0 }; [s.vacs[i].x, s.vacs[i].z, s.vacs[i].yaw] = row }),
  visual(_c, s) {                    // every screen: meshes follow the synced state
    s.meshes.forEach((m, i) => { const v = s.vacs[i]; m.visible = !!v; if (v) { m.position.set(v.x, 0, v.z); m.rotation.y = v.yaw } })
  },
  hud: (_c, s) => ({ chips: [`${s.vacs.length} vacuums`] }),
})
```

It is survival, so the engine ends the round once enough toys are sucked up, and everyone left standing goes
through. Falling off the map uses the default for survival (`fail`). Quick Play turns each `fail` into a
respawn with no extra code.

## Testing hooks

- `?snap` (before the `#`) exposes `window.__plush` without an animation loop. Step it with
  `__plush.simulate(seconds, render = true)`. `?net=local` also exposes it, with the live loop running.
- Deep links: `#/plush?auto=loft`, `#/plush?auto=quick&level=<id>`, `#/plush?auto=host`, `#/plush?join=CODE`,
  `#/plush?auto=board` (Toy Box Trail).
- Board: `startBoard()`, `setAutopilot(true)` (your seat plays itself), `session.trail` (the board game: poke
  `ph`, `turn`, `players[i].tile` / `.items` / `.b` to set up a case), `levelAction('roll')`, and
  `runDuel({ levelId, toys, seconds })`.
  `?quality=low|high` forces a quality tier.
- `__plush.debug()` gives the phase, level, round, toys, roster with stats, gallery ammo, results, plan and feed.
  `__plush.levelState()` gives the level's state object.
- Flow: `startShow()`, `startQuick(id)`, `forceRound(id, final?)`, `toLoft()`, `setSettings({...})`, and
  `setAutopilot(true)`, which makes your toy play itself with the level's bot hook.
- Pokes: `debugTrick(toyIdx, trickId, targetIdx)`, `debugGive(toyIdx, sprinkles)`,
  `debugThrow(contestantIdx, kind, toyIdx)`, `useTrick(id, target?)`, `throwAt(kind, target?)`,
  `testPointer = {x, z, down}` (drives the free pointer), and `input.touchMove(x, y)` / `input.touchButton(name, down)`.
- Two-tab online on one machine: open `/?net=local#/plush?auto=host` in one tab, read the code from
  `__plush.debug().code`, then open `/?net=local#/plush?join=CODE` in another.

## Performance notes

The game is one imperative three.js renderer (no React per frame). Device pixel ratio is capped at 1.5. There
are two quality tiers, and the game adapts: if frames stay slow it drops resolution, then shadows. One key
light casts shadows, with a tight frustum that follows the camera focus. Repeated meshes (books, rafters,
bulbs, tiles) are instanced. Name tags and pop-ups are DOM elements the engine moves directly. Particle pools
are fixed size. Keep your level's own geometry modest, use `InstancedMesh` for anything repeated, and avoid
allocating in `visual`/`tick` (reuse module-level `Vector3`s).

Everything in the game is original. Don't borrow names, layouts or assets from other party games.
