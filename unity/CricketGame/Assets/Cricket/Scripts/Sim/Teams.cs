using System;
using System.Collections.Generic;
using UnityEngine;

namespace Cricket.Sim
{
    public enum Role : byte { Batter, Bowler, AllRounder, Keeper }

    [Serializable]
    public class PlayerProfile
    {
        public string Name = "Player";
        public Role Role = Role.Batter;
        public bool LeftHandBat;
        public bool LeftArmBowl;
        public BowlStyle Bowl = BowlStyle.Medium;
        [Range(0, 100)] public int Batting = 60;
        [Range(0, 100)] public int Bowling = 40;
        [Range(0, 100)] public int Fielding = 60;
        [Range(0, 100)] public int Pace = 50;     // bowling speed within the style
        public int SkinTone;                      // 0 light, 1 dark texture; tint varies by name hash

        public float Bat01 => Batting / 100f;
        public float Bowl01 => Bowling / 100f;
        public float Field01 => Fielding / 100f;
        public float Pace01 => Pace / 100f;
        public bool CanBowl => Role == Role.Bowler || Role == Role.AllRounder || Bowling >= 45;

        public PlayerProfile Clone() => (PlayerProfile)MemberwiseClone();

        public string Initials()
        {
            var parts = Name.Split(' ');
            return parts.Length > 1 ? $"{parts[0][0]}. {parts[parts.Length - 1]}" : Name;
        }

        public string Surname()
        {
            var parts = Name.Split(' ');
            return parts[parts.Length - 1];
        }
    }

    [Serializable]
    public class TeamProfile
    {
        public string Id = "custom";
        public string Name = "My XI";
        public string Short = "MYX";
        public string Primary = "#1e40af";   // shirt (coloured kit)
        public string Secondary = "#facc15"; // trousers accents, helmet, cap peak
        public string Trousers = "#1e3a8a";
        public int Captain;
        public int Keeper = 4;
        public bool Custom;
        public List<PlayerProfile> Players = new List<PlayerProfile>();

        public Color PrimaryColor => Parse(Primary, new Color(0.12f, 0.25f, 0.69f));
        public Color SecondaryColor => Parse(Secondary, new Color(0.98f, 0.8f, 0.08f));
        public Color TrousersColor => Parse(Trousers, new Color(0.12f, 0.23f, 0.54f));

        public static Color Parse(string hex, Color fallback)
        {
            if (string.IsNullOrEmpty(hex)) return fallback;
            if (hex[0] != '#') hex = "#" + hex;
            return ColorUtility.TryParseHtmlString(hex, out var c) ? c : fallback;
        }

        public TeamProfile Clone()
        {
            var t = (TeamProfile)MemberwiseClone();
            t.Players = new List<PlayerProfile>();
            foreach (var p in Players) t.Players.Add(p.Clone());
            return t;
        }

        /// <summary>Makes sure there are 11 players, a keeper and at least five who can bowl.</summary>
        public void Validate()
        {
            while (Players.Count < 11) Players.Add(new PlayerProfile { Name = $"Player {Players.Count + 1}" });
            if (Players.Count > 11) Players.RemoveRange(11, Players.Count - 11);
            Keeper = Mathf.Clamp(Keeper, 0, 10);
            Captain = Mathf.Clamp(Captain, 0, 10);
            Players[Keeper].Role = Role.Keeper;
            int bowlers = 0;
            foreach (var p in Players) if (p.CanBowl && p.Role != Role.Keeper) bowlers++;
            for (int i = 10; i >= 0 && bowlers < 5; i--)
            {
                var p = Players[i];
                if (p.Role == Role.Keeper || p.CanBowl) continue;
                p.Role = Role.AllRounder;
                p.Bowling = Mathf.Max(p.Bowling, 50);
                bowlers++;
            }
            if (string.IsNullOrEmpty(Short)) Short = (Name ?? "XI").ToUpperInvariant();
            Short = Short.Length > 3 ? Short.Substring(0, 3).ToUpperInvariant() : Short.ToUpperInvariant();
        }

        public float Strength()
        {
            float s = 0f;
            foreach (var p in Players) s += Mathf.Max(p.Batting, p.Bowling) * 0.7f + p.Fielding * 0.3f;
            return s / Mathf.Max(1, Players.Count);
        }
    }

