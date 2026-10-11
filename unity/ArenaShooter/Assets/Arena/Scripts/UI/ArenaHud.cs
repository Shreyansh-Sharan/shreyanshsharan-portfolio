using System.Collections.Generic;
using Arena.Core;
using Arena.Game;
using UnityEngine;

namespace Arena.UI
{
    /// <summary>Main menu and in-game HUD, drawn with IMGUI so the build needs no UI assets.</summary>
    public class ArenaHud : MonoBehaviour
    {
        public static bool MenuOpen { get; private set; }
        public static bool PointerOverUi { get; private set; }

        static float hitUntil, damageAt = -10f, toastUntil;
        static bool hitKill, hitHead;
        static Vector3 damageFrom;
        static string toast;
        static Color toastColor;

        public static void ShowHit(bool headshot, bool killed)
        {
            hitUntil = Time.time + (killed ? 0.35f : 0.15f);
            hitKill = killed;
            hitHead = headshot;
        }

        public static void ShowDamage(Vector3 from)
        {
            damageAt = Time.time;
            damageFrom = from;
        }

        public static void Toast(string text, Color color)
        {
            toast = text;
            toastColor = color;
            toastUntil = Time.time + 2.2f;
        }

        static readonly Color Panel = new Color(0.03f, 0.04f, 0.09f, 0.72f);
        static readonly Color Accent = new Color(0.98f, 0.62f, 0.2f);
        static readonly Color Cyan = new Color(0.25f, 0.85f, 1f);
        static readonly Color Muted = new Color(1f, 1f, 1f, 0.6f);

        Texture2D white;
        GUIStyle label, title, big, small, button, field, center;
        GUIStyle bigLeft, bigRight, smallCenter, smallRight, smallTop, smallWrap, labelBold, code;
        string nameField = "Player", codeField = "";
        float bots = 5;
        int difficulty = 1;
        float width;
        readonly List<Rect> uiRects = new List<Rect>();

        void Awake()
        {
            white = Texture2D.whiteTexture;
            nameField = LaunchOptions.Current.Name;
            codeField = LaunchOptions.Current.Code;
            bots = LaunchOptions.Current.Bots;
            difficulty = LaunchOptions.Current.Difficulty;
        }

        void InitStyles()
        {
            if (label != null) return;
            label = new GUIStyle(GUI.skin.label) { fontSize = 22, richText = true };
            label.normal.textColor = Color.white;
            center = new GUIStyle(label) { alignment = TextAnchor.MiddleCenter };
            small = new GUIStyle(label) { fontSize = 17 };
            big = new GUIStyle(center) { fontSize = 44, fontStyle = FontStyle.Bold };
            title = new GUIStyle(center) { fontSize = 72, fontStyle = FontStyle.Bold };
            button = new GUIStyle(GUI.skin.button) { fontSize = 22, fontStyle = FontStyle.Bold };
            button.normal.textColor = button.hover.textColor = button.active.textColor = Color.white;
            field = new GUIStyle(GUI.skin.textField) { fontSize = 24, alignment = TextAnchor.MiddleLeft, padding = new RectOffset(12, 12, 6, 6) };
            bigLeft = new GUIStyle(big) { alignment = TextAnchor.MiddleLeft };
            bigRight = new GUIStyle(big) { alignment = TextAnchor.MiddleRight };
            code = new GUIStyle(bigLeft) { fontSize = 38 };
            smallCenter = new GUIStyle(small) { alignment = TextAnchor.MiddleCenter };
            smallRight = new GUIStyle(small) { alignment = TextAnchor.MiddleRight };
            smallTop = new GUIStyle(small) { alignment = TextAnchor.UpperCenter };
            smallWrap = new GUIStyle(smallTop) { wordWrap = true };
            labelBold = new GUIStyle(label) { fontStyle = FontStyle.Bold };
        }

        void Update()
        {
            var boot = ArenaBootstrap.Instance;
            MenuOpen = boot == null || !boot.InGame;
        }

        void OnGUI()
        {
            InitStyles();
            float scale = Screen.height / 1080f;
            GUI.matrix = Matrix4x4.TRS(Vector3.zero, Quaternion.identity, new Vector3(scale, scale, 1f));
            width = Screen.width / scale;
            uiRects.Clear();

            var boot = ArenaBootstrap.Instance;
            if (boot == null) return;
            if (!boot.InGame) DrawMenu(boot);
            else DrawHud(boot);

            if (Event.current.type == EventType.Repaint)
            {
                var mouse = Event.current.mousePosition;
                PointerOverUi = uiRects.Exists(r => r.Contains(mouse));
            }
        }

