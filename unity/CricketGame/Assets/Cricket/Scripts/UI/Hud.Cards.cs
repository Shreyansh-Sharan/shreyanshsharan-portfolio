using Cricket.Game;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.UI
{
    public partial class Hud
    {
        int cardTab;
        int cardInnings = -1;
        bool chartsDirty = true;
        int chartCount = -1, chartInnings = -1;
        Texture2D wagon, pitchMap;

        // ------------------------------------------------------------------ scorecards

        void ScorecardScreen(bool modal)
        {
            var d = MatchDirector.Instance;
            if (d == null || d.State.Innings.Count == 0) { if (modal) screen = returnTo; return; }
            var st = d.State;
            int idx = cardInnings < 0 || cardInnings >= st.Innings.Count ? st.Innings.Count - 1 : cardInnings;
            var inn = st.Innings[idx];
            var r = Panel(new Rect(W * 0.5f - 780, H * 0.5f - 440, 1560, 860));
            Text(new Rect(r.x + 30, r.y + 18, 900, 50), $"{st.Setup.Teams[inn.BattingTeam].Name}  {st.ScoreText(inn)}  ({inn.OversText} ov)", h1);
            for (int i = 0; i < st.Innings.Count; i++)
            {
                var label = st.Innings[i].SuperOver ? $"SO {st.Setup.Teams[st.Innings[i].BattingTeam].Short}" : $"{st.Setup.Teams[st.Innings[i].BattingTeam].Short} inns";
                if (Button(new Rect(r.xMax - 180 - (st.Innings.Count - 1 - i) * 170, r.y + 22, 160, 44), label, i == idx)) { cardInnings = i; chartsDirty = true; }
            }
            string[] tabs = { "Batting", "Bowling", "Wagon wheel", "Pitch map" };
            for (int i = 0; i < tabs.Length; i++) if (Button(new Rect(r.x + 30 + i * 210, r.y + 84, 200, 44), tabs[i], cardTab == i)) cardTab = i;
            var body = new Rect(r.x + 30, r.y + 146, r.width - 60, r.height - 240);
            switch (cardTab)
            {
                case 0: BattingCard(body, inn, st); break;
                case 1: BowlingCard(body, inn, st); break;
                case 2: Chart(body, inn, st, true); break;
                default: Chart(body, inn, st, false); break;
            }
            if (modal && Button(new Rect(r.x + 30, r.yMax - 76, 200, 54), "Back")) screen = returnTo;
        }

        void BattingCard(Rect r, InningsState inn, MatchState st)
        {
            var team = st.Setup.Teams[inn.BattingTeam];
            Text(new Rect(r.x, r.y, 400, 30), "<b>Batter</b>", small);
            Text(new Rect(r.x + 380, r.y, 420, 30), "", small);
            Text(new Rect(r.x + 860, r.y, 120, 30), "<b>R</b>", small);
            Text(new Rect(r.x + 940, r.y, 120, 30), "<b>B</b>", small);
            Text(new Rect(r.x + 1020, r.y, 120, 30), "<b>4s</b>", small);
            Text(new Rect(r.x + 1100, r.y, 120, 30), "<b>6s</b>", small);
            Text(new Rect(r.x + 1180, r.y, 120, 30), "<b>SR</b>", small);
            float y = r.y + 36;
            foreach (var c in inn.Batting)
            {
                var p = team.Players[c.Player];
                bool batting = c.Batted && !c.Out && (c.Player == inn.Striker || c.Player == inn.NonStriker) && !inn.Complete;
                string name = p.Name + (c.Player == team.Captain ? " (c)" : "") + (c.Player == team.Keeper ? " †" : "") + (batting && c.Player == inn.Striker ? " *" : "");
                Text(new Rect(r.x, y, 380, 30), c.Batted ? $"<b>{name}</b>" : name, label, c.Batted ? Ink : Muted);
                Text(new Rect(r.x + 380, y, 470, 30), c.Batted ? st.DismissalText(inn, c) : "", small);
                if (c.Batted)
                {
                    Text(new Rect(r.x + 860, y, 80, 30), $"<b>{c.Runs}</b>", label);
                    Text(new Rect(r.x + 940, y, 80, 30), c.Balls.ToString(), label);
                    Text(new Rect(r.x + 1020, y, 80, 30), c.Fours.ToString(), label);
                    Text(new Rect(r.x + 1100, y, 80, 30), c.Sixes.ToString(), label);
                    Text(new Rect(r.x + 1180, y, 120, 30), c.Balls > 0 ? c.StrikeRate.ToString("0.0") : "-", label);
                }
                y += 34;
            }
            Text(new Rect(r.x, y + 8, r.width, 30), $"Extras {inn.Extras} (b {inn.Byes}, lb {inn.LegByes}, w {inn.Wides}, nb {inn.NoBalls})   ·   Total <b>{st.ScoreText(inn)}</b> ({inn.OversText} ov, RR {inn.RunRate:0.00})", label);
            if (inn.Wickets_.Count > 0)
            {
                var fow = new System.Text.StringBuilder("Fall of wickets: ");
                foreach (var f in inn.Wickets_) fow.Append($"{f.Runs}-{f.Wicket} ({team.Players[f.Player].Surname()}, {f.Overs})  ");
                Text(new Rect(r.x, y + 44, r.width, 60), fow.ToString(), small);
            }
        }

        void BowlingCard(Rect r, InningsState inn, MatchState st)
        {
            var team = st.Setup.Teams[1 - inn.BattingTeam];
            string[] head = { "Bowler", "O", "M", "R", "W", "Econ", "Dots", "Wd", "Nb" };
            float[] xs = { 0, 420, 520, 600, 690, 780, 900, 1000, 1080 };
            for (int i = 0; i < head.Length; i++) Text(new Rect(r.x + xs[i], r.y, 200, 30), $"<b>{head[i]}</b>", small);
            float y = r.y + 36;
            foreach (var b in inn.Bowling)
            {
                if (b.Balls == 0 && b.Runs == 0) continue;
                var p = team.Players[b.Player];
                Text(new Rect(r.x, y, 410, 30), $"<b>{p.Name}</b>  <size=14>{MatchDirector.StyleName(p)}</size>", label);
                string[] vals = { b.Overs, b.Maidens.ToString(), b.Runs.ToString(), b.Wickets.ToString(), b.Economy.ToString("0.00"), b.Dots.ToString(), b.Wides.ToString(), b.NoBalls.ToString() };
                for (int i = 0; i < vals.Length; i++) Text(new Rect(r.x + xs[i + 1], y, 120, 30), vals[i], label);
                y += 36;
            }
        }

        void BattingSummary(Rect r, InningsState inn, MatchState st)
        {
            var team = st.Setup.Teams[inn.BattingTeam];
            Text(new Rect(r.x, r.y, r.width, 30), "<b>Top batters</b>", small, Accent);
            var list = new System.Collections.Generic.List<BatterCard>(inn.Batting.FindAll(c => c.Batted));
            list.Sort((a, b) => b.Runs.CompareTo(a.Runs));
            float y = r.y + 34;
            for (int i = 0; i < Mathf.Min(4, list.Count); i++)
            {
                var c = list[i];
                Text(new Rect(r.x, y, r.width - 120, 30), team.Players[c.Player].Name + (c.Out ? "" : " *"), label);
                Text(new Rect(r.xMax - 120, y, 120, 30), $"<b>{c.Runs}</b> ({c.Balls})", label);
                y += 34;
            }
        }

        void BowlingSummary(Rect r, InningsState inn, MatchState st)
        {
            var team = st.Setup.Teams[1 - inn.BattingTeam];
            Text(new Rect(r.x, r.y, r.width, 30), "<b>Top bowlers</b>", small, Accent);
            var list = new System.Collections.Generic.List<BowlerCard>(inn.Bowling.FindAll(b => b.Balls > 0));
            list.Sort((a, b) => b.Wickets != a.Wickets ? b.Wickets.CompareTo(a.Wickets) : a.Runs.CompareTo(b.Runs));
            float y = r.y + 34;
            for (int i = 0; i < Mathf.Min(4, list.Count); i++)
            {
                var b = list[i];
                Text(new Rect(r.x, y, r.width - 160, 30), team.Players[b.Player].Name, label);
                Text(new Rect(r.xMax - 160, y, 160, 30), $"<b>{b.Wickets}-{b.Runs}</b> ({b.Overs})", label);
                y += 34;
            }
        }

        // ------------------------------------------------------------------ wagon wheel and pitch map

        void Chart(Rect r, InningsState inn, MatchState st, bool wheel)
        {
            int idx = st.Innings.IndexOf(inn);
            if (chartsDirty || chartCount != inn.Log.Count || chartInnings != idx)
            {
                BuildCharts(inn);
                chartsDirty = false;
                chartCount = inn.Log.Count;
                chartInnings = idx;
            }
            var tex = wheel ? wagon : pitchMap;
            float size = Mathf.Min(r.height, r.width * 0.5f);
            var img = wheel ? new Rect(r.x, r.y, size, size) : new Rect(r.x + size * 0.3f, r.y, size * 0.4f, size);
            if (tex) GUI.DrawTexture(img, tex, ScaleMode.StretchToFill);
            var legend = new Rect(r.x + size + 40, r.y, r.width - size - 40, r.height);
            if (wheel)
            {
                int ones = 0, fours = 0, sixes = 0;
                foreach (var b in inn.Log) { if (b.Six) sixes++; else if (b.Four) fours++; else if (b.Runs > 0) ones += b.Runs; }
                Text(legend, $"<b>Wagon wheel</b> (right-handers' view; left-handers mirrored)\n\n<color=#e5e7eb>■</color> 1-3 runs: {ones}\n<color=#60a5fa>■</color> Fours: {fours}\n<color=#f87171>■</color> Sixes: {sixes}\n\nOff side is on the right.", label);
            }
            else
            {
                Text(legend, "<b>Pitch map</b> (where each ball landed, batter at the bottom)\n\n<color=#f87171>●</color> Wicket\n<color=#60a5fa>●</color> Boundary\n<color=#9ca3af>●</color> Dot ball\n<color=#fbbf24>●</color> Runs\n\nBands: yorker, full, good, short.", label);
            }
        }

        void BuildCharts(InningsState inn)
        {
            const int n = 256;
            if (!wagon) wagon = new Texture2D(n, n, TextureFormat.RGBA32, false) { hideFlags = HideFlags.DontSave };
            if (!pitchMap) pitchMap = new Texture2D(96, 256, TextureFormat.RGBA32, false) { hideFlags = HideFlags.DontSave };
            var px = new Color32[n * n];
            var grass = new Color32(26, 92, 44, 255);
            var outer = new Color32(18, 28, 40, 0);
            for (int y = 0; y < n; y++)
                for (int x = 0; x < n; x++)
                {
                    float dx = (x - n / 2f) / (n / 2f), dy = (y - n / 2f) / (n / 2f);
                    float k = dx * dx + dy * dy;
                    px[y * n + x] = k <= 1f ? (Mathf.Abs(Mathf.Sqrt(k) - 0.4f) < 0.006f ? new Color32(220, 220, 220, 255) : grass) : outer;
                }
            // Pitch strip in the middle.
            for (int y = n / 2 - 14; y < n / 2 + 14; y++) for (int x = n / 2 - 2; x < n / 2 + 2; x++) px[y * n + x] = new Color32(196, 170, 120, 255);
            float scaleW = (n / 2f - 4f) / (Geo.BoundaryStraight + Geo.HalfPitch);
            foreach (var b in inn.Log)
            {
                int runs = b.Four ? 4 : b.Six ? 6 : b.Runs;
                if (runs <= 0 || b.Extra == ExtraType.Wide) continue;
                var f = BatFrame.For(b.StrikerEnd, !b.LeftHand);
                // Canonical frame: striker at the centre, straight up, off side to the right.
                float off = f.OffsetOff(b.End) * (b.LeftHand ? -1f : 1f);
                float fwd = f.OffsetFwd(b.End);
                var col = b.Six ? new Color32(248, 113, 113, 255) : b.Four ? new Color32(96, 165, 250, 255) : new Color32(229, 231, 235, 255);
                Line(px, n, n / 2, n / 2, n / 2 + Mathf.RoundToInt(off * scaleW), n / 2 + Mathf.RoundToInt(fwd * scaleW), col);
            }
            wagon.SetPixels32(px);
            wagon.Apply();

            // Pitch map: 3.05 m wide (plus margins) x 14 m from the batter's stumps.
            int pw = 96, ph = 256;
            var pp = new Color32[pw * ph];
            for (int y = 0; y < ph; y++)
                for (int x = 0; x < pw; x++)
                {
                    float len = (ph - y) / (float)ph * 14f;
                    byte band = (byte)(len < 2f ? 175 : len < 5f ? 165 : len < 8f ? 155 : 145);
                    pp[y * pw + x] = new Color32(band, (byte)(band - 25), (byte)(band - 70), 255);
                }
            for (int x = 0; x < pw; x++) pp[(ph - 1 - Mathf.RoundToInt(Geo.CreaseDepth / 14f * ph)) * pw + x] = new Color32(250, 250, 250, 255);
            for (int y = ph - 8; y < ph; y++) for (int x = pw / 2 - 5; x <= pw / 2 + 5; x += 5) pp[y * pw + x] = new Color32(255, 255, 255, 255);
            foreach (var b in inn.Log)
            {
                if (b.Pitched == Vector3.zero) continue;
                var f = BatFrame.For(b.StrikerEnd, !b.LeftHand);
                float off = f.OffsetOff(b.Pitched) * (b.LeftHand ? -1f : 1f);
                float len = f.OffsetFwd(b.Pitched);
                if (len < 0f || len > 14f) continue;
                int cx = pw / 2 + Mathf.RoundToInt(off / 2.4f * pw);
                int cy = ph - 1 - Mathf.RoundToInt(len / 14f * ph);
                var col = b.Wicket ? new Color32(248, 113, 113, 255) : b.Four || b.Six ? new Color32(96, 165, 250, 255) : b.Runs + b.Extras == 0 ? new Color32(120, 120, 130, 255) : new Color32(251, 191, 36, 255);
                for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++)
                    {
                        int xx = cx + x, yy = cy + y;
                        if (x * x + y * y <= 5 && xx >= 0 && xx < pw && yy >= 0 && yy < ph) pp[yy * pw + xx] = col;
                    }
            }
            pitchMap.SetPixels32(pp);
            pitchMap.Apply();
        }

        static void Line(Color32[] px, int n, int x0, int y0, int x1, int y1, Color32 c)
        {
            int dx = Mathf.Abs(x1 - x0), dy = -Mathf.Abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx + dy;
            for (int guard = 0; guard < 1000; guard++)
            {
                if (x0 >= 0 && x0 < n && y0 >= 0 && y0 < n) px[y0 * n + x0] = c;
                if (x0 == x1 && y0 == y1) break;
                int e2 = 2 * err;
                if (e2 >= dy) { err += dy; x0 += sx; }
                if (e2 <= dx) { err += dx; y0 += sy; }
            }
        }

        // ------------------------------------------------------------------ DRS

        void ReviewPanel(MatchDirector d)
        {
            var rv = d.Review;
            var r = Panel(new Rect(W - 560, 130, 520, rv.Lbw ? 420 : 330));
            Text(new Rect(r.x + 24, r.y + 16, r.width - 48, 40), "DECISION REVIEW", h2, Accent);
            Text(new Rect(r.x + 24, r.y + 56, r.width - 48, 30), $"Original decision: <b>{(rv.OriginalOut ? "OUT" : "NOT OUT")}</b>", small);
            float t = rv.Time;
            if (rv.Lbw)
            {
                Row(r, 0, "PITCHING", rv.Track.FullToss ? "FULL TOSS" : Umpiring.ZoneText(rv.Track.Pitching), rv.Track.Pitching == Zone.OutsideLeg ? Bad : Good, t > 1.8f);
                bool impactOk = rv.Track.ImpactZone == Zone.InLine || !rv.Track.ShotOffered && rv.Track.ImpactOffSide;
                Row(r, 1, "IMPACT", Umpiring.ZoneText(rv.Track.ImpactZone), rv.Track.ImpactZone == Zone.UmpiresCall ? Warn : impactOk ? Good : Bad, t > 3.2f);
                Row(r, 2, "WICKETS", Umpiring.ZoneText(rv.Track.Wickets), rv.Track.Wickets == Zone.Hitting ? Good : rv.Track.Wickets == Zone.UmpiresCall ? Warn : Bad, t > 4.8f);
            }
            else
            {
                // Edge detection: a sound-wave trace with a spike if there was a nick.
                var g = new Rect(r.x + 24, r.y + 110, r.width - 48, 110);
                Fill(g, darker);
                int bars = 60;
                float reveal = Mathf.Clamp01(t / 2.5f);
                for (int i = 0; i < Mathf.RoundToInt(bars * reveal); i++)
                {
                    float spike = rv.Edge && Mathf.Abs(i - bars / 2) < 2 ? 0.95f : Mathf.PerlinNoise(i * 0.4f, 0.5f) * 0.18f + 0.03f;
                    float h = g.height * spike;
                    Fill(new Rect(g.x + i * g.width / bars, g.center.y - h * 0.5f, g.width / bars - 1, h), rv.Edge && spike > 0.5f ? redTex : blueTex);
                }
                if (t > 3f) Text(new Rect(r.x + 24, r.y + 232, r.width - 48, 30), rv.Edge ? "Edge detected" : "No edge", label, rv.Edge ? Bad : Good);
            }
            if (t > d.ReviewDuration - 1.6f)
            {
                string verdict = rv.Outcome == ReviewOutcome.UmpiresCall ? "UMPIRE'S CALL" : rv.FinalOut ? "OUT" : "NOT OUT";
                Text(new Rect(r.x + 24, r.yMax - 70, r.width - 48, 50), verdict, h1, rv.FinalOut ? Bad : Good);
            }
        }

        void Row(Rect r, int i, string name, string value, Color c, bool shown)
        {
            var row = new Rect(r.x + 24, r.y + 104 + i * 70, r.width - 48, 58);
            Fill(row, darker);
            Text(new Rect(row.x + 16, row.y + 14, 200, 30), name, label);
            if (shown)
            {
                Fill(new Rect(row.xMax - 230, row.y + 8, 222, 42), white, c);
                Text(new Rect(row.xMax - 230, row.y + 14, 222, 30), $"<b>{value}</b>", new GUIStyle(label) { alignment = TextAnchor.MiddleCenter }, new Color(0.05f, 0.05f, 0.05f));
            }
        }
    }
}