    [Serializable]
    class TeamList { public List<TeamProfile> Teams = new List<TeamProfile>(); }

    /// <summary>The fictional sides that ship with the game, plus the player's own teams (saved in PlayerPrefs).</summary>
    public static class TeamStore
    {
        const string Key = "cricket.teams.v1";

        static readonly string[] First =
        {
            "Arlo", "Bastien", "Callum", "Devan", "Eshan", "Faisal", "Gideon", "Halden", "Idris", "Jory", "Kiano", "Lorcan",
            "Marek", "Nilesh", "Orrin", "Pavel", "Quentin", "Rafferty", "Soren", "Tavish", "Ulric", "Varun", "Wynn", "Yannick",
            "Zeb", "Anselm", "Brodie", "Cyrus", "Dario", "Emrys", "Fintan", "Garrick", "Hamish", "Ivo", "Jasper", "Kofi",
            "Lennox", "Malik", "Nevan", "Oskar", "Pranav", "Rohan", "Sami", "Teodor", "Uday", "Vasco", "Wilder", "Xander",
        };

        static readonly string[] Last =
        {
            "Ashcombe", "Brightwell", "Caldmore", "Dunmere", "Ellacott", "Fairholm", "Galbraith", "Hartigan", "Inchley",
            "Jessop-Vane", "Kilbride", "Larchmont", "Morrow", "Northcote", "Okonkwo-Reid", "Pellham", "Quarrie", "Ravenhill",
            "Sallow", "Thornbury", "Underhay", "Varga", "Whitmore", "Yardley", "Zielke", "Abernethy", "Blackmoor", "Cresswell",
            "Draycott", "Esterby", "Fenwick", "Greaves-Lal", "Holloway", "Iyengar-Ross", "Joubertin", "Kestrell", "Lindqvist",
            "Mahadeo", "Nightingale", "Oduya", "Prabhakaran-Lee", "Rathbone", "Sandhurst", "Tremayne", "Uppal-Grant", "Vellacott",
        };

        struct Side { public string Id, Name, Short, Primary, Secondary, Trousers; public int Strength; }

        static readonly Side[] Sides =
        {
            new Side { Id = "northland", Name = "Northland", Short = "NTH", Primary = "#1d4ed8", Secondary = "#facc15", Trousers = "#1e3a8a", Strength = 78 },
            new Side { Id = "southern-isles", Name = "Southern Isles", Short = "SIS", Primary = "#047857", Secondary = "#fde047", Trousers = "#064e3b", Strength = 76 },
            new Side { Id = "eastvale", Name = "Eastvale", Short = "EVL", Primary = "#b91c1c", Secondary = "#f8fafc", Trousers = "#7f1d1d", Strength = 74 },
            new Side { Id = "westmark", Name = "Westmark", Short = "WMK", Primary = "#7c3aed", Secondary = "#f59e0b", Trousers = "#4c1d95", Strength = 72 },
            new Side { Id = "coral-coast", Name = "Coral Coast", Short = "CRL", Primary = "#f97316", Secondary = "#0ea5e9", Trousers = "#0c4a6e", Strength = 70 },
            new Side { Id = "red-mesa", Name = "Red Mesa", Short = "RMS", Primary = "#9f1239", Secondary = "#fbbf24", Trousers = "#1f2937", Strength = 68 },
            new Side { Id = "highland-union", Name = "Highland Union", Short = "HLU", Primary = "#0f766e", Secondary = "#f472b6", Trousers = "#134e4a", Strength = 66 },
            new Side { Id = "sunfield", Name = "Sunfield", Short = "SFD", Primary = "#ca8a04", Secondary = "#1e3a8a", Trousers = "#1e293b", Strength = 64 },
        };

        static List<TeamProfile> builtIn;

        public static List<TeamProfile> BuiltIn
        {
            get
            {
                if (builtIn == null)
                {
                    builtIn = new List<TeamProfile>();
                    foreach (var s in Sides) builtIn.Add(Generate(s.Id, s.Name, s.Short, s.Primary, s.Secondary, s.Trousers, s.Strength));
                }
                return builtIn;
            }
        }

