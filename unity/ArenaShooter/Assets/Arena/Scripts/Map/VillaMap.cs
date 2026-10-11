using System.Collections.Generic;
using UnityEngine;
using static Arena.Map.MapData;

namespace Arena.Map
{
    /// <summary>
    /// "Villa": an original hillside Italian village with terracotta roofs, shuttered windows and washing lines.
    /// A long curved lane (the "banana") climbs from the attacker spawn over a stone bridge across the canal to
    /// B, a church courtyard with a fountain and a bell tower. Narrow alleys lead through mid to an arch, and an
    /// apartment block with a balcony overlooks A, a farm square by the defender spawn.
    /// </summary>
    public static class VillaMap
    {
        public static MapDefinition Create() => new MapDefinition
        {
            Id = "villa",
            Name = "Villa",
            Tagline = "Terracotta, church bells and a long curved lane",
            Origin = new Vector3(1600, 0, 0),
            MinX = -56, MaxX = 56, MinZ = -60, MaxZ = 60,
            WallHeight = new Vector2(5.5f, 9f),
            TrimChance = 0f,
            RoofStyle = RoofStyle.Gable,
            WindowChance = 0.5f,

            Walkable = new[]
            {
                R(-44, -58, 4, -46),   // Attacker spawn
                R(-52, -50, -40, -30), // Banana, bottom
                R(-50, -32, -38, -18), // Banana
                R(-50, -20, -32, -6),  // Bridge square (the canal crosses it)
                R(-46, -8, -34, 8),    // Banana, top
                R(-42, 6, -28, 18),    // Banana bend into B
                R(-40, 16, -4, 46),    // B: church courtyard
                R(-8, 40, 8, 50),      // Construction: B to the defenders
                R(4, 46, 46, 58),      // Defender spawn
                R(-10, -46, -2, -24),  // Second mid
                R(-16, -26, 14, -10),  // Mid square
                R(-2, -10, 8, 30),     // Mid
                R(-2, 26, 22, 34),     // Arch side
                R(-32, -22, -16, -16), // Mid to banana
                R(4, -58, 24, -48),    // Attacker spawn to apartments
                R(16, -48, 26, -12),   // Apartments, ground floor
                R(12, -20, 18, -14),   // Boiler room: mid to apartments
                R(16, -12, 26, 4),     // Apartment balcony (raised)
                R(16, 4, 48, 40),      // A: farm square
                R(34, -18, 48, 4),     // Pit
                R(16, 40, 46, 48),     // A to the defenders
            },

            // The canal, either side of the bridge.
            Water = new[] { R(-50, -14, -44, -11), R(-38, -14, -32, -11) },

            Roofs = new[]
            {
                R(16, -48, 26, -24),
                R(-4, 40, 4, 46),
                R(12, -20, 16, -14),
            },

            Props = new[]
            {
                // Stone bridge over the canal, the apartment balcony and the church steps.
                P(-41, -12.5f, 6, 3, 1.6f, PropKind.Stone),
                P(21, -4, 10, 16, 2.4f, PropKind.Stone),
                P(-22, 45, 12, 2, 0.35f, PropKind.Stone),
                // Fountain in the courtyard: a low basin and a column.
                P(-24, 24.6f, 5, 0.6f, 0.8f, PropKind.Stone),
                P(-24, 29.4f, 5, 0.6f, 0.8f, PropKind.Stone),
                P(-26.2f, 27, 0.6f, 4.2f, 0.8f, PropKind.Stone),
                P(-21.8f, 27, 0.6f, 4.2f, 0.8f, PropKind.Stone),
                P(-24, 27, 0.8f, 0.8f, 2.2f, PropKind.Stone),
                // B site
                P(-12, 40, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-34, 40, 2, 2, 2, PropKind.Wood),
                P(-10, 22, 3, 2, 1.4f, PropKind.Stone),
                P(-30, 19, 2, 2, 1.6f, PropKind.Metal),
                // Banana
                P(-46, -40, 2, 4, 1.2f, PropKind.Stone),
                P(-48, -34, 3, 0.8f, 1.1f, PropKind.Stone),
                P(-41, -26, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-44, -1, 2, 2, 2, PropKind.Wood),
                P(-38, 12, 3, 1.5f, 1.4f, PropKind.Stone),
                P(-24, -19, 3, 2, 1.4f, PropKind.Metal),
                // Mid
                P(-2, -18, 2.4f, 2.4f, 1f, PropKind.Stone),
                P(3, 4, 2, 2, 2, PropKind.Wood),
                P(0, 20, 1.6f, 1.6f, 1.6f, PropKind.Metal),
                P(-12, -12, 2, 2, 1.6f, PropKind.Wood),
                // A site: well, cart, hay
                P(32, 28, 2.2f, 2.2f, 1f, PropKind.Stone),
                P(26, 16, 3, 1.6f, 1.4f, PropKind.Wood),
                P(40, 14, 2.4f, 2.4f, 1.6f, PropKind.Wood),
                P(44, 30, 2, 2, 2, PropKind.Wood),
                P(24, 36, 2, 4, 1.4f, PropKind.Stone),
                // Pit
                P(38, -10, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(45, -2, 2, 2, 2, PropKind.Metal),
                P(36, 0, 2, 2, 1.2f, PropKind.Stone),
                // Apartments
                P(20, -40, 2, 2, 2, PropKind.Wood),
                P(24, -30, 1.6f, 1.6f, 1.6f, PropKind.Metal),
                // Spawns
                P(-30, -52, 3, 2, 1.4f, PropKind.Stone),
                P(-10, -54, 2, 2, 2, PropKind.Wood),
                P(-2, -50, 2, 2, 1.6f, PropKind.Stone),
                P(14, 52, 2, 2, 2, PropKind.Wood),
                P(30, 50, 4, 2, 1.3f, PropKind.Stone),
                P(40, 54, 2, 2, 2, PropKind.Metal),
            },

            Ramps = new[]
            {
                Rp(-41, -19, -41, -14, 6, 1.6f),   // Bridge, south side
                Rp(-41, -6, -41, -11, 6, 1.6f),    // Bridge, north side
                Rp(21, -22, 21, -12, 5, 2.4f),     // Apartment stairs up to the balcony
                Rp(21, 10, 21, 4, 5, 2.4f),        // Balcony steps down into A
            },

            Decor = BuildDecor(),

            Sites = new[] { new Site(32, 22, 10f, "A"), new Site(-16, 34, 10f, "B") },

            Lanes = new[] { R(-6.125f, -45, -5.875f, -25), R(20.875f, -47, 21.125f, -24), R(-46.125f, -49, -45.875f, -35) },

            SpawnPoints = new[]
            {
                V(-36, -52), V(-18, -52), V(-6, -56), V(10, 54), V(24, 54), V(42, 50),
                V(36, 34), V(28, 10), V(-34, 32), V(-12, 28), V(-46, -24), V(-40, 0),
                V(-9, -15), V(3, 10), V(21, -44), V(42, -12), V(8, 30), V(14, -54),
            },

            Pickups = new[]
            {
                (V(-41, 2), PickupKind.Health),
                (V(-6, -13), PickupKind.Health),
                (V(42, 6), PickupKind.Health),
                (V(0, 45), PickupKind.Health),
                (V(-20, 38), PickupKind.Shield),
                (V(36, 25), PickupKind.Shield),
                (V(-41, -12.5f, 1.6f), PickupKind.Overdrive),
                (V(-20, -19), PickupKind.Haste),
                (V(14, -55), PickupKind.Haste),
                (V(-6, -34), PickupKind.Smg),
                (V(30, 54), PickupKind.Rifle),
                (V(-30, -55), PickupKind.Rifle),
                (V(23, -1, 2.4f), PickupKind.Sniper),
                (V(-45, -44), PickupKind.Shotgun),
            },

            Waypoints = new[]
            {
                V(32, 22), V(-16, 34), V(-28, 20), V(0, -18), V(3, 10), V(-6, -36), V(-49, -44), V(-44, -26),
                V(-41, -12.5f, 1.6f), V(-40, 0), V(-34, 12), V(-20, -19), V(21, -36), V(21, -4, 2.4f), V(40, -8),
                V(24, 30), V(8, 30), V(26, 52), V(0, 46), V(-20, -52), V(14, -52), V(-30, 40),
            },

            Perches = new[]
            {
                H(21, 2, 0f, 2.4f),     // Apartment balcony, into A
                H(6, 30, 90f),          // Arch side, through the arch into A
                H(-14, 42, 212f),       // Church steps, across the courtyard to the banana
                H(-40, 6, 188f),        // Top of banana, down the lane to the bridge
                H(3, -8, 0f),           // Mid square, up mid
                H(42, -16, 0f),         // Pit, into A
            },

            // Over the mid square, facing the attackers.
            BrandPosition = new Vector3(0, 0, -19),
            BrandYaw = 0f,
            BrandHeight = 8.2f,

            Look = new MapLook
            {
                FogColor = C(0.86f, 0.77f, 0.66f), FogStart = 45f, FogEnd = 175f,
                AmbientSky = C(0.62f, 0.66f, 0.8f), AmbientEquator = C(0.66f, 0.54f, 0.42f), AmbientGround = C(0.3f, 0.24f, 0.18f),
                SkyTint = C(0.55f, 0.62f, 0.88f), SkyGround = C(0.6f, 0.48f, 0.38f), SkyExposure = 1.3f, Atmosphere = 1.05f,
                SunColor = C(1f, 0.86f, 0.66f), SunIntensity = 1.3f, ShadowStrength = 0.78f, SunEuler = new Vector3(32f, 118f, 0f),
                Neon = C(1f, 0.82f, 0.5f), NeonAlt = C(0.95f, 0.72f, 0.3f), Glow = C(1f, 0.78f, 0.45f),
                WallTints = new[] { C(1f, 0.86f, 0.68f), C(0.98f, 0.78f, 0.62f), C(1f, 0.93f, 0.78f) },
                GroundTint = C(0.92f, 0.88f, 0.82f), FloorTint = C(0.85f, 0.75f, 0.62f), RoofTint = C(1f, 0.9f, 0.85f),
                StoneTint = C(0.88f, 0.85f, 0.8f), AccentTint = C(0.95f, 0.62f, 0.45f), MetalTint = C(0.45f, 0.45f, 0.48f),
                WaterColor = C(0.06f, 0.16f, 0.17f),
                WindowColor = C(0.2f, 0.36f, 0.24f), Foliage = C(0.18f, 0.32f, 0.16f), ClothTint = Color.white,
            },

            Textures = new MapTextures
            {
                Ground = "villa_cobble", Floor = "dunes_floor", Roof = "villa_roof_tiles", Wood = "dunes_wood",
                Metal = "dunes_metal", Stone = "sandstorm_wall_block", Accent = "dunes_wall_brick", Cloth = "bazaar_awning",
                Walls = new[] { "villa_wall_stucco", "dunes_wall_plaster", "villa_wall_stucco" },
            },
        };

        static Decor[] BuildDecor()
        {
            var d = new List<Decor>
            {
                // Church: a tall gabled facade with a dark door and a glowing rose window, and a bell tower.
                D(-22, 6, 47.6f, 20, 12, 3, DecorKind.Wall, true),
                D(-22, 12.4f, 47.6f, 18, 0.8f, 3.2f, DecorKind.Roof),
                D(-22, 13.2f, 47.6f, 12, 0.8f, 3.2f, DecorKind.Roof),
                D(-22, 14f, 47.6f, 6, 0.8f, 3.2f, DecorKind.Roof),
                D(-22, 2.6f, 46.05f, 4, 5.2f, 0.2f, DecorKind.Window),
                D(-22, 8.6f, 46.05f, 2.6f, 2.6f, 0.2f, DecorKind.Glow),
                D(-36, 9, 50, 5, 18, 5, DecorKind.Wall, true),
                D(-36, 18.4f, 50, 5.6f, 0.8f, 5.6f, DecorKind.Roof),
                D(-36, 19.6f, 50, 3.6f, 1.6f, 3.6f, DecorKind.Roof),
                D(-36, 15.8f, 47.45f, 1.6f, 2.2f, 0.2f, DecorKind.Window),
                D(-36, 15.6f, 50, 1.2f, 1.2f, 1.2f, DecorKind.Glow),
                // Fountain water and bowl.
                D(-24, 0.55f, 27, 3.8f, 0.1f, 4.2f, DecorKind.Water),
                D(-24, 2.3f, 27, 1.8f, 0.2f, 1.8f, DecorKind.Stone),
                // Bridge parapets.
                D(-44.15f, 2.1f, -12.5f, 0.3f, 1f, 3, DecorKind.Stone, true),
                D(-37.85f, 2.1f, -12.5f, 0.3f, 1f, 3, DecorKind.Stone, true),
                // Canal edging.
                D(-41, 0.15f, -14.15f, 18, 0.3f, 0.3f, DecorKind.Stone),
                D(-41, 0.15f, -10.85f, 18, 0.3f, 0.3f, DecorKind.Stone),
                // Balcony railing either side of the steps, and an awning over it.
                D(17.25f, 2.9f, 3.8f, 2.5f, 1f, 0.3f, DecorKind.Metal, true),
                D(24.75f, 2.9f, 3.8f, 2.5f, 1f, 0.3f, DecorKind.Metal, true),
                D(21, 5.6f, -4, 10.4f, 0.12f, 16.4f, DecorKind.Cloth),
                // Planter in the mid square.
                D(-2, 1.5f, -18, 1.8f, 1f, 1.8f, DecorKind.Foliage),
            };

            d.AddRange(Arch(15.4f, 30, 8, false));            // The arch from arch side into A
            d.AddRange(Arch(-6, -25.4f, 8, true));            // Top of second mid
            d.AddRange(Arch(-46, -45.4f, 12, true, clear: 3.2f, top: 5f)); // Bottom of banana

            // Decorative balconies (with iron railings) on the courtyard and A square walls.
            foreach (var (x, z, alongX, outward) in new[]
                     {
                         (-39.4f, 30f, false, 1f), (-39.4f, 38f, false, 1f), (-4.6f, 24f, false, -1f),
                         (47.4f, 20f, false, -1f), (47.4f, 32f, false, -1f), (20f, -57.4f, true, 1f), (-28f, -46.6f, true, -1f),
                     })
            {
                var slab = alongX ? new Vector3(4, 0.2f, 1.2f) : new Vector3(1.2f, 0.2f, 4);
                var rail = alongX ? new Vector3(4, 1f, 0.08f) : new Vector3(0.08f, 1f, 4);
                d.Add(new Decor(new Vector3(x, 3.6f, z), slab, DecorKind.Stone, false));
                var railAt = alongX ? new Vector3(x, 4.2f, z + outward * 0.56f) : new Vector3(x + outward * 0.56f, 4.2f, z);
                d.Add(new Decor(railAt, rail, DecorKind.Metal, false));
                var pot = alongX ? new Vector3(x - 1.2f, 3.95f, z) : new Vector3(x, 3.95f, z - 1.2f);
                d.Add(new Decor(pot, new Vector3(0.6f, 0.5f, 0.6f), DecorKind.Foliage, false));
            }

            // Washing lines strung across the alleys.
            d.Add(D(-46, 5.4f, -38, 12, 0.05f, 0.5f, DecorKind.Cloth));
            d.Add(D(-44, 5.8f, -24, 12, 0.05f, 0.5f, DecorKind.Cloth));
            d.Add(D(-6, 5.2f, -36, 8, 0.05f, 0.5f, DecorKind.Cloth));
            d.Add(D(21, 5.4f, -54, 0.5f, 0.05f, 10, DecorKind.Cloth));
            d.Add(D(-35, 5.6f, 12, 14, 0.05f, 0.5f, DecorKind.Cloth));

            // Cypress trees and wall lanterns.
            foreach (var (x, z) in new[] { (-38.6f, 44.6f), (-5.4f, 17.4f), (44.6f, 46.6f), (17.4f, 38.6f), (-42.6f, -56.6f) })
            {
                d.Add(D(x, 0.5f, z, 0.4f, 1f, 0.4f, DecorKind.Wood, true));
                d.Add(D(x, 3.6f, z, 1.2f, 5.4f, 1.2f, DecorKind.Foliage, true));
                d.Add(D(x, 6.6f, z, 0.7f, 1.2f, 0.7f, DecorKind.Foliage));
            }
            foreach (var (x, z) in new[] { (-49.7f, -26f), (-45.7f, 0f), (-9.7f, -36f), (25.7f, -36f), (-1.7f, 10f), (47.7f, -8f), (-39.7f, 22f) })
                d.Add(D(x, 3.3f, z, 0.25f, 0.5f, 0.5f, DecorKind.Glow));
            return d.ToArray();
        }
    }
}
