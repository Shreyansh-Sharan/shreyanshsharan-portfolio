using System.Collections.Generic;
using UnityEngine;
using static Arena.Map.MapData;

namespace Arena.Map
{
    /// <summary>
    /// "Sandstorm": a sun-bleached sandstone town built on the classic desert two-site flow, original layout.
    /// Long A runs up the east side through a double door to a raised A site; a long mid lane with a double
    /// door splits the map, and a raised catwalk climbs from mid to A; tunnels under the west side lead to B.
    /// The defenders spawn between the sites in the north, the attackers in the south.
    /// </summary>
    public static class SandstormMap
    {
        public static MapDefinition Create() => new MapDefinition
        {
            Id = "sandstorm",
            Name = "Sandstorm",
            Tagline = "Long doors, high catwalk, bleached stone",
            Origin = new Vector3(1200, 0, 0),
            MinX = -56, MaxX = 56, MinZ = -62, MaxZ = 62,
            WallHeight = new Vector2(5.5f, 10f),
            TrimChance = 0.12f,
            RoofStyle = RoofStyle.Parapet,
            WindowChance = 0.32f,
            DomeChance = 0.12f,

            Walkable = new[]
            {
                R(-30, -60, 24, -46),  // Attacker spawn
                R(24, -58, 44, -44),   // Outside long
                R(36, -44, 44, -30),   // Long doors
                R(36, -30, 52, 20),    // Long A
                R(16, 20, 52, 48),     // A site (raised plinth in the middle)
                R(16, 8, 22, 20),      // Catwalk (raised)
                R(6, 0, 22, 8),        // Short: mid to the catwalk stairs
                R(-6, -46, 6, 42),     // Mid
                R(-14, -34, -6, -22),  // Top-mid nook
                R(-46, -58, -30, -44), // Upper tunnels
                R(-50, -44, -38, 6),   // Lower tunnels
                R(-38, -12, -6, -6),   // Tunnel link to mid
                R(-54, 6, -18, 42),    // B site
                R(-18, 30, -6, 44),    // B doors
                R(-22, 42, 30, 60),    // Defender spawn
            },

            Blockers = new[]
            {
                B(36, -38, 38.8f, -36), B(41.2f, -38, 44, -36),  // Long doors (double door, one gap)
                B(-6, 22, -1.2f, 23.6f), B(1.2f, 22, 6, 23.6f),  // Mid doors
                B(-13, 30, -11.4f, 35), B(-13, 37.4f, -11.4f, 44), // B doors
            },

            Roofs = new[]
            {
                R(-46, -58, -30, -44),
                R(-50, -44, -38, 4),
                R(-38, -12, -12, -6),
            },

            Props = new[]
            {
                // Raised walkways: the A site plinth, the catwalk and the back of B.
                P(34, 37, 24, 14, 1.4f, PropKind.Stone),
                P(19, 22, 6, 28, 1.4f, PropKind.Stone),
                P(-46, 35, 14, 10, 1.4f, PropKind.Stone),
                // A site (on the plinth) and the ground in front of it
                P(30, 38, 2.4f, 2.4f, 2.4f, PropKind.Wood, 1.4f),
                P(32.4f, 38, 2.4f, 2.4f, 1.2f, PropKind.Wood, 1.4f),
                P(40, 41, 2, 2, 2, PropKind.Metal, 1.4f),
                P(29, 30.5f, 8, 0.8f, 0.9f, PropKind.Stone, 1.4f),
                P(30, 25, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(47, 24, 2, 2, 2, PropKind.Stone),
                P(49, 40, 3, 5, 1.6f, PropKind.Metal),
                P(19, 45, 2, 2, 1.4f, PropKind.Wood),
                // Long A
                P(40, -24, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(49, -27, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(49, -27, 1.8f, 1.8f, 1.8f, PropKind.Wood, 2.4f),
                P(48, -12, 2, 4, 1.4f, PropKind.Stone),
                P(39, 0, 2, 2, 2, PropKind.Metal),
                P(50, 10, 1.6f, 1.6f, 3, PropKind.Stone),
                // Mid
                P(0, -4, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-3, 14, 1.6f, 1.6f, 1.6f, PropKind.Metal),
                P(3, 30, 2, 2, 1.2f, PropKind.Stone),
                P(-11, -28, 2, 2, 2, PropKind.Wood),
                P(10, 4, 1.4f, 1.4f, 1.4f, PropKind.Metal),
                // B site
                P(-30, 24, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-30, 24, 1.8f, 1.8f, 1.8f, PropKind.Wood, 2.4f),
                P(-24, 14, 3, 2, 1.4f, PropKind.Metal),
                P(-36, 14, 2, 2, 2, PropKind.Metal),
                P(-50, 12, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-22, 38, 2, 2, 1.4f, PropKind.Stone),
                P(-44, 37, 2, 2, 1.4f, PropKind.Wood, 1.4f),
                // Tunnels
                P(-44, -24, 1.6f, 1.6f, 1.6f, PropKind.Wood),
                P(-40, -52, 2, 2, 2, PropKind.Wood),
                P(-48, -6, 2, 2, 1.2f, PropKind.Stone),
                // Spawns and connectors
                P(-14, -52, 3, 2, 1.4f, PropKind.Stone),
                P(10, -54, 2, 2, 2, PropKind.Wood),
                P(-24, -50, 2, 2, 2, PropKind.Wood),
                P(-10, 50, 4, 2, 1.3f, PropKind.Metal),
                P(14, 54, 2, 2, 2, PropKind.Wood),
                P(22, 46, 2, 2, 1.4f, PropKind.Stone),
                P(32, -50, 2, 2, 1.6f, PropKind.Stone),
            },

            Ramps = new[]
            {
                Rp(19, 1, 19, 8, 6, 1.4f),     // Catwalk stairs from short
                Rp(40, 22, 40, 30, 6, 1.4f),   // Long up onto A
                Rp(27, 50, 27, 44, 6, 1.4f),   // Defender spawn up onto A
                Rp(-46, 23, -46, 30, 6, 1.4f), // Up to the back of B
            },

            Decor = BuildDecor(),

            Sites = new[] { new Site(34, 37, 10f, "A", 1.4f), new Site(-33, 22, 10f, "B") },

            Lanes = new[] { R(43.875f, -29, 44.125f, 19), R(-0.125f, -45, 0.125f, 21), R(-44.125f, -43, -43.875f, 5) },

            SpawnPoints = new[]
            {
                V(-20, -52), V(0, -54), V(16, -50), V(-14, 54), V(8, 56), V(24, 52),
                V(30, 22), V(48, 45), V(-48, 20), V(-26, 36), V(0, -24), V(0, 8),
                V(44, -14), V(44, 10), V(-44, -30), V(-24, -9), V(34, -52), V(-38, -50),
            },

            Pickups = new[]
            {
                (V(0, 1), PickupKind.Health),
                (V(-44, -12), PickupKind.Health),
                (V(44, -4), PickupKind.Health),
                (V(2, 48), PickupKind.Health),
                (V(-37, 28), PickupKind.Shield),
                (V(35, 41, 1.4f), PickupKind.Shield),
                (V(-22, -9), PickupKind.Overdrive),
                (V(28, -52), PickupKind.Haste),
                (V(19, 16, 1.4f), PickupKind.Haste),
                (V(13, 4), PickupKind.Smg),
                (V(-9, -24), PickupKind.Rifle),
                (V(18, 57), PickupKind.Rifle),
                (V(46, 15), PickupKind.Sniper),
                (V(-44, -36), PickupKind.Shotgun),
            },

            Waypoints = new[]
            {
                V(34, 36, 1.4f), V(-33, 22), V(0, 1), V(0, -30), V(0, 18), V(44, -20), V(44, 10), V(-44, -28),
                V(-44, 0), V(-22, -9), V(19, 20, 1.4f), V(14, 4), V(8, 50), V(-16, 36), V(30, -52), V(-38, -52),
                V(0, -52), V(33, 23), V(-46, 35, 1.4f), V(48, 44), V(-9, -31), V(-40, 14),
            },

            Perches = new[]
            {
                H(44, -26, 0f),             // Bottom of long, watching the doors and the length of long
                H(44, 43, 180f, 1.4f),      // Back of A, down long
                H(0, 38, 180f),             // Defender mid, down mid through the doors
                H(0, -40, 0f),              // Attacker mid, up mid
                H(-46, 38, 176f, 1.4f),     // Back of B, onto the tunnel exit
                H(-44, -38, 0f),            // Lower tunnels, up the tunnel
            },

            // Over mid near the attacker side, like a city gate.
            BrandPosition = new Vector3(0, 0, -18),
            BrandYaw = 0f,
            BrandHeight = 8.5f,

            Look = new MapLook
            {
                FogColor = C(0.94f, 0.86f, 0.74f), FogStart = 55f, FogEnd = 200f,
                AmbientSky = C(0.72f, 0.74f, 0.82f), AmbientEquator = C(0.68f, 0.6f, 0.5f), AmbientGround = C(0.36f, 0.3f, 0.24f),
                SkyTint = C(0.58f, 0.68f, 0.95f), SkyGround = C(0.66f, 0.56f, 0.44f), SkyExposure = 1.45f, Atmosphere = 0.85f,
                SunColor = C(1f, 0.96f, 0.86f), SunIntensity = 1.5f, ShadowStrength = 0.82f, SunEuler = new Vector3(58f, 22f, 0f),
                Neon = C(1f, 0.78f, 0.36f), NeonAlt = C(0.22f, 0.75f, 1f), Glow = C(1f, 0.78f, 0.42f),
                WallTints = new[] { C(1f, 0.97f, 0.9f), C(1f, 0.95f, 0.86f), C(0.96f, 0.88f, 0.76f) },
                GroundTint = C(1f, 0.97f, 0.9f), FloorTint = C(0.95f, 0.88f, 0.78f), RoofTint = C(0.85f, 0.75f, 0.6f),
                StoneTint = C(0.98f, 0.93f, 0.84f), AccentTint = C(0.95f, 0.85f, 0.75f),
                WindowColor = C(0.2f, 0.13f, 0.08f), ClothTint = C(0.75f, 0.85f, 1f), Foliage = C(0.3f, 0.48f, 0.2f),
            },

            Textures = new MapTextures
            {
                Ground = "dunes_ground", Floor = "dunes_floor", Roof = "dunes_wood", Wood = "dunes_wood",
                Metal = "dunes_metal", Stone = "sandstorm_wall_block", Accent = "dunes_wall_brick", Cloth = "bazaar_awning",
                Walls = new[] { "sandstorm_wall_block", "dunes_wall_plaster", "sandstorm_wall_block" },
            },
        };

        static Decor[] BuildDecor()
        {
            var d = new List<Decor>();
            // Sandstone arches over the main passages.
            d.AddRange(Arch(0, -44.6f, 12, true));    // Attacker spawn into mid
            d.AddRange(Arch(-44, 5.4f, 12, true));    // Tunnel exit into B
            d.AddRange(Arch(31, -51, 14, false));     // Outside long
            d.AddRange(Arch(0, 40.6f, 12, true));     // Defender side of mid
            d.AddRange(Arch(40, -29.4f, 8, true, clear: 3.4f, top: 5f)); // Top of long doors

            // Striped awnings over the doors, palms in the spawns and on B, lanterns in the tunnels.
            d.Add(D(40, 4.6f, -39.4f, 8.4f, 0.12f, 2.4f, DecorKind.Cloth));
            d.Add(D(0, 4.8f, 24.6f, 12.4f, 0.12f, 2.4f, DecorKind.Cloth));
            d.Add(D(-12.2f, 4.8f, 37, 2.4f, 0.12f, 14, DecorKind.Cloth));
            foreach (var (x, z) in new[] { (-20f, 57f), (26f, 57f), (-51f, 41.2f), (-26f, -57f), (20f, -57f) })
            {
                d.Add(D(x, 3.2f, z, 0.5f, 6.4f, 0.5f, DecorKind.Wood, true));
                d.Add(D(x, 6.5f, z, 4.2f, 0.25f, 1.1f, DecorKind.Foliage));
                d.Add(D(x, 6.5f, z, 1.1f, 0.25f, 4.2f, DecorKind.Foliage));
                d.Add(D(x, 6.75f, z, 1.4f, 0.4f, 1.4f, DecorKind.Foliage));
            }
            foreach (var z in new[] { -36f, -20f, -4f })
                d.Add(D(-49.7f, 3.4f, z, 0.25f, 0.5f, 0.5f, DecorKind.Glow));
            foreach (var x in new[] { -42f, -34f })
                d.Add(D(x, 3.4f, -57.7f, 0.5f, 0.5f, 0.25f, DecorKind.Glow));
            d.Add(D(-26f, 3.4f, -11.7f, 0.5f, 0.5f, 0.25f, DecorKind.Glow));
            // A low wall along the catwalk where it overlooks A, and a well in the defender spawn.
            d.Add(D(21.85f, 1.85f, 25, 0.3f, 0.9f, 10, DecorKind.Stone, true));
            d.Add(D(4, 0.5f, 52, 2.4f, 1f, 2.4f, DecorKind.Stone, true));
            d.Add(D(4, 0.95f, 52, 1.6f, 0.1f, 1.6f, DecorKind.Water));
            return d.ToArray();
        }
    }
}
