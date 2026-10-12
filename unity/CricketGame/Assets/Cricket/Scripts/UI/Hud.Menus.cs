using System.Collections.Generic;
using Cricket.Core;
using Cricket.Fx;
using Cricket.Game;
using Cricket.Sim;
using Cricket.View;
using UnityEngine;

namespace Cricket.UI
{
    public partial class Hud
    {
        LaunchOptions setup;
        List<TeamProfile> teamsCache;
        string joinCode = "";
        bool onlineHost = true;

        LaunchOptions Setup
        {
            get
            {
                if (setup == null)
                {
                    setup = new LaunchOptions { Mode = LaunchMode.Quick, Team = Settings.TeamId, Opponent = "eastvale", Name = Settings.PlayerName, ManualFielding = Settings.ManualFielding };
                    var cur = LaunchOptions.Current;
                    if (cur != null) { setup.Format = cur.Format; setup.Difficulty = cur.Difficulty; setup.Pitch = cur.Pitch; setup.Time = cur.Time; setup.Overs = cur.Overs; }
                }
                return setup;
            }
        }

        List<TeamProfile> Teams => teamsCache ??= TeamStore.All();

        void MainMenu(CricketBootstrap boot)
        {
            var c = new Rect(W * 0.5f - 330, H * 0.5f - 330, 660, 660);
            Panel(c);
            Text(new Rect(c.x, c.y + 26, c.width, 40), "SHREYANSH SHARAN PRESENTS", new GUIStyle(small) { alignment = TextAnchor.MiddleCenter, fontStyle = FontStyle.Bold }, Accent);
            Text(new Rect(c.x, c.y + 64, c.width, 80), "CRICKET", title);
            Text(new Rect(c.x, c.y + 138, c.width, 30), "T20 · T10 · ODI · Super Over · online 1v1", new GUIStyle(small) { alignment = TextAnchor.MiddleCenter });
            float y = c.y + 200;
            if (Button(new Rect(c.x + 110, y, 440, 64), "Quick match vs CPU")) { setup = null; Setup.Mode = LaunchMode.Quick; screen = Screen.Setup; }
            y += 80;
            if (Button(new Rect(c.x + 110, y, 440, 64), "Play online with a friend")) { setup = null; screen = Screen.Online; }
            y += 80;
            if (Button(new Rect(c.x + 110, y, 440, 64), "Team builder")) { teamsCache = null; screen = Screen.TeamList; }
            y += 80;
            if (Button(new Rect(c.x + 110, y, 210, 56), "Settings")) { returnTo = Screen.Main; screen = Screen.Settings; }
            if (Button(new Rect(c.x + 340, y, 210, 56), "Controls")) { returnTo = Screen.Main; screen = Screen.Help; }
            if (boot != null && !boot.StadiumReady) Text(new Rect(c.x, c.yMax - 50, c.width, 30), "The stadium is still being built — you can set up your match meanwhile.", new GUIStyle(tiny) { alignment = TextAnchor.MiddleCenter });
        }

        // ---- quick match setup

