using System.Collections.Generic;
using Arena.Core;
using Arena.Game;
using Arena.Map;
using UnityEngine;

namespace Arena.UI
{
    /// <summary>
    /// Main menu and in-game HUD, drawn with IMGUI so the build needs no UI assets: vitals, weapon and slots,
    /// crosshair (changes with aiming and weapon), sniper scope, minimap, kill feed with weapon icons, scoreboard.
    /// </summary>
    public class ArenaHud : MonoBehaviour
    {
        public static bool MenuOpen { get; private set; }
        public static bool PointerOverUi { get; private set; }
        /// <summary>True while a full-screen UI is up; the post-processing blurs the world behind it.</summary>
        public static bool WantsBlur { get; private set; } = true;

        const float TitleSeconds = 3.4f;
        static float titleStart = -100f;

        /// <summary>Plays the "Shreyansh Sharan presents" title card for the active map.</summary>
        public static void ShowTitle() => titleStart = Time.unscaledTime;

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

        Texture2D white, scope;
        GUIStyle label, title, big, small, button, field, center, tiny;
        GUIStyle bigLeft, bigRight, smallCenter, smallRight, smallTop, smallWrap, labelBold, code;
        GUIStyle cardName, cardPresents, cardMap, cardLogo, mapButton;
        bool wasPlaying;
        string nameField = "Player", codeField = "";
        float bots = 5;
        int difficulty = 1, primary = (int)WeaponKind.Rifle;
        float width;
        readonly List<Rect> uiRects = new List<Rect>();

        void Awake()
        {
            white = Texture2D.whiteTexture;
            scope = MakeScope(512);
            nameField = LaunchOptions.Current.Name;
            primary = (int)LaunchOptions.Current.Primary;
            codeField = LaunchOptions.Current.Code;
            bots = LaunchOptions.Current.Bots;
            difficulty = LaunchOptions.Current.Difficulty;
            MapRuntime.Changed += OnMapChanged;
        }

        void OnDestroy()
        {
            MapRuntime.Changed -= OnMapChanged;
            if (scope) Destroy(scope);
        }

        /// <summary>The scope mask: clear lens with a soft dark rim, black outside the circle.</summary>
        static Texture2D MakeScope(int size)
        {
            var tex = new Texture2D(size, size, TextureFormat.RGBA32, false) { wrapMode = TextureWrapMode.Clamp, name = "Scope" };
            var px = new Color32[size * size];
            float half = size / 2f;
            for (int y = 0; y < size; y++)
            for (int x = 0; x < size; x++)
            {
                float r = Mathf.Sqrt((x + 0.5f - half) * (x + 0.5f - half) + (y + 0.5f - half) * (y + 0.5f - half)) / half;
                float a = Mathf.Max(Mathf.SmoothStep(0.955f, 0.975f, r), 0.35f * Mathf.SmoothStep(0.62f, 0.955f, r));
                if (r > 0.94f && r < 0.955f) a = Mathf.Max(a, 0.85f); // the tube's edge ring
                px[y * size + x] = new Color32(0, 0, 0, (byte)(Mathf.Clamp01(a) * 255));
            }
            tex.SetPixels32(px);
            tex.Apply(false, true);
            return tex;
        }

        void OnMapChanged(MapDefinition map)
        {
            if (wasPlaying) ShowTitle();
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
            mapButton = new GUIStyle(button) { fontSize = 16 };
            tiny = new GUIStyle(label) { fontSize = 13, fontStyle = FontStyle.Bold, alignment = TextAnchor.MiddleCenter };
            cardName = new GUIStyle(center) { fontSize = 30, fontStyle = FontStyle.Bold };
            cardPresents = new GUIStyle(center) { fontSize = 24, fontStyle = FontStyle.Italic };
            cardMap = new GUIStyle(center) { fontSize = 112, fontStyle = FontStyle.Bold };
            cardLogo = new GUIStyle(center) { fontSize = 40, fontStyle = FontStyle.Bold };
        }

