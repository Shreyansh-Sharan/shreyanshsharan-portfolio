using Cricket.Sim;
using UnityEngine;

namespace Cricket.UI
{
    /// <summary>Team builder: your own side with name, kit colours and eleven players (roles, hands, bowling styles and
    /// ratings), saved in the browser (PlayerPrefs).</summary>
    public partial class Hud
    {
        TeamProfile editTeam;
        string savedNote = "";

        static readonly string[] Palette =
        {
            "#1d4ed8", "#0ea5e9", "#047857", "#22c55e", "#b91c1c", "#f97316", "#facc15", "#7c3aed", "#db2777", "#0f172a", "#f8fafc", "#78350f",
        };

        void TeamListScreen()
        {
            var r = Panel(new Rect(W * 0.5f - 560, H * 0.5f - 400, 1120, 800));
            Text(new Rect(r.x + 30, r.y + 20, 800, 50), "Team builder", h1);
            Text(new Rect(r.x + 30, r.y + 76, r.width - 60, 30), "Create your own side, or start from one of the built-in teams. Saved in this browser.", small);
            var custom = TeamStore.Custom();
            float y = r.y + 130;
            if (custom.Count == 0) { Text(new Rect(r.x + 30, y, 700, 30), "No teams of your own yet.", label); y += 44; }
            foreach (var t in custom)
            {
                Fill(new Rect(r.x + 30, y + 6, 10, 36), white, t.PrimaryColor);
                Text(new Rect(r.x + 52, y + 8, 520, 32), $"<b>{t.Name}</b> ({t.Short})", label);
                if (Button(new Rect(r.x + 600, y, 150, 46), "Edit")) { editTeam = t.Clone(); savedNote = ""; screen = Screen.TeamEdit; }
                if (Button(new Rect(r.x + 760, y, 150, 46), "Play", Settings.TeamId == t.Id)) { Settings.TeamId = t.Id; setup = null; teamsCache = null; screen = Screen.Setup; }
                if (Button(new Rect(r.x + 920, y, 150, 46), "Delete")) { TeamStore.Delete(t.Id); teamsCache = null; }
                y += 56;
            }
            y += 20;
            Text(new Rect(r.x + 30, y, 600, 30), "<b>Start a new team from</b>", label, Accent);
            y += 40;
            if (Button(new Rect(r.x + 30, y, 220, 48), "Blank XI"))
            {
                var rng = new Rng(System.Environment.TickCount);
                editTeam = TeamStore.Generate("my-new", "My XI", "MYX", "#1d4ed8", "#facc15", "#1e3a8a", 72);
                editTeam.Id = "";
                savedNote = "";
                screen = Screen.TeamEdit;
            }
            int i = 0;
            foreach (var t in TeamStore.BuiltIn)
            {
                var b = new Rect(r.x + 270 + (i % 3) * 270, y + (i / 3) * 56, 260, 48);
                if (Button(b, t.Name))
                {
                    editTeam = t.Clone();
                    editTeam.Id = "";
                    editTeam.Name = "My " + t.Name;
                    savedNote = "";
                    screen = Screen.TeamEdit;
                }
                Fill(new Rect(b.x + 6, b.y + 6, 6, b.height - 12), white, t.PrimaryColor);
                i++;
            }
            if (Button(new Rect(r.x + 30, r.yMax - 80, 200, 56), "Back")) { teamsCache = null; screen = Screen.Main; }
        }