        void SetupScreen(CricketBootstrap boot)
        {
            var o = Setup;
            var r = Panel(new Rect(W * 0.5f - 640, H * 0.5f - 420, 1280, 840));
            Text(new Rect(r.x + 30, r.y + 20, 800, 50), o.Mode == LaunchMode.Quick ? "Quick match" : onlineHost ? "Host an online match" : "Join an online match", h1);
            float y = r.y + 90;
            float lx = r.x + 30, cx = r.x + 240;

            Text(new Rect(lx, y + 10, 200, 30), "Format", label);
            string[] formats = { "T20", "T10", "ODI (50)", "Super Over" };
            for (int i = 0; i < formats.Length; i++)
                if (Button(new Rect(cx + i * 175, y, 165, 48), formats[i], (int)o.Format == i)) { o.Format = (MatchFormat)i; o.Overs = 0; }
            y += 62;
            if (o.Format != MatchFormat.SuperOver)
            {
                int def = FormatRules.For(o.Format).Overs;
                int overs = o.Overs > 0 ? o.Overs : def;
                Text(new Rect(lx, y + 6, 200, 30), "Overs", label);
                uiRects.Add(new Rect(cx, y, 700, 40));
                int nv = Mathf.RoundToInt(GUI.HorizontalSlider(new Rect(cx, y + 14, 520, 24), overs, 1, o.Format == MatchFormat.ODI ? 50 : o.Format == MatchFormat.T10 ? 10 : 20));
                if (nv != overs) o.Overs = nv == def ? 0 : nv;
                Text(new Rect(cx + 540, y + 4, 200, 30), $"{(o.Overs > 0 ? o.Overs : def)} per side", label);
                y += 52;
            }

            Text(new Rect(lx, y + 10, 200, 30), "Your team", label);
            TeamPicker(new Rect(cx, y, 1000, 110), o.Team, id => o.Team = id);
            y += 124;
            if (o.Mode == LaunchMode.Quick)
            {
                Text(new Rect(lx, y + 10, 200, 30), "Opponent", label);
                TeamPicker(new Rect(cx, y, 1000, 110), o.Opponent, id => o.Opponent = id, o.Team);
                y += 124;
                Text(new Rect(lx, y + 10, 200, 30), "Difficulty", label);
                string[] diffs = { "Easy", "Normal", "Hard" };
                for (int i = 0; i < 3; i++) if (Button(new Rect(cx + i * 175, y, 165, 48), diffs[i], (int)o.Difficulty == i)) o.Difficulty = (Difficulty)i;
                y += 62;
            }
            if (o.Mode != LaunchMode.Join)
            {
                Text(new Rect(lx, y + 10, 200, 30), "Pitch", label);
                string[] pitches = { "Green seamer", "Flat road", "Dry turner" };
                for (int i = 0; i < 3; i++) if (Button(new Rect(cx + i * 205, y, 195, 48), pitches[i], (int)o.Pitch == i)) o.Pitch = (PitchType)i;
                y += 62;
                Text(new Rect(lx, y + 10, 200, 30), "Time", label);
                string[] times = { "Day", "Dusk", "Night (lights)" };
                for (int i = 0; i < 3; i++) if (Button(new Rect(cx + i * 205, y, 195, 48), times[i], (int)o.Time == i)) o.Time = (TimeOfDay)i;
                y += 62;
            }
            if (o.Mode == LaunchMode.Quick)
            {
                Text(new Rect(lx, y + 10, 200, 30), "Fielding", label);
                if (Button(new Rect(cx, y, 195, 48), "CPU fields", !o.ManualFielding)) o.ManualFielding = false;
                if (Button(new Rect(cx + 205, y, 195, 48), "Manual", o.ManualFielding)) o.ManualFielding = true;
                y += 62;
            }
            if (o.Mode == LaunchMode.Join)
            {
                Text(new Rect(lx, y + 10, 200, 30), "Invite code", label);
                uiRects.Add(new Rect(cx, y, 300, 48));
                joinCode = GUI.TextField(new Rect(cx, y, 300, 48), joinCode ?? "", 12, field).ToUpperInvariant();
                y += 62;
            }

            if (Button(new Rect(r.x + 30, r.yMax - 80, 200, 56), "Back")) screen = o.Mode == LaunchMode.Quick ? Screen.Main : Screen.Online;
            string go = o.Mode == LaunchMode.Quick ? "Play" : o.Mode == LaunchMode.Host ? "Create match" : "Join match";
            bool ok = o.Mode != LaunchMode.Join || (joinCode ?? "").Trim().Length >= 4;
            GUI.enabled = ok && (boot == null || !boot.Busy);
            if (Button(new Rect(r.xMax - 330, r.yMax - 80, 300, 56), go, true))
            {
                Settings.TeamId = o.Team;
                Settings.ManualFielding = o.ManualFielding;
                o.Code = joinCode;
                screen = Screen.None;
                boot?.Launch(o);
            }
            GUI.enabled = true;
        }