        void Update()
        {
            var boot = ArenaBootstrap.Instance;
            MenuOpen = boot == null || !boot.InGame;

            var me = Combatant.Local;
            var match = MatchManager.Instance;
            bool playing = !MenuOpen && me != null;
            if (playing && !wasPlaying) ShowTitle();
            wasPlaying = playing;

            WantsBlur = !playing
                || TitleAlpha(match) > 0.01f
                || (match != null && match.Ended.Value)
                || !me.Alive.Value
                || !PlayerController.InputCaptured;
        }

        static float Fade(float t) =>
            t < 0f || t > TitleSeconds ? 0f : Mathf.Min(Mathf.Clamp01(t / 0.4f), Mathf.Clamp01((TitleSeconds - t) / 0.7f));

        /// <summary>The card shows when a match starts and over the last seconds of each intermission.</summary>
        static float TitleAlpha(MatchManager match)
        {
            float a = Fade(Time.unscaledTime - titleStart);
            if (match != null && match.Ended.Value) a = Mathf.Max(a, Fade(TitleSeconds - match.SecondsLeft));
            return a;
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
            else
            {
                DrawHud(boot);
                float card = TitleAlpha(MatchManager.Instance);
                if (card > 0.001f) DrawTitleCard(card);
            }

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
            float w = 640, x = (width - w) / 2f, y = 70;
            Fill(new Rect(x - 30, y - 30, w + 60, 930), Panel);

            Text(new Rect(x, y, w, 80), "DUNES ARENA", title, Accent);
            Text(new Rect(x, y + 80, w, 30), "By Shreyansh Sharan: six arenas, five weapons, powers and bots", center, Muted);
            y += 130;

            Text(new Rect(x, y, 160, 44), "Name", label, Muted);
            nameField = GUI.TextField(new Rect(x + 160, y, w - 160, 44), nameField, 16, field);
            y += 64;

            Text(new Rect(x, y, 160, 44), "Map", label, Muted);
            int current = Mathf.Max(0, MapRuntime.Index);
            var names = new string[Maps.All.Length];
            for (int i = 0; i < names.Length; i++) names[i] = Maps.All[i].Name.ToUpperInvariant();
            int columns = Mathf.Min(3, names.Length), rows = (names.Length + columns - 1) / columns;
            int picked = GUI.SelectionGrid(new Rect(x + 160, y, w - 160, 44 * rows), current, names, columns, mapButton);
            if (picked != current) MapRuntime.Activate(picked);
            Text(new Rect(x + 160, y + 44 * rows + 2, w - 160, 26), Maps.Get(picked).Tagline, small, Muted);
            y += 44 * rows + 40;

            Text(new Rect(x, y, 160, 44), "Primary", label, Muted);
            var primaries = new string[WeaponSpec.All.Length - 1];
            for (int i = 1; i < WeaponSpec.All.Length; i++) primaries[i - 1] = WeaponSpec.Get(i).Short;
            primary = 1 + GUI.SelectionGrid(new Rect(x + 160, y, w - 160, 44), Mathf.Clamp(primary - 1, 0, primaries.Length - 1), primaries, primaries.Length, mapButton);
            y += 60;

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
            Text(new Rect(x - 200, 1080 - 92, w + 400, 60),
                "WASD move · Mouse aim · Click fire · Hold right click to aim (sniper: click to scope) · 1-5 or wheel switch weapons\nSpace double jump · Q dash · E shield · F scan · R reload · Tab scores", smallWrap, Muted);
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
                Map = MapRuntime.Current.Id,
                Primary = (WeaponKind)Mathf.Clamp(primary, 1, WeaponSpec.All.Length - 1),
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
                if (pc.Scoped) DrawScope(cx, cy, pc);
                else DrawCrosshair(cx, cy, pc, weapon);
                DrawHitMarker(cx, cy);
                DrawScan(pc, me);
            }

            DrawVitals(me, weapon);
            DrawAbilities(pc, me, cx);
            DrawTopBar(match, cx);
            DrawFeed(match);
            bool invite = !string.IsNullOrEmpty(boot.JoinCode);
            if (invite) DrawInvite(boot.JoinCode);
            DrawMinimap(me, pc, 30, invite ? 124 : 24);

