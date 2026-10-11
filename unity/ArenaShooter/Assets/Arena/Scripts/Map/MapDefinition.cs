using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arena.Map
{
    public enum PropKind { Wood, Metal, Stone, Container }

    public enum PickupKind : byte { Health, Shield, Overdrive, Haste }

    public enum DecorKind { Wall, Metal, Wood, Roof, Accent, Neon, Glow, Water }

    /// <summary>A crate, barrier or container: centre x/z, base height and size (x, height, z).</summary>
    public struct Prop
    {
        public Vector3 Center;
        public Vector3 Size;
        public PropKind Kind;
        public Prop(float x, float z, float sx, float sz, float sy, PropKind kind, float baseY = 0f)
        {
            Center = new Vector3(x, baseY, z);
            Size = new Vector3(sx, sy, sz);
            Kind = kind;
        }
    }

    /// <summary>Set dressing (cranes, water, antennas, lights). Solid decor gets a collider.</summary>
    public struct Decor
    {
        public Vector3 Center;
        public Vector3 Size;
        public DecorKind Kind;
        public bool Solid;
        public Decor(Vector3 center, Vector3 size, DecorKind kind, bool solid)
        {
            Center = center;
            Size = size;
            Kind = kind;
            Solid = solid;
        }
    }

    /// <summary>Glowing site plate: centre, size and letter.</summary>
    public struct Site
    {
        public Vector2 Center;
        public float Size;
        public string Letter;
        public Site(float x, float z, float size, string letter)
        {
            Center = new Vector2(x, z);
            Size = size;
            Letter = letter;
        }
    }

    /// <summary>Lighting, fog and sky for a map, applied when it becomes the active map.</summary>
    [Serializable]
    public class MapLook
    {
        public Color FogColor;
        public float FogStart = 45f, FogEnd = 170f;
        public Color AmbientSky, AmbientEquator, AmbientGround;
        public Color SkyTint, SkyGround;
        public float SkyExposure = 1.25f, Atmosphere = 1.15f, SunSize = 0.05f;
        public Color SunColor;
        public float SunIntensity = 1.3f, ShadowStrength = 0.75f;
        public Vector3 SunEuler = new Vector3(42f, -35f, 0f);
        public Color Neon, NeonAlt, Glow;
        public Color[] WallTints = { Color.white, Color.white, Color.white };
    }

    /// <summary>Texture file names (in Assets/Arena/Textures, without extension) for each surface slot.</summary>
    [Serializable]
    public class MapTextures
    {
        public string Ground, Floor, Roof, Wood, Metal, Stone, Accent;
        public string[] Walls;
    }

    /// <summary>
    /// A complete arena described as data, in local metres (x = east, z = north). Everything inside the
    /// bounds that isn't covered by a walkable rect becomes a solid building. The map is placed at
    /// <see cref="Origin"/> in the shared scene, so every gameplay point goes through <see cref="ToWorld"/>.
    /// </summary>
    public class MapDefinition
    {
        public string Id, Name, Tagline;
        public Vector3 Origin;
        public float MinX, MaxX, MinZ, MaxZ;
        public Vector2 WallHeight = new Vector2(5f, 9.5f);
        public float TrimChance = 0.55f;

        public Rect[] Walkable = Array.Empty<Rect>();
        /// <summary>Door frames and walls placed inside walkable space: (x0, z0, x1, z1).</summary>
        public Vector4[] Blockers = Array.Empty<Vector4>();
        /// <summary>Covered sections (tunnels, warehouses).</summary>
        public Rect[] Roofs = Array.Empty<Rect>();
        public Prop[] Props = Array.Empty<Prop>();
        public Decor[] Decor = Array.Empty<Decor>();
        public Site[] Sites = Array.Empty<Site>();
        /// <summary>Thin glowing guide lines on the floor.</summary>
        public Rect[] Lanes = Array.Empty<Rect>();

        public Vector3[] SpawnPoints = Array.Empty<Vector3>();
        public (Vector3 position, PickupKind kind)[] Pickups = Array.Empty<(Vector3, PickupKind)>();
        /// <summary>Points of interest the bots roam between.</summary>
        public Vector3[] Waypoints = Array.Empty<Vector3>();

        /// <summary>The "SHREYANSH SHARAN" gantry: base centre, yaw (front faces local -Z) and clearance height.</summary>
        public Vector3 BrandPosition;
        public float BrandYaw, BrandHeight = 8f;

        public MapLook Look = new MapLook();
        public MapTextures Textures = new MapTextures();

        public Vector3 ToWorld(Vector3 local) => Origin + local;
        public Vector3 Center => Origin + new Vector3((MinX + MaxX) / 2f, 0f, (MinZ + MaxZ) / 2f);
        public float Radius => Mathf.Max(MaxX - MinX, MaxZ - MinZ) * 0.55f;

        public bool IsWalkable(float x, float z)
        {
            foreach (var r in Walkable)
                if (x >= r.xMin && x < r.xMax && z >= r.yMin && z < r.yMax) return true;
            return false;
        }

        /// <summary>Merges the non-walkable grid cells into as few boxes as possible (greedy rectangles).</summary>
        public List<RectInt> SolidBlocks(int cell = 1)
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
    }

    /// <summary>Short helpers so the map files read like tables.</summary>
    public static class MapData
    {
        public static Rect R(float x0, float z0, float x1, float z1) => Rect.MinMaxRect(x0, z0, x1, z1);
        public static Vector4 B(float x0, float z0, float x1, float z1) => new Vector4(x0, z0, x1, z1);
        public static Vector3 V(float x, float z) => new Vector3(x, 0.1f, z);
        public static Prop P(float x, float z, float sx, float sz, float sy, PropKind kind, float baseY = 0f) => new Prop(x, z, sx, sz, sy, kind, baseY);
        public static Decor D(float x, float y, float z, float sx, float sy, float sz, DecorKind kind, bool solid = false)
            => new Decor(new Vector3(x, y, z), new Vector3(sx, sy, sz), kind, solid);
        public static Color C(float r, float g, float b) => new Color(r, g, b);
    }
}