        void TeamPicker(Rect r, string selected, System.Action<string> pick, string exclude = null)
        {
            var teams = Teams;
            uiRects.Add(r);
            int perRow = 5;
            float w = (r.width - (perRow - 1) * 10) / perRow;
            int shown = Mathf.Min(teams.Count, 10);
            for (int i = 0; i < shown; i++)
            {
                var t = teams[i];
                var b = new Rect(r.x + (i % perRow) * (w + 10), r.y + (i / perRow) * 56, w, 48);
                bool on = string.Equals(t.Id, selected, System.StringComparison.OrdinalIgnoreCase);
                GUI.enabled = t.Id != exclude;
                if (Button(b, (t.Custom ? "★ " : "") + t.Name, on)) pick(t.Id);
                GUI.enabled = true;
                Fill(new Rect(b.x + 6, b.y + 6, 6, b.height - 12), white, t.PrimaryColor);
            }
        }

        // ---- online

        void OnlineScreen(CricketBootstrap boot)
        {
            var r = Panel(new Rect(W * 0.5f - 420, H * 0.5f - 260, 840, 520));
            Text(new Rect(r.x + 30, r.y + 20, 600, 50), "Play online (1v1)", h1);
            Text(new Rect(r.x + 30, r.y + 84, r.width - 60, 90), "One of you hosts and gets an invite code; the other joins with it. The host bats or bowls first after the toss and you swap for the second innings. Matches run over Unity Relay (secure WebSockets).", small);
            if (Button(new Rect(r.x + 30, r.y + 200, 370, 70), "Host a match"))
            {
                setup = null;
                onlineHost = true;
                Setup.Mode = LaunchMode.Host;
                screen = Screen.Setup;
            }
            if (Button(new Rect(r.x + 440, r.y + 200, 370, 70), "Join with a code"))
            {
                setup = null;
                onlineHost = false;
                Setup.Mode = LaunchMode.Join;
                screen = Screen.Setup;
            }
            Text(new Rect(r.x + 30, r.y + 300, r.width - 60, 120), "Online play needs the game's Unity project linked to a Unity Cloud project with Relay and Lobby enabled. If hosting fails, the exact error is shown so it can be fixed.", tiny);
            if (Button(new Rect(r.x + 30, r.yMax - 80, 200, 56), "Back")) screen = Screen.Main;
        }

        // ---- settings and help

        void SettingsScreen()
        {
            var r = Panel(new Rect(W * 0.5f - 460, H * 0.5f - 360, 920, 720));
            Text(new Rect(r.x + 30, r.y + 20, 600, 50), "Settings", h1);
            float y = r.y + 100;
            Toggle(ref y, r, "Batting camera", Settings.BattingCam == 0 ? "Behind the batter" : "Broadcast (end-on)", () => Settings.BattingCam = 1 - Settings.BattingCam);
            Toggle(ref y, r, "Bowling camera", Settings.BowlingCam == 0 ? "Behind the bowler" : "Broadcast (end-on)", () => Settings.BowlingCam = 1 - Settings.BowlingCam);
            Toggle(ref y, r, "Running", Settings.AssistedRunning ? "Assisted (partner calls)" : "Manual", () => Settings.AssistedRunning = !Settings.AssistedRunning);
            Toggle(ref y, r, "Replays of big moments", Settings.Replays ? "On" : "Off", () => Settings.Replays = !Settings.Replays);
            Toggle(ref y, r, "Aim arrow and hints", Settings.ShowAim ? "On" : "Off", () => Settings.ShowAim = !Settings.ShowAim);
            Toggle(ref y, r, "Commentary", Settings.Commentary ? "On" : "Off", () => Settings.Commentary = !Settings.Commentary);
            Toggle(ref y, r, "Graphics", Settings.LowGraphics ? "Low (no post-processing, no shadows)" : "High", () => { Settings.LowGraphics = !Settings.LowGraphics; PostFx.Instance?.Apply(); });
            Text(new Rect(r.x + 30, y + 8, 300, 30), "Volume", label);
            uiRects.Add(new Rect(r.x + 340, y, 520, 40));
            float v = GUI.HorizontalSlider(new Rect(r.x + 340, y + 14, 420, 24), Settings.Volume, 0f, 1f);
            if (Mathf.Abs(v - Settings.Volume) > 0.001f) Settings.Volume = v;
            y += 60;
            if (Button(new Rect(r.x + 30, r.yMax - 80, 200, 56), "Back")) screen = returnTo;
        }