            if (toast != null && Time.time < toastUntil)
                Text(new Rect(0, 700, width, 50), toast, big, toastColor);

            if (!me.Alive.Value && (match == null || !match.Ended.Value))
            {
                Fill(new Rect(cx - 360, 380, 720, 230), Panel);
                Text(new Rect(cx - 360, 395, 720, 60), $"ELIMINATED BY {me.LastKiller.Value.ToString().ToUpperInvariant()}", big, new Color(1f, 0.35f, 0.35f));
                float wait = Mathf.Max(0, (float)(me.RespawnAt.Value - me.Now));
                string with = me.LastWeapon.Value < WeaponSpec.All.Length ? $"with the {WeaponSpec.Get(me.LastWeapon.Value).Name} · " : "";
                Text(new Rect(cx - 360, 455, 720, 40), $"{with}Respawning in {wait:0.0}s", center, Color.white);
                if (weapon != null) DrawLoadoutChoice(new Rect(cx - 330, 505, 660, 90), weapon, "Next spawn: press 2-5 or click to change your primary");
            }

            if (match != null && match.Ended.Value) DrawMatchEnd(match, cx);
            else if (Input.GetKey(KeyCode.Tab)) DrawScoreboard(cx);

            if (!PlayerController.InputCaptured && me.Alive.Value) DrawPaused(boot, cx);
        }

        /// <summary>
        /// The crosshair shows the real cone of fire (converted from degrees with the current field of view): lines
        /// from the hip, a dot and brackets when aiming down sights, a ring of pellets for the shotgun.
        /// </summary>
        void DrawCrosshair(float cx, float cy, PlayerController pc, Weapon weapon)
        {
            if (weapon == null) return;
            var spec = weapon.Spec;
            float fov = pc.Camera ? pc.Camera.fieldOfView : PlayerController.BaseFov;
            float spread = weapon.SpreadFor(pc.Moving, pc.Zoomed, pc.Scoped);
            float gap = Mathf.Clamp(Mathf.Tan(spread * Mathf.Deg2Rad) / Mathf.Tan(fov * 0.5f * Mathf.Deg2Rad) * 540f, 4f, 280f);
            var c = new Color(1f, 1f, 1f, 0.9f);
            if (spec.Pellets > 1)
            {
                for (int i = 0; i < 16; i++)
                {
                    float a = i * Mathf.PI / 8f;
                    Fill(new Rect(cx + Mathf.Cos(a) * gap - 1.5f, cy + Mathf.Sin(a) * gap - 1.5f, 3, 3), c);
                }
                Fill(new Rect(cx - 1.5f, cy - 1.5f, 3, 3), c);
            }
            else if (pc.Zoomed)
            {
                var t = new Color(spec.Tint.r, spec.Tint.g, spec.Tint.b, 0.95f);
                Fill(new Rect(cx - 2, cy - 2, 4, 4), t);
                float b = gap + 6f;
                foreach (var (sx, sy) in new[] { (-1f, -1f), (1f, -1f), (-1f, 1f), (1f, 1f) })
                {
                    Fill(new Rect(cx + sx * b - (sx < 0 ? 0 : 7), cy + sy * b - (sy < 0 ? 0 : 1.5f), 7, 1.5f), c);
                    Fill(new Rect(cx + sx * b - (sx < 0 ? 0 : 1.5f), cy + sy * b - (sy < 0 ? 0 : 7), 1.5f, 7), c);
                }
            }
            else
            {
                Fill(new Rect(cx - 1, cy - gap - 10, 2, 10), c);
                Fill(new Rect(cx - 1, cy + gap, 2, 10), c);
                Fill(new Rect(cx - gap - 10, cy - 1, 10, 2), c);
                Fill(new Rect(cx + gap, cy - 1, 10, 2), c);
                Fill(new Rect(cx - 1, cy - 1, 2, 2), c);
            }
        }

