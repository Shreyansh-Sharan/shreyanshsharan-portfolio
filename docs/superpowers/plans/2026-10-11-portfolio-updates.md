# Portfolio Updates Implementation Plan

> **For agentic workers:** Implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. This project has **no unit-test runner**; the verification gates are `npm run lint` (oxlint, must stay 0 errors), `npm run build` (tsc + vite, must pass), and runtime browser checks via the `agent-browser` skill.

**Goal:** Add a third top-level Profile tab, embed FootballIQ as a full-page iframe, replace the profile intro video with a free stylized 3D avatar, give the world explorer a real run animation, fix intermittent black-screen bugs in explore mode, and add a PalWorld-style creature with an 8-type randomized spell system.

**Architecture:** React 19 + Vite 8 + TypeScript, `@react-three/fiber` / `drei` / `postprocessing` for the 3D world. A hash router (`src/lib/router.ts`) drives a switch in `App.tsx`. Home tiles are data-driven from `src/data/content.ts`. The 3D world lives in `src/world/*` and shares DOM state through a tiny external store (`src/world/store.ts`). All new work follows these existing patterns.

**Tech Stack:** React 19, TypeScript ~6, Vite 8, three.js 0.186, @react-three/fiber 9, @react-three/drei 10, @react-three/postprocessing 3, lucide-react, oxlint.

**Spec:** This plan is self-contained; the design was agreed in chat (see task list). No separate spec file.

## Global Constraints

- **Lint:** `npm run lint` must report **0 errors** (warnings tolerated; do not add new error-level ones). Run from `site/`.
- **Build:** `npm run build` (`tsc -b && vite build`) must pass. Run from `site/`.
- **Static host:** Deploys to GitHub Pages under a base path — always build URLs with `import.meta.env.BASE_URL`, never a leading `/`.
- **No new runtime deps** unless a task explicitly adds one (none planned).
- **Follow existing patterns:** hash routes in `router.ts`, tile data in `content.ts`, world state in `store.ts`, asset URLs via `modelUrl()` / `import.meta.env.BASE_URL`.
- **Scope discipline:** touch only what each task names. Do not refactor unrelated code.

---

## File Structure

**Group A — Three tabs + FootballIQ + Profile media (DOM/React):**
- Modify `site/src/data/content.ts` — add `footballiq` tile; retype `Tile['tab']` to include `'profile'`; add `iframe` TileAction; move profile tile to `profile` tab.
- Modify `site/src/components/Home.tsx` — three-tab nav, generalize tab navigation off the hardcoded career/extras pair.
- Modify `site/src/lib/router.ts` — add `embed` route.
- Create `site/src/components/Embed.tsx` — full-page iframe view with back button + new-tab fallback.
- Modify `site/src/App.tsx` — wire the `embed` route.
- Modify `site/src/components/Profile.tsx` — remove video, use stylized avatar.
- Modify `site/src/components/ProfileAvatar.tsx` — load the new avatar GLB (if fetched) with better presentation.
- Possibly add `site/public/profile/avatar-stylized.glb` (fetched free asset).

**Group B — Explorer run animation + black-screen fixes (3D):**
- Modify `site/src/world/Characters.tsx` — real/procedural run.
- Possibly add `site/public/world/models/explorer-run.glb` (fetched free asset).
- Modify `site/src/world/WorldCanvas.tsx` — context-loss recovery, composer guard.
- Create `site/src/world/CanvasErrorBoundary.tsx` — error boundary around the Canvas.

**Group C — Creature + spell system (3D, the largest subsystem):**
- Create `site/src/world/Critter.tsx` — the wandering creature, jump-on bounce, spell reactions.
- Create `site/src/world/spells.ts` — spell registry (8 types), random picker, cast state.
- Create `site/src/world/SpellFx.tsx` — visual effects per spell (rock drop, car flyby, lightning, ice, flower, shrink/grow, bounce, gun shot).
- Modify `site/src/world/controls.ts` — add `cast` (mouse click + key) input.
- Modify `site/src/world/WorldCanvas.tsx` — mount `<Critter/>` and `<SpellFx/>`.
- Modify `site/src/world/PlayHud.tsx` — show a spell hint / current wand mode.

---

## Task 1: Add the third "Profile" tab (data + types)

**Files:**
- Modify: `site/src/data/content.ts`
- Modify: `site/src/components/Home.tsx`

