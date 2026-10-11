using Arena.Fx;
using Arena.Map;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>Weapon slots, in number-key order (1 to 5).</summary>
    public enum WeaponKind : byte { Pistol, Smg, Rifle, Sniper, Shotgun }

    /// <summary>
    /// Everything that makes one weapon feel different: damage and range falloff, rate of fire, magazine and
    /// reload, spread and recoil, aim-down-sights zoom, move speed, how it looks and sounds, and how bots use it.
    /// </summary>
    public class WeaponSpec
    {
        public WeaponKind Kind;
        public string Name, Short, Icon;
        public Color Tint;

        // Damage
        public int Damage;
        public int Pellets = 1;
        public float HeadshotMultiplier = 2f;
        /// <summary>Full damage up to FalloffStart, easing to MinDamageScale at FalloffEnd and beyond.</summary>
        public float FalloffStart, FalloffEnd, MinDamageScale = 1f;
        public float Range;

        // Handling
        public float FireInterval;
        public bool Automatic;
        public int MagazineSize;
        public float ReloadTime;
        public float DrawTime = 0.35f;
        public float MoveSpeed = 1f;

        // Accuracy (degrees)
        public float BaseSpread, MoveSpread, BloomPerShot, MaxBloom;
        public float BloomRecovery = 4f;
        /// <summary>Spread multiplier while aiming down sights or scoped.</summary>
        public float AdsSpread = 0.5f;
        /// <summary>Extra spread when firing a scoped weapon from the hip.</summary>
        public float HipPenalty;

        // Recoil (degrees per shot)
        public float RecoilKick;
        /// <summary>Side-to-side sway for sustained fire; the pattern is the same every spray, so it can be learned.</summary>
        public float RecoilSway;

        // Zoom
        /// <summary>Field of view per zoom level: one level for sights, two for a scope.</summary>
        public float[] ZoomFov;
        public bool Scope;

        // Look and sound
        public Vector3 ModelScale;
        public float TracerWidth = 1f, FlashSize = 0.22f, Volume = 0.45f;
        public AudioClip Sound;

        // Bots
        /// <summary>The distance band a bot tries to fight in (it closes in or backs off to stay inside it).</summary>
        public float BotMinRange, BotMaxRange;
        /// <summary>Bots with this weapon stop and hold an angle instead of strafing.</summary>
        public bool BotHolds;

        public bool IsSidearm => Kind == WeaponKind.Pistol;
        public int Slot => (int)Kind + 1;

        /// <summary>Damage scale at a given distance.</summary>
        public float Falloff(float distance) =>
            distance <= FalloffStart ? 1f : Mathf.Lerp(1f, MinDamageScale, Mathf.InverseLerp(FalloffStart, FalloffEnd, distance));

        /// <summary>
        /// The recoil pattern: shot n of a spray climbs, then sways left and right. Returns (up, right) in degrees.
        /// Single-shot weapons just kick up.
        /// </summary>
        public Vector2 Recoil(int shot)
        {
            if (!Automatic) return new Vector2(RecoilKick, Random.Range(-0.25f, 0.25f) * RecoilKick);
            float climb = shot < 8 ? RecoilKick : RecoilKick * 0.35f;
            float sway = shot < 5 ? 0f : Mathf.Sin((shot - 5) * 0.55f) * RecoilSway;
            return new Vector2(climb, sway);
        }

        // ---------------- The arsenal ----------------

        public static readonly WeaponSpec[] All =
        {
            new WeaponSpec
            {
                Kind = WeaponKind.Pistol, Name = "P9 Sidearm", Short = "PISTOL", Icon = "/=-", Tint = new Color(0.55f, 0.85f, 1f),
                Damage = 24, HeadshotMultiplier = 3f, FalloffStart = 15f, FalloffEnd = 45f, MinDamageScale = 0.6f, Range = 90f,
                FireInterval = 0.16f, Automatic = false, MagazineSize = 12, ReloadTime = 1.1f, DrawTime = 0.25f, MoveSpeed = 1.05f,
                BaseSpread = 0.4f, MoveSpread = 1.1f, BloomPerShot = 0.6f, MaxBloom = 2.5f, BloomRecovery = 5f, AdsSpread = 0.6f,
                RecoilKick = 1.3f, ZoomFov = new[] { 64f },
                ModelScale = new Vector3(0.09f, 0.14f, 0.32f), TracerWidth = 0.8f, FlashSize = 0.18f, Volume = 0.42f, Sound = Sfx.PistolShot,
                BotMinRange = 4f, BotMaxRange = 16f,
            },
            new WeaponSpec
            {
                Kind = WeaponKind.Smg, Name = "Vespa SMG", Short = "SMG", Icon = "/=#=-", Tint = new Color(0.4f, 1f, 0.55f),
                Damage = 14, HeadshotMultiplier = 2f, FalloffStart = 10f, FalloffEnd = 35f, MinDamageScale = 0.45f, Range = 80f,
                FireInterval = 0.065f, Automatic = true, MagazineSize = 32, ReloadTime = 1.6f, DrawTime = 0.3f, MoveSpeed = 1.08f,
                BaseSpread = 0.9f, MoveSpread = 0.5f, BloomPerShot = 0.18f, MaxBloom = 3.2f, BloomRecovery = 6f, AdsSpread = 0.7f,
                RecoilKick = 0.45f, RecoilSway = 0.35f, ZoomFov = new[] { 62f },
                ModelScale = new Vector3(0.11f, 0.17f, 0.46f), TracerWidth = 0.75f, FlashSize = 0.2f, Volume = 0.36f, Sound = Sfx.SmgShot,
                BotMinRange = 3f, BotMaxRange = 14f,
            },
            new WeaponSpec
            {
                Kind = WeaponKind.Rifle, Name = "Kestrel AR", Short = "RIFLE", Icon = "/=##==-", Tint = new Color(1f, 0.6f, 0.2f),
                Damage = 22, HeadshotMultiplier = 2.5f, FalloffStart = 35f, FalloffEnd = 90f, MinDamageScale = 0.75f, Range = 160f,
                FireInterval = 0.1f, Automatic = true, MagazineSize = 30, ReloadTime = 1.9f, DrawTime = 0.4f, MoveSpeed = 0.95f,
                BaseSpread = 0.25f, MoveSpread = 2.2f, BloomPerShot = 0.3f, MaxBloom = 2.8f, BloomRecovery = 4f, AdsSpread = 0.45f,
                RecoilKick = 0.9f, RecoilSway = 0.6f, ZoomFov = new[] { 52f },
                ModelScale = new Vector3(0.12f, 0.15f, 0.66f), TracerWidth = 1f, FlashSize = 0.24f, Volume = 0.45f, Sound = Sfx.RifleShot,
                BotMinRange = 9f, BotMaxRange = 28f,
            },
            new WeaponSpec
            {
                Kind = WeaponKind.Sniper, Name = "Longbow", Short = "SNIPER", Icon = "o/=#=====-", Tint = new Color(0.85f, 0.4f, 1f),
                Damage = 100, HeadshotMultiplier = 2.5f, FalloffStart = 200f, FalloffEnd = 260f, MinDamageScale = 0.9f, Range = 260f,
                FireInterval = 1.35f, Automatic = false, MagazineSize = 5, ReloadTime = 2.6f, DrawTime = 0.7f, MoveSpeed = 0.85f,
                BaseSpread = 0.02f, MoveSpread = 3f, BloomPerShot = 0f, MaxBloom = 0f, AdsSpread = 1f, HipPenalty = 7f,
                RecoilKick = 3.5f, ZoomFov = new[] { 30f, 12f }, Scope = true,
                ModelScale = new Vector3(0.1f, 0.14f, 0.95f), TracerWidth = 1.8f, FlashSize = 0.34f, Volume = 0.6f, Sound = Sfx.SniperShot,
                BotMinRange = 22f, BotMaxRange = 80f, BotHolds = true,
            },
            new WeaponSpec
            {
                Kind = WeaponKind.Shotgun, Name = "Mastiff", Short = "SHOTGUN", Icon = "/=##=]", Tint = new Color(1f, 0.3f, 0.3f),
                Damage = 11, Pellets = 9, HeadshotMultiplier = 1.5f, FalloffStart = 6f, FalloffEnd = 22f, MinDamageScale = 0.2f, Range = 45f,
                FireInterval = 0.85f, Automatic = false, MagazineSize = 6, ReloadTime = 2.4f, DrawTime = 0.45f, MoveSpeed = 0.97f,
                BaseSpread = 4.5f, MoveSpread = 0.8f, BloomPerShot = 0f, MaxBloom = 0f, AdsSpread = 0.75f,
                RecoilKick = 3f, ZoomFov = new[] { 68f },
                ModelScale = new Vector3(0.15f, 0.16f, 0.72f), TracerWidth = 0.6f, FlashSize = 0.36f, Volume = 0.6f, Sound = Sfx.ShotgunShot,
                BotMinRange = 0f, BotMaxRange = 7f,
            },
        };

        public static WeaponSpec Get(WeaponKind kind) => All[Mathf.Clamp((int)kind, 0, All.Length - 1)];
        public static WeaponSpec Get(int kind) => All[Mathf.Clamp(kind, 0, All.Length - 1)];

        /// <summary>Parses a weapon id from the page (pistol, smg, rifle, sniper, shotgun).</summary>
        public static bool TryParse(string id, out WeaponKind kind)
        {
            foreach (var w in All)
                if (string.Equals(w.Kind.ToString(), id, System.StringComparison.OrdinalIgnoreCase)
                    || string.Equals(w.Short, id, System.StringComparison.OrdinalIgnoreCase))
                {
                    kind = w.Kind;
                    return true;
                }
            kind = WeaponKind.Rifle;
            return false;
        }

        /// <summary>The weapon a pickup crate holds, if it is a weapon crate.</summary>
        public static bool FromPickup(PickupKind pickup, out WeaponKind kind)
        {
            switch (pickup)
            {
                case PickupKind.Smg: kind = WeaponKind.Smg; return true;
                case PickupKind.Rifle: kind = WeaponKind.Rifle; return true;
                case PickupKind.Sniper: kind = WeaponKind.Sniper; return true;
                case PickupKind.Shotgun: kind = WeaponKind.Shotgun; return true;
                default: kind = WeaponKind.Pistol; return false;
            }
        }
    }
}