        /// <summary>Sniper scope: the lens mask, black bars to the screen edges, a fine reticle with mil dots and the zoom.</summary>
        void DrawScope(float cx, float cy, PlayerController pc)
        {
            const float r = 540f;
            var black = Color.black;
            GUI.DrawTexture(new Rect(cx - r, cy - r, 2 * r, 2 * r), scope);
            Fill(new Rect(0, 0, cx - r + 1, 1080), black);
            Fill(new Rect(cx + r - 1, 0, width - (cx + r) + 2, 1080), black);
            var line = new Color(0f, 0f, 0f, 0.9f);
            const float inner = 12f;
            Fill(new Rect(cx - r, cy - 0.75f, r - inner, 1.5f), line);
            Fill(new Rect(cx + inner, cy - 0.75f, r - inner, 1.5f), line);
            Fill(new Rect(cx - 0.75f, cy - r, 1.5f, r - inner), line);
            Fill(new Rect(cx - 0.75f, cy + inner, 1.5f, r - inner), line);
            // Heavy posts on the outer part of each line.
            Fill(new Rect(cx - r, cy - 2.5f, r - 300f, 5f), line);
            Fill(new Rect(cx + 300f, cy - 2.5f, r - 300f, 5f), line);
            Fill(new Rect(cx - 2.5f, cy + 300f, 5f, r - 300f), line);
            for (int i = 1; i <= 5; i++)
            {
                float d = inner + i * 48f;
                Fill(new Rect(cx - d - 2, cy - 2, 4, 4), line);
                Fill(new Rect(cx + d - 2, cy - 2, 4, 4), line);
                Fill(new Rect(cx - 2, cy + d - 2, 4, 4), line);
            }
            Fill(new Rect(cx - 2, cy - 2, 4, 4), new Color(1f, 0.15f, 0.1f, 0.95f));
            float fov = pc.Camera ? pc.Camera.fieldOfView : PlayerController.BaseFov;
            float zoom = Mathf.Tan(PlayerController.BaseFov * 0.5f * Mathf.Deg2Rad) / Mathf.Tan(fov * 0.5f * Mathf.Deg2Rad);
            Text(new Rect(cx + 120, cy + 380, 260, 30), $"x{zoom:0.0}  ·  ZOOM {pc.ZoomLevel}/2", small, new Color(1f, 1f, 1f, 0.8f));
            if (pc.Moving) Text(new Rect(cx - 380, cy + 380, 300, 30), "MOVING: SHOTS DRIFT", smallRight, new Color(1f, 0.6f, 0.4f, 0.85f));
        }

        void DrawHitMarker(float cx, float cy)
        {
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
            var spec = weapon.Spec;
            var a = new Rect(width - 340, 1080 - 150, 300, 110);
            Fill(a, Panel);
            Fill(new Rect(a.x, a.y, 4, a.height), spec.Tint);
            Text(new Rect(a.x, a.y + 10, a.width - 20, 60), $"{weapon.Ammo}<size=26> / {weapon.MagazineSize}</size>", bigRight, Color.white);
            Text(new Rect(a.x + 20, a.y + 16, 150, 26), spec.Icon, labelBold, spec.Tint);
            if (weapon.Reloading)
            {
                Text(new Rect(a.x + 20, a.y + 72, 200, 26), "RELOADING", small, Accent);
                Bar(new Rect(a.x + 20, a.y + 96, a.width - 40, 6), weapon.ReloadProgress, Accent);
            }
            else Text(new Rect(a.x + 20, a.y + 72, 270, 26), spec.Name.ToUpperInvariant(), small, Color.white);

            // Weapon slots: number key, short name; carried ones lit, the one in hand outlined in its colour.
            float sw = 66, gap = 5, sx = a.xMax - WeaponSpec.All.Length * (sw + gap) + gap, sy = a.y - 46;
            for (int i = 0; i < WeaponSpec.All.Length; i++)
            {
                var ws = WeaponSpec.Get(i);
                bool owned = weapon.Owns(ws.Kind), current = weapon.Kind == ws.Kind;
                var slot = new Rect(sx + i * (sw + gap), sy, sw, 38);
                Fill(slot, current ? new Color(ws.Tint.r, ws.Tint.g, ws.Tint.b, 0.3f) : Panel);
                if (current) Outline(slot, 2, ws.Tint);
                var col = owned ? Color.white : new Color(1f, 1f, 1f, 0.28f);
                Text(new Rect(slot.x, slot.y + 1, slot.width, 18), ws.Slot.ToString(), tiny, owned ? ws.Tint : col);
                Text(new Rect(slot.x, slot.y + 17, slot.width, 18), ws.Short, tiny, col);
            }
        }

