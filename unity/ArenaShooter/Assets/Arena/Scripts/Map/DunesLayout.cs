using System.Collections.Generic;
using UnityEngine;

namespace Arena.Map
{
    /// <summary>
    /// "Dunes": an original desert map with the classic two-site flow (a long lane to A, a short
    /// catwalk from mid, tunnels to B, mid doors to the defender spawn). All coordinates in metres,
    /// x = east, z = north. Everything not covered by a walkable rect becomes a solid building.
    /// </summary>
    public static class DunesLayout
    {
        public const float MinX = -50f, MaxX = 50f, MinZ = -58f, MaxZ = 58f;

        /// <summary>Open, walkable ground: (x0, z0, x1, z1).</summary>
        public static readonly Rect[] Walkable =
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
        };

        /// <summary>Door frames and walls placed inside walkable space: (x0, z0, x1, z1, height).</summary>
        public static readonly Vector4[] Blockers =
        {
            new Vector4(34, -13, 38.5f, -11), new Vector4(41.5f, -13, 44, -11), // Long doors
            new Vector4(-5, 23, -1.6f, 25), new Vector4(1.6f, 23, 5, 25),       // Mid doors
            new Vector4(-18, 35, -15.5f, 37), new Vector4(-12.5f, 35, -10, 37), // B doors frame
        };

        /// <summary>Covered sections (tunnels): (x0, z0, x1, z1).</summary>
        public static readonly Rect[] Roofs =
        {
            R(-44, -34, -34, 4),
            R(-40, -46, -26, -34),
            R(-34, -6, -12, 0),
        };

        public enum PropKind { Wood, Metal, Stone }

        public struct Prop
        {
            public Vector3 Center; // x, base y, z
            public Vector3 Size;
            public PropKind Kind;
            public Prop(float x, float z, float sx, float sz, float sy, PropKind kind, float baseY = 0f)
            {
                Center = new Vector3(x, baseY, z);
                Size = new Vector3(sx, sy, sz);
                Kind = kind;
            }
        }

        public static readonly Prop[] Props =
        {
            // A site
            new Prop(24, 30, 2.4f, 2.4f, 2.4f, PropKind.Wood),
            new Prop(26.4f, 30, 2.4f, 2.4f, 1.2f, PropKind.Wood),
            new Prop(24, 30, 1.8f, 1.8f, 1.8f, PropKind.Metal, 2.4f),
            new Prop(36, 38, 3, 3, 1.6f, PropKind.Stone),
            new Prop(40, 30, 2, 2, 2, PropKind.Metal),
            new Prop(20, 40, 2, 4, 1.4f, PropKind.Stone),
            new Prop(30, 24, 6, 1.2f, 1.2f, PropKind.Stone),
            // B site
            new Prop(-30, 24, 2.4f, 2.4f, 2.4f, PropKind.Wood),
            new Prop(-36, 30, 2, 2, 2, PropKind.Metal),
            new Prop(-24, 30, 3, 2, 1.2f, PropKind.Wood),
            new Prop(-40, 16, 2.4f, 2.4f, 2.4f, PropKind.Wood),
            new Prop(-40, 16, 1.8f, 1.8f, 1.8f, PropKind.Wood, 2.4f),
            new Prop(-28, 36, 2, 2, 1.4f, PropKind.Stone),
            // Mid
            new Prop(0, -8, 2, 2, 1.6f, PropKind.Wood),
            new Prop(-3, 14, 1.6f, 1.6f, 1.6f, PropKind.Metal),
            // Long
            new Prop(40, -24, 2.4f, 2.4f, 2.4f, PropKind.Wood),
            new Prop(37, 4, 2, 2, 2, PropKind.Metal),
            new Prop(42, 14, 1.6f, 1.6f, 3, PropKind.Stone),
            // Spawns and connectors
            new Prop(-10, -46, 3, 2, 1.4f, PropKind.Stone),
            new Prop(12, -48, 2, 2, 2, PropKind.Wood),
            new Prop(2, 46, 4, 2, 1.3f, PropKind.Metal),
            new Prop(-6, 50, 2, 2, 2, PropKind.Wood),
            new Prop(-41.5f, -25, 1.6f, 1.6f, 1.6f, PropKind.Wood),
            new Prop(30, -42, 2, 2, 1.6f, PropKind.Stone),
            new Prop(6.5f, 12.5f, 1.4f, 1.4f, 1.4f, PropKind.Metal),
        };

        /// <summary>Glowing site plates: (centre x, centre z, size, letter).</summary>
        public static readonly (Vector2 center, float size, string letter)[] Sites =
        {
            (new Vector2(31, 33), 10f, "A"),
            (new Vector2(-32, 23), 10f, "B"),
        };

        public static readonly Vector3[] SpawnPoints =
        {
            V(-20, -48), V(0, -50), V(20, -46), V(-6, 46), V(8, 50), V(14, 42),
            V(24, 40), V(40, 26), V(-40, 34), V(-24, 12), V(0, -20), V(0, 10),
            V(39, -20), V(39, 10), V(-39, -20), V(32, -40), V(-20, -3), V(-38, -40),
        };

        public enum PickupKind : byte { Health, Shield, Overdrive, Haste }

        public static readonly (Vector3 position, PickupKind kind)[] Pickups =
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
        };

        /// <summary>Points of interest the bots roam between.</summary>
        public static readonly Vector3[] Waypoints =
        {
            V(31, 33), V(-32, 23), V(0, 0), V(0, -28), V(0, 20), V(39, -20), V(39, 12),
            V(-39, -24), V(-39, 0), V(-20, -3), V(14, 16), V(8, 9), V(8, 44), V(-14, 38),
            V(26, -40), V(-34, -40), V(0, -48), V(24, 40), V(-40, 34),
        };

        public static bool IsWalkable(float x, float z)
        {
            foreach (var r in Walkable)
                if (x >= r.xMin && x < r.xMax && z >= r.yMin && z < r.yMax) return true;
            return false;
        }

        /// <summary>Merges the non-walkable grid cells into as few boxes as possible (greedy rectangles).</summary>
        public static List<RectInt> SolidBlocks(int cell = 1)
        {
            int w = Mathf.RoundToInt((MaxX - MinX) / cell), h = Mathf.RoundToInt((MaxZ - MinZ) / cell);
            var solid = new bool[w, h];
            for (int i = 0; i < w; i++)
            for (int j = 0; j < h; j++)
                solid[i, j] = !IsWalkable(MinX + (i + 0.5f) * cell, MinZ + (j + 0.5f) * cell);

            var blocks = new List<RectInt>();
            for (int j = 0; j < h; j++)
            for (int i = 0; i < w; i++)
            {
                if (!solid[i, j]) continue;
                int iw = 1;
                while (i + iw < w && solid[i + iw, j] && iw < 24) iw++;
                int jh = 1;
                while (j + jh < h && jh < 24)
                {
                    bool row = true;
                    for (int k = 0; k < iw; k++) if (!solid[i + k, j + jh]) { row = false; break; }
                    if (!row) break;
                    jh++;
                }
                for (int a = 0; a < iw; a++)
                for (int b = 0; b < jh; b++)
                    solid[i + a, j + b] = false;
                blocks.Add(new RectInt(i, j, iw, jh));
            }
            return blocks;
        }

        static Rect R(float x0, float z0, float x1, float z1) => Rect.MinMaxRect(x0, z0, x1, z1);
        static Vector3 V(float x, float z) => new Vector3(x, 0.1f, z);
    }
}