        // ---------------- Menu ----------------

        void DrawMenu(ArenaBootstrap boot)
        {
            Fill(new Rect(0, 0, width, 1080), new Color(0.02f, 0.02f, 0.05f, 0.35f));
            float w = 640, x = (width - w) / 2f, y = 150;
            Fill(new Rect(x - 30, y - 30, w + 60, 800), Panel);

            Text(new Rect(x, y, w, 80), "DUNES ARENA", title, Accent);
            Text(new Rect(x, y + 80, w, 30), "A portfolio side quest: desert deathmatch with powers", center, Muted);
            y += 140;

            Text(new Rect(x, y, 160, 44), "Name", label, Muted);
            nameField = GUI.TextField(new Rect(x + 160, y, w - 160, 44), nameField, 16, field);
            y += 64;

            Text(new Rect(x, y, 160, 30), $"Bots: {Mathf.RoundToInt(bots)}", label, Muted);
            bots = GUI.HorizontalSlider(new Rect(x + 160, y + 10, w - 160, 30), bots, 0, 9);
            y += 50;

            Text(new Rect(x, y, 160, 44), "Bot skill", label, Muted);
            difficulty = GUI.SelectionGrid(new Rect(x + 160, y, w - 160, 44), difficulty, new[] { "Easy", "Normal", "Hard" }, 3, button);
            y += 74;

            GUI.enabled = !boot.Busy;
            if (GUI.Button(new Rect(x, y, w, 64), "PLAY VS BOTS", button)) Launch(boot, LaunchMode.Solo);
            y += 80;
            if (GUI.Button(new Rect(x, y, w, 64), "HOST ONLINE MATCH (GET A CODE)", button)) Launch(boot, LaunchMode.Host);
            y += 90;

            Text(new Rect(x, y, 160, 50), "Join code", label, Muted);
            codeField = GUI.TextField(new Rect(x + 160, y, w - 160 - 150, 50), codeField.ToUpperInvariant(), 12, field);
            if (GUI.Button(new Rect(x + w - 140, y, 140, 50), "JOIN", button) && codeField.Trim().Length > 0) Launch(boot, LaunchMode.Join);
            GUI.enabled = true;
            y += 76;

            if (!string.IsNullOrEmpty(boot.Status)) Text(new Rect(x, y, w, 60), boot.Status, center, Accent);
            Text(new Rect(x, 1080 - 80, w, 30), "WASD move · Mouse aim · Click fire · Space double jump · Q dash · E shield · F scan · R reload · Tab scores", center, Muted);
        }

        void Launch(ArenaBootstrap boot, LaunchMode mode)
        {
            boot.StartGame(new LaunchOptions
            {
                Mode = mode,
                Bots = Mathf.RoundToInt(bots),
                Difficulty = difficulty,
                Name = LaunchOptions.Sanitize(nameField),
                Code = codeField.Trim().ToUpperInvariant(),
            });
        }

        // ---------------- HUD ----------------

