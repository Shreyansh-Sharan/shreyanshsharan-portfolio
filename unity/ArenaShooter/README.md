# Dunes Arena

A lightweight browser FPS for the portfolio site: an original desert map with the classic two-site flow (long lane
to A, catwalk from mid, tunnels to B, mid doors), powers, power-ups, AI bots and online matches with friends.

![Top-down map](dunes-map.png)

## What's in it

- **Modes:** solo vs 0–9 AI bots (easy / normal / hard), host an online match and share a join code, or join with a code.
  Bots also fill online matches.
- **Powers:** double jump (Space twice), dash (Q or Shift), overshield (E), pulse scan that reveals enemies through
  walls (F), zoom (right click).
- **Power-ups on the map:** health, shield cells, Overdrive (double damage) and Haste (speed).
- **Rules:** free-for-all deathmatch, first to 20 kills or highest score after 8 minutes, then a new round.
- **Lightweight:** the map, characters and effects are built from primitives in code, and sounds are synthesised,
  so there are no textures, models or audio files to download.

## Set up on a Mac

1. Install **Unity Hub**, then **Unity 6000.0 LTS** (the project pins 6000.0.84f1; any 6000.0.x works) with
   the **WebGL Build Support** module. Apple Silicon is supported natively.
2. In Unity Hub choose **Add → Add project from disk** and pick `unity/ArenaShooter`. The first open downloads the
   packages listed in `Packages/manifest.json`.
3. In the Unity menu bar run **Arena → 1. Generate Scene and Prefabs**. This creates the materials, the player,
   bot and pickup prefabs, the map, the bots' NavMesh and `Assets/Arena/Scenes/Arena.unity`.
4. Open that scene and press **Play**. Use **Play vs bots** to try it immediately.

### Online play (optional)

Online matches use Unity Multiplayer Services (sessions over Relay, secure WebSockets so browsers can join).

1. **Edit → Project Settings → Services**: link the project to a Unity Cloud project (free).
2. In the Unity Cloud dashboard enable **Relay** and **Lobby** for that project.
3. **Host online match** shows an invite code; friends enter it under **Join**, or open the site's invite link.

Solo mode works without any of this.

## Build into the portfolio site

Run **Arena → 2. Build WebGL into Portfolio Site**. It writes the build to `site/public/games/arena/`, which the
site's Arena page loads in an iframe. Commit that folder and push; the site's GitHub Pages workflow publishes it.

From the command line (Unity must be activated):

```bash
/Applications/Unity/Hub/Editor/6000.0.84f1/Unity.app/Contents/MacOS/Unity \
  -batchmode -quit -projectPath unity/ArenaShooter \
  -executeMethod Arena.EditorTools.ArenaSetup.GenerateAndBuild
```

The build uses Gzip with decompression fallback (works on GitHub Pages), Medium code stripping and a minimal custom
loading page (`Assets/WebGLTemplates/Arena`).

## How the page talks to the game

The site starts the game with URL parameters, for example
`games/arena/index.html?mode=solo&bots=5&diff=1&name=Ana` or `?mode=join&code=ABC123`. The game reports back with
`postMessage({ source: 'arena', type, payload })`, where type is `ready`, `started`, `code` (the join code to share),
`error` or `left`.

## Code map

| Path | What it does |
| --- | --- |
| `Scripts/Map/DunesLayout.cs` | The map as data: open areas, door frames, tunnels, crates, spawns, pickups, bot waypoints |
| `Scripts/Map/MapBuilder.cs` | Turns the layout into buildings, neon trims, site plates and signs |
| `Scripts/Core/ArenaBootstrap.cs` | Reads launch options and starts solo, host or join |
| `Scripts/Core/SessionService.cs` | Multiplayer Services sessions (Relay, join codes) |
| `Scripts/Game/Combatant.cs` | Health, shield, score, buffs and respawn, shared by players and bots (server-owned) |
| `Scripts/Game/PlayerController.cs` | First-person movement and powers (owner-authoritative for instant feel) |
| `Scripts/Game/Weapon.cs` | Hitscan pulse rifle: client-detected hits, server-applied damage |
| `Scripts/Game/BotBrain.cs` | AI: roam, spot, strafe, shoot with skill-based aim, grab health, use overshield |
| `Scripts/Game/Pickup.cs`, `MatchManager.cs` | Power-ups, deathmatch rules, kill feed |
| `Scripts/UI/ArenaHud.cs` | Menu and HUD (IMGUI, no UI assets) |
| `Scripts/Fx/*` | Pooled effects and synthesised sounds |
| `Editor/ArenaSetup.cs` | Generates everything and builds WebGL |

Tuning lives in public fields and constants: weapon damage and fire rate in `Weapon`, movement and cooldowns in
`PlayerController`, bot skill levels in `BotBrain.Skills`, kill limit and match length in `MatchManager`.