        void Toggle(ref float y, Rect r, string name, string value, System.Action flip)
        {
            Text(new Rect(r.x + 30, y + 8, 300, 30), name, label);
            if (Button(new Rect(r.x + 340, y, 520, 48), value)) flip();
            y += 62;
        }

        const string ControlsText =
            "<b>Batting</b>\n" +
            "Mouse (or left stick): aim the shot — the arrow shows where.  Left click (A): attacking shot, the stroke is picked from your aim, feet and the ball.\n" +
            "Shift (Y): lofted.  Right click (X): defend.  Space (B): leave.  Hold W (LB): front foot, S (LT): back foot.\n" +
            "1 drive · 2 cut · 3 pull/hook · 4 or E sweep · 5 flick.  A/D: shuffle across before the ball.  Q (RS): charge a spinner.\n" +
            "Timing: swing so the bat arrives as the ball does — the read-out shows early/perfect/late in milliseconds.\n" +
            "<b>Running</b>  R (RB): run / call another · F (RT): send back · Space (A): slide the bat in.\n\n" +
            "<b>Bowling</b>\n" +
            "Mouse (left stick): move the landing marker on the pitch.  Q/E or wheel (LB/RB) or 1-6: delivery.  V (Y): over/round the wicket.\n" +
            "Click or Space (A): run in; press again when the needle is in the green. Late = no-ball risk, early = wayward.\n" +
            "F (Back): field — presets 1-5, or click a fielder then his new spot.  Stamina drops as a bowler tires.\n\n" +
            "<b>Fielding (manual)</b>  WASD/stick move · Tab (LB) switch · Space (A) catch on the ring · Click (RB) throw to keeper, right click (RT) to bowler · hold Shift for a direct hit.\n\n" +
            "<b>Everywhere</b>  R (Y): review a decision · C: camera · Tab: scorecard · H: controls · Esc (Start): pause.";

        void HelpScreen()
        {
            var r = Panel(new Rect(W * 0.5f - 760, H * 0.5f - 430, 1520, 860));
            Text(new Rect(r.x + 30, r.y + 20, 600, 50), "Controls", h1);
            Text(new Rect(r.x + 30, r.y + 90, r.width - 60, r.height - 180), ControlsText, label);
            if (Button(new Rect(r.x + 30, r.yMax - 80, 200, 56), "Back")) screen = returnTo;
        }

        void HelpOverlay(MatchDirector d)
        {
            var r = Panel(new Rect(W * 0.5f - 760, 110, 1520, 760));
            Text(new Rect(r.x + 30, r.y + 20, r.width - 60, r.height - 40), ControlsText + "\n\n<i>Press H to close.</i>", small);
        }

        void PauseScreen(CricketBootstrap boot)
        {
            var r = Panel(new Rect(W * 0.5f - 300, H * 0.5f - 300, 600, 600));
            Text(new Rect(r.x, r.y + 24, r.width, 50), "Paused", new GUIStyle(h1) { alignment = TextAnchor.MiddleCenter });
            float y = r.y + 110;
            if (Button(new Rect(r.x + 100, y, 400, 60), "Resume")) screen = Screen.None;
            y += 76;
            if (Button(new Rect(r.x + 100, y, 400, 60), "Scorecard")) { returnTo = Screen.Pause; screen = Screen.Scorecard; }
            y += 76;
            if (Button(new Rect(r.x + 100, y, 400, 60), "Settings")) { returnTo = Screen.Pause; screen = Screen.Settings; }
            y += 76;
            if (Button(new Rect(r.x + 100, y, 400, 60), "Controls")) { returnTo = Screen.Pause; screen = Screen.Help; }
            y += 76;
            if (Button(new Rect(r.x + 100, y, 400, 60), "Quit to menu")) { Time.timeScale = 1f; boot?.Leave(); screen = Screen.Main; }
        }

        // ---- breaks and the end

