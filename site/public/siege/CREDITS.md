# NEON SIEGE · asset credits

The six heroes, their blasters and most of the arena (crates, barrels, loot chests, kiosks, vents, dish, sentry
drone, turnstiles, shutters, cars, hover car, box truck, train, barriers, truss bridges, neon blade signs,
billboard, streetlights and the six towers) are original models made for this project. They need no credit.

The hero animation clips and a few backdrop pieces are Creative Commons models from Sketchfab, used under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) (converted to meshopt-compressed GLB with WebP textures,
decimated where noted). The same list is shown in the game's menu under "Model credits". Everything else (maps,
neon wall signs, holo-ads, effects, sounds, UI, key art) is generated in code.

## Hero animation clips (CC BY 4.0)

Every hero shares one humanoid rig. Clips from the characters below are retargeted onto it (world-space rotation
deltas with per-bone rest alignment, baked into each `char-*.glb`; locomotion cycles are re-phased and carry their
measured ground speed). Strafing, backpedalling, hit flinches, recoil and the dash lunge are derived procedurally at
runtime from these clips. Only the motion is used; none of these characters' meshes or textures ship.

| Clips | Used on | Model | Author | Model page |
| --- | --- | --- | --- | --- |
| `aim`, `fire`, `fire2`, `death` (all heroes except FURNACE's death); `idle`, `walk`, `run`, `super` (WREN); `super` (ROOK) | all six heroes | Star Soldier | [Suvalien](https://sketchfab.com/Suvalien) | https://sketchfab.com/3d-models/star-soldier-97ac0915492341148fe2419a1964f097 |
| `idle`, `walk`, `run` (ROOK); `walk` (FLICK) | ROOK, FLICK | Futuristic soldier (lowpoly) | [SlagPerch 3D](https://sketchfab.com/slagperch3d) | https://sketchfab.com/3d-models/futuristic-soldier-lowpoly-5ebade1ccbff4adb91ddd3a4d1fcd541 |
| `idle`, `walk`, `death`, `super` | FURNACE | Evil Robot – Game-Ready | [CharlieCatling](https://sketchfab.com/charliecatling) | https://sketchfab.com/3d-models/evil-robot-game-ready-5918ff9fae3342e59a76a919bf89391a |
| `idle`, `run`, `super` | FLICK | Cyber-diva Mark-2 | [SmugglersStudio](https://sketchfab.com/SmugglersStudio) | https://sketchfab.com/3d-models/cyber-diva-mark-2-5fa032f5076247b6a0665f20fe226323 |
| `idle`, `walk`, `run`, `super` | PIKE | Animated Stylized Character - Rogue Warrior | [Karthik Naidu](https://sketchfab.com/Karthiknaidu97) | https://sketchfab.com/3d-models/animated-stylized-character-rogue-warrior-e49c999cc7ce4668a7fdeff328ad0b93 |
| `idle`, `walk`, `run`, `super` | SALVE | Rigged, animated Character free | [Cris](https://sketchfab.com/cristopher.faundez) | https://sketchfab.com/3d-models/rigged-animated-character-free-a950d1e0b2574fbd9ced0c6d6e0bb9b3 |

## Backdrop pieces (CC BY 4.0)

| File | Used for | Model | Author | Model page |
| --- | --- | --- | --- | --- |
| `models/env-shop-a.glb` | Shop fronts around the street maps | Asian Shop #11 | [carlcapu9](https://sketchfab.com/carlcapu9) | https://sketchfab.com/3d-models/asian-shop-11-59ab89e8a6784f20a8f561f8804439d5 |
| `models/env-hk-alley.glb` (decimated) | Kessho Row backdrop block | Hong Kong buildings Alley-2k+ followers:) | [Pasha](https://sketchfab.com/Pasha.) | https://sketchfab.com/3d-models/hong-kong-buildings-alley-2k-followers-8192b1cd4a8144c88163c43a3a6abb3f |
| `models/env-city.glb` (decimated) | Distant skyline | Cyberpunk City - #1 | [John Doe](https://sketchfab.com/born2012) | https://sketchfab.com/3d-models/cyberpunk-city-1-14d2eaa145ee42938e004115871adf6c |
| `models/env-skybox.glb` | Sky | FREE - SkyBox Dystopian Alleyway | [Paul](https://sketchfab.com/paul_paul_paul) | https://sketchfab.com/3d-models/free-skybox-dystopian-alleyway-80ddc539289a4a439c0e3ea4e59e2b84 |
| `models/env-case.glb` | Low cover | Sci fi Case | [KonstantinaBeratze](https://sketchfab.com/KonstantinaBeratze) | https://sketchfab.com/3d-models/sci-fi-case-c59c954c785b4b4488362ef8bb866dfe |
| `models/env-station.glb` (decimated) | Underpass concourse | Subway station | [Pasha](https://sketchfab.com/Pasha.) | https://sketchfab.com/3d-models/subway-station-fa31f1ebe8cb437f9c753b22b3fdfc55 |

## Other files

| File(s) | Source | Licence |
| --- | --- | --- |
| `models/grenade.glb` | Kenney "Blaster Kit" 2.1, https://kenney.nl/assets/blaster-kit | CC0 1.0 |
| `models/media-facade.glb` | Low-poly prop from the site owner's licensed 3D asset library (vertex-coloured, no textures) | Licensed to the site owner; do not redistribute outside this site |
| `portraits/*.webp`, `keyart.webp` | Rendered in-engine from the models above | Derived works; the clip credits above apply to the posed heroes |

Conversion: `@gltf-transform` (prune, dedup, weld, meshopt simplify, WebP textures at 512–1024 px, quantize,
meshopt compression). Neon parts of the original props carry an emissive mask cut from their base colour. Heroes
keep their skeletons; their clips are resampled at 30 fps under the canonical names listed in
`src/siege/engine/assets.ts` (idle, walk, run, aim, fire, fire2, death, super).

Fictional brands on the holo-ads (ORBIT COLA, ZENITH MOBILE, LUMEN ENERGY, HALCYON TYRES, NORTHWIND AIR, KETTLE &
CRUMB, PINEWOOD BANK, SKYLARK TRAVEL, IRONLEAF, GRAINFIELD) are the site's own invented sponsors.