        /// <summary>Four buttons (with keys 2 to 5) to pick the primary for the next spawn.</summary>
        void DrawLoadoutChoice(Rect r, Weapon weapon, string caption)
        {
            Text(new Rect(r.x, r.y, r.width, 26), caption, smallCenter, Muted);
            int n = WeaponSpec.All.Length - 1;
            float bw = (r.width - (n - 1) * 10f) / n;
            for (int i = 1; i <= n; i++)
            {
                var ws = WeaponSpec.Get(i);
                var b = new Rect(r.x + (i - 1) * (bw + 10f), r.y + 32, bw, 48);
                uiRects.Add(b);
                bool chosen = weapon.PrimaryKind == ws.Kind;
                Fill(b, chosen ? new Color(ws.Tint.r, ws.Tint.g, ws.Tint.b, 0.3f) : new Color(1f, 1f, 1f, 0.06f));
                if (chosen) Outline(b, 2, ws.Tint);
                if (GUI.Button(b, GUIContent.none, GUIStyle.none)) weapon.ChooseLoadout(ws.Kind);
                Text(b, $"<b>{ws.Slot}</b>  {ws.Short}", center, chosen ? ws.Tint : Color.white);
            }
        }

        /// <summary>A small map of the arena (from its walkable areas) with the sites, you, and anyone your scan reveals.</summary>
        void DrawMinimap(Combatant me, PlayerController pc, float x, float y)
        {
            var map = MapRuntime.Current;
            float sx = map.MaxX - map.MinX, sz = map.MaxZ - map.MinZ;
            float k = 200f / Mathf.Max(sx, sz);
            Fill(new Rect(x, y, sx * k + 16, sz * k + 16), Panel);
            float ox = x + 8, oy = y + 8;
            Rect ToHud(Rect w) => new Rect(ox + (w.xMin - map.MinX) * k, oy + (map.MaxZ - w.yMax) * k, w.width * k, w.height * k);
            Vector2 PointToHud(Vector3 world)
            {
                var local = world - map.Origin;
                return new Vector2(ox + (local.x - map.MinX) * k, oy + (map.MaxZ - local.z) * k);
            }
            foreach (var w in map.Walkable) Fill(ToHud(w), new Color(0.42f, 0.44f, 0.52f, 1f));
            foreach (var w in map.Roofs) Fill(ToHud(w), new Color(0.3f, 0.32f, 0.38f, 1f));
            foreach (var w in map.Water) Fill(ToHud(w), new Color(0.2f, 0.45f, 0.7f, 1f));
            foreach (var site in map.Sites)
            {
                var c = PointToHud(map.Origin + new Vector3(site.Center.x, 0f, site.Center.y));
                var col = site.Letter == "A" ? new Color(1f, 0.5f, 0.15f) : new Color(0.35f, 0.6f, 1f);
                Text(new Rect(c.x - 15, c.y - 13, 30, 26), site.Letter, labelBold, col);
            }
            if (Time.time < pc.ScanUntil)
                foreach (var c in Combatant.All)
                {
                    if (c == me || !c.Alive.Value) continue;
                    var e = PointToHud(c.transform.position);
                    Fill(new Rect(e.x - 3, e.y - 3, 6, 6), new Color(1f, 0.25f, 0.3f));
                }
            var p = PointToHud(me.transform.position);
            var matrix = GUI.matrix;
            GUIUtility.RotateAroundPivot(me.transform.eulerAngles.y, p);
            Fill(new Rect(p.x - 1, p.y - 11, 2, 9), Color.white);
            GUI.matrix = matrix;
            Fill(new Rect(p.x - 4, p.y - 4, 8, 8), me.Color);
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
                string gun = "  >  ";
                if (k.Weapon < WeaponSpec.All.Length)
                {
                    var ws = WeaponSpec.Get(k.Weapon);
                    gun = $"  <color=#{ColorUtility.ToHtmlStringRGB(ws.Tint)}>[{ws.Icon} {ws.Short}]</color>  ";
                }
                string killer = string.IsNullOrEmpty(k.Killer) ? "" : $"<color=#{ColorUtility.ToHtmlStringRGB(k.KillerColor)}>{k.Killer}</color>{gun}";
                string text = $"{killer}<color=#{ColorUtility.ToHtmlStringRGB(k.VictimColor)}>{k.Victim}</color>{(k.Headshot ? "  (headshot)" : "")}";
                var r = new Rect(width - 620, y, 590, 34);
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
            var r = new Rect(cx - 380, 280, 760, 450);
            Fill(r, new Color(0.03f, 0.04f, 0.09f, 0.88f));
            Text(new Rect(r.x, r.y + 26, r.width, 60), "CLICK TO PLAY", big, Color.white);
            Text(new Rect(r.x + 40, r.y + 92, r.width - 80, 130),
                "WASD move · Mouse aim · Left click fire · Hold right click to aim (sniper: click to step the scope, wheel zooms)\n1-5 or mouse wheel switch weapons · R reload · Space jump (twice to double jump)\nQ / Shift dash · E overshield · F pulse scan · Tab scoreboard",
                smallWrap, Muted);
            var weapon = Combatant.Local != null ? Combatant.Local.GetComponent<Weapon>() : null;
            if (weapon != null) DrawLoadoutChoice(new Rect(r.x + 50, r.y + 230, r.width - 100, 90), weapon, "Primary at your next spawn (crates on the map add more)");
            var leave = new Rect(r.x + r.width / 2 - 120, r.y + 360, 240, 56);
            uiRects.Add(leave);
            if (GUI.Button(leave, "LEAVE MATCH", button)) boot.Leave();
        }

