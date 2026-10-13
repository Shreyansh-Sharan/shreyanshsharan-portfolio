# NEON SIEGE · asset credits

Everything else in the game (maps, neon signs, holo-ads, effects, sounds, UI, key art) is generated in code.
Kenney files are CC0 1.0 (public domain); the licence text ships inside each original download. The catalog props are
licensed to the site owner and are not CC0: do not redistribute them outside this site.

| File(s) | Source | Licence |
| --- | --- | --- |
| `models/hero-*.glb` (6 characters: m, q, d, r, h, g of the pack) | Kenney "Blocky Characters" 2.0, https://kenney.nl/assets/blocky-characters | CC0 1.0 |
| `models/gun-*.glb` (blasters h, e, i, k, j, a), `models/crate-small.glb`, `models/crate-medium.glb`, `models/grenade.glb` | Kenney "Blaster Kit" 2.1, https://kenney.nl/assets/blaster-kit | CC0 1.0 |
| `models/ammo-crate.glb`, `supply-crate`, `barrel-stack`, `sandbag-stack`, `checkpoint-barrier`, `generator-unit`, `security-bollard`, `service-dumpster`, `transformer-kiosk`, `transit-shelter`, `led-streetlight`, `giant-billboard`, `media-facade`, `neon-shop-sign`, `neon-storefront`, `hotel-neon-blade`, `corner-shop`, `retail-infill`, `metro-headhouse`, `taxi`, `box-truck` | Low-poly props from the site owner's licensed 3D asset library (vertex-coloured, no textures) | Licensed to the site owner |

Conversion: `gltf-transform optimize --compress meshopt --texture-compress webp --texture-size 512` (no geometry
simplification). Characters use the pack's node-driven animation clips (idle, walk, sprint, die, holding-right-shoot).

Fictional brands on the holo-ads (ORBIT COLA, ZENITH MOBILE, LUMEN ENERGY, HALCYON TYRES, NORTHWIND AIR, KETTLE &
CRUMB, PINEWOOD BANK, SKYLARK TRAVEL, IRONLEAF, GRAINFIELD) are the site's own invented sponsors.
