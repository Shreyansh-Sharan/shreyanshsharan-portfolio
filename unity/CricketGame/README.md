# Cricket (Unity 6, WebGL)

A realistic cricket game for the portfolio site, playable at `#/cricket`. The lobby page lives in
`site/src/components/Cricket.tsx`, and the build goes to `site/public/games/cricket/`. See **REBUILD.md** to build it
and **ASSETS.md** for the third-party assets and their licences.

## Modes

- **Formats:** T20 (default), T10, ODI (50 overs) and Super Over. Each starts with a toss (call it, then bat or bowl).
  A tied match goes to a super over, and up to three more if those tie too.
- **Opponents:** a quick match against the CPU (Easy, Normal or Hard), or 1v1 online (host with a code, the friend
  joins). The host is authoritative.
- **Teams:** eight fictional sides, plus your own XI from the in-game **Team builder** (names, kit colours, roles,
  batting and bowling ratings). The XI is saved in the browser.
- **Conditions:** green, flat or dusty pitch; day, dusk or night (floodlights).
- **Fielding:** AI fielding by default, or manual (catch prompts and aimed throws).

## Controls

| Batting | Keyboard + mouse | Gamepad |
| --- | --- | --- |
| Aim the shot | Mouse | Left stick |
| Play a shot (stroke picked from aim, feet and the ball) | Left click | A / Y |
| Loft it | hold Shift | hold Y |
| Front foot / back foot | hold W / S | hold LB / LT |
| Choose a stroke: drive, cut, pull, sweep, flick | 1 – 5 (E also sweeps) | — |
| Defend / leave | Right click / Space | X / B |
| Charge the spinner, change guard | Q, A / D | RS |
| Run / send back / slide the bat in | R / F / Space | RB / RT / A |

| Bowling | Keyboard + mouse | Gamepad |
| --- | --- | --- |
| Place the landing marker | Mouse | Left stick |
| Change delivery (seam-up, inswing, outswing, bouncer, yorker, slower ball; off-break, arm ball; leg-break, googly) | Q / E or mouse wheel | LB / RB |
| Over or round the wicket | V | Y |
| Run in, then release in the green on the meter | Click, then click | A, then A |
| Field editor (presets, drag individual fielders) | F | Back |

| Everything else | Keyboard | Gamepad |
| --- | --- | --- |
| Review a decision (DRS) | R | Y |
| Camera | C | L3 |
| Scorecard, wagon wheel, pitch map | hold Tab | hold Back |
| Manual fielding: catch / throw to the keeper / to the bowler (Shift for a direct hit) | Space / Click or K / Right click or B | A / RB / RT |
| Help, pause | H, Esc or P | Start |

On touch screens, on-screen buttons appear for the current phase.

## How it works

The game is split into a pure simulation, a match director that runs one ball at a time, and a view that draws it.

```
Assets/Cricket/Scripts/
  Sim/   pure C#, no scene objects (also compiled by the offline tests)
    Geometry.cs        pitch and field dimensions, the batter's frame of reference
    Conditions.cs      pitch types (bounce, grip, seam, pace), wear, time of day, wind
    BallPhysics.cs     500 Hz ball flight: drag, swing, Magnus spin, bounce with restitution + friction, rolling
    Delivery.cs        delivery types and a solver that lands the ball on the bowler's marker
    Shots.cs           strokes, footwork, timing windows, edges and the bat-on-ball collision
    Umpiring.cs        LBW tracking (pitching, impact, wickets), umpire's call, wides
    MatchState.cs      formats, scoring, extras, dismissals, cards, innings, super overs
    FieldPositions.cs  named fielding positions and presets; fielding restrictions
    Teams.cs           the fictional sides and the custom-team store
  Game/  the match director: phases, run-ups, release, ball in play, fielders, running, reviews, AI, commentary,
         replays and the online snapshot
  View/  procedural stadium and crowd, cricketer rig (clips + procedural layer + IK), ball, stumps, cameras
  UI/    input mapping and the IMGUI HUD: menus, scorebug, meter, field editor, scorecard, DRS, team builder
  Core/  bootstrap, launch options, the page bridge, ads, Unity Multiplayer Services sessions
  Net/   NetMatch: the RPCs for the host-authoritative 1v1
  Fx/    synthesised sound and post-processing
Assets/Cricket/Editor/   CricketSetup (menu items, generation, player settings, link.xml) and first-open setup
Assets/Plugins/WebGL/CricketBridge.jslib    postMessage bridge to the host page
Assets/WebGLTemplates/Cricket/index.html    loader page that reports load progress to the site
Tools/PhysicsSim, Tools/MatchSim            offline tests with the .NET SDK (see REBUILD.md)
```

## Page messages

The game posts `{source: 'cricket', type, payload}` to the parent page:

- lifecycle: `progress` (0–1), `ready`, `loaded`, `started`, `code` (the invite code), `error` (text), `left`,
  `result` (JSON);
- ads: `adbreak` and `rewarded`, with `{id, placement}`.

The page can post in:

- `{type: 'start', query}`, where the query string looks like
  `mode=quick&format=t20&team=northland&opp=eastvale&diff=1&pitch=flat&time=night&field=auto`;
- `mute` and `unmute`;
- `ad-started` (an ad is really showing), `adbreak-done`, `reward-granted` and `reward-skipped`, each with `{id}`.

During an ad the game pauses its time and audio. With no reply it resumes after a short grace period, and when it isn't
embedded it resumes at once.
