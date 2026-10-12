using System.Collections.Generic;
using Cricket.Core;
using Cricket.Fx;
using Cricket.Game;
using Cricket.Sim;
using Cricket.View;
using UnityEngine;

namespace Cricket.UI
{
    /// <summary>
    /// All the 2D interface in IMGUI (no UI assets to download): menus, the team builder, the broadcast-style scorebug,
    /// bowling and batting overlays, the DRS panel, scorecards with wagon wheel and pitch map, and touch buttons.
    /// Laid out on a 1920x1080 virtual canvas that scales to the window.
    /// Split over partial files: this one (styles, in-match HUD), Hud.Menus, Hud.Cards and Hud.TeamBuilder.
    /// </summary>
    public partial class Hud : MonoBehaviour
    {
        public static bool PointerOverUi { get; private set; }
        public static bool MenuOpen => instance != null && instance.screen != Screen.None;
        public static bool FieldEditor;
        public static bool MarkerConfirmByClick = true;
        public static bool ManualFieldingActive => MatchDirector.Instance != null && MatchDirector.Instance.ManualFielding && MatchDirector.Instance.Phase == Phase.BallLive;

        enum Screen { None, Main, Setup, Online, TeamList, TeamEdit, Settings, Help, Pause, Scorecard }

        static Hud instance;
        Screen screen = Screen.Main;
        Screen returnTo = Screen.Main;
        float scale = 1f;
        float W => UnityEngine.Screen.width / scale;
        float H => UnityEngine.Screen.height / scale;
        readonly List<Rect> uiRects = new List<Rect>();
        readonly List<Rect> lastRects = new List<Rect>();
        bool showHelp;
        readonly List<(string text, float at)> commentary = new List<(string, float)>();
        static float timingShownAt = -10f;
        static string timingText = "";
        static Color timingColor;

        // Styles
        bool stylesReady;
        GUIStyle panel, panelLight, title, h1, h2, label, small, tiny, button, buttonOn, scoreBig, scoreMid, chip, center, banner, field;
        Texture2D white, dark, darker, accentTex, greenTex, amberTex, redTex, blueTex, roundTex;
        static readonly Color Accent = new Color(0.98f, 0.62f, 0.12f);
        static readonly Color Ink = new Color(0.94f, 0.95f, 0.98f);
        static readonly Color Muted = new Color(0.65f, 0.7f, 0.78f);
        static readonly Color Good = new Color(0.3f, 0.85f, 0.45f);
        static readonly Color Warn = new Color(1f, 0.75f, 0.2f);
        static readonly Color Bad = new Color(1f, 0.33f, 0.3f);

        void Awake()
        {
            instance = this;
            var opts = LaunchOptions.Current;
            screen = opts.Mode == LaunchMode.Menu ? Screen.Main : Screen.None;
        }

        void Start()
        {
            var d = MatchDirector.Instance;
            if (d != null) d.OnEvent += OnEvent;
            AudioListener.volume = Settings.Volume;
        }

        void OnDestroy()
        {
            var d = MatchDirector.Instance;
            if (d != null) d.OnEvent -= OnEvent;
        }

        public static void Open(bool main)
        {
            if (instance == null) return;
            instance.screen = main ? Screen.Main : Screen.None;
        }

        void OnEvent(GameEvent e)
        {
            if (e.Type == EvType.Commentary && Settings.Commentary && !string.IsNullOrEmpty(e.Text))
            {
                commentary.Add((e.Text, Time.unscaledTime));
                if (commentary.Count > 4) commentary.RemoveAt(0);
            }
            if (e.Type == EvType.Beaten) Sfx.OohCrowd(0.5f);
            if (e.Type == EvType.MatchEnd) chartsDirty = true;
            if (e.Type == EvType.PhaseChange && (Phase)e.I == Phase.PreDelivery) { FieldEditor = false; if (CameraRig.Instance) CameraRig.Instance.FieldEditor = false; }
        }

        public static void ShowTiming(float error, float window)
        {
            var t = Shots.ClassifyTiming(error, window);
            timingShownAt = Time.unscaledTime;
            int ms = Mathf.RoundToInt(error * 1000f);
            switch (t)
            {
                case Timing.Perfect: timingText = $"PERFECT  {ms:+0;-0;0} ms"; timingColor = Good; break;
                case Timing.Early: timingText = $"EARLY  {ms:+0;-0} ms"; timingColor = Warn; break;
                case Timing.Late: timingText = $"LATE  {ms:+0;-0} ms"; timingColor = Warn; break;
                case Timing.VeryEarly: timingText = $"WAY TOO EARLY  {ms:+0;-0} ms"; timingColor = Bad; break;
                default: timingText = $"TOO LATE  {ms:+0;-0} ms"; timingColor = Bad; break;
            }
        }

        public static void ContinueFromBreak()
        {
            var d = MatchDirector.Instance;
            if (d == null || d.Phase != Phase.InningsBreak) return;
            // Ad break at the innings break, then carry on.
            AdService.AdBreak("innings-break", () => d.Submit(Command.Make(CmdType.Continue, d.LocalSide)), !d.Online);
        }