        void TeamEditScreen()
        {
            var t = editTeam;
            if (t == null) { screen = Screen.TeamList; return; }
            var r = Panel(new Rect(W * 0.5f - 900, H * 0.5f - 500, 1800, 1000));
            Text(new Rect(r.x + 30, r.y + 16, 400, 46), "Edit team", h1);
            // Name, short code and colours.
            Text(new Rect(r.x + 30, r.y + 76, 100, 30), "Name", label);
            uiRects.Add(new Rect(r.x + 110, r.y + 70, 380, 44));
            t.Name = GUI.TextField(new Rect(r.x + 110, r.y + 70, 380, 44), t.Name ?? "", 24, field);
            Text(new Rect(r.x + 510, r.y + 76, 80, 30), "Code", label);
            uiRects.Add(new Rect(r.x + 580, r.y + 70, 100, 44));
            t.Short = GUI.TextField(new Rect(r.x + 580, r.y + 70, 100, 44), t.Short ?? "", 3, field).ToUpperInvariant();
            Swatches(new Rect(r.x + 710, r.y + 66, 1060, 34), "Shirt", ref t.Primary);
            Swatches(new Rect(r.x + 710, r.y + 104, 1060, 34), "Accent", ref t.Secondary);
            Swatches(new Rect(r.x + 710, r.y + 142, 1060, 34), "Trousers", ref t.Trousers);

            // Header row.
            float y = r.y + 196;
            string[] head = { "#", "Player", "Role", "Bats", "Bowls", "Arm", "Batting", "Bowling", "Fielding", "Pace", "C", "WK" };
            float[] xs = { 0, 40, 330, 520, 600, 790, 860, 1070, 1280, 1490, 1650, 1700 };
            for (int i = 0; i < head.Length; i++) Text(new Rect(r.x + 30 + xs[i], y, 200, 28), $"<b>{head[i]}</b>", tiny);
            y += 32;
            for (int i = 0; i < t.Players.Count && i < 11; i++)
            {
                var p = t.Players[i];
                float x = r.x + 30;
                Text(new Rect(x, y + 8, 40, 30), (i + 1).ToString(), label, Muted);
                uiRects.Add(new Rect(x + 40, y, 280, 42));
                p.Name = GUI.TextField(new Rect(x + 40, y, 280, 42), p.Name ?? "", 22, field);
                if (Button(new Rect(x + 330, y, 180, 42), RoleName(p.Role))) p.Role = (Role)(((int)p.Role + 1) % 4);
                if (Button(new Rect(x + 520, y, 70, 42), p.LeftHandBat ? "L" : "R")) p.LeftHandBat = !p.LeftHandBat;
                if (Button(new Rect(x + 600, y, 180, 42), StyleShort(p.Bowl))) p.Bowl = (BowlStyle)(((int)p.Bowl + 1) % 4);
                if (Button(new Rect(x + 790, y, 60, 42), p.LeftArmBowl ? "L" : "R")) p.LeftArmBowl = !p.LeftArmBowl;
                p.Batting = Rating(new Rect(x + 860, y, 200, 42), p.Batting);
                p.Bowling = Rating(new Rect(x + 1070, y, 200, 42), p.Bowling);
                p.Fielding = Rating(new Rect(x + 1280, y, 200, 42), p.Fielding);
                p.Pace = Rating(new Rect(x + 1490, y, 150, 42), p.Pace);
                if (Button(new Rect(x + 1650, y, 42, 42), t.Captain == i ? "●" : "", t.Captain == i)) t.Captain = i;
                if (Button(new Rect(x + 1700, y, 42, 42), t.Keeper == i ? "●" : "", t.Keeper == i)) t.Keeper = i;
                y += 50;
            }
            Text(new Rect(r.x + 30, y + 6, 1200, 30), "Batting order is top to bottom. Click a role, hand or style to cycle it. You need a keeper and at least five bowlers (fixed for you on save).", tiny);

            if (Button(new Rect(r.x + 30, r.yMax - 76, 200, 54), "Back")) { screen = Screen.TeamList; teamsCache = null; }
            if (Button(new Rect(r.x + 250, r.yMax - 76, 240, 54), "Random names"))
            {
                var rng = new Rng(System.Environment.TickCount);
                foreach (var p in t.Players) p.Name = TeamStore.RandomName(rng);
            }
            if (Button(new Rect(r.xMax - 560, r.yMax - 76, 250, 54), "Save"))
            {
                TeamStore.Save(t);
                teamsCache = null;
                savedNote = "Saved.";
            }
            if (Button(new Rect(r.xMax - 290, r.yMax - 76, 260, 54), "Save and play", true))
            {
                TeamStore.Save(t);
                Settings.TeamId = t.Id;
                teamsCache = null;
                setup = null;
                screen = Screen.Setup;
            }
            if (!string.IsNullOrEmpty(savedNote)) Text(new Rect(r.xMax - 760, r.yMax - 64, 180, 30), savedNote, label, Good);
        }

        int Rating(Rect r, int v)
        {
            uiRects.Add(r);
            int nv = Mathf.RoundToInt(GUI.HorizontalSlider(new Rect(r.x, r.y + 14, r.width - 50, 20), v, 0, 100));
            Text(new Rect(r.xMax - 44, r.y + 8, 44, 30), nv.ToString(), small);
            return nv;
        }

        void Swatches(Rect r, string name, ref string value)
        {
            Text(new Rect(r.x, r.y + 2, 110, 30), name, small);
            for (int i = 0; i < Palette.Length; i++)
            {
                var b = new Rect(r.x + 120 + i * 46, r.y, 40, 32);
                uiRects.Add(b);
                Fill(b, white, TeamProfile.Parse(Palette[i], Color.gray));
                if (string.Equals(value, Palette[i], System.StringComparison.OrdinalIgnoreCase)) Fill(new Rect(b.x, b.yMax - 4, b.width, 4), accentTex);
                if (GUI.Button(b, GUIContent.none, GUIStyle.none)) value = Palette[i];
            }
        }

        static string RoleName(Role r) => r == Role.AllRounder ? "All-rounder" : r == Role.Keeper ? "Keeper" : r.ToString();

        static string StyleShort(BowlStyle s) => s == BowlStyle.OffSpin ? "Off-spin" : s == BowlStyle.LegSpin ? "Leg-spin" : s.ToString();
    }
}
