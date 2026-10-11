# Rebuilding the arena for the site

The WebGL build in `site/public/games/arena/` is produced by Unity and committed as is. After changing anything under
`Assets/Arena` (maps, weapons, HUD, textures), rebuild it:

1. Open `unity/ArenaShooter` in **Unity 6000.0** (the project pins 6000.0.84f1) with **WebGL Build Support**.
   Let the first import finish (it also imports the new textures in `Assets/Arena/Textures`).
2. Run **Arena → 1. Generate Scene and Prefabs**. This is required whenever maps or prefabs change: it rebuilds the
   materials (including the new per-map tints, cloth, foliage and window materials), the player and bot prefabs (with
   the weapon glow), the pickup prefab (with the four weapon-crate visuals), every map, one NavMesh across all of
   them, and `Assets/Arena/Scenes/Arena.unity`. The committed scene only knows the first three maps until you do this.
3. Press **Play** and check each map from the menu: walk the ramps, try 1–5, right click and the sniper scope.
4. Run **Arena → 2. Build WebGL into Portfolio Site**. It writes straight into `site/public/games/arena/`.
5. In `site/`, run `npm run dev` and open the Arena page to try the build embedded; then commit
   `site/public/games/arena/` together with the Unity changes.

Or, from a terminal (Unity activated; adjust the editor path for your machine):

```bash
/Applications/Unity/Hub/Editor/6000.0.84f1/Unity.app/Contents/MacOS/Unity \
  -batchmode -quit -projectPath unity/ArenaShooter \
  -executeMethod Arena.EditorTools.ArenaSetup.GenerateAndBuild -logFile -
```

Until the build is redone, the site keeps working with the old build: it ignores `gun=`, and the new map ids
(`sandstorm`, `villa`, `bazaar`) fall back to Dunes.

The procedural textures can be regenerated with `python3 Tools/make_textures.py` (needs numpy and Pillow) before
step 2.