        void Update()
        {
            var mouse = new Vector2(Input.mousePosition.x / scale, (UnityEngine.Screen.height - Input.mousePosition.y) / scale);
            bool over = false;
            foreach (var r in lastRects) if (r.Contains(mouse)) { over = true; break; }
            PointerOverUi = over || screen != Screen.None;
            if (Input.touchCount > 0) CricketInput.TouchUsed = true;
            else if (Input.GetMouseButtonDown(0) && Input.touchCount == 0 && Input.mousePresent) { }

            var d = MatchDirector.Instance;
            if (CricketInput.Down(Act.Pause))
            {
                if (screen == Screen.Pause || screen == Screen.Scorecard || screen == Screen.Settings || screen == Screen.Help) screen = InMatch ? Screen.None : Screen.Main;
                else if (screen == Screen.None && InMatch) screen = Screen.Pause;
                else if (screen == Screen.TeamEdit) screen = Screen.TeamList;
                else if (screen != Screen.Main && !InMatch) screen = Screen.Main;
            }
            if (CricketInput.Down(Act.Help) && screen == Screen.None) showHelp = !showHelp;
            PostFx.WantsBlur = screen != Screen.None;
            // Pausing a solo match stops time.
            bool pause = screen == Screen.Pause || screen == Screen.Settings && InMatch || screen == Screen.Help && InMatch || screen == Screen.Scorecard && InMatch;
            if (d != null && !d.Online && !AdService.Showing) Time.timeScale = pause ? 0f : 1f;
        }

        bool InMatch => MatchDirector.Instance != null && MatchDirector.Instance.State.Current != null && MatchDirector.Instance.Phase != Phase.Menu && MatchDirector.Instance.Phase != Phase.Loading
                        || CricketBootstrap.Instance != null && CricketBootstrap.Instance.InMatch;

        // ------------------------------------------------------------------ styles

        Texture2D Tex(Color c)
        {
            var t = new Texture2D(1, 1) { hideFlags = HideFlags.DontSave };
            t.SetPixel(0, 0, c);
            t.Apply();
            return t;
        }

        Texture2D Rounded(Color c, int r)
        {
            int n = r * 2 + 2;
            var t = new Texture2D(n, n) { hideFlags = HideFlags.DontSave, wrapMode = TextureWrapMode.Clamp };
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float dx = Mathf.Max(0, Mathf.Max(r - x, x - (n - 1 - r))), dy = Mathf.Max(0, Mathf.Max(r - y, y - (n - 1 - r)));
                    float d = Mathf.Sqrt(dx * dx + dy * dy);
                    var cc = c;
                    cc.a *= Mathf.Clamp01(r - d + 0.5f);
                    t.SetPixel(x, y, cc);
                }
            t.Apply();
            return t;
        }

