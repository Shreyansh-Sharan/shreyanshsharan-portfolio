# Rebuilding the cricket game for the site

The site's Cricket page (`#/cricket`, `site/src/components/Cricket.tsx`) iframes the WebGL build in
`site/public/games/cricket/`. Until a build is published there, the page shows a "build isn't published yet" notice.
The build is produced by Unity and committed as is.

## One-time setup

1. Install **Unity 6000.0 LTS** (the project pins `6000.0.84f1`; any 6000.0.x works) with **WebGL Build Support**
   from Unity Hub.
2. In Unity Hub, choose **Add → Add project from disk** and pick `unity/CricketGame`. The first open resolves the
   packages in `Packages/manifest.json` and imports the model and textures. This takes a few minutes.
3. When it finishes, a dialog offers to generate the scene. Click **Generate now**, or run step 1 below.

## Every rebuild

1. Run **Cricket → 1. Generate Scene and Prefabs**. This (re)creates:
   - the materials, the `Cricketer` prefab (the CC0 body with LODs and kit materials), and the `NetMatch` network prefab;
   - `Assets/Cricket/Scenes/Cricket.unity` (bootstrap, director, view, camera rig, network manager, HUD);
   - `Assets/Cricket/link.xml`;
   - the WebGL player settings (Brotli with decompression fallback, IL2CPP Optimize Size, Master, High stripping,
     Explicitly Thrown Exceptions Only, shader stripping, the `Cricket` WebGL template).

   It is safe to run as often as you like.
2. Press **Play** and try a quick T10 from the menu: bat an over, bowl an over, and press `Tab` for the scorecard.
3. Run **Cricket → 2. Build WebGL into Portfolio Site**. It writes straight into `site/public/games/cricket/`, and the
   Console prints the build size.
4. In `site/`, run `npm run dev` and open `#/cricket`. The lobby shows a loading bar while the build preloads; press
   Play. Then commit `site/public/games/cricket/` together with the Unity changes.

From a terminal (Unity activated; adjust the editor path for your machine), steps 1 and 3 in one go:

```bash
# macOS
/Applications/Unity/Hub/Editor/6000.0.84f1/Unity.app/Contents/MacOS/Unity \
  -batchmode -quit -projectPath unity/CricketGame \
  -executeMethod Cricket.EditorTools.CricketSetup.GenerateAndBuild -logFile -
# Windows
"C:\Program Files\Unity\Hub\Editor\6000.0.84f1\Editor\Unity.exe" -batchmode -quit -projectPath unity\CricketGame ^
  -executeMethod Cricket.EditorTools.CricketSetup.GenerateAndBuild -logFile -
```

## Online play (Unity Cloud linking)

Quick matches against the CPU need nothing else. **Host online** and **Join with code** use Unity Multiplayer
Services (sessions with Relay over secure WebSockets), so the project must be linked to a Unity Cloud project:

1. In the Editor, open **Edit → Project Settings → Services**, sign in, and **Link** the project to a new or existing
   Unity Cloud project in your organisation.
2. In the Unity Cloud dashboard (cloud.unity.com), open that project and enable **Relay** and **Lobby** (Multiplayer →
   Multiplayer Services). Both have free tiers.
3. Rebuild (step 3 above). The link is stored in `ProjectSettings/ProjectSettings.asset` (`cloudProjectId`); commit it.

If the project isn't linked, hosting shows the exact service error in the game and on the site's player bar, together
with a pointer to these steps.

## Hosting notes

- The build uses **Brotli with decompression fallback**: files end in `.unityweb`, and the loader decompresses them in
  JavaScript when the server doesn't send `Content-Encoding: br`. It works as is on Vercel and GitHub Pages. To skip the
  JS decompression (faster start), serve `games/cricket/Build/*.unityweb` with `Content-Encoding: br` (and
  `Content-Type: application/wasm` for the `.wasm.unityweb` file).
- Data caching (IndexedDB) is on, so a second visit starts almost instantly. File names are fixed (`cricket.*`), so a
  new build replaces the old one and the loader revalidates it.
- The page preloads the build in a hidden iframe (`?mode=lobby`) while the visitor picks settings. The game idles at 6
  fps with audio paused until the page posts `{type: 'start', query}`. Preloading is skipped on data-saver, 2G, and
  small touch screens.

## Offline checks (no Unity needed, .NET 8 SDK)

```bash
python3 unity/CricketGame/Tools/PhysicsSim/run.py              # ball flight, bounce, swing, spin and shot sanity numbers
python3 unity/CricketGame/Tools/MatchSim/run.py t20 3          # headless CPU vs CPU matches through the real match director
python3 unity/CricketGame/Tools/MatchSim/run.py super 5
```

## Regenerating the source assets (optional)

The committed `Assets/Cricket/Models/Cricketer.glb` and textures were produced by:

- `Tools/build_cricketer.mjs`, from the Quaternius packs (see ASSETS.md). It needs `@gltf-transform/core`,
  `@gltf-transform/extensions`, `@gltf-transform/functions`, `meshoptimizer` and `sharp`:
  `node Tools/build_cricketer.mjs <UBC male .gltf> <UAL1 .glb> <UAL2 .glb> Assets/Cricket/Models/Cricketer.glb <skin .jpg>`.
- `Tools/prep_tex.py` (Pillow), which writes the 1024 px skin and ambientCG colour maps.
- `Tools/make_input_manager.py`, which writes `ProjectSettings/InputManager.asset` (keyboard, mouse and gamepad axes).
