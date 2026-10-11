using System.Collections.Generic;
using UnityEngine;
using static Arena.Map.MapData;

namespace Arena.Map
{
    /// <summary>
    /// "Harbor Night": a container port at dusk. A stacked container yard holds mid, a roofed warehouse
    /// runs down the west side, and an open quay wraps the north and east edges above the water.
    /// </summary>
    public static class HarborMap
    {
        public static MapDefinition Create() => new MapDefinition
        {
            Id = "harbor",
            Name = "Harbor Night",
            Tagline = "Neon on the water, steel in the yard",
            Origin = new Vector3(400, 0, 0),
            MinX = -50, MaxX = 50, MinZ = -50, MaxZ = 50,
            WallHeight = new Vector2(6f, 12f),
            TrimChance = 0.4f,

            Walkable = new[]
            {
                R(-30, -48, 40, -36),  // Gate yard (south spawn)
                R(36, -44, 50, 36),    // East quay
                R(-46, 36, 50, 50),    // North quay
                R(-14, -36, 14, 36),   // Container yard (mid)
                R(-44, -40, -32, 30),  // Warehouse lane
                R(-44, -46, -28, -36), // Gate yard to warehouse
                R(-44, 28, -36, 38),   // Warehouse to quay
                R(-32, -4, -14, 4),    // Alley: yard to warehouse
                R(14, 10, 36, 16),     // Crane alley: yard to east quay
            },

            Blockers = new[]
            {
                B(-44, -25, -40, -23), B(-36, -25, -32, -23), // Warehouse doors
                B(-14, 34, -3, 36), B(3, 34, 14, 36),         // Yard gate to the quay
            },

            Roofs = new[]
            {
                R(-44, -24, -32, 14),
                R(-32, -4, -20, 4),
            },

            Props = new[]
            {
                // Container yard
                P(-8, -14, 6, 2.5f, 2.6f, PropKind.Container),
                P(8, -8, 2.5f, 6, 2.6f, PropKind.Container),
                P(-6, 10, 6, 2.5f, 2.6f, PropKind.Container),
                P(-6, 10, 6, 2.5f, 2.6f, PropKind.Container, 2.6f),
                P(8, 24, 2.5f, 6, 2.6f, PropKind.Container),
                P(-9, 28, 2.5f, 6, 2.6f, PropKind.Container),
                P(5, 3, 1.6f, 1.6f, 1.6f, PropKind.Wood),
                P(-11, -27, 2, 2, 2, PropKind.Wood),
                P(10, -29, 1.8f, 1.8f, 1.8f, PropKind.Metal),
                // North quay
                P(-14, 44, 2, 2, 2, PropKind.Wood),
                P(22, 46, 2, 2, 2, PropKind.Metal),
                P(-2, 47.5f, 6, 2.5f, 2.6f, PropKind.Container),
                P(-36, 46, 6, 2.5f, 2.6f, PropKind.Container),
                P(34, 40, 2, 2, 1.4f, PropKind.Stone),
                P(28, 47, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                // East quay
                P(40, -28, 2, 2, 2, PropKind.Wood),
                P(46, 0, 1.8f, 1.8f, 1.8f, PropKind.Metal),
                P(40, 28, 2.5f, 6, 2.6f, PropKind.Container),
                // Warehouse
                P(-36, -20, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-42, 4, 2, 2, 2, PropKind.Metal),
                P(-34, 20, 2, 2, 2, PropKind.Wood),
                // Gate yard
                P(-12, -42, 3, 1.2f, 1.2f, PropKind.Stone),
                P(14, -46, 2, 2, 2, PropKind.Wood),
                P(30, -44, 2, 2, 1.6f, PropKind.Metal),
            },

            Decor = BuildDecor(),

            Sites = new[] { new Site(30, 43, 10f, "A"), new Site(-38, -12, 10f, "B") },

            Lanes = new[] { R(-0.125f, -35, 0.125f, -18), R(42.875f, -42, 43.125f, 34), R(-38.125f, -38, -37.875f, -18) },

            SpawnPoints = new[]
            {
                V(-20, -44), V(0, -46), V(20, -42), V(38, -40), V(-30, 44), V(-6, 42), V(14, 44), V(40, 42),
                V(-40, -30), V(-40, 20), V(0, -24), V(0, 20), V(44, -10), V(44, 22), V(-24, 0), V(26, 13),
            },

            Pickups = new[]
            {
                (V(2, -2), PickupKind.Health),
                (V(-38, 8), PickupKind.Health),
                (V(44, 4), PickupKind.Health),
                (V(0, 42), PickupKind.Health),
                (V(-38, -12), PickupKind.Shield),
                (V(30, 43), PickupKind.Shield),
                (V(-24, 0), PickupKind.Overdrive),
                (V(26, 13), PickupKind.Haste),
                (V(10, -42), PickupKind.Haste),
                (V(-29, 2), PickupKind.Smg),
                (V(4, -44), PickupKind.Rifle),
                (V(46, 32), PickupKind.Sniper),
                (V(-41, -18), PickupKind.Shotgun),
            },

            Waypoints = new[]
            {
                V(30, 43), V(-38, -12), V(0, 0), V(0, -28), V(0, 28), V(44, -24), V(44, 16), V(-40, -30),
                V(-40, 20), V(-24, 0), V(26, 13), V(-20, 44), V(10, 42), V(-40, 34), V(0, -44), V(30, -40), V(-30, -42),
            },

            Perches = new[]
            {
                H(43, -40, 0f),     // East quay, up the quay
                H(0, 30, 180f),     // Yard gate, down the container yard
                H(-38, 26, 180f),   // Warehouse, down the lane
                H(-40, 44, 90f),    // North quay, along the water
            },

            BrandPosition = new Vector3(0, 0, -12),
            BrandYaw = 0f,
            BrandHeight = 9f,

            Look = new MapLook
            {
                FogColor = C(0.1f, 0.11f, 0.2f), FogStart = 30f, FogEnd = 150f,
                AmbientSky = C(0.32f, 0.36f, 0.58f), AmbientEquator = C(0.34f, 0.27f, 0.36f), AmbientGround = C(0.1f, 0.1f, 0.14f),
                SkyTint = C(0.42f, 0.32f, 0.62f), SkyGround = C(0.08f, 0.08f, 0.12f), SkyExposure = 0.6f, Atmosphere = 1.7f,
                SunColor = C(1f, 0.55f, 0.38f), SunIntensity = 0.75f, ShadowStrength = 0.6f, SunEuler = new Vector3(14f, 205f, 0f),
                Neon = C(1f, 0.22f, 0.66f), NeonAlt = C(0.2f, 0.9f, 1f), Glow = C(1f, 0.28f, 0.16f),
                WallTints = new[] { Color.white, Color.white, Color.white },
            },

            Textures = new MapTextures
            {
                Ground = "harbor_ground", Floor = "harbor_wood", Roof = "harbor_metal", Wood = "harbor_wood",
                Metal = "harbor_metal", Stone = "harbor_ground", Accent = "harbor_accent",
                Walls = new[] { "harbor_container_red", "harbor_wall_brick", "harbor_container_teal" },
            },
        };

        static Decor[] BuildDecor()
        {
            var d = new List<Decor>
            {
                // Water beyond the quays, a hazard-painted curb and a few lamp posts.
                D(0, -1.4f, 82, 260, 0.2f, 64, DecorKind.Water),
                D(82, -1.4f, 0, 64, 0.2f, 260, DecorKind.Water),
                D(0, 0.15f, 49.8f, 100, 0.3f, 0.4f, DecorKind.Accent),
                D(49.8f, 0.15f, 0, 0.4f, 0.3f, 100, DecorKind.Accent),
            };
            foreach (var x in new[] { -40f, -24f, -8f, 8f, 24f, 40f })
                d.Add(D(x, 0.4f, 49.2f, 0.5f, 0.8f, 0.5f, DecorKind.Metal, true));
            foreach (var z in new[] { -36f, -20f, -4f, 12f, 28f })
                d.Add(D(49.2f, 0.4f, z, 0.5f, 0.8f, 0.5f, DecorKind.Metal, true));
            foreach (var x in new[] { -28f, 4f, 36f })
            {
                d.Add(D(x, 3f, 49.3f, 0.3f, 6f, 0.3f, DecorKind.Metal, true));
                d.Add(D(x, 6.1f, 49.3f, 0.9f, 0.25f, 0.9f, DecorKind.Glow));
            }

            // Two gantry cranes standing in the water, booms reaching over the quay.
            foreach (var cx in new[] { -20f, 24f })
            {
                foreach (var lx in new[] { -4f, 4f })
                foreach (var lz in new[] { 54f, 62f })
                    d.Add(D(cx + lx, 11f, lz, 1f, 22f, 1f, DecorKind.Accent));
                d.Add(D(cx, 22.5f, 58, 10, 1, 10, DecorKind.Accent));
                d.Add(D(cx, 23.7f, 44, 1.6f, 1.4f, 44, DecorKind.Metal));
                d.Add(D(cx, 23.5f, 64.5f, 4, 3, 4, DecorKind.Wall));
                d.Add(D(cx, 20.5f, 52.5f, 3, 3, 3, DecorKind.Wall));
                d.Add(D(cx, 24.7f, 22.4f, 0.7f, 0.7f, 0.7f, DecorKind.Glow));
                d.Add(D(cx, 25.3f, 64.5f, 0.6f, 0.6f, 0.6f, DecorKind.Glow));
            }
            return d.ToArray();
        }
    }
}
