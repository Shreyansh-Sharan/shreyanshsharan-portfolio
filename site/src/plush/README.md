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
    loft.ts          the hub (type 'hub')
    cookie-cutter.ts logic: trace a biscuit (free pointer, seated toys, lots of tricks)
    music-box.ts     survival: move while the music plays (synced phases, WebAudio, a key pickup)
    top-sumo.ts      survival: ride balls on a shrinking stool (ball mode, custom hazard, shrinking floor)
    robo-vac.example.ts  the worked example below (compiles, not registered)
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

## LevelCtx: what a level can use

Read-only facts: `root` (add visuals here; it is cleared between rounds), `scene`, `phys`, `assets`, `rng`, `seed`,
`mode` ('show' | 'quick' | 'hub'), `role`/`isHost`, `difficulty` (0–2), `spice` (0 mild, 1 normal, 2 mean),
`quality` ('low' | 'high'), `toys`, `me`, `target`, `round` {index,total,final}, `time`, `timeLeft`,
`phase`, `pointer` (this screen's free pointer), `cam`, `music`, `hazards`, `THREE`, `RAPIER`.

Results (host): `qualify(toy, note?)`, `fail(toy, reason)`, `end()`, `active()`, `qualifiedCount()`.

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
on the Show winner uses this. The Sewing Table will build on it.

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
- Deep links: `#/plush?auto=loft`, `#/plush?auto=quick&level=<id>`, `#/plush?auto=host`, `#/plush?join=CODE`.
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