**Interfaces:**
- Produces: `Tile['tab']` is now `'career' | 'extras' | 'profile'`. `TABS` in Home is derived or extended to three entries. The profile tile has `tab: 'profile'`.

- [ ] **Step 1:** In `content.ts`, change the `tab` field type on the `Tile` interface from `'career' | 'extras'` to `'career' | 'extras' | 'profile'`. Update the `TileAction` union comment if needed.
- [ ] **Step 2:** Find the profile tile (`id: 'profile'`). Set `tab: 'profile'`. Remove any `alsoIn` on it (it no longer needs duplication). Confirm no other tile references `alsoIn: 'profile'`.
- [ ] **Step 3:** In `Home.tsx`, extend `TABS` to `[{id:'profile',label:'Profile'},{id:'career',label:'Career'},{id:'extras',label:'Extras'}]`. Decide ordering: Profile first per the design.
- [ ] **Step 4:** Generalize `indexByTab` from a hardcoded `{career, extras}` record to one built from `TABS` (e.g. `Object.fromEntries(TABS.map(t => [t.id, 0]))` typed as `Record<Tab, number>`). Update the initializer that sets the starting tab's index.
- [ ] **Step 5:** Generalize `tilesFor(tab)` so the profile tab returns its own tiles (the shared/`alsoIn` logic still works for career/extras; profile has no shared tiles).
- [ ] **Step 6:** Fix the hardcoded tab switching: `prevTab`/`nextTab` at the top of `useActions` and the horizontal switch in the `'tabs'` zone currently jump straight to `'extras'`/`'career'`. Replace with index-based stepping through `TABS` (compute current tab index, move ±1, clamp).
- [ ] **Step 7:** Update the `cards-title` logic (`tile.tab === 'career' ? 'Activities' : 'Preview'`) so profile still reads 'Preview'.
- [ ] **Step 8 (verify):** `cd site && npm run lint && npm run build`. Expected: 0 errors, build passes. Then browser-check: three tabs show, Q/E and arrow-left/right cycle Profile↔Career↔Extras, profile tile appears under Profile.
- [ ] **Step 9:** Commit: `feat(home): add Profile as a third top-level tab`.

---

## Task 2: FootballIQ tile + full-page iframe route

**Files:**
- Modify: `site/src/data/content.ts`
- Modify: `site/src/lib/router.ts`
- Create: `site/src/components/Embed.tsx`
- Modify: `site/src/App.tsx`
- Modify: `site/src/components/Home.tsx` (dispatch the new action)
- Modify: `site/src/styles.css` (embed layout)

**Interfaces:**
- Produces: `TileAction` gains `{ kind: 'iframe'; url: string; label: string }`. Route gains `{ name: 'embed'; id: string }` parsed from `#/embed/:id`. `Embed` component renders a full-viewport iframe.

- [ ] **Step 1:** In `content.ts`, add to the `TileAction` union: `| { kind: 'iframe'; url: string; label: string }`.
- [ ] **Step 2:** Add a `footballiq` tile under `tab: 'career'`. Copy: title "FootballIQ", tagline e.g. "Every match, understood live", org "Independent · Product", genre "Live Football Analytics", blurb summarizing: live event + 30Hz tracking data → real-time insights, calibrated models, an AI strategist that cites evidence; five synchronized views on one clock; built on Microsoft Fabric/Foundry with StatsBomb + PFF data. `action: { kind: 'iframe', url: 'https://footballiq.shreyanshsharan.com', label: 'Open FootballIQ' }`. Give it a football-green accent e.g. `['#065f46', '#34d399']`. Add 3-4 `stats` and `activities`.
- [ ] **Step 3:** In `router.ts`, add `{ name: 'embed'; id: string }` to the `Route` union and a `case 'embed'` in `parse` returning `parts[1] ? {name:'embed',id:parts[1]} : {name:'home'}`.
- [ ] **Step 4:** Create `Embed.tsx`: a `Page`-wrapped (or custom full-bleed) component taking the tile id, looking up the tile's iframe url, rendering `<iframe src={url} title={title} className="embed-frame" />` with a back button (`navigate('#/home/'+id)`), a loading spinner shown until `onLoad`, and an "Open in new tab ↗" link always visible. Add `allow`/`referrerPolicy` attributes sensibly; `sandbox` left off so the app works (FootballIQ is first-party).
- [ ] **Step 5:** In `App.tsx`, add `case 'embed': screen = <Embed id={route.id} onAccent={setAccent} />`. Import it (lazy is fine).
- [ ] **Step 6:** In `Home.tsx` `runPrimary`, add `case 'iframe': play('select'); navigate('#/embed/'+t.id); break`. Set `primaryLabel` to use `action.label` for iframe (the existing `tile.action.kind === 'hub' ? 'Play' : tile.action.label` already covers it).
- [ ] **Step 7:** Add `.embed-*` CSS: full-viewport frame, back bar, spinner.
- [ ] **Step 8 (verify):** lint + build pass. Browser: FootballIQ tile shows under Career; clicking opens full-page iframe of the live site; back returns; "open in new tab" works. Confirm the iframe actually renders (site sends no X-Frame-Options — verified).
- [ ] **Step 9:** Commit: `feat: add FootballIQ as a full-page embedded tile`.

