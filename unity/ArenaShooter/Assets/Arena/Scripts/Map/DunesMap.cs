using UnityEngine;
using static Arena.Map.MapData;

namespace Arena.Map
{
    /// <summary>
    /// "Dunes": an original desert map with the classic two-site flow (a long lane to A, a short
    /// catwalk from mid, tunnels to B, mid doors to the defender spawn).
    /// </summary>
    public static class DunesMap
    {
        public static MapDefinition Create() => new MapDefinition
        {
            Id = "dunes",
            Name = "Dunes",
            Tagline = "Sun-baked lanes, two sites, no mercy",
            Origin = new Vector3(0, 0, 0),
            MinX = -50, MaxX = 50, MinZ = -58, MaxZ = 58,
            WallHeight = new Vector2(5f, 9.5f),
            TrimChance = 0.55f,

            Walkable = new[]
            {
                R(-28, -54, 28, -40),  // Attacker spawn
                R(20, -46, 44, -32),   // Outside long
                R(34, -34, 44, 22),    // Long A
                R(16, 20, 46, 46),     // A site
                R(-12, 38, 18, 54),    // Defender spawn
                R(-5, -36, 5, 30),     // Mid
                R(-8, -42, 8, -34),    // Mid ramp from spawn
                R(-5, 28, 5, 40),      // Mid to defender spawn
                R(5, 4, 12, 14),       // Catwalk (low)
                R(10, 10, 18, 22),     // Catwalk to A short
                R(-40, -46, -26, -34), // Upper tunnels
                R(-44, -34, -34, 6),   // Lower tunnels to B
                R(-34, -6, -5, 0),     // Tunnel link to mid
                R(-46, 6, -18, 40),    // B site
                R(-18, 32, -10, 42),   // B doors
            },

            Blockers = new[]
            {
                B(34, -13, 38.5f, -11), B(41.5f, -13, 44, -11), // Long doors
                B(-5, 23, -1.6f, 25), B(1.6f, 23, 5, 25),       // Mid doors
                B(-18, 35, -15.5f, 37), B(-12.5f, 35, -10, 37), // B doors frame
            },

            Roofs = new[]
            {
                R(-44, -34, -34, 4),
                R(-40, -46, -26, -34),
                R(-34, -6, -12, 0),
            },

            Props = new[]
            {
                // A site
                P(24, 30, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(26.4f, 30, 2.4f, 2.4f, 1.2f, PropKind.Wood),
                P(24, 30, 1.8f, 1.8f, 1.8f, PropKind.Metal, 2.4f),
                P(36, 38, 3, 3, 1.6f, PropKind.Stone),
                P(40, 30, 2, 2, 2, PropKind.Metal),
                P(20, 40, 2, 4, 1.4f, PropKind.Stone),
                P(30, 24, 6, 1.2f, 1.2f, PropKind.Stone),
                // B site
                P(-30, 24, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-36, 30, 2, 2, 2, PropKind.Metal),
                P(-24, 30, 3, 2, 1.2f, PropKind.Wood),
                P(-40, 16, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-40, 16, 1.8f, 1.8f, 1.8f, PropKind.Wood, 2.4f),
                P(-28, 36, 2, 2, 1.4f, PropKind.Stone),
                // Mid
                P(0, -8, 2, 2, 1.6f, PropKind.Wood),
                P(-3, 14, 1.6f, 1.6f, 1.6f, PropKind.Metal),
                // Long
                P(40, -24, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(37, 4, 2, 2, 2, PropKind.Metal),
                P(42, 14, 1.6f, 1.6f, 3, PropKind.Stone),
                // Spawns and connectors
                P(-10, -46, 3, 2, 1.4f, PropKind.Stone),
                P(12, -48, 2, 2, 2, PropKind.Wood),
                P(2, 46, 4, 2, 1.3f, PropKind.Metal),
                P(-6, 50, 2, 2, 2, PropKind.Wood),
                P(-41.5f, -25, 1.6f, 1.6f, 1.6f, PropKind.Wood),
                P(30, -42, 2, 2, 1.6f, PropKind.Stone),
                P(6.5f, 12.5f, 1.4f, 1.4f, 1.4f, PropKind.Metal),
            },

            Sites = new[] { new Site(31, 33, 10f, "A"), new Site(-32, 23, 10f, "B") },

            Lanes = new[] { R(-0.125f, -35, 0.125f, 29), R(38.875f, -33, 39.125f, 21), R(-39.125f, -33, -38.875f, 5) },

            SpawnPoints = new[]
            {
                V(-20, -48), V(0, -50), V(20, -46), V(-6, 46), V(8, 50), V(14, 42),
                V(24, 40), V(40, 26), V(-40, 34), V(-24, 12), V(0, -20), V(0, 10),
                V(39, -20), V(39, 10), V(-39, -20), V(32, -40), V(-20, -3), V(-38, -40),
            },

            Pickups = new[]
            {
                (V(0, 0), PickupKind.Health),
                (V(-39, -10), PickupKind.Health),
                (V(39, -2), PickupKind.Health),
                (V(2, 42), PickupKind.Health),
                (V(-32, 18), PickupKind.Shield),
                (V(30, 38), PickupKind.Shield),
                (V(-20, -3), PickupKind.Overdrive),
                (V(26, -40), PickupKind.Haste),
                (V(14, 16), PickupKind.Haste),
            },

            Waypoints = new[]
            {
                V(31, 33), V(-32, 23), V(0, 0), V(0, -28), V(0, 20), V(39, -20), V(39, 12),
                V(-39, -24), V(-39, 0), V(-20, -3), V(14, 16), V(8, 9), V(8, 44), V(-14, 38),
                V(26, -40), V(-34, -40), V(0, -48), V(24, 40), V(-40, 34),
            },

            // A gantry over mid, read from the attackers' side; the back carries the same sign.
            BrandPosition = new Vector3(0, 0, -16),
            BrandYaw = 0f,
            BrandHeight = 8.5f,

            Look = new MapLook
            {
                FogColor = C(0.88f, 0.72f, 0.55f), FogStart = 45f, FogEnd = 170f,
                AmbientSky = C(0.62f, 0.62f, 0.72f), AmbientEquator = C(0.58f, 0.48f, 0.38f), AmbientGround = C(0.28f, 0.22f, 0.17f),
                SkyTint = C(0.95f, 0.62f, 0.45f), SkyGround = C(0.55f, 0.42f, 0.32f), SkyExposure = 1.25f, Atmosphere = 1.15f,
                SunColor = C(1f, 0.92f, 0.8f), SunIntensity = 1.3f, ShadowStrength = 0.75f, SunEuler = new Vector3(42f, -35f, 0f),
                Neon = C(0.1f, 0.85f, 0.9f), NeonAlt = C(1f, 0.55f, 0.15f), Glow = C(1f, 0.7f, 0.3f),
                WallTints = new[] { Color.white, Color.white, C(0.9f, 0.78f, 0.68f) },
            },

            Textures = new MapTextures
            {
                Ground = "dunes_ground", Floor = "dunes_floor", Roof = "dunes_floor", Wood = "dunes_wood",
                Metal = "dunes_metal", Stone = "dunes_wall_plaster", Accent = "dunes_accent",
                Walls = new[] { "dunes_wall_brick", "dunes_wall_plaster", "dunes_wall_brick" },
            },
        };
    }
}
