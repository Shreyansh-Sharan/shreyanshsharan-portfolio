using System;
using Arena.Map;
using UnityEngine;

namespace Arena.Core
{
    public enum LaunchMode { Menu, Solo, Host, Join }

    /// <summary>How a match should start. Read from the page URL when embedded in the portfolio site.</summary>
    [Serializable]
    public class LaunchOptions
    {
        public LaunchMode Mode = LaunchMode.Menu;
        public int Bots = 5;
        public int Difficulty = 1; // 0 easy, 1 normal, 2 hard
        public string Name = "Player";
        public string Code = "";
        public string Map = "dunes"; // dunes | harbor | frost (the host's choice; joiners follow the host)

        public static LaunchOptions Current = new LaunchOptions();

        /// <summary>Parses ?mode=solo|host|join&amp;bots=5&amp;diff=1&amp;name=Ana&amp;code=ABC123&amp;map=dunes|harbor|frost.</summary>
        public static LaunchOptions FromUrl(string url)
        {
            var o = new LaunchOptions();
            if (string.IsNullOrEmpty(url)) return o;
            int q = url.IndexOf('?');
            if (q < 0) return o;
            var query = url.Substring(q + 1);
            int hash = query.IndexOf('#');
            if (hash >= 0) query = query.Substring(0, hash);

            foreach (var pair in query.Split('&'))
            {
                var kv = pair.Split(new[] { '=' }, 2);
                if (kv.Length != 2) continue;
                var key = kv[0].ToLowerInvariant();
                var value = Uri.UnescapeDataString(kv[1].Replace('+', ' '));
                switch (key)
                {
                    case "mode":
                        o.Mode = value.ToLowerInvariant() switch
                        {
                            "solo" => LaunchMode.Solo,
                            "host" => LaunchMode.Host,
                            "join" => LaunchMode.Join,
                            _ => LaunchMode.Menu,
                        };
                        break;
                    case "bots":
                        if (int.TryParse(value, out var b)) o.Bots = Mathf.Clamp(b, 0, 9);
                        break;
                    case "diff":
                        if (int.TryParse(value, out var d)) o.Difficulty = Mathf.Clamp(d, 0, 2);
                        break;
                    case "name":
                        o.Name = Sanitize(value);
                        break;
                    case "code":
                        o.Code = value.Trim().ToUpperInvariant();
                        break;
                    case "map":
                        o.Map = Maps.Get(Maps.IndexOf(value.Trim())).Id;
                        break;
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
    }
}
