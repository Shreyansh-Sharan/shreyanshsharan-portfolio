using System;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Core
{
    public enum LaunchMode { Menu, Lobby, Quick, Host, Join }

    /// <summary>
    /// How a match should start: from the page URL (?mode=quick&amp;format=t20&amp;team=northland&amp;opp=eastvale&amp;diff=1
    /// &amp;pitch=flat&amp;time=night&amp;overs=5&amp;field=manual), from a "start" message the page posts into a preloaded game
    /// (same keys), or from the in-game menu.
    /// </summary>
    [Serializable]
    public class LaunchOptions
    {
        public LaunchMode Mode = LaunchMode.Menu;
        public MatchFormat Format = MatchFormat.T20;
        public int Overs;
        public string Team = "";
        public string Opponent = "";
        public Difficulty Difficulty = Difficulty.Normal;
        public PitchType Pitch = PitchType.Flat;
        public TimeOfDay Time = TimeOfDay.Day;
        public string Code = "";
        public string Name = "Player";
        public bool ManualFielding;
        /// <summary>A custom team JSON passed by the page (the lobby's team builder), optional.</summary>
        public string TeamJson = "";

        public static LaunchOptions Current = new LaunchOptions();

        public static LaunchOptions FromUrl(string url)
        {
            if (string.IsNullOrEmpty(url)) return new LaunchOptions();
            int q = url.IndexOf('?');
            if (q < 0) return new LaunchOptions();
            var query = url.Substring(q + 1);
            int hash = query.IndexOf('#');
            if (hash >= 0) query = query.Substring(0, hash);
            return FromQuery(query);
        }

        public static LaunchOptions FromQuery(string query)
        {
            var o = new LaunchOptions();
            if (string.IsNullOrEmpty(query)) return o;
            if (query.StartsWith("?")) query = query.Substring(1);
            foreach (var pair in query.Split('&'))
            {
                var kv = pair.Split(new[] { '=' }, 2);
                if (kv.Length != 2) continue;
                var key = kv[0].ToLowerInvariant();
                string value;
                try { value = Uri.UnescapeDataString(kv[1].Replace('+', ' ')).Trim(); }
                catch { continue; }
                string v = value.ToLowerInvariant();
                switch (key)
                {
                    case "mode":
                        o.Mode = v == "quick" || v == "solo" ? LaunchMode.Quick : v == "host" ? LaunchMode.Host : v == "join" ? LaunchMode.Join : v == "lobby" ? LaunchMode.Lobby : LaunchMode.Menu;
                        break;
                    case "format":
                        o.Format = v == "t10" ? MatchFormat.T10 : v == "odi" ? MatchFormat.ODI : v == "super" || v == "superover" ? MatchFormat.SuperOver : MatchFormat.T20;
                        break;
                    case "overs":
                        if (int.TryParse(v, out var ov)) o.Overs = Mathf.Clamp(ov, 1, 50);
                        break;
                    case "team": o.Team = value; break;
                    case "opp": o.Opponent = value; break;
                    case "diff":
                        if (int.TryParse(v, out var d)) o.Difficulty = (Difficulty)Mathf.Clamp(d, 0, 2);
                        break;
                    case "pitch":
                        o.Pitch = v == "green" ? PitchType.Green : v == "dusty" || v == "dry" ? PitchType.Dusty : PitchType.Flat;
                        break;
                    case "time":
                        o.Time = v == "night" ? TimeOfDay.Night : v == "dusk" ? TimeOfDay.Dusk : TimeOfDay.Day;
                        break;
                    case "code": o.Code = value.ToUpperInvariant(); break;
                    case "name": o.Name = Sanitize(value); break;
                    case "field": o.ManualFielding = v == "manual"; break;
                    case "teamjson": o.TeamJson = value; break;
                }
            }
            if (o.Mode == LaunchMode.Join && string.IsNullOrEmpty(o.Code)) o.Mode = LaunchMode.Menu;
            return o;
        }

        public static string Sanitize(string name)
        {
            name = (name ?? "").Trim();
            if (name.Length > 16) name = name.Substring(0, 16);
            return string.IsNullOrEmpty(name) ? "Player" : name;
        }

        /// <summary>Builds the match setup: your team (custom or built-in) against the opponent.</summary>
        public MatchSetup ToSetup()
        {
            var setup = new MatchSetup
            {
                Format = Format,
                Overs = Overs,
                Difficulty = Difficulty,
                Pitch = Pitch,
                Time = Time,
                ManualFielding = ManualFielding,
                Seed = Environment.TickCount,
            };
            TeamProfile mine = null;
            if (!string.IsNullOrEmpty(TeamJson))
            {
                try { mine = JsonUtility.FromJson<TeamProfile>(TeamJson); mine.Custom = true; }
                catch { mine = null; }
            }
            mine ??= TeamStore.Find(string.IsNullOrEmpty(Team) ? Settings.TeamId : Team) ?? TeamStore.BuiltIn[0].Clone();
            var opp = TeamStore.Find(Opponent);
            if (opp == null || opp.Id == mine.Id)
            {
                foreach (var t in TeamStore.BuiltIn) if (t.Id != mine.Id) { opp = t.Clone(); break; }
            }
            mine.Validate();
            opp.Validate();
            setup.Teams = new[] { mine, opp };
            return setup;
        }
    }
}