        void DrawHud(ArenaBootstrap boot)
        {
            var me = Combatant.Local;
            var pc = PlayerController.Local;
            var match = MatchManager.Instance;
            if (me == null || pc == null)
            {
                Text(new Rect(0, 500, width, 60), "Joining the arena...", big, Color.white);
                return;
            }
            var weapon = me.GetComponent<Weapon>();
            float cx = width / 2f, cy = 540f;

            // Damage flash.
            float dmg = Mathf.Clamp01(1f - (Time.time - damageAt) / 0.5f);
            if (dmg > 0) Fill(new Rect(0, 0, width, 1080), new Color(0.9f, 0.05f, 0.05f, 0.22f * dmg));

            if (me.Alive.Value && (match == null || !match.Ended.Value))
            {
                DrawCrosshair(cx, cy, pc, weapon);
                DrawScan(pc, me);
            }

            DrawVitals(me, weapon);
            DrawAbilities(pc, me, cx);
            DrawTopBar(match, cx);
            DrawFeed(match);
            if (!string.IsNullOrEmpty(boot.JoinCode)) DrawInvite(boot.JoinCode);

            if (toast != null && Time.time < toastUntil)
                Text(new Rect(0, 700, width, 50), toast, big, toastColor);

            if (!me.Alive.Value && (match == null || !match.Ended.Value))
            {
                Fill(new Rect(cx - 330, 380, 660, 150), Panel);
                Text(new Rect(cx - 330, 395, 660, 60), $"ELIMINATED BY {me.LastKiller.Value.ToString().ToUpperInvariant()}", big, new Color(1f, 0.35f, 0.35f));
                float wait = Mathf.Max(0, (float)(me.RespawnAt.Value - me.Now));
                Text(new Rect(cx - 330, 460, 660, 50), $"Respawning in {wait:0.0}s", center, Color.white);
            }

            if (match != null && match.Ended.Value) DrawMatchEnd(match, cx);
            else if (Input.GetKey(KeyCode.Tab)) DrawScoreboard(cx);

            if (!PlayerController.InputCaptured && me.Alive.Value) DrawPaused(boot, cx);
        }

        void DrawCrosshair(float cx, float cy, PlayerController pc, Weapon weapon)
        {
            float gap = 7f + (pc.Moving ? 7f : 0f) + (weapon != null ? weapon.CurrentSpread * 2f : 0f);
            if (pc.Zoomed) gap *= 0.5f;
            var c = new Color(1f, 1f, 1f, 0.9f);
            Fill(new Rect(cx - 1, cy - gap - 10, 2, 10), c);
            Fill(new Rect(cx - 1, cy + gap, 2, 10), c);
            Fill(new Rect(cx - gap - 10, cy - 1, 10, 2), c);
            Fill(new Rect(cx + gap, cy - 1, 10, 2), c);
            Fill(new Rect(cx - 1, cy - 1, 2, 2), c);

            if (Time.time < hitUntil)
            {
                var hc = hitKill ? new Color(1f, 0.25f, 0.25f) : hitHead ? Accent : Color.white;
                var matrix = GUI.matrix;
                for (int i = 0; i < 4; i++)
                {
                    GUIUtility.RotateAroundPivot(45f + 90f * i, new Vector2(cx, cy));
                    Fill(new Rect(cx + 9, cy - 1.5f, 12, 3), hc);
                    GUI.matrix = matrix;
                }
            }
        }

        void DrawScan(PlayerController pc, Combatant me)
        {
            if (Time.time >= pc.ScanUntil || pc.Camera == null) return;
            float scale = Screen.height / 1080f;
            foreach (var c in Combatant.All)
            {
                if (c == me || !c.Alive.Value) continue;
                var sp = pc.Camera.WorldToScreenPoint(c.transform.position + Vector3.up * 2.1f);
                if (sp.z <= 0) continue;
                float x = sp.x / scale, y = (Screen.height - sp.y) / scale;
                float d = Vector3.Distance(pc.transform.position, c.transform.position);
                Fill(new Rect(x - 7, y - 7, 14, 14), new Color(1f, 0.25f, 0.3f, 0.9f));
                Text(new Rect(x - 80, y + 8, 160, 24), $"{c.Name} · {d:0}m", smallTop, new Color(1f, 0.6f, 0.6f));
            }
        }

        void DrawVitals(Combatant me, Weapon weapon)
        {
            var r = new Rect(40, 1080 - 150, 380, 110);
            Fill(r, Panel);
            Text(new Rect(r.x + 20, r.y + 8, 140, 60), me.Health.Value.ToString(), bigLeft, Color.white);
            Text(new Rect(r.x + 130, r.y + 22, 120, 30), "HEALTH", small, Muted);
            Bar(new Rect(r.x + 20, r.y + 72, 340, 10), me.Health.Value / (float)Combatant.MaxHealth, new Color(0.35f, 0.95f, 0.5f));
            Bar(new Rect(r.x + 20, r.y + 88, 340, 8), me.Shield.Value / (float)Combatant.MaxShield, Cyan);
            if (me.Shield.Value > 0) Text(new Rect(r.x + 250, r.y + 22, 120, 30), $"+{me.Shield.Value} SHIELD", small, Cyan);

            if (weapon == null) return;
            var a = new Rect(width - 300, 1080 - 150, 260, 110);
            Fill(a, Panel);
            Text(new Rect(a.x, a.y + 10, a.width - 20, 60), $"{weapon.Ammo}<size=26> / {weapon.MagazineSize}</size>", bigRight, Color.white);
            if (weapon.Reloading)
            {
                Text(new Rect(a.x + 20, a.y + 72, 200, 26), "RELOADING", small, Accent);
                Bar(new Rect(a.x + 20, a.y + 96, a.width - 40, 6), weapon.ReloadProgress, Accent);
            }
            else Text(new Rect(a.x + 20, a.y + 72, 220, 26), "PULSE RIFLE", small, Muted);
        }