        void Styles()
        {
            if (stylesReady) return;
            stylesReady = true;
            white = Tex(Color.white);
            dark = Tex(new Color(0.04f, 0.06f, 0.1f, 0.86f));
            darker = Tex(new Color(0.02f, 0.03f, 0.05f, 0.95f));
            accentTex = Tex(Accent);
            greenTex = Tex(Good);
            amberTex = Tex(Warn);
            redTex = Tex(Bad);
            blueTex = Tex(new Color(0.3f, 0.6f, 1f));
            roundTex = Rounded(new Color(0.05f, 0.07f, 0.12f, 0.9f), 10);
            var lightRound = Rounded(new Color(1f, 1f, 1f, 0.08f), 8);
            var btn = Rounded(new Color(1f, 1f, 1f, 0.1f), 8);
            var btnHover = Rounded(new Color(1f, 1f, 1f, 0.18f), 8);
            var btnOn = Rounded(Accent, 8);

            panel = new GUIStyle { normal = { background = roundTex }, border = new RectOffset(10, 10, 10, 10), padding = new RectOffset(18, 18, 16, 16) };
            panelLight = new GUIStyle { normal = { background = lightRound }, border = new RectOffset(8, 8, 8, 8), padding = new RectOffset(10, 10, 8, 8) };
            label = new GUIStyle(GUI.skin.label) { fontSize = 20, normal = { textColor = Ink }, wordWrap = true, richText = true };
            small = new GUIStyle(label) { fontSize = 17, normal = { textColor = Muted } };
            tiny = new GUIStyle(label) { fontSize = 14, normal = { textColor = Muted } };
            title = new GUIStyle(label) { fontSize = 54, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
            h1 = new GUIStyle(label) { fontSize = 34, fontStyle = FontStyle.Bold };
            h2 = new GUIStyle(label) { fontSize = 24, fontStyle = FontStyle.Bold };
            center = new GUIStyle(label) { alignment = TextAnchor.MiddleCenter };
            button = new GUIStyle(GUI.skin.button)
            {
                fontSize = 20, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter,
                normal = { background = btn, textColor = Ink }, hover = { background = btnHover, textColor = Color.white },
                active = { background = btnOn, textColor = Color.black }, border = new RectOffset(8, 8, 8, 8), padding = new RectOffset(10, 10, 6, 6),
            };
            buttonOn = new GUIStyle(button) { normal = { background = btnOn, textColor = new Color(0.08f, 0.06f, 0.02f) }, hover = { background = btnOn, textColor = Color.black } };
            scoreBig = new GUIStyle(label) { fontSize = 40, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleLeft, wordWrap = false };
            scoreMid = new GUIStyle(label) { fontSize = 22, alignment = TextAnchor.MiddleLeft, wordWrap = false };
            chip = new GUIStyle(label) { fontSize = 18, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter, normal = { background = btn, textColor = Ink }, border = new RectOffset(8, 8, 8, 8) };
            banner = new GUIStyle(label) { fontSize = 96, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter, wordWrap = false };
            field = new GUIStyle(GUI.skin.textField) { fontSize = 20, normal = { textColor = Ink, background = btn }, focused = { textColor = Color.white, background = btnHover }, border = new RectOffset(8, 8, 8, 8), padding = new RectOffset(8, 8, 6, 6) };
        }

        Rect Panel(Rect r, GUIStyle style = null)
        {
            GUI.Box(r, GUIContent.none, style ?? panel);
            uiRects.Add(r);
            return r;
        }

        bool Button(Rect r, string text, bool on = false)
        {
            uiRects.Add(r);
            bool clicked = GUI.Button(r, text, on ? buttonOn : button);
            if (clicked) Sfx.Play2D(Sfx.Click, 0.4f);
            return clicked;
        }

        void Fill(Rect r, Texture2D tex, Color? tint = null)
        {
            var c = GUI.color;
            if (tint.HasValue) GUI.color = tint.Value;
            GUI.DrawTexture(r, tex);
            GUI.color = c;
        }

        void Text(Rect r, string s, GUIStyle st, Color? color = null)
        {
            if (color.HasValue)
            {
                var old = st.normal.textColor;
                st.normal.textColor = color.Value;
                GUI.Label(r, s, st);
                st.normal.textColor = old;
            }
            else GUI.Label(r, s, st);
        }

        void Shadowed(Rect r, string s, GUIStyle st, Color color)
        {
            var old = st.normal.textColor;
            st.normal.textColor = new Color(0, 0, 0, 0.6f);
            GUI.Label(new Rect(r.x + 3, r.y + 3, r.width, r.height), s, st);
            st.normal.textColor = color;
            GUI.Label(r, s, st);
            st.normal.textColor = old;
        }

        // ------------------------------------------------------------------ OnGUI

        void OnGUI()
        {
            Styles();
            if (Event.current.type == EventType.Layout)
            {
                lastRects.Clear();
                lastRects.AddRange(uiRects);
                uiRects.Clear();
            }
            scale = Mathf.Min(UnityEngine.Screen.width / 1920f, UnityEngine.Screen.height / 1080f);
            if (UnityEngine.Screen.width < 900) scale = Mathf.Max(scale, UnityEngine.Screen.width / 1300f);
            GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, new Vector3(scale, scale, 1f));

            var boot = CricketBootstrap.Instance;
            var d = MatchDirector.Instance;
            bool match = d != null && d.State.Current != null && d.Phase != Phase.Menu && d.Phase != Phase.Loading || d != null && d.Phase == Phase.Toss;

            if (match && screen != Screen.Pause) MatchHud(d);
            DrawLoading(boot);

            switch (screen)
            {
                case Screen.Main: MainMenu(boot); break;
                case Screen.Setup: SetupScreen(boot); break;
                case Screen.Online: OnlineScreen(boot); break;
                case Screen.TeamList: TeamListScreen(); break;
                case Screen.TeamEdit: TeamEditScreen(); break;
                case Screen.Settings: SettingsScreen(); break;
                case Screen.Help: HelpScreen(); break;
                case Screen.Pause: PauseScreen(boot); break;
                case Screen.Scorecard: ScorecardScreen(true); break;
            }
            if (screen == Screen.None && boot != null && !string.IsNullOrEmpty(boot.Status) && !match) StatusPanel(boot);
        }

        void DrawLoading(CricketBootstrap boot)
        {
            if (boot == null || boot.StadiumReady) return;
            var r = new Rect(W * 0.5f - 260, H - 70, 520, 40);
            Panel(r, panelLight);
            Fill(new Rect(r.x + 10, r.y + 28, (r.width - 20) * boot.StadiumProgress, 4), accentTex);
            Text(new Rect(r.x + 12, r.y + 2, r.width - 24, 26), $"Building the stadium… {Mathf.RoundToInt(boot.StadiumProgress * 100)}%", tiny);
        }

        void StatusPanel(CricketBootstrap boot)
        {
            var r = Panel(new Rect(W * 0.5f - 380, H * 0.5f - 110, 760, 220));
            GUILayout.BeginArea(new Rect(r.x + 24, r.y + 18, r.width - 48, r.height - 36));
            GUILayout.Label(boot.Status, h2);
            if (!string.IsNullOrEmpty(boot.JoinCode)) GUILayout.Label($"Invite code: <b>{boot.JoinCode}</b>", label);
            if (!string.IsNullOrEmpty(boot.Error)) GUILayout.Label($"<color=#fca5a5>{boot.Error}</color>", small);
            GUILayout.EndArea();
            if (Button(new Rect(r.xMax - 180, r.yMax - 64, 160, 44), "Back")) { boot.Leave(); screen = Screen.Main; }
        }

        // ------------------------------------------------------------------ in-match HUD