---

## Task 3: Replace profile intro video with a stylized 3D avatar

**Files:**
- Modify: `site/src/components/Profile.tsx`
- Modify: `site/src/components/ProfileAvatar.tsx`
- Add (if fetched): `site/public/profile/avatar-stylized.glb`

**Interfaces:**
- Produces: `ProfileMedia` renders only the 3D avatar (no video, no toggle). `ProfileAvatar` loads a stylized GLB with a fallback to the existing `avatar.glb`.

- [ ] **Step 1:** Attempt to fetch a free CC0 stylized character GLB (e.g. from a known CC0 source). If one is obtained, save to `site/public/profile/avatar-stylized.glb`. If none is obtainable, skip and keep `avatar.glb` (document the fallback in the commit).
- [ ] **Step 2:** In `Profile.tsx`, remove the `view` state, the `seg` toggle, and the `<video>` branch. Render the avatar directly inside the stage with a poster fallback in `Suspense`. Remove the "intro clip" wording from the caption; keep a short caption about the avatar.
- [ ] **Step 3:** In `ProfileAvatar.tsx`, point `useGLTF` at the stylized GLB if present (`profile/avatar-stylized.glb`), else `profile/avatar.glb`. Improve presentation: a subtle turntable/auto-rotate, nicer key/rim lighting, a soft contact shadow, and an accent-tinted gradient backdrop. Keep it `Suspense`-friendly.
- [ ] **Step 4:** Remove the now-unused `intro.mp4` reference. (Leave the file in `public/` to avoid a risky delete; just stop referencing it. Do NOT reference your personal video anywhere.)
- [ ] **Step 5 (verify):** lint + build pass. Browser: Profile page shows the 3D avatar, no video, no toggle; avatar rotates/looks polished; poster shows on slow load.
- [ ] **Step 6:** Commit: `feat(profile): replace intro video with a stylized 3D avatar`.

---

## Task 4: Explorer run animation (real clip → procedural fallback)

**Files:**
- Modify: `site/src/world/Characters.tsx`
- Add (if fetched): `site/public/world/models/explorer-run.glb`

**Interfaces:**
- Consumes: existing `Player` component, `actions.walk` / `actions.idle`.
- Produces: a distinct run state — either a third `run` clip or a procedural run layer applied when `run` is true.

- [ ] **Step 1:** Attempt to fetch a free rigged humanoid run clip (e.g. Mixamo-style / CC0) and retarget to the explorer rig. If bone names match the explorer skeleton, save `explorer-run.glb`, load it like `explorer-idle.glb`, add a `run` clip named `'run'`, and `fadeTo('run')` when `run` is true.
- [ ] **Step 2 (fallback — expected path):** If retargeting fails, keep the walk clip but make running read clearly: when `run` is true, increase `timeScale` AND add a procedural layer on the model group — forward torso lean (rotate model ~0.12rad), vertical bob synced to a faster cadence, and a slight stride-scale. Apply only while `speed` is high and `run` is true; ease out when walking.
- [ ] **Step 3:** Ensure walking (non-run) is visually unchanged. Ensure idle still plays when stopped.
- [ ] **Step 4 (verify):** lint + build pass. Browser: enter explore (⌘K), hold Shift to run — running now looks distinct from walking (faster cadence + lean + bob), walking unchanged, idle when still.
- [ ] **Step 5:** Commit: `feat(world): give the explorer a distinct run animation`.

---

## Task 5: Fix intermittent black-screen in explore mode

**Files:**
- Create: `site/src/world/CanvasErrorBoundary.tsx`
- Modify: `site/src/world/WorldCanvas.tsx`
- Modify: `site/src/App.tsx` (wrap)