        void DrawAbilities(PlayerController pc, Combatant me, float cx)
        {
            float now = Time.time;
            var items = new (string key, string name, float left, float total, Color color)[]
            {
                ("Q", "DASH", pc.DashReadyAt - now, PlayerController.DashCooldown, Accent),
                ("E", "SHIELD", (float)(me.OvershieldReadyAt.Value - me.Now), Combatant.OvershieldCooldown, Cyan),
                ("F", "SCAN", pc.ScanReadyAt - now, PlayerController.ScanCooldown, new Color(1f, 0.4f, 0.45f)),
            };
            float w = 130, gap = 14, x = cx - (items.Length * w + (items.Length - 1) * gap) / 2f, y = 1080 - 120;
            foreach (var it in items)
            {
                var r = new Rect(x, y, w, 80);
                Fill(r, Panel);
                bool ready = it.left <= 0;
                Text(new Rect(r.x + 12, r.y + 6, 40, 30), it.key, labelBold, ready ? it.color : Muted);
                Text(new Rect(r.x + 44, r.y + 8, w - 50, 26), it.name, small, Color.white);
                Text(new Rect(r.x + 12, r.y + 38, w - 24, 28), ready ? "READY" : $"{it.left:0.0}s", small, ready ? it.color : Muted);
                Bar(new Rect(r.x + 12, r.y + 68, w - 24, 5), ready ? 1f : 1f - it.left / it.total, it.color);
                x += w + gap;
            }

            float by = y - 40;
            if (me.HasOverdrive) Text(new Rect(cx - 300, by, 600, 30), $"OVERDRIVE {(float)(me.OverdriveUntil.Value - me.Now):0}s: DOUBLE DAMAGE", center, Accent);
            if (me.HasHaste) Text(new Rect(cx - 300, by - 30, 600, 30), $"HASTE {(float)(me.HasteUntil.Value - me.Now):0}s", center, new Color(0.85f, 0.45f, 1f));
        }

        void DrawTopBar(MatchManager match, float cx)
        {
            if (match == null) return;
            var r = new Rect(cx - 160, 20, 320, 84);
            Fill(r, Panel);
            float s = match.SecondsLeft;
            Text(new Rect(r.x, r.y + 4, r.width, 46), $"{(int)s / 60}:{(int)s % 60:00}", big, match.Ended.Value ? Accent : Color.white);
            var leader = MatchManager.Leader();
            string lead = leader != null ? $"{leader.Name} leads · {leader.Kills.Value}/{MatchManager.KillLimit}" : $"First to {MatchManager.KillLimit}";
            Text(new Rect(r.x, r.y + 50, r.width, 28), lead, smallCenter, Muted);
        }

        void DrawFeed(MatchManager match)
        {
            if (match == null) return;
            float y = 24;
            for (int i = match.Feed.Count - 1; i >= 0; i--)
            {
                var k = match.Feed[i];
                if (Time.time - k.Time > 7f) continue;
                string killer = string.IsNullOrEmpty(k.Killer) ? "" : $"<color=#{ColorUtility.ToHtmlStringRGB(k.KillerColor)}>{k.Killer}</color>  >  ";
                string text = $"{killer}<color=#{ColorUtility.ToHtmlStringRGB(k.VictimColor)}>{k.Victim}</color>{(k.Headshot ? "  (headshot)" : "")}";
                var r = new Rect(width - 520, y, 490, 34);
                Fill(r, Panel);
                GUI.Label(new Rect(r.x + 12, r.y + 3, r.width - 24, 30), text, smallRight);
                y += 40;
            }
        }