        void MatchHud(MatchDirector d)
        {
            var inn = d.Inn;
            if (d.Phase == Phase.Toss) { TossPanel(d); return; }
            if (inn == null) return;
            bool replay = ReplayRecorder.Instance != null && ReplayRecorder.Instance.Playing;

            if (d.Phase == Phase.Review) ReviewPanel(d);
            else if (!replay) Scorebug(d);
            if (replay)
            {
                Text(new Rect(40, 40, 400, 60), "<b>REPLAY</b>", h1, Accent);
                if (Button(new Rect(W - 220, 40, 180, 48), "Skip ▶▶")) d.Submit(Command.Make(CmdType.SkipReplay, d.LocalSide));
            }
            DrawCommentary(d);
            BallInfo(d);

            switch (d.Phase)
            {
                case Phase.ChooseBowler: if (d.LocalBowls) BowlerPicker(d); else Waiting(d, "The fielding captain is choosing a bowler…"); break;
                case Phase.PreDelivery:
                case Phase.RunUp:
                    if (d.LocalBowls) BowlingPanel(d);
                    if (d.LocalBats) BattingPanel(d);
                    break;
                case Phase.BallInFlight:
                    if (d.LocalBats) BattingPanel(d);
                    break;
                case Phase.BallLive:
                    if (d.LocalBats) RunningPanel(d);
                    if (d.ManualFielding) ManualFieldingPanel(d);
                    break;
                case Phase.Dead:
                    ReviewPrompt(d);
                    break;
                case Phase.InningsBreak: InningsBreakPanel(d); break;
                case Phase.MatchEnd: MatchEndPanel(d); break;
            }
            DrawTiming();
            BannerText(d);
            if (showHelp) HelpOverlay(d);
            if (CricketInput.Held(Act.Scorecard) && screen == Screen.None) ScorecardScreen(false);
            TouchButtons(d);
        }

        void BannerText(MatchDirector d)
        {
            if (d.BannerTime <= 0f || string.IsNullOrEmpty(d.Banner)) return;
            float a = Mathf.Clamp01(d.BannerTime * 2f);
            var c = d.Banner == "SIX!" ? new Color(1f, 0.85f, 0.2f, a) : d.Banner == "FOUR!" ? new Color(0.45f, 0.75f, 1f, a) : d.Banner.StartsWith("OUT") ? new Color(1f, 0.35f, 0.3f, a) : new Color(1f, 1f, 1f, a);
            var st = d.Banner.Length > 10 ? h1 : banner;
            Shadowed(new Rect(0, H * 0.28f, W, 140), d.Banner, st, c);
        }

        void DrawTiming()
        {
            float age = Time.unscaledTime - timingShownAt;
            if (age > 1.8f || string.IsNullOrEmpty(timingText)) return;
            var c = timingColor;
            c.a = Mathf.Clamp01((1.8f - age) * 2f);
            Shadowed(new Rect(0, H * 0.62f, W, 50), timingText, h2, c);
            var d = MatchDirector.Instance;
            if (d != null && !string.IsNullOrEmpty(d.LastShotNote) && age > 0.3f) Shadowed(new Rect(0, H * 0.62f + 40, W, 40), d.LastShotNote, small, new Color(1, 1, 1, c.a));
        }

        void DrawCommentary(MatchDirector d)
        {
            if (commentary.Count == 0) return;
            var (text, at) = commentary[commentary.Count - 1];
            float age = Time.unscaledTime - at;
            if (age > 7f) return;
            float a = Mathf.Clamp01((7f - age) * 1.5f);
            var r = new Rect(W * 0.5f - 520, 22, 1040, 54);
            var old = GUI.color;
            GUI.color = new Color(1, 1, 1, a);
            GUI.Box(r, GUIContent.none, panelLight);
            Text(new Rect(r.x + 16, r.y + 6, r.width - 32, r.height - 8), "“" + text + "”", small, new Color(0.92f, 0.94f, 1f, a));
            GUI.color = old;
        }

        void BallInfo(MatchDirector d)
        {
            if (d.LastKmh <= 0f || d.Phase == Phase.ChooseBowler) return;
            var r = new Rect(W - 300, 24, 270, 74);
            Panel(r, panelLight);
            var spec = Deliveries.Get(d.Plan.Type);
            Text(new Rect(r.x + 14, r.y + 4, 250, 36), $"<b>{d.LastKmh:0}</b> km/h", h2);
            Text(new Rect(r.x + 14, r.y + 38, 250, 30), $"{spec.Name} · {(d.Plan.AroundWicket ? "round" : "over")} the wicket", tiny);
        }

        void Waiting(MatchDirector d, string text)
        {
            var r = Panel(new Rect(W * 0.5f - 300, H * 0.4f, 600, 70));
            Text(new Rect(r.x + 20, r.y + 18, r.width - 40, 40), text, center);
        }

