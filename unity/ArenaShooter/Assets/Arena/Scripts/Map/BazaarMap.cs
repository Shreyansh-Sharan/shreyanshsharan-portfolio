using System.Collections.Generic;
using UnityEngine;
using static Arena.Map.MapData;

namespace Arena.Map
{
    /// <summary>
    /// "Bazaar": an original Middle-Eastern market town at dusk. The attackers come from the east; A sits in a
    /// colonnaded square below the palace (reached through the palace hall and its balcony, or down the ramp),
    /// B is a market square reached through an apartment block. A long mid is watched by a sniper window on
    /// the defenders' side, and a covered connector and a planted "jungle" link mid to A and the defenders.
    /// </summary>
    public static class BazaarMap
    {
        public static MapDefinition Create() => new MapDefinition
        {
            Id = "bazaar",
            Name = "Bazaar",
            Tagline = "Lanterns, domes and a window over mid",
            Origin = new Vector3(2000, 0, 0),
            MinX = -60, MaxX = 60, MinZ = -60, MaxZ = 52,
            WallHeight = new Vector2(5f, 10f),
            TrimChance = 0.18f,
            RoofStyle = RoofStyle.Parapet,
            WindowChance = 0.42f,
            DomeChance = 0.3f,

            Walkable = new[]
            {
                R(40, -16, 58, 16),    // Attacker spawn
                R(26, -4, 42, 6),      // Top mid
                R(-18, -4, 26, 6),     // Mid
                R(-30, -4, -18, 6),    // Sniper window room (raised)
                R(-40, -4, -30, 6),    // Window stairs
                R(-58, -22, -36, 22),  // Defender spawn
                R(-50, -46, -38, -22), // Defender spawn to ticket booth
                R(-6, -22, 2, -4),     // Connector
                R(-22, -30, 2, -20),   // Jungle
                R(-38, -28, -20, -20), // Jungle to the defenders
                R(-14, -50, 22, -28),  // A: palace square
                R(-38, -46, -14, -36), // Ticket booth: A to the defenders
                R(30, -30, 46, -14),   // A ramp
                R(22, -36, 34, -26),   // Bottom of A ramp
                R(50, -40, 58, -16),   // Palace entrance
                R(32, -50, 58, -40),   // Palace hall
                R(16, -48, 32, -40),   // Palace balcony (raised) and its steps down into A
                R(40, 16, 54, 34),     // Apartments entrance
                R(4, 28, 48, 40),      // Apartments
                R(-6, 6, 2, 18),       // B short
                R(-36, 18, 4, 46),     // B: market square
                R(-56, 22, -36, 42),   // Market stalls (defenders to B)
            },

            Roofs = new[]
            {
                R(32, -50, 58, -40),   // Palace hall
                R(18, 28, 48, 40),     // Apartments
                R(-6, -18, 2, -6),     // Connector
                R(-22, -30, -12, -20), // Covered half of the jungle
                R(-56, 34, -36, 42),   // Covered market
            },

            Props = new[]
            {
                // Raised floors: the sniper window room, the palace balcony and the apartments' upper floor.
                P(-24.3f, 1, 11.4f, 10, 2.6f, PropKind.Stone),
                P(27, -44, 10, 8, 1.8f, PropKind.Stone),
                P(9, 34, 10, 12, 2f, PropKind.Stone),
                // A: the triple stack, a cart, the sandwich and pillar cover along the colonnade.
                P(4, -36, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(6.4f, -36, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(5.2f, -36, 2.4f, 2.4f, 2.4f, PropKind.Wood, 2.4f),
                P(-8, -44, 2, 2, 2, PropKind.Wood),
                P(14, -32, 1.2f, 4, 1.6f, PropKind.Stone),
                P(-2, -31, 3, 1.6f, 1.3f, PropKind.Metal),
                P(-12, -49, 0.9f, 0.9f, 5f, PropKind.Stone),
                P(-6, -49, 0.9f, 0.9f, 5f, PropKind.Stone),
                P(0, -49, 0.9f, 0.9f, 5f, PropKind.Stone),
                P(6, -49, 0.9f, 0.9f, 5f, PropKind.Stone),
                P(12, -49, 0.9f, 0.9f, 5f, PropKind.Stone),
                P(18, -49, 0.9f, 0.9f, 5f, PropKind.Stone),
                // A ramp and palace
                P(36, -22, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(28, -33, 2, 2, 1.4f, PropKind.Stone),
                P(54, -30, 2, 2, 2, PropKind.Wood),
                P(44, -46, 1.6f, 1.6f, 1.6f, PropKind.Metal),
                // Mid
                P(10, 1, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-8, -2, 2, 2, 1.4f, PropKind.Stone),
                P(22, 3, 2, 2, 2, PropKind.Wood),
                P(36, -1, 3, 1.5f, 1.2f, PropKind.Stone),
                // Jungle planters and the connector
                P(-16, -25, 2, 2, 0.9f, PropKind.Stone),
                P(-4, -27, 2, 2, 0.9f, PropKind.Stone),
                P(-2, -12, 1.6f, 1.6f, 1.6f, PropKind.Wood),
                // B: van, bench and boxes
                P(-8, 40, 5, 2.4f, 2.4f, PropKind.Metal),
                P(-20, 30, 4, 1, 0.9f, PropKind.Wood),
                P(-28, 38, 2.4f, 2.4f, 2.4f, PropKind.Wood),
                P(-30, 24, 2, 2, 2, PropKind.Wood),
                P(-12, 22, 2, 2, 1.4f, PropKind.Stone),
                // Market stalls (counters under awnings)
                P(-50, 28, 6, 1.2f, 1.1f, PropKind.Wood),
                P(-42, 28, 6, 1.2f, 1.1f, PropKind.Wood),
                P(-50, 36, 6, 1.2f, 1.1f, PropKind.Wood),
                P(-42, 36, 6, 1.2f, 1.1f, PropKind.Wood),
                // Apartments
                P(30, 36, 2, 2, 2, PropKind.Wood),
                P(44, 24, 2, 2, 1.6f, PropKind.Metal),
                // Spawns
                P(50, 6, 3, 2, 1.4f, PropKind.Stone),
                P(46, -8, 2, 2, 2, PropKind.Wood),
                P(-46, 6, 3, 2, 1.4f, PropKind.Stone),
                P(-52, -10, 2, 2, 2, PropKind.Wood),
                P(-44, -34, 2, 2, 1.6f, PropKind.Metal),
            },

            Ramps = new[]
            {
                Rp(-40, 1, -30, 1, 6, 2.6f),   // Defender stairs up to the sniper window
                Rp(38, -45, 32, -45, 5, 1.8f), // Palace hall up to the balcony
                Rp(17, -44, 22, -44, 5, 1.8f), // Balcony steps down into A
                Rp(22, 34, 14, 34, 6, 2f),     // Apartment stairs to the upper floor
                Rp(-2, 30, 4, 30, 4, 2f),      // Upper floor steps down into B
            },

            Decor = BuildDecor(),

            // The palace dome behind A and a mosque-style dome over the market.
            Domes = new[] { new Vector4(4, 11, -56, 10), new Vector4(-46, 9.5f, 47, 7) },

            Sites = new[] { new Site(4, -42, 10f, "A"), new Site(-20, 37, 10f, "B") },

            Lanes = new[] { R(-17, 0.875f, 41, 1.125f), R(17, 33.875f, 47, 34.125f), R(37.875f, -29, 38.125f, -15) },

            SpawnPoints = new[]
            {
                V(50, 0), V(54, -10), V(48, 12), V(-50, 0), V(-46, -14), V(-52, 14),
                V(-4, -46), V(18, -34), V(-30, 30), V(-10, 26), V(16, 0), V(-12, 2),
                V(-14, -27), V(-52, 32), V(30, 32), V(48, -44), V(36, -26), V(-26, -41),
            },

            Pickups = new[]
            {
                (V(-2, -15), PickupKind.Health),
                (V(-44, -28), PickupKind.Health),
                (V(48, 28), PickupKind.Health),
                (V(-2, 12), PickupKind.Health),
                (V(-4, -40), PickupKind.Shield),
                (V(-24, 42), PickupKind.Shield),
                (V(27, -44, 1.8f), PickupKind.Overdrive),
                (V(-46, 32), PickupKind.Haste),
                (V(33, 1), PickupKind.Haste),
                (V(-26, 3, 2.6f), PickupKind.Sniper),
                (V(-12, -23), PickupKind.Shotgun),
                (V(26, 31), PickupKind.Smg),
                (V(40, -20), PickupKind.Rifle),
                (V(-50, -16), PickupKind.Rifle),
            },

            Waypoints = new[]
            {
                V(4, -42), V(-20, 37), V(0, 1), V(30, 1), V(-14, 1), V(-24, 1, 2.6f), V(-2, -14), V(-12, -25),
                V(-30, -24), V(-26, -41), V(-44, -36), V(38, -26), V(27, -31), V(27, -44, 1.8f), V(48, -44), V(54, -26),
                V(48, 24), V(30, 32), V(9, 34, 2f), V(-2, 12), V(-46, 32), V(-50, 0), V(50, 0), V(-30, 32),
            },

            Perches = new[]
            {
                H(-23, 1, 90f, 2.6f),    // The sniper window, down mid
                H(8, 36, 270f, 2f),      // Apartment upper floor, into B
                H(27, -42, 280f, 1.8f),  // Palace balcony, across A
                H(-12, -46, 65f),        // Defender corner of A, up the ramp
                H(36, 2, 270f),          // Top mid, down mid
                H(-40, 31, 90f),         // Market, into B
            },

            // Across mid between the window and top mid.
            BrandPosition = new Vector3(8, 0, 1),
            BrandYaw = 90f,
            BrandHeight = 8.5f,

            Look = new MapLook
            {
                FogColor = C(0.5f, 0.34f, 0.34f), FogStart = 35f, FogEnd = 165f,
                AmbientSky = C(0.46f, 0.38f, 0.56f), AmbientEquator = C(0.58f, 0.4f, 0.32f), AmbientGround = C(0.2f, 0.14f, 0.12f),
                SkyTint = C(0.9f, 0.45f, 0.42f), SkyGround = C(0.32f, 0.2f, 0.2f), SkyExposure = 0.85f, Atmosphere = 1.6f,
                SunColor = C(1f, 0.56f, 0.32f), SunIntensity = 0.95f, ShadowStrength = 0.65f, SunEuler = new Vector3(12f, 255f, 0f),
                Neon = C(1f, 0.62f, 0.22f), NeonAlt = C(0.25f, 0.85f, 0.8f), Glow = C(1f, 0.62f, 0.26f),
                WallTints = new[] { C(1f, 0.9f, 0.82f), C(0.96f, 0.8f, 0.72f), C(0.9f, 0.76f, 0.64f) },
                GroundTint = C(0.9f, 0.78f, 0.68f), FloorTint = C(1f, 0.95f, 0.9f), RoofTint = C(0.75f, 0.6f, 0.48f),
                StoneTint = C(0.95f, 0.85f, 0.75f), MetalTint = C(0.9f, 0.75f, 0.45f),
                WindowColor = C(1f, 0.62f, 0.28f), WindowGlow = 1.4f, Foliage = C(0.2f, 0.42f, 0.22f), ClothTint = Color.white,
            },

            Textures = new MapTextures
            {
                Ground = "dunes_floor", Floor = "dunes_accent", Roof = "dunes_wood", Wood = "dunes_wood",
                Metal = "dunes_metal", Stone = "sandstorm_wall_block", Accent = "dunes_accent", Cloth = "bazaar_awning",
                Walls = new[] { "bazaar_wall_mud", "dunes_wall_plaster", "bazaar_wall_mud" },
            },
        };

        static Decor[] BuildDecor()
        {
            var d = new List<Decor>
            {
                // The sniper window: a chest-high sill, jambs and a lintel across the end of mid, and a roof over the room.
                D(-18.3f, 1.75f, 1, 0.6f, 3.5f, 10, DecorKind.Wall, true),
                D(-18.3f, 5.25f, -2.75f, 0.6f, 3.5f, 2.5f, DecorKind.Wall, true),
                D(-18.3f, 5.25f, 4.75f, 0.6f, 3.5f, 2.5f, DecorKind.Wall, true),
                D(-18.3f, 6.1f, 1, 0.6f, 1.8f, 5, DecorKind.Wall, true),
                D(-24.3f, 7.2f, 1, 11.4f, 0.4f, 10, DecorKind.Roof, true),
                D(-17.9f, 3.45f, 1, 0.3f, 0.12f, 5.2f, DecorKind.Stone),
                D(-24, 5.6f, 5.7f, 0.5f, 0.5f, 0.25f, DecorKind.Glow),
                // Towers that carry the palace and market domes.
                D(4, 5.5f, -55.5f, 9, 11, 9, DecorKind.Wall, true),
                D(-46, 4.75f, 47, 7, 9.5f, 7, DecorKind.Wall, true),
                // Colonnade beam over the A pillars and the palace frontage.
                D(3, 5.3f, -49, 32, 0.6f, 1.2f, DecorKind.Stone),
                D(4, 6.5f, -50.6f, 14, 2, 0.4f, DecorKind.Accent),
                // Railings on the raised floors.
                D(4.3f, 2.5f, 36, 0.3f, 1f, 8, DecorKind.Stone, true),
                D(22.3f, 2.3f, -40.75f, 0.3f, 1f, 1.5f, DecorKind.Stone, true),
                D(22.3f, 2.3f, -47.25f, 0.3f, 1f, 1.5f, DecorKind.Stone, true),
                // Jungle trees.
                D(-6, 2, -22.5f, 0.5f, 4, 0.5f, DecorKind.Wood, true),
                D(-6, 4.6f, -22.5f, 3.4f, 1.4f, 3.4f, DecorKind.Foliage),
                D(-16, 1.6f, -25, 1.8f, 1.4f, 1.8f, DecorKind.Foliage),
                D(-4, 1.6f, -27, 1.8f, 1.4f, 1.8f, DecorKind.Foliage),
            };

            // Striped awnings over the market counters and a few shop fronts.
            foreach (var (x, z) in new[] { (-50f, 28f), (-42f, 28f), (-50f, 36f), (-42f, 36f) })
            {
                d.Add(D(x, 2.9f, z + 0.4f, 6.6f, 0.12f, 2.8f, DecorKind.Cloth));
                d.Add(D(x - 3.1f, 1.45f, z + 1.6f, 0.12f, 2.9f, 0.12f, DecorKind.Wood));
                d.Add(D(x + 3.1f, 1.45f, z + 1.6f, 0.12f, 2.9f, 0.12f, DecorKind.Wood));
            }
            foreach (var (x, z, w, alongX) in new[]
                     {
                         (10f, -3.4f, 6f, true), (-12f, 5.4f, 5f, true), (40f, -29.4f, 5f, true), (-30f, 45.4f, 6f, true),
                         (3.4f, 22f, 5f, false), (57.4f, -4f, 5f, false),
                     })
                d.Add(new Decor(new Vector3(x, 3.1f, z), alongX ? new Vector3(w, 0.1f, 1.6f) : new Vector3(1.6f, 0.1f, w), DecorKind.Cloth, false));

            // Arches into the sites and the palace.
            d.AddRange(Arch(-14.6f, -41, 10, false));                 // Ticket booth into A
            d.AddRange(Arch(54, -39.4f, 8, true, clear: 3.4f, top: 5.6f)); // Palace entrance
            d.AddRange(Arch(-2, 17.4f, 8, true));                     // Short into B
            d.AddRange(Arch(-35.4f, 32, 20, false, clear: 3.8f, top: 6f)); // Market into B

            // Hanging lanterns along mid, the market and the apartments.
            foreach (var x in new[] { -12f, 0f, 14f, 30f })
            {
                d.Add(D(x, 5.2f, 1, 0.08f, 1.2f, 0.08f, DecorKind.Metal));
                d.Add(D(x, 4.5f, 1, 0.45f, 0.6f, 0.45f, DecorKind.Glow));
            }
            foreach (var (x, z) in new[] { (-46f, 32f), (-46f, 40f), (-40f, 24f), (24f, 34f), (36f, 34f), (-20f, -25f), (40f, -45f), (50f, -45f) })
                d.Add(D(x, 3.4f, z, 0.45f, 0.6f, 0.45f, DecorKind.Glow));
            // String lights across top mid and B.
            d.Add(D(34, 5.6f, 1, 16, 0.08f, 0.08f, DecorKind.Neon));
            d.Add(D(-16, 5.8f, 32, 40, 0.08f, 0.08f, DecorKind.Neon));
            d.Add(D(-16, 5.4f, 40, 40, 0.08f, 0.08f, DecorKind.Neon));
            // Palms in the spawns and on B.
            foreach (var (x, z) in new[] { (56f, 14f), (56f, -14f), (-56f, 20f), (-56f, -20f), (-34f, 44f), (2f, 44f) })
            {
                d.Add(D(x, 3.2f, z, 0.5f, 6.4f, 0.5f, DecorKind.Wood, true));
                d.Add(D(x, 6.5f, z, 4.2f, 0.25f, 1.1f, DecorKind.Foliage));
                d.Add(D(x, 6.5f, z, 1.1f, 0.25f, 4.2f, DecorKind.Foliage));
                d.Add(D(x, 6.75f, z, 1.4f, 0.4f, 1.4f, DecorKind.Foliage));
            }
            return d.ToArray();
        }
    }
}