**Interfaces:**
- Produces: `CanvasErrorBoundary` React error boundary; WebGL `webglcontextlost`/`webglcontextrestored` handling inside the Canvas via `onCreated`.

- [ ] **Step 1 (reproduce/localize):** Identify black-screen causes. Known risks in `WorldCanvas.tsx`: (a) WebGL context loss has no handler → permanent black; (b) an uncaught error in any 3D child throws up to the app with no boundary; (c) `EffectComposer` failing on low-end GPUs can blank the frame; (d) `Suspense fallback={null}` means nothing paints while large GLBs load, which can look like a black screen with the `#9fc0de` bg replaced if the color node errors.
- [ ] **Step 2:** In `WorldCanvas.tsx` `onCreated`, add `gl.domElement.addEventListener('webglcontextlost', e => { e.preventDefault(); })` and `'webglcontextrestored'` to let three re-init; set `gl.getContext().isContextLost()` guard. Call `state.invalidate()` on restore.
- [ ] **Step 3:** Create `CanvasErrorBoundary.tsx` (class component) that catches render errors from the 3D tree and renders `null` (so the 2D `Background` shows through) instead of a black void; log to console. Wrap `<WorldCanvas/>` in `App.tsx` with it.
- [ ] **Step 4:** Guard the composer: wrap `<EffectComposer>` children so that if postprocessing is unavailable the scene still renders unprocessed (e.g. render EffectComposer only when `high` or gate behind a try; at minimum ensure Bloom/Vignette failing cannot blank the frame). Simplest robust option: keep EffectComposer but ensure a plain render path exists if it throws (boundary handles it).
- [ ] **Step 5:** Ensure the `<color attach="background">` and fog always apply so a stalled load shows sky-blue, never pure black.
- [ ] **Step 6 (verify):** lint + build pass. Browser: enter/exit explore repeatedly, resize window, switch tabs/routes while in explore, force a context loss via DevTools (`WEBGL_lose_context`) — screen recovers to sky or site, never stays black. Capture screenshots across a few transitions.
- [ ] **Step 7:** Commit: `fix(world): recover from WebGL context loss and render errors instead of black screen`.

---

## Task 6: Creature ("Critter") + jump-on bounce

**Files:**
- Create: `site/src/world/Critter.tsx`
- Modify: `site/src/world/WorldCanvas.tsx` (mount it)

**Interfaces:**
- Consumes: `player` (position) from `Characters.tsx`, `heightAt` from `terrain`, `useWorld`/`world` store.
- Produces: `<Critter/>` component; exports creature position for spell targeting (`critter.pos: THREE.Vector3`, `critter.state`).

- [ ] **Step 1:** Create a `critter` shared object (like `player`) holding `pos`, `vy`, `grounded`, `mood`, `scale`, `effect` (current spell effect + timer).
- [ ] **Step 2:** Build the creature mesh procedurally (no asset dependency): a rounded body (sphere/capsule), big eyes, little legs/ears — a funny PalWorld-ish blob. Use simple materials; give it an idle wobble and a hop-wander AI that roams near the hub region and gently follows/avoids the player.
- [ ] **Step 3:** Jump-on bounce: each frame, if the player is above the critter and descending and horizontally within radius, bounce the player up (set player `vy`) and squash the critter (scale y down then spring back), play a sound via `lib/sound`. Mario-style.
- [ ] **Step 4:** Mount `<Critter/>` in `WorldCanvas` inside the `playing` guard (only in explore mode) within a `Suspense`.
- [ ] **Step 5 (verify):** lint + build pass. Browser: in explore mode a funny creature wanders; jumping on it bounces you and squashes it.
- [ ] **Step 6:** Commit: `feat(world): add a wandering creature you can bounce on`.

---

## Task 7: Spell registry + cast input (8 randomized spells)

**Files:**
- Create: `site/src/world/spells.ts`
- Modify: `site/src/world/controls.ts`
- Modify: `site/src/world/PlayHud.tsx` (hint)

**Interfaces:**
- Produces: `SPELLS` array of 8 `Spell` defs (`id`, `name`, `duration`, `apply(critter)`), `randomSpell()`, a `cast` queue the FX layer reads. `controls.cast` boolean + a `castQueue` of `{spell, at}`.