        /// <summary>Broadcast-style score strip along the bottom.</summary>
        void Scorebug(MatchDirector d)
        {
            var st = d.State;
            var inn = d.Inn;
            var bat = st.Setup.Teams[inn.BattingTeam];
            var bowlTeam = st.Setup.Teams[1 - inn.BattingTeam];
            float w = Mathf.Min(1500f, W - 40f);
            var r = new Rect(W * 0.5f - w * 0.5f, H - 112, w, 88);
            Fill(r, darker);
            uiRects.Add(r);
            // Team block
            var teamR = new Rect(r.x, r.y, 120, r.height);
            Fill(teamR, white, bat.PrimaryColor);
            Shadowed(new Rect(teamR.x, teamR.y, teamR.width, teamR.height), bat.Short, new GUIStyle(h1) { alignment = TextAnchor.MiddleCenter }, Color.white);
            // Score
            float x = r.x + 136;
            Text(new Rect(x, r.y + 6, 220, 50), $"{inn.Runs}/{inn.Wickets}", scoreBig);
            var rules = st.ActiveRules;
            Text(new Rect(x, r.y + 52, 260, 30), $"{inn.OversText} ov ({rules.Overs}){(st.IsPowerplay ? "  <color=#fbbf24>P</color>" : "")}{(inn.FreeHit ? "  <color=#f87171>FREE HIT</color>" : "")}", small);
            x += 250;
            // Rates / chase
            if (inn.Target > 0)
            {
                Text(new Rect(x, r.y + 8, 300, 34), $"Need <b>{st.RunsNeeded}</b> from <b>{st.BallsLeft}</b>", scoreMid);
                Text(new Rect(x, r.y + 44, 300, 34), $"RRR {st.RequiredRate:0.00} · CRR {inn.RunRate:0.00}", small);
            }
            else
            {
                Text(new Rect(x, r.y + 8, 300, 34), $"CRR <b>{inn.RunRate:0.00}</b>", scoreMid);
                Text(new Rect(x, r.y + 44, 300, 34), inn.SuperOver ? "Super over" : $"{bowlTeam.Short} to bowl · {rules.Label}", small);
            }
            x += 300;
            // Batters
            BatterLine(new Rect(x, r.y + 8, 330, 34), d, inn.Striker, true);
            BatterLine(new Rect(x, r.y + 44, 330, 34), d, inn.NonStriker, false);
            x += 340;
            // Bowler
            int bowler = inn.Bowler >= 0 ? inn.Bowler : inn.LastOverBowler;
            if (bowler >= 0)
            {
                var card = inn.Bowling.Find(b => b.Player == bowler);
                string fig = card != null ? $"{card.Wickets}-{card.Runs} ({card.Overs})" : "0-0 (0.0)";
                Text(new Rect(x, r.y + 8, 300, 34), $"{bowlTeam.Players[bowler].Surname()}  <b>{fig}</b>", scoreMid);
            }
            Text(new Rect(x, r.y + 44, 330, 34), st.ThisOver(), small);
            // Reviews
            Text(new Rect(r.xMax - 140, r.y + 6, 130, 30), $"DRS {inn.BatReviews}·{inn.BowlReviews}", tiny);
        }

        void BatterLine(Rect r, MatchDirector d, int player, bool onStrike)
        {
            var inn = d.Inn;
            var team = d.State.Setup.Teams[inn.BattingTeam];
            if (player < 0 || player >= team.Players.Count) return;
            var c = inn.Card(player);
            string name = team.Players[player].Surname();
            Text(r, $"{(onStrike ? "<color=#fbbf24>▶</color> " : "   ")}{name}  <b>{c?.Runs ?? 0}</b> ({c?.Balls ?? 0})", scoreMid);
        }

        // ---- toss

        void TossPanel(MatchDirector d)
        {
            var r = Panel(new Rect(W * 0.5f - 360, H * 0.5f - 170, 720, 340));
            var st = d.State;
            Text(new Rect(r.x, r.y + 20, r.width, 50), "THE TOSS", new GUIStyle(h1) { alignment = TextAnchor.MiddleCenter });
            Text(new Rect(r.x + 30, r.y + 76, r.width - 60, 40), $"{st.Setup.Teams[0].Name}  v  {st.Setup.Teams[1].Name}", center);
            int caller = d.Online ? 1 : 0;
            if (d.TossCall < 0)
            {
                if (caller == d.LocalSide)
                {
                    Text(new Rect(r.x, r.y + 130, r.width, 40), "Call it in the air:", center);
                    if (Button(new Rect(r.x + 160, r.y + 190, 180, 60), "Heads") || Input.GetKeyDown(KeyCode.H) && !showHelp) d.Submit(Command.Make(CmdType.TossCall, d.LocalSide, 0));
                    if (Button(new Rect(r.x + 380, r.y + 190, 180, 60), "Tails") || Input.GetKeyDown(KeyCode.T)) d.Submit(Command.Make(CmdType.TossCall, d.LocalSide, 1));
                }
                else Text(new Rect(r.x, r.y + 160, r.width, 40), "Your opponent is calling…", center);
                return;
            }
            string coin = d.TossResult < 0 ? "Spinning…" : d.TossResult == 0 ? "It's HEADS" : "It's TAILS";
            Text(new Rect(r.x, r.y + 130, r.width, 40), coin, new GUIStyle(h2) { alignment = TextAnchor.MiddleCenter });
            if (st.TossWinner >= 0)
            {
                bool youWon = d.TeamSide(st.TossWinner) == d.LocalSide;
                Text(new Rect(r.x, r.y + 175, r.width, 40), $"{st.Setup.Teams[st.TossWinner].Name} won the toss", center);
                if (youWon && st.Innings.Count == 0)
                {
                    if (Button(new Rect(r.x + 160, r.y + 240, 180, 60), "Bat first")) d.Submit(Command.Make(CmdType.TossChoice, d.LocalSide, 0));
                    if (Button(new Rect(r.x + 380, r.y + 240, 180, 60), "Bowl first")) d.Submit(Command.Make(CmdType.TossChoice, d.LocalSide, 1));
                }
            }
        }

        // ---- bowling

        void BowlerPicker(MatchDirector d)
        {
            var list = d.EligibleBowlers();
            var team = d.FieldingTeam;
            var inn = d.Inn;
            float h = 90 + list.Count * 52;
            var r = Panel(new Rect(W * 0.5f - 420, H * 0.5f - h * 0.5f - 60, 840, h));
            Text(new Rect(r.x + 24, r.y + 16, 600, 40), "Who bowls the next over?", h2);
            Text(new Rect(r.x + 600, r.y + 20, 220, 30), "Keys 1–9", tiny);
            for (int i = 0; i < list.Count; i++)
            {
                var p = team.Players[list[i]];
                var card = inn.Bowling.Find(b => b.Player == list[i]);
                var a = d.FielderFor(list[i]);
                string fig = card != null && card.Balls > 0 ? $"{card.Overs} ov  {card.Wickets}-{card.Runs}  econ {card.Economy:0.0}" : "fresh";
                var row = new Rect(r.x + 20, r.y + 70 + i * 52, r.width - 40, 46);
                if (Button(row, "")) d.Submit(Command.Make(CmdType.PickBowler, d.LocalSide, list[i]));
                Text(new Rect(row.x + 14, row.y + 8, 40, 30), $"{i + 1}", h2, Accent);
                Text(new Rect(row.x + 54, row.y + 8, 300, 30), $"<b>{p.Name}</b>", label);
                Text(new Rect(row.x + 360, row.y + 10, 220, 30), MatchDirector.StyleName(p), small);
                Text(new Rect(row.x + 580, row.y + 10, 200, 30), fig, small);
                if (a != null) Fill(new Rect(row.xMax - 40, row.y + 12, 24 * a.Stamina / 100f, 22), a.Stamina > 60 ? greenTex : a.Stamina > 30 ? amberTex : redTex);
            }
        }

        void BowlingPanel(MatchDirector d)
        {
            var bowler = d.FieldingTeam.Players[d.Inn.Bowler];
            var types = Deliveries.For(bowler.Bowl);
            float w = 150 * types.Length + 20;
            var r = Panel(new Rect(W * 0.5f - w * 0.5f, H - 300, w, 160));
            for (int i = 0; i < types.Length; i++)
            {
                var spec = Deliveries.Get(types[i]);
                if (Button(new Rect(r.x + 10 + i * 150, r.y + 12, 140, 52), $"{i + 1}  {spec.Name}", types[i] == d.SelectedDelivery) && d.Phase == Phase.PreDelivery)
                {
                    d.Submit(Command.Make(CmdType.PickDelivery, d.LocalSide, (int)types[i]));
                    if (!d.IsAuthority) d.SelectedDelivery = types[i];
                }
            }
            var f = d.Frame;
            float len = f.OffsetFwd(d.Marker), off = f.OffsetOff(d.Marker);
            string lenName = len < 0.3f ? "full toss" : len < 2.5f ? "yorker" : len < 5f ? "full" : len < 7.5f ? "good length" : len < 9.5f ? "short of a length" : "short";
            string line = Mathf.Abs(off) < 0.12f ? "on the stumps" : off > 0.9f ? "wide outside off" : off > 0.12f ? "outside off" : off < -0.25f ? "down leg" : "on the pads";
            var bowlerActor = d.BowlerActor;
            string stamina = bowlerActor != null ? $"Stamina {bowlerActor.Stamina:0}%" : "";
            Text(new Rect(r.x + 14, r.y + 72, r.width - 28, 30), $"{bowler.Name} · {MatchDirector.StyleName(bowler)} · {(d.AroundWicket ? "round" : "over")} the wicket (V) · {stamina}", small);
            Text(new Rect(r.x + 14, r.y + 102, r.width - 28, 30), d.Phase == Phase.PreDelivery
                ? $"Marker: {lenName}, {line}.  <b>Click / Space</b> to run in · Q/E delivery · <b>F</b> field ({d.Preset})"
                : "Press <b>Space / Click</b> when the needle is in the green", small);
            if (d.Phase == Phase.PreDelivery && Button(new Rect(r.xMax - 150, r.y + 104, 140, 40), FieldEditor ? "Done" : "Field (F)", FieldEditor))
            {
                FieldEditor = !FieldEditor;
                CameraRig.Instance.FieldEditor = FieldEditor;
            }
            if (FieldEditor) FieldPanel(d);
            if (d.Phase == Phase.RunUp) Meter(d);
        }

        void Meter(MatchDirector d)
        {
            var r = new Rect(W * 0.5f - 360, H - 360, 720, 46);
            Fill(r, darker);
            float g0 = Mathf.Clamp01(d.MeterGreen - d.MeterHalfWidth), g1 = Mathf.Clamp01(d.MeterGreen + d.MeterHalfWidth);
            float p0 = Mathf.Clamp01(d.MeterGreen - d.MeterHalfWidth * 0.3f), p1 = Mathf.Clamp01(d.MeterGreen + d.MeterHalfWidth * 0.3f);
            float over = Mathf.Clamp01(d.MeterGreen + d.MeterHalfWidth * 1.15f);
            Fill(new Rect(r.x + r.width * g0, r.y, r.width * (g1 - g0), r.height), amberTex);
            Fill(new Rect(r.x + r.width * p0, r.y, r.width * (p1 - p0), r.height), greenTex);
            Fill(new Rect(r.x + r.width * over, r.y, r.width * (1f - over), r.height), redTex, new Color(1f, 0.3f, 0.3f, 0.7f));
            Fill(new Rect(r.x + r.width * d.MeterValue - 3, r.y - 8, 6, r.height + 16), white);
            Text(new Rect(r.x, r.y - 34, r.width, 30), "RELEASE", new GUIStyle(small) { alignment = TextAnchor.MiddleCenter });
        }

        void FieldPanel(MatchDirector d)
        {
            var r = Panel(new Rect(30, 140, 340, 470));
            Text(new Rect(r.x + 18, r.y + 12, 300, 34), "Field setting", h2);
            string[] names = { "Attacking", "Balanced", "Defensive", "Death", "Spin attack" };
            for (int i = 0; i < names.Length; i++)
                if (Button(new Rect(r.x + 18, r.y + 56 + i * 52, 300, 44), $"{i + 1}  {names[i]}", (int)d.Preset == i)) d.Submit(Command.Make(CmdType.FieldPreset, d.LocalSide, i));
            Text(new Rect(r.x + 18, r.y + 330, 300, 120), "Click a fielder, then click where he should go. Fielding restrictions apply (2 outside the circle in the powerplay, 5 after).", tiny);
            // Labels over fielders.
            var cam = CameraRig.Instance ? CameraRig.Instance.Cam : null;
            if (!cam) return;
            for (int i = 0; i < 9; i++)
            {
                var a = d.FielderAtIndex(i);
                if (a == null) continue;
                var sp = cam.WorldToScreenPoint(a.Pos + Vector3.up * 2f);
                if (sp.z < 0) continue;
                var gp = new Vector2(sp.x / scale, (UnityEngine.Screen.height - sp.y) / scale);
                bool sel = Controls.SelectedFielder == i;
                Text(new Rect(gp.x - 90, gp.y - 26, 180, 26), $"{(sel ? "▶ " : "")}{a.SpotName}", new GUIStyle(tiny) { alignment = TextAnchor.MiddleCenter }, sel ? Accent : Ink);
            }
        }

        // ---- batting

        void BattingPanel(MatchDirector d)
        {
            if (!Settings.ShowAim && !showHelp) return;
            var r = new Rect(30, H - 270, 470, 130);
            Panel(r, panelLight);
            string aim = AimName(d.AimAngle);
            Text(new Rect(r.x + 14, r.y + 8, r.width - 28, 30), $"Aim: <b>{aim}</b>  {(CricketInput.Held(Act.Loft) ? "<color=#fbbf24>LOFTED</color>" : "along the ground")}", small);
            Text(new Rect(r.x + 14, r.y + 38, r.width - 28, 90),
                "Click shot · Right-click defend · Space leave · Shift loft\nHold W front foot / S back foot · 1-5 drive, cut, pull, sweep, flick\nA/D shuffle · Q charge (spinners) · H all controls", tiny);
        }

        static string AimName(float a)
        {
            if (a > 135) return "third man";
            if (a > 100) return "backward point";
            if (a > 75) return "point";
            if (a > 50) return "cover";
            if (a > 25) return "extra cover";
            if (a > 8) return "mid-off";
            if (a > -8) return "straight";
            if (a > -25) return "mid-on";
            if (a > -60) return "midwicket";
            if (a > -100) return "square leg";
            if (a > -140) return "backward square";
            return "fine leg";
        }

        void RunningPanel(MatchDirector d)
        {
            var r = new Rect(30, H - 230, 420, 92);
            Panel(r, panelLight);
            bool assisted = Settings.AssistedRunning;
            Text(new Rect(r.x + 14, r.y + 8, r.width - 28, 30), $"<b>R</b> run · <b>F</b> send back · <b>Space</b> slide the bat in", small);
            Text(new Rect(r.x + 14, r.y + 44, r.width - 28, 30), assisted ? "Assisted running is on: your partner calls if you don't." : "Manual running: you call every run.", tiny);
        }

        void ManualFieldingPanel(MatchDirector d)
        {
            var r = new Rect(W - 470, H - 250, 440, 110);
            Panel(r, panelLight);
            Text(new Rect(r.x + 14, r.y + 8, r.width - 28, 96), "Manual fielding: WASD / stick move · Tab switch fielder\nSpace catch (on the ring) · Click throw to keeper, right-click to bowler\nHold Shift to go for a direct hit", tiny);
            if (d.CatchPromptAt > 0f && d.Controlled != null)
            {
                float left = d.CatchPromptAt - d.LiveTime;
                if (left > -0.2f && left < 1.2f)
                {
                    var cam = CameraRig.Instance.Cam;
                    var sp = cam.WorldToScreenPoint(d.Controlled.Pos + Vector3.up * 1.2f);
                    if (sp.z > 0)
                    {
                        var gp = new Vector2(sp.x / scale, (UnityEngine.Screen.height - sp.y) / scale);
                        float rad = 20f + Mathf.Max(0f, left) * 120f;
                        var ring = new Rect(gp.x - rad, gp.y - rad, rad * 2, rad * 2);
                        var c = Mathf.Abs(left) < 0.12f ? Good : Warn;
                        Fill(new Rect(gp.x - 20, gp.y - 20, 40, 40), roundTex);
                        Text(ring, "CATCH!", new GUIStyle(h2) { alignment = TextAnchor.MiddleCenter }, c);
                    }
                }
            }
        }

        void ReviewPrompt(MatchDirector d)
        {
            if (!d.CanReview(d.LocalSide) && !d.RewardedReviewOffer) return;
            var r = Panel(new Rect(W * 0.5f - 300, H * 0.5f - 230, 600, d.RewardedReviewOffer ? 170 : 120));
            if (d.CanReview(d.LocalSide))
            {
                Text(new Rect(r.x + 20, r.y + 14, r.width - 40, 40), $"Review? Press <b>R</b> — {Mathf.CeilToInt(d.ReviewCountdown)} s", h2);
                Text(new Rect(r.x + 20, r.y + 60, r.width - 40, 30), $"Reviews left: {d.ReviewsLeft(d.LocalSide)}", small);
                if (Button(new Rect(r.xMax - 170, r.y + 60, 150, 44), "Review")) d.Submit(Command.Make(CmdType.Review, d.LocalSide));
            }
            else
            {
                Text(new Rect(r.x + 20, r.y + 14, r.width - 40, 40), "No reviews left", h2);
                Text(new Rect(r.x + 20, r.y + 58, r.width - 40, 30), "Watch a short ad for one extra review?", small);
                if (Button(new Rect(r.x + 20, r.y + 104, 300, 48), "Watch ad for a review"))
                {
                    int side = d.LocalSide;
                    AdService.Rewarded("extra-review", granted =>
                    {
                        if (granted)
                        {
                            d.GrantExtraReview(side);
                            d.Submit(Command.Make(CmdType.Review, side));
                        }
                    });
                }
            }
        }

        // ---- touch

        void TouchButtons(MatchDirector d)
        {
            if (!CricketInput.TouchUsed) return;
            float s = 120f;
            float y = H - 260 - s;
            if (d.LocalBats && (d.Phase == Phase.RunUp || d.Phase == Phase.BallInFlight || d.Phase == Phase.PreDelivery))
            {
                TouchBtn(new Rect(W - 3 * (s + 16) - 20, y, s, s), "SHOT", Act.Shot);
                TouchBtn(new Rect(W - 2 * (s + 16) - 20, y, s, s), "DEFEND", Act.Defend);
                TouchBtn(new Rect(W - (s + 16) - 20, y, s, s), "LEAVE", Act.Leave);
                TouchHold(new Rect(20, y, s, s), "FRONT", Act.Front);
                TouchHold(new Rect(36 + s, y, s, s), "BACK", Act.Back);
                TouchHold(new Rect(52 + 2 * s, y, s, s), "LOFT", Act.Loft);
                // Aim by dragging across the top half of the screen.
                if (Input.touchCount > 0)
                {
                    var t = Input.GetTouch(0);
                    if (t.position.y > UnityEngine.Screen.height * 0.5f && CameraRig.Instance.GroundPoint(t.position, out var p))
                    {
                        d.AimAngle = d.Frame.AngleOf(p);
                        d.Submit(Command.Make(CmdType.Aim, d.LocalSide, 0, d.AimAngle));
                    }
                }
            }
            if (d.LocalBats && d.Phase == Phase.BallLive)
            {
                TouchBtn(new Rect(W - 3 * (s + 16) - 20, y, s, s), "RUN", Act.Run);
                TouchBtn(new Rect(W - 2 * (s + 16) - 20, y, s, s), "BACK", Act.SendBack);
                TouchBtn(new Rect(W - (s + 16) - 20, y, s, s), "SLIDE", Act.Slide);
            }
            if (d.LocalBowls && (d.Phase == Phase.PreDelivery || d.Phase == Phase.RunUp))
            {
                TouchBtn(new Rect(W - (s + 16) - 20, y, s, s), d.Phase == Phase.RunUp ? "RELEASE" : "BOWL", Act.Confirm);
                if (d.Phase == Phase.PreDelivery)
                {
                    TouchBtn(new Rect(20, y, s, s), "◀", Act.PrevDelivery);
                    TouchBtn(new Rect(36 + s, y, s, s), "▶", Act.NextDelivery);
                    if (Input.touchCount > 0)
                    {
                        var t = Input.GetTouch(0);
                        if (t.position.y > UnityEngine.Screen.height * 0.45f && CameraRig.Instance.GroundPoint(t.position, out var p))
                            d.Submit(Command.Make(CmdType.SetTarget, d.LocalSide, 0, p.x, p.z));
                    }
                }
            }
            if (d.Phase == Phase.Dead && d.CanReview(d.LocalSide)) TouchBtn(new Rect(W - (s + 16) - 20, y - s - 16, s, s), "REVIEW", Act.Review);
        }

        void TouchBtn(Rect r, string text, Act act)
        {
            if (Button(r, text)) CricketInput.Virtual(act);
        }

        void TouchHold(Rect r, string text, Act act)
        {
            bool held = CricketInput.Held(act);
            if (Button(r, text, held))
            {
                if (held) CricketInput.VirtualRelease(act);
                else CricketInput.Virtual(act, true);
            }
        }
    }
}