        // ---------------- Title card ----------------

        void DrawTitleCard(float a)
        {
            var map = MapRuntime.Current;
            float cx = width / 2f;
            Fill(new Rect(0, 0, width, 1080), new Color(0.01f, 0.01f, 0.03f, 0.84f * a));
            var accent = new Color(Accent.r, Accent.g, Accent.b, a);
            var cyan = new Color(Cyan.r, Cyan.g, Cyan.b, a);

            var logo = new Rect(cx - 44, 230, 88, 88);
            Outline(logo, 3, cyan);
            Text(logo, "SS", cardLogo, cyan);

            float line = 560f * Mathf.SmoothStep(0f, 1f, a);
            Fill(new Rect(cx - line / 2f, 340, line, 2), accent);
            Text(new Rect(0, 352, width, 50), Spaced("SHREYANSH SHARAN"), cardName, new Color(1f, 1f, 1f, a));
            Text(new Rect(0, 402, width, 36), "presents", cardPresents, new Color(1f, 1f, 1f, 0.6f * a));
            Text(new Rect(0, 452, width, 140), map.Name.ToUpperInvariant(), cardMap, accent);
            Text(new Rect(0, 596, width, 40), map.Tagline, center, new Color(1f, 1f, 1f, 0.85f * a));
            Fill(new Rect(cx - line / 2f, 650, line, 2), cyan);
        }

        static string Spaced(string s)
        {
            var sb = new System.Text.StringBuilder(s.Length * 2);
            foreach (var ch in s)
            {
                if (sb.Length > 0) sb.Append(' ');
                if (ch == ' ') sb.Append("  ");
                else sb.Append(ch);
            }
            return sb.ToString();
        }

        void Outline(Rect r, float t, Color c)
        {
            Fill(new Rect(r.x, r.y, r.width, t), c);
            Fill(new Rect(r.x, r.yMax - t, r.width, t), c);
            Fill(new Rect(r.x, r.y, t, r.height), c);
            Fill(new Rect(r.xMax - t, r.y, t, r.height), c);
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
            style.normal.textColor = new Color(0, 0, 0, 0.6f * color.a);
            GUI.Label(new Rect(r.x + 2, r.y + 2, r.width, r.height), text, style);
            style.normal.textColor = color;
            GUI.Label(r, text, style);
            style.normal.textColor = old;
        }
    }
}
