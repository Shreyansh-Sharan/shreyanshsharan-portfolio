# NEON SIEGE · asset credits

The heroes and the arena pieces are Creative Commons models from Sketchfab, used under
[CC BY 4.0](http://creativecommons.org/licenses/by/4.0/) (converted to meshopt-compressed GLB with WebP textures,
decimated where noted; no other changes). The same list is shown in the game's menu under "Model credits".
Everything else (maps, neon signs, holo-ads, effects, sounds, UI, key art) is generated in code.

## Heroes (CC BY 4.0)

| Hero | Model | Author | Model page |
| --- | --- | --- | --- |
| ROOK (`models/char-rook.glb`) | Futuristic soldier (lowpoly) | [SlagPerch 3D](https://sketchfab.com/slagperch3d) | https://sketchfab.com/3d-models/futuristic-soldier-lowpoly-5ebade1ccbff4adb91ddd3a4d1fcd541 |
| WREN (`models/char-wren.glb`; its clips also drive the other heroes, see below) | Star Soldier | [Suvalien](https://sketchfab.com/Suvalien) | https://sketchfab.com/3d-models/star-soldier-97ac0915492341148fe2419a1964f097 |
| FURNACE (`models/char-furnace.glb`, decimated to 12k faces) | Evil Robot – Game-Ready | [CharlieCatling](https://sketchfab.com/charliecatling) | https://sketchfab.com/3d-models/evil-robot-game-ready-5918ff9fae3342e59a76a919bf89391a |
| FLICK (`models/char-flick.glb`) | Cyber-diva Mark-2 | [SmugglersStudio](https://sketchfab.com/SmugglersStudio) | https://sketchfab.com/3d-models/cyber-diva-mark-2-5fa032f5076247b6a0665f20fe226323 |
| PIKE (`models/char-pike.glb`, decimated to 11k faces, sword removed) | Animated Stylized Character - Rogue Warrior | [Karthik Naidu](https://sketchfab.com/Karthiknaidu97) | https://sketchfab.com/3d-models/animated-stylized-character-rogue-warrior-e49c999cc7ce4668a7fdeff328ad0b93 |
| SALVE (`models/char-salve.glb`) | Rigged, animated Character free | [Cris](https://sketchfab.com/cristopher.faundez) | https://sketchfab.com/3d-models/rigged-animated-character-free-a950d1e0b2574fbd9ced0c6d6e0bb9b3 |

### Animation clips shared across the cast (CC BY 4.0)

Four of the heroes ship without fire or death animations, so the game retargets clips from two of the models
above onto every rig (world-space rotation deltas with per-bone rest alignment, baked into each `char-*.glb`;
locomotion cycles are re-phased and carry their measured ground speed). Strafing, backpedalling, hit flinches,
recoil and the dash lunge are derived procedurally at runtime from these clips.

| Clips | Used on | Model | Author | Model page |
| --- | --- | --- | --- | --- |
| `aim` (idle), `fire`, `fire2`, `death` | ROOK, FURNACE (aim/fire only), FLICK, PIKE, SALVE | Star Soldier | [Suvalien](https://sketchfab.com/Suvalien) | https://sketchfab.com/3d-models/star-soldier-97ac0915492341148fe2419a1964f097 |
| `walk` | FLICK | Futuristic soldier (lowpoly) | [SlagPerch 3D](https://sketchfab.com/slagperch3d) | https://sketchfab.com/3d-models/futuristic-soldier-lowpoly-5ebade1ccbff4adb91ddd3a4d1fcd541 |

## Arenas and props (CC BY 4.0)

| File | Used for | Model | Author | Model page |
| --- | --- | --- | --- | --- |
| `models/env-shutter.glb` | Wall cladding (shutters) | Alley Shop | [Ted Mebratu](https://sketchfab.com/paraside) | https://sketchfab.com/3d-models/alley-shop-d78ed5e713534fada31d4aaa45e6a394 |
| `models/env-shop-a.glb` | Shop fronts around the street maps | Asian Shop #11 | [carlcapu9](https://sketchfab.com/carlcapu9) | https://sketchfab.com/3d-models/asian-shop-11-59ab89e8a6784f20a8f561f8804439d5 |
| `models/env-building-1..6.glb` (split per building, decimated) | Towers around the arenas | Sci-fi Buildings Pack (low-poly, game ready) | [TampaJoey](https://sketchfab.com/TampaJoey) | https://sketchfab.com/3d-models/sci-fi-buildings-pack-low-poly-game-ready-333a430644b34e688aecfdc874f4cbf2 |
| `models/env-hk-alley.glb` (decimated) | Kessho Row backdrop block | Hong Kong buildings Alley-2k+ followers:) | [Pasha](https://sketchfab.com/Pasha.) | https://sketchfab.com/3d-models/hong-kong-buildings-alley-2k-followers-8192b1cd4a8144c88163c43a3a6abb3f |
| `models/env-city.glb` (decimated) | Distant skyline | Cyberpunk City - #1 | [John Doe](https://sketchfab.com/born2012) | https://sketchfab.com/3d-models/cyberpunk-city-1-14d2eaa145ee42938e004115871adf6c |
| `models/env-neon-blade.glb` (decimated) | Blade signs on walls | Game Ready Japanese Small Vertical Neon Sign | [Alex Bes](https://sketchfab.com/alexbescg) | https://sketchfab.com/3d-models/game-ready-japanese-small-vertical-neon-sign-5849c107ecb7472bb1eef028f5b97f0d |
| `models/env-skybox.glb` | Sky | FREE - SkyBox Dystopian Alleyway | [Paul](https://sketchfab.com/paul_paul_paul) | https://sketchfab.com/3d-models/free-skybox-dystopian-alleyway-80ddc539289a4a439c0e3ea4e59e2b84 |
| `models/env-crate-neon.glb` | Crates | Sci-fi Crate | [Darren McNerney 3D](https://sketchfab.com/DarrenMcnerney3D) | https://sketchfab.com/3d-models/sci-fi-crate-0e60a62a8f1e4048b638a32eb0661015 |
| `models/env-crate-yellow.glb` | Crates | Basic Sci-Fi Crate | [LaVADraGoN](https://sketchfab.com/lavadragon) | https://sketchfab.com/3d-models/basic-sci-fi-crate-042201dac61041fabb88f483368daa3f |
| `models/env-crate-lp.glb` | Crates | Low Poly Sci-Fi crate | [Tom.McCahey](https://sketchfab.com/Tom.McCahey) | https://sketchfab.com/3d-models/low-poly-sci-fi-crate-5f328b69346a42bc8fb6e4c03b17bdd5 |
| `models/env-crate-military.glb` | Crates | Military Crate | [LuddePudde](https://sketchfab.com/luddepubde) | https://sketchfab.com/3d-models/military-crate-19c943e409644a8281cc96f63e6743c6 |
| `models/env-loot-chest.glb` | Grid Royale loot crates | Openable Crate / Loot Box  / Chest | [Shaz](https://sketchfab.com/shaz13) | https://sketchfab.com/3d-models/openable-crate-loot-box-chest-93d4333ad5764cf7941744b09cafff78 |
| `models/env-case.glb` | Low cover | Sci fi Case | [KonstantinaBeratze](https://sketchfab.com/KonstantinaBeratze) | https://sketchfab.com/3d-models/sci-fi-case-c59c954c785b4b4488362ef8bb866dfe |
| `models/env-terminal.glb` | Kiosks | Reston B2 Terminal | [Iteration Unlimited](https://sketchfab.com/iterationunlimited) | https://sketchfab.com/3d-models/reston-b2-terminal-91b08809f18244628385193e396dd3da |
| `models/env-rails.glb` | Railings and barriers | Metal Rails JFG | [Jesus Fernandez Garcia](https://sketchfab.com/jamyzgenius) | https://sketchfab.com/3d-models/metal-rails-jfg-257d620e3a254a4a8b7980a856e88ce8 |
| `models/env-vent.glb` | Rooftop vents | Rooftop 1 HD JFG - Roblox Showcase Prop | [Jesus Fernandez Garcia](https://sketchfab.com/jamyzgenius) | https://sketchfab.com/3d-models/rooftop-1-hd-jfg-roblox-showcase-prop-a1bc290c55ee4d93b220b45bf3a6ae8a |
| `models/env-vent-tall.glb` | Rooftop vents | Rooftop 2 HD JFG - Roblox Showcase Prop | [Jesus Fernandez Garcia](https://sketchfab.com/jamyzgenius) | https://sketchfab.com/3d-models/rooftop-2-hd-jfg-roblox-showcase-prop-7a3e4c39319745dc87ecca97fe315741 |
| `models/env-dish.glb` (decimated) | Helipad dish | Old Scifi satellite dish | [CGKnuenz](https://sketchfab.com/Knuenzj) | https://sketchfab.com/3d-models/old-scifi-satellite-dish-f01a91e9773e4622b25c4d27903e85c6 |
| `models/env-bridge.glb` (decimated) | Helipad truss | Stylised Low Poly - City Metal Bridge | [remidoes3d](https://sketchfab.com/remidoes3d) | https://sketchfab.com/3d-models/stylised-low-poly-city-metal-bridge-674aee9cfd7b478b93c2f3e2d7026a0c |
| `models/env-turnstiles.glb` | Underpass gates | Low Poly Turnstiles | [anDDDres](https://sketchfab.com/anDDDres) | https://sketchfab.com/3d-models/low-poly-turnstiles-12536f966f9048dcba7e33fa08d9d6b5 |
| `models/env-train.glb` | Underpass carriages | LowPoly 3D Train | [Ajaya Tamang Moktan](https://sketchfab.com/ajaa) | https://sketchfab.com/3d-models/lowpoly-3d-train-eefc996de2be46fa8eccc6853c765aa4 |
| `models/env-station.glb` (decimated) | Underpass concourse | Subway station | [Pasha](https://sketchfab.com/Pasha.) | https://sketchfab.com/3d-models/subway-station-fa31f1ebe8cb437f9c753b22b3fdfc55 |
| `models/env-hover-car.glb` (decimated) | Parked cars | Hover-Car - Low-Poly, Sci-Fi, Game-Ready | [Mert Tetik](https://sketchfab.com/merttetik) | https://sketchfab.com/3d-models/hover-car-low-poly-sci-fi-game-ready-95fc47d2715247f89c8e359dc1838b14 |
| `models/env-car-1.glb` | Parked cars | sci-fi car low-poly | [LOST](https://sketchfab.com/faraon666rdsv) | https://sketchfab.com/3d-models/sci-fi-car-low-poly-9fbf7336ee7a4046a4e057e24528ab96 |
| `models/env-car-2.glb` | Parked cars | sci-fi car low-poly | [LOST](https://sketchfab.com/faraon666rdsv) | https://sketchfab.com/3d-models/sci-fi-car-low-poly-63083240f5314baeb9214471a5016694 |
| `models/env-drone.glb` | WREN's Sentry Pod | Futuristic flying animated Robot - Low Poly | [Shayan](https://sketchfab.com/mshayan02) | https://sketchfab.com/3d-models/futuristic-flying-animated-robot-low-poly-c5b92c281dc444448e64c0607719c7a2 |

## Other files

| File(s) | Source | Licence |
| --- | --- | --- |
| `models/gun-*.glb` (blasters h, e, i, k, j, a), `models/grenade.glb` | Kenney "Blaster Kit" 2.1, https://kenney.nl/assets/blaster-kit | CC0 1.0 |
| `models/led-streetlight.glb`, `media-facade`, `giant-billboard`, `box-truck` | Low-poly props from the site owner's licensed 3D asset library (vertex-coloured, no textures) | Licensed to the site owner; do not redistribute outside this site |
| `portraits/*.webp`, `keyart.webp` | Rendered in-engine from the models above | Derived works, same CC BY attribution applies |

Conversion: `@gltf-transform` (prune, dedup, flatten/join for static pieces, meshopt simplify where noted, WebP
textures at 512–1024 px, meshopt compression). Characters keep their skeletons; their clips are resampled at 30 fps
under the canonical names listed in `src/siege/engine/assets.ts` (idle, walk, run, aim, fire, fire2, death, super),
with the retargeted clips credited above.

Fictional brands on the holo-ads (ORBIT COLA, ZENITH MOBILE, LUMEN ENERGY, HALCYON TYRES, NORTHWIND AIR, KETTLE &
CRUMB, PINEWOOD BANK, SKYLARK TRAVEL, IRONLEAF, GRAINFIELD) are the site's own invented sponsors.