        public static List<TeamProfile> Custom()
        {
            try
            {
                var json = PlayerPrefs.GetString(Key, "");
                if (string.IsNullOrEmpty(json)) return new List<TeamProfile>();
                var list = JsonUtility.FromJson<TeamList>(json);
                foreach (var t in list.Teams) { t.Custom = true; t.Validate(); }
                return list.Teams;
            }
            catch (Exception e)
            {
                Debug.LogWarning($"Cricket: couldn't read saved teams ({e.Message}).");
                return new List<TeamProfile>();
            }
        }

        public static List<TeamProfile> All()
        {
            var all = new List<TeamProfile>(Custom());
            all.AddRange(BuiltIn);
            return all;
        }

        public static TeamProfile Find(string id)
        {
            foreach (var t in All()) if (string.Equals(t.Id, id, StringComparison.OrdinalIgnoreCase)) return t.Clone();
            return null;
        }

        public static void Save(TeamProfile team)
        {
            team.Custom = true;
            team.Validate();
            if (string.IsNullOrEmpty(team.Id) || !team.Id.StartsWith("my-", StringComparison.Ordinal)) team.Id = "my-" + Guid.NewGuid().ToString("N").Substring(0, 8);
            var list = new TeamList { Teams = Custom() };
            list.Teams.RemoveAll(t => t.Id == team.Id);
            list.Teams.Insert(0, team.Clone());
            PlayerPrefs.SetString(Key, JsonUtility.ToJson(list));
            PlayerPrefs.Save();
        }

        public static void Delete(string id)
        {
            var list = new TeamList { Teams = Custom() };
            list.Teams.RemoveAll(t => t.Id == id);
            PlayerPrefs.SetString(Key, JsonUtility.ToJson(list));
            PlayerPrefs.Save();
        }

        public static string RandomName(Rng rng) => First[rng.Range(0, First.Length)] + " " + Last[rng.Range(0, Last.Length)];

        /// <summary>A balanced fictional XI: openers, middle order, a keeper, an all-rounder, two quicks, a medium pacer and two spinners.</summary>
        public static TeamProfile Generate(string id, string name, string shortName, string primary, string secondary, string trousers, int strength)
        {
            var rng = new Rng(Hash(id));
            var t = new TeamProfile { Id = id, Name = name, Short = shortName, Primary = primary, Secondary = secondary, Trousers = trousers };
            var used = new HashSet<string>();
            Role[] roles = { Role.Batter, Role.Batter, Role.Batter, Role.Batter, Role.Keeper, Role.AllRounder, Role.AllRounder, Role.Bowler, Role.Bowler, Role.Bowler, Role.Bowler };
            BowlStyle[] styles = { BowlStyle.Medium, BowlStyle.OffSpin, BowlStyle.Medium, BowlStyle.LegSpin, BowlStyle.Medium, BowlStyle.Medium, BowlStyle.OffSpin, BowlStyle.Fast, BowlStyle.Fast, BowlStyle.LegSpin, BowlStyle.Fast };
            for (int i = 0; i < 11; i++)
            {
                string n;
                do n = RandomName(rng); while (!used.Add(n));
                var role = roles[i];
                int bat = role == Role.Batter ? strength + rng.Range(-4, 12) : role == Role.Keeper ? strength + rng.Range(-8, 6)
                        : role == Role.AllRounder ? strength + rng.Range(-10, 4) : strength - 35 + rng.Range(-8, 10) - i * 2;
                int bowl = role == Role.Bowler ? strength + rng.Range(-2, 12) : role == Role.AllRounder ? strength + rng.Range(-8, 4)
                         : rng.Range(10, 35);
                t.Players.Add(new PlayerProfile
                {
                    Name = n,
                    Role = role,
                    LeftHandBat = rng.Chance(0.28f),
                    LeftArmBowl = rng.Chance(0.22f),
                    Bowl = styles[i],
                    Batting = Mathf.Clamp(bat, 15, 99),
                    Bowling = Mathf.Clamp(bowl, 5, 99),
                    Fielding = Mathf.Clamp(strength + rng.Range(-15, 12), 30, 99),
                    Pace = rng.Range(30, 95),
                    SkinTone = rng.Range(0, 2),
                });
            }
            t.Keeper = 4;
            t.Captain = rng.Range(0, 4);
            t.Validate();
            return t;
        }

        public static int Hash(string s)
        {
            unchecked
            {
                int h = 23;
                foreach (char c in s ?? "") h = h * 31 + c;
                return h;
            }
        }
    }
}