- [ ] **Step 1:** Define `Spell` type and the 8 spells: **bloom** (morph to flower), **shrink**, **grow**, **freeze** (ice block), **bounce/launch** (comedic spin into air), **rockDrop** (a boulder falls on it), **carRun** (a car zooms through), **gunShot** (wand→gun, projectile + knockback), plus **lightning** (electric shock from sky). That's 9 — keep all; `randomSpell()` picks uniformly. (User explicitly listed rock, car, gun, lightning as additions.)
- [ ] **Step 2:** In `controls.ts`, add `controls.cast = false` and set it on left mouse click (pointerdown on canvas, distinct from drag-look: treat a quick click without drag as a cast) and on a key (e.g. `KeyF`). Add a small `castRequested` flag consumed per frame.
- [ ] **Step 3:** On cast, pick `randomSpell()`, apply its effect to the critter (set `critter.effect`), and push an FX event. Wand has two modes conceptually; gun spell swaps visuals.
- [ ] **Step 4:** In `PlayHud.tsx`, add a hint line: "Click / F — cast a random spell" and show the last spell name briefly.
- [ ] **Step 5 (verify):** lint + build pass. Browser: clicking or pressing F near/at the critter triggers a random spell; HUD shows the spell name.
- [ ] **Step 6:** Commit: `feat(world): random spell casting (click / F) with 9 spell types`.

---

## Task 8: Spell visual effects

**Files:**
- Create: `site/src/world/SpellFx.tsx`
- Modify: `site/src/world/Critter.tsx` (react to `critter.effect`)
- Modify: `site/src/world/WorldCanvas.tsx` (mount `<SpellFx/>`)

**Interfaces:**
- Consumes: `critter`, `SPELLS`, the cast queue from `spells.ts`.
- Produces: `<SpellFx/>` that renders transient meshes/particles per active spell and cleans them up on timeout.

- [ ] **Step 1:** Implement each effect driven by `critter.effect`:
  - **bloom:** hide body, grow a flower (petals via cones + stem), revert after duration.
  - **shrink/grow:** tween `critter.scale`.
  - **freeze:** wrap critter in a translucent ice box, add a shiver, melt out.
  - **bounce/launch:** set critter `vy` high + spin, land.
  - **rockDrop:** spawn a boulder above, drop with gravity, impact puff, squash critter, remove.
  - **carRun:** a simple car mesh zooms along a line through the critter, knocks it spinning, drives off.
  - **gunShot:** muzzle flash + a fast projectile from player→critter, knockback.
  - **lightning:** a bright bolt (stretched emissive quad/line) from sky + flash + scorch, brief stun.
- [ ] **Step 2:** All effects are time-boxed and self-removing; never leak meshes (dispose or unmount via React state list).
- [ ] **Step 3:** Mount `<SpellFx/>` in `WorldCanvas` under the `playing` guard.
- [ ] **Step 4 (verify):** lint + build pass. Browser: cast repeatedly — each of the 9 effects fires, looks funny, and cleans up; no console errors; framerate stays reasonable.
- [ ] **Step 5:** Commit: `feat(world): visual effects for all spell types`.

---

## Task 9: Final integration verify + polish

**Files:** any touched above.

- [ ] **Step 1:** Full `cd site && npm run lint && npm run build` — 0 errors, build passes.
- [ ] **Step 2:** Browser smoke test the whole flow: three tabs; FootballIQ embed; profile avatar (no video); run animation; repeated explore enter/exit with no black screen; creature bounce; all 9 spells via click and F.
- [ ] **Step 3:** Check mobile/low-tier path still loads (the `quality()` low path) and nothing crashes when 3D is disabled (`?lite`).
- [ ] **Step 4:** Commit any polish: `polish: portfolio updates pass`.

---

## Self-Review Notes

- **Spec coverage:** three tabs (T1) ✓, FootballIQ full-page iframe (T2) ✓, remove video + stylized avatar (T3) ✓, run animation with procedural fallback (T4) ✓, black-screen fix (T5) ✓, creature + jump-on + spells incl. bloom/shrink/grow/freeze/bounce + rock/car/gun/lightning + randomized (T6–T8) ✓.
- **Asset risk:** T3 (avatar GLB) and T4 (run GLB) depend on finding free assets; both have procedural/existing-asset fallbacks so they never block.
- **Iframe risk:** verified FootballIQ sends no X-Frame-Options/CSP frame-ancestors → embeddable; new-tab fallback included regardless.
- **No test runner:** verification is lint + build + browser, as the project has no unit tests; this is intentional and matches the repo.