        void InningsBreakPanel(MatchDirector d)
        {
            var st = d.State;
            var inn = d.Inn;
            var r = Panel(new Rect(W * 0.5f - 560, H * 0.5f - 330, 1120, 600));
            bool tieBreak = inn.Target > 0;
            Text(new Rect(r.x + 30, r.y + 20, r.width - 60, 50), tieBreak ? "Scores level — Super Over!" : "Innings break", h1);
            Text(new Rect(r.x + 30, r.y + 80, r.width - 60, 40), $"{st.Setup.Teams[inn.BattingTeam].Name} <b>{st.ScoreText(inn)}</b> ({inn.OversText} overs)", h2);
            if (!tieBreak) Text(new Rect(r.x + 30, r.y + 124, r.width - 60, 30), $"{st.Setup.Teams[1 - inn.BattingTeam].Name} need {inn.Runs + 1} to win from {st.ActiveRules.Overs * 6} balls.", label);
            BattingSummary(new Rect(r.x + 30, r.y + 170, 520, 330), inn, st);
            BowlingSummary(new Rect(r.x + 570, r.y + 170, 520, 330), inn, st);
            if (Button(new Rect(r.xMax - 330, r.yMax - 80, 300, 56), "Continue", true)) ContinueFromBreak();
            if (Button(new Rect(r.x + 30, r.yMax - 80, 240, 56), "Full scorecard")) { returnTo = Screen.None; screen = Screen.Scorecard; }
        }

        void MatchEndPanel(MatchDirector d)
        {
            var st = d.State;
            var r = Panel(new Rect(W * 0.5f - 560, H * 0.5f - 340, 1120, 640));
            Text(new Rect(r.x + 30, r.y + 22, r.width - 60, 50), st.Result, h1, st.Winner >= 0 && d.TeamSide(st.Winner) == d.LocalSide ? Good : Ink);
            float y = r.y + 92;
            foreach (var inn in st.Innings)
            {
                Text(new Rect(r.x + 30, y, r.width - 60, 36), $"{(inn.SuperOver ? "Super over: " : "")}{st.Setup.Teams[inn.BattingTeam].Name}  <b>{st.ScoreText(inn)}</b>  ({inn.OversText} ov)", h2);
                y += 40;
            }
            var potm = PlayerOfTheMatch(st);
            if (!string.IsNullOrEmpty(potm)) { Text(new Rect(r.x + 30, y + 10, r.width - 60, 36), "Player of the match: <b>" + potm + "</b>", label, Accent); y += 50; }
            if (st.Innings.Count > 0) BattingSummary(new Rect(r.x + 30, y + 10, 520, 260), st.Innings[st.Innings.Count - 1], st);
            if (st.Innings.Count > 0) BowlingSummary(new Rect(r.x + 570, y + 10, 520, 260), st.Innings[st.Innings.Count - 1], st);
            var boot = CricketBootstrap.Instance;
            if (!d.Online && Button(new Rect(r.xMax - 330, r.yMax - 80, 300, 56), "Play again", true)) boot?.Rematch();
            if (Button(new Rect(r.x + 30, r.yMax - 80, 240, 56), "Main menu")) { boot?.Leave(); screen = Screen.Main; }
            if (Button(new Rect(r.x + 290, r.yMax - 80, 240, 56), "Scorecard")) { returnTo = Screen.None; screen = Screen.Scorecard; }
        }

        static string PlayerOfTheMatch(MatchState st)
        {
            string best = null;
            float bestScore = -1f;
            foreach (var inn in st.Innings)
            {
                var bat = st.Setup.Teams[inn.BattingTeam];
                var bowl = st.Setup.Teams[1 - inn.BattingTeam];
                foreach (var c in inn.Batting)
                {
                    float s = c.Runs + c.Sixes * 2 + (c.Balls > 0 ? (c.StrikeRate - 120f) * 0.1f : 0f) + (st.Winner == inn.BattingTeam ? 10f : 0f);
                    if (c.Batted && s > bestScore) { bestScore = s; best = bat.Players[c.Player].Name; }
                }
                foreach (var b in inn.Bowling)
                {
                    float s = b.Wickets * 22f - b.Runs * 0.3f + b.Dots * 0.5f + (st.Winner == 1 - inn.BattingTeam ? 10f : 0f);
                    if (b.Balls > 0 && s > bestScore) { bestScore = s; best = bowl.Players[b.Player].Name; }
                }
            }
            return best;
        }
    }
}
