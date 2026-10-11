using UnityEngine;
using static Arena.Map.MapData;

namespace Arena.Map
{
    /// <summary>
    /// "Frost Outpost": a snowed-in military base. A courtyard with a command bunker holds mid, a
    /// hangar covers the west lane (B) and a trench lane runs past the comms mast in the east (A).
    /// </summary>
    public static class FrostMap
    {
        public static MapDefinition Create() => new MapDefinition
        {
            Id = "frost",
            Name = "Frost Outpost",
            Tagline = "Cold steel, colder aim",
            Origin = new Vector3(800, 0, 0),
            MinX = -48, MaxX = 48, MinZ = -48, MaxZ = 48,
            WallHeight = new Vector2(4.5f, 8.5f),
            TrimChance = 0.7f,

            Walkable = new[]
            {
                R(-28, -46, 28, -34), // South spawn
                R(-28, 34, 28, 46),   // North spawn
                R(-16, -20, 16, 20),  // Courtyard (mid)
                R(-6, -34, 6, -20),   // South gate
                R(-6, 20, 6, 34),     // North gate
                R(-44, -40, -30, 40), // Hangar lane (B)
                R(-44, -44, -28, -34),
                R(-44, 34, -28, 44),
                R(30, -40, 44, 40),   // Trench lane (A)
                R(28, -44, 44, -34),
                R(28, 34, 44, 44),
                R(-30, -6, -16, 2),   // Tunnel: courtyard to hangar
                R(16, 4, 30, 10),     // Cut: courtyard to trench
            },

            Blockers = new[]
            {
                B(-44, -23, -40, -21), B(-34, -23, -30, -21), // Hangar doors
                B(30, 14, 34, 16), B(40, 14, 44, 16),         // Trench checkpoint
            },

            Roofs = new[]
            {
                R(-44, -22, -30, -2),
                R(-30, -6, -20, 2),
            },

            Props = new[]
            {
                // Courtyard: the command bunker and sandbag lines
                P(0, 0, 5, 5, 2.8f, PropKind.Stone),
                P(-9, -6, 3, 1, 1.1f, PropKind.Stone),
                P(9, 6, 3, 1, 1.1f, PropKind.Stone),
                P(-6, 9, 1, 3, 1.1f, PropKind.Stone),
                P(6, -9, 1, 3, 1.1f, PropKind.Stone),
                P(-12, 15, 2, 2, 2, PropKind.Wood),
                P(12, -15, 2, 2, 2, PropKind.Metal),
                // Trench lane and A
                P(33, 30, 2, 2, 2, PropKind.Metal),
                P(41, 22, 3, 1, 1.2f, PropKind.Stone),
                P(40, -14, 2, 2, 2, PropKind.Wood),
                P(33, -18, 1.6f, 1.6f, 1.6f, PropKind.Metal),
                P(41, -36, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                // Hangar and B
                P(-40, -16, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-40, -16, 1.8f, 1.8f, 1.8f, PropKind.Metal, 2.4f),
                P(-33, -8, 2, 2, 2, PropKind.Metal),
                P(-41, -27, 2, 2, 2, PropKind.Wood),
                P(-34, 18, 2, 2, 1.6f, PropKind.Metal),
                // Spawns
                P(-8, -38, 3, 1.2f, 1.2f, PropKind.Stone),
                P(10, 38, 3, 1.2f, 1.2f, PropKind.Stone),
                P(22, -42, 2, 2, 2, PropKind.Wood),
                P(-22, 42, 2, 2, 2, PropKind.Metal),
            },

            Decor = new[]
            {
                // Comms masts with warning lights, and floodlights on the gates.
                D(46, 11, 26, 0.6f, 22, 0.6f, DecorKind.Metal),
                D(46, 22.3f, 26, 0.8f, 0.6f, 0.8f, DecorKind.Glow),
                D(46, 6, 26, 3, 0.3f, 3, DecorKind.Metal),
                D(-46, 9, -30, 0.6f, 18, 0.6f, DecorKind.Metal),
                D(-46, 18.3f, -30, 0.8f, 0.6f, 0.8f, DecorKind.Glow),
                D(-6.25f, 5.2f, -27, 0.5f, 0.4f, 1.2f, DecorKind.Neon),
                D(6.25f, 5.2f, -27, 0.5f, 0.4f, 1.2f, DecorKind.Neon),
                D(-6.25f, 5.2f, 27, 0.5f, 0.4f, 1.2f, DecorKind.Neon),
                D(6.25f, 5.2f, 27, 0.5f, 0.4f, 1.2f, DecorKind.Neon),
            },

            Sites = new[] { new Site(37, 26, 10f, "A"), new Site(-37, -12, 10f, "B") },

            Lanes = new[] { R(36.875f, -38, 37.125f, 12), R(-0.125f, -33, 0.125f, -21), R(-0.125f, 21, 0.125f, 33) },

            SpawnPoints = new[]
            {
                V(-18, -42), V(0, -44), V(18, -40), V(-18, 42), V(0, 40), V(18, 44),
                V(-37, -32), V(-37, 30), V(37, -30), V(37, 6), V(-10, -12), V(10, 12),
                V(-24, -2), V(22, 7), V(-37, 10), V(37, 38),
            },

            Pickups = new[]
            {
                (V(0, -27), PickupKind.Health),
                (V(0, 27), PickupKind.Health),
                (V(-37, 0), PickupKind.Health),
                (V(37, -6), PickupKind.Health),
                (V(-37, -12), PickupKind.Shield),
                (V(37, 26), PickupKind.Shield),
                (V(-24, -2), PickupKind.Overdrive),
                (V(22, 7), PickupKind.Haste),
                (V(-36, 40), PickupKind.Haste),
            },

            Waypoints = new[]
            {
                V(37, 26), V(-37, -12), V(0, -12), V(0, 12), V(-12, 0), V(12, 0), V(0, -28), V(0, 28),
                V(-37, -32), V(-37, 24), V(37, -32), V(37, 8), V(-24, -2), V(22, 7), V(0, -42), V(0, 42),
                V(-36, 40), V(36, 40), V(-36, -40), V(36, -40),
            },

            // Over the south gate, facing the south spawn.
            BrandPosition = new Vector3(0, 0, -23),
            BrandYaw = 0f,
            BrandHeight = 8f,

            Look = new MapLook
            {
                FogColor = C(0.76f, 0.8f, 0.86f), FogStart = 25f, FogEnd = 140f,
                AmbientSky = C(0.78f, 0.82f, 0.92f), AmbientEquator = C(0.62f, 0.66f, 0.72f), AmbientGround = C(0.42f, 0.44f, 0.48f),
                SkyTint = C(0.62f, 0.68f, 0.8f), SkyGround = C(0.7f, 0.72f, 0.76f), SkyExposure = 1.05f, Atmosphere = 0.55f,
                SunColor = C(0.9f, 0.94f, 1f), SunIntensity = 0.85f, ShadowStrength = 0.45f, SunEuler = new Vector3(55f, 140f, 0f),
                Neon = C(0.25f, 0.8f, 1f), NeonAlt = C(1f, 0.45f, 0.2f), Glow = C(1f, 0.2f, 0.15f),
                WallTints = new[] { Color.white, Color.white, C(0.82f, 0.86f, 0.9f) },
            },

            Textures = new MapTextures
            {
                Ground = "frost_ground", Floor = "frost_roof", Roof = "frost_roof", Wood = "frost_wood",
                Metal = "frost_metal", Stone = "frost_wall_concrete", Accent = "frost_accent",
                Walls = new[] { "frost_wall_concrete", "frost_wall_panel", "frost_wall_concrete" },
            },
        };
    }
}