        void DrawInvite(string code)
        {
            var r = new Rect(30, 24, 340, 84);
            Fill(r, Panel);
            Text(new Rect(r.x + 18, r.y + 6, 300, 26), "INVITE CODE", small, Muted);
            Text(new Rect(r.x + 18, r.y + 32, 300, 46), code, this.code, Accent);
        }

        void DrawScoreboard(float cx)
        {
            var list = new List<Combatant>(Combatant.All);
            list.Sort((a, b) => b.Kills.Value != a.Kills.Value ? b.Kills.Value.CompareTo(a.Kills.Value) : a.Deaths.Value.CompareTo(b.Deaths.Value));
            float w = 620, h = 90 + list.Count * 40;
            var r = new Rect(cx - w / 2, 200, w, h);
            Fill(r, new Color(0.03f, 0.04f, 0.09f, 0.88f));
            Text(new Rect(r.x + 24, r.y + 18, 300, 36), "SCOREBOARD", label, Accent);
            Text(new Rect(r.x + w - 200, r.y + 18, 80, 36), "K", label, Muted);
            Text(new Rect(r.x + w - 110, r.y + 18, 80, 36), "D", label, Muted);
            float y = r.y + 64;
            foreach (var c in list)
            {
                if (c == Combatant.Local) Fill(new Rect(r.x + 12, y - 2, w - 24, 36), new Color(1f, 1f, 1f, 0.08f));
                Fill(new Rect(r.x + 24, y + 8, 14, 14), c.Color);
                Text(new Rect(r.x + 50, y, 360, 32), c.Name + (c.IsBot ? "  <size=14>BOT</size>" : ""), label, c.Alive.Value ? Color.white : Muted);
                Text(new Rect(r.x + w - 200, y, 80, 32), c.Kills.Value.ToString(), label, Color.white);
                Text(new Rect(r.x + w - 110, y, 80, 32), c.Deaths.Value.ToString(), label, Muted);
                y += 40;
            }
        }

        void DrawMatchEnd(MatchManager match, float cx)
        {
            Fill(new Rect(0, 0, width, 1080), new Color(0, 0, 0, 0.45f));
            bool won = Combatant.Local != null && match.Winner.Value.Equals(Combatant.Local.DisplayName.Value);
            Text(new Rect(0, 110, width, 90), won ? "VICTORY" : "MATCH OVER", title, won ? Accent : Color.white);
            Text(new Rect(0, 190, width, 40), $"{match.Winner.Value} wins · next match in {match.SecondsLeft:0}s", center, Muted);
            DrawScoreboard(cx);
        }

        void DrawPaused(ArenaBootstrap boot, float cx)
        {
            var r = new Rect(cx - 360, 330, 720, 330);
            Fill(r, new Color(0.03f, 0.04f, 0.09f, 0.88f));
            Text(new Rect(r.x, r.y + 30, r.width, 60), "CLICK TO PLAY", big, Color.white);
            Text(new Rect(r.x + 40, r.y + 100, r.width - 80, 120),
                "WASD move · Mouse aim · Left click fire · Right click zoom\nSpace jump (twice to double jump) · Q / Shift dash\nE overshield · F pulse scan · R reload · Tab scoreboard",
                smallWrap, Muted);
            var leave = new Rect(r.x + r.width / 2 - 120, r.y + 240, 240, 56);
            uiRects.Add(leave);
            if (GUI.Button(leave, "LEAVE MATCH", button)) boot.Leave();
        }

        // ---------------- Helpers ----------------

        void Fill(Rect r, Color c)
        {
            var old = GUI.color;
            GUI.color = c;
            GUI.DrawTexture(r, white);
            GUI.color = old;
        }

        void Bar(Rect r, float value, Color c)
        {
            Fill(r, new Color(1f, 1f, 1f, 0.12f));
            Fill(new Rect(r.x, r.y, r.width * Mathf.Clamp01(value), r.height), c);
        }

        // Recolours the shared style in place (no per-frame allocations), drawing a soft shadow first.
        static void Text(Rect r, string text, GUIStyle style, Color color)
        {
            var old = style.normal.textColor;
            style.normal.textColor = new Color(0, 0, 0, 0.6f);
            GUI.Label(new Rect(r.x + 2, r.y + 2, r.width, r.height), text, style);
            style.normal.textColor = color;
            GUI.Label(r, text, style);
            style.normal.textColor = old;
        }
    }
}
