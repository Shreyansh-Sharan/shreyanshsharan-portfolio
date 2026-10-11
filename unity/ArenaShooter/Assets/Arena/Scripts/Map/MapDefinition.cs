using System;
using System.Collections.Generic;
using UnityEngine;

namespace Arena.Map
{
    public enum PropKind { Wood, Metal, Stone, Container }

    /// <summary>Power-ups first, then weapon crates (one per non-sidearm weapon, in WeaponKind order).</summary>
    public enum PickupKind : byte { Health, Shield, Overdrive, Haste, Smg, Rifle, Sniper, Shotgun }

    public enum DecorKind { Wall, Metal, Wood, Roof, Accent, Neon, Glow, Water, Stone, Cloth, Foliage, Window }

    /// <summary>How the tops of the generated buildings are finished.</summary>
    public enum RoofStyle { Flat, Gable, Parapet }

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

    /// <summary>Glowing site plate: centre, size, letter and the height it sits at (raised sites).</summary>
    public struct Site
    {
        public Vector2 Center;
        public float Size;
        public string Letter;
        public float BaseY;
        public Site(float x, float z, float size, string letter, float baseY = 0f)
        {
            Center = new Vector2(x, z);
            Size = size;
            Letter = letter;
            BaseY = baseY;
        }
    }

    /// <summary>
    /// A solid sloped walkway (a wedge) that climbs from <see cref="Bottom"/> to <see cref="Top"/> (x/z),
    /// <see cref="Width"/> wide, rising <see cref="Rise"/> metres above <see cref="BaseY"/>. Used for stairs up to
    /// catwalks, raised sites, balconies and bridges, so both players and the NavMesh can climb them.
    /// </summary>
    public struct Ramp
    {
        public Vector2 Bottom, Top;
        public float Width, Rise, BaseY;
        public PropKind Kind;
        public Ramp(float x0, float z0, float x1, float z1, float width, float rise, PropKind kind, float baseY = 0f)
        {
            Bottom = new Vector2(x0, z0);
            Top = new Vector2(x1, z1);
            Width = width;
            Rise = rise;
            Kind = kind;
            BaseY = baseY;
        }
    }

    /// <summary>A spot where sniper bots hold an angle: position (y = floor height) and the yaw they watch.</summary>
    public struct Perch
    {
        public Vector3 Position;
        public float Yaw;
        public Perch(Vector3 position, float yaw)
        {
            Position = position;
            Yaw = yaw;
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
        // Surface tints (multiplied with the textures). The defaults are what the first three maps use.
        public Color GroundTint = Color.white, FloorTint = new Color(0.9f, 0.9f, 0.9f), RoofTint = new Color(0.8f, 0.8f, 0.8f);
        public Color WoodTint = Color.white, MetalTint = Color.white, StoneTint = new Color(0.92f, 0.9f, 0.88f), AccentTint = Color.white;
        public Color WaterColor = new Color(0.03f, 0.07f, 0.13f);
        /// <summary>Window panels and shutters; a glow above zero makes them emissive (lit rooms at dusk).</summary>
        public Color WindowColor = new Color(0.08f, 0.09f, 0.12f);
        public float WindowGlow;
        public Color Foliage = new Color(0.22f, 0.42f, 0.2f);
        public Color ClothTint = Color.white;
    }

    /// <summary>Texture file names (in Assets/Arena/Textures, without extension) for each surface slot.</summary>
    [Serializable]
    public class MapTextures
    {
        public string Ground, Floor, Roof, Wood, Metal, Stone, Accent, Cloth;
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
        public RoofStyle RoofStyle = RoofStyle.Flat;
        /// <summary>Chance of a window (with sill) every few metres on building faces that look onto open ground.</summary>
        public float WindowChance;
        /// <summary>Chance that a large flat-roofed building gets a dome.</summary>
        public float DomeChance;

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
        /// <summary>Slopes up to raised walkways (catwalks, raised sites, balconies, bridges).</summary>
        public Ramp[] Ramps = Array.Empty<Ramp>();
        /// <summary>Open water (canals): not a building, but impassable. Shots fly over it; bodies can't cross it.</summary>
        public Rect[] Water = Array.Empty<Rect>();
        /// <summary>Landmark domes: (x, base height, z, diameter).</summary>
        public Vector4[] Domes = Array.Empty<Vector4>();

        public Vector3[] SpawnPoints = Array.Empty<Vector3>();
        public (Vector3 position, PickupKind kind)[] Pickups = Array.Empty<(Vector3, PickupKind)>();
        /// <summary>Points of interest the bots roam between.</summary>
        public Vector3[] Waypoints = Array.Empty<Vector3>();
        /// <summary>Long sightlines where sniper bots hold an angle. Maps without any fall back to waypoints.</summary>
        public Perch[] Perches = Array.Empty<Perch>();

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

        public bool IsWater(float x, float z)
        {
            foreach (var r in Water)
                if (x >= r.xMin && x < r.xMax && z >= r.yMin && z < r.yMax) return true;
            return false;
        }

        /// <summary>Open ground: walkable or water. Everything else inside the bounds is a building.</summary>
        public bool IsOpen(float x, float z) => IsWalkable(x, z) || IsWater(x, z);

        /// <summary>Merges the non-walkable grid cells into as few boxes as possible (greedy rectangles).</summary>
        public List<RectInt> SolidBlocks(int cell = 1)
        {
            int w = Mathf.RoundToInt((MaxX - MinX) / cell), h = Mathf.RoundToInt((MaxZ - MinZ) / cell);
            var solid = new bool[w, h];
            for (int i = 0; i < w; i++)
            for (int j = 0; j < h; j++)
                solid[i, j] = !IsOpen(MinX + (i + 0.5f) * cell, MinZ + (j + 0.5f) * cell);

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
        /// <summary>A point on a raised floor <paramref name="height"/> metres up.</summary>
        public static Vector3 V(float x, float z, float height) => new Vector3(x, height + 0.1f, z);
        public static Ramp Rp(float x0, float z0, float x1, float z1, float width, float rise, PropKind kind = PropKind.Stone, float baseY = 0f)
            => new Ramp(x0, z0, x1, z1, width, rise, kind, baseY);
        public static Perch H(float x, float z, float yaw, float height = 0f) => new Perch(new Vector3(x, height + 0.1f, z), yaw);
        public static Prop P(float x, float z, float sx, float sz, float sy, PropKind kind, float baseY = 0f) => new Prop(x, z, sx, sz, sy, kind, baseY);
        public static Decor D(float x, float y, float z, float sx, float sy, float sz, DecorKind kind, bool solid = false)
            => new Decor(new Vector3(x, y, z), new Vector3(sx, sy, sz), kind, solid);
        public static Color C(float r, float g, float b) => new Color(r, g, b);

        /// <summary>
        /// A stone arch over a passage: two pillars, stepped haunches and a lintel, centred on (x, z). The opening is
        /// <paramref name="span"/> wide across the passage; <paramref name="acrossX"/> is true when the span runs along x
        /// (the passage runs north-south). The pillars stand just inside the passage, so they are cover too.
        /// </summary>
        public static IEnumerable<Decor> Arch(float x, float z, float span, bool acrossX, float depth = 1.2f,
            float clear = 3.6f, float top = 5.4f, DecorKind kind = DecorKind.Wall)
        {
            Vector3 At(float across, float y) => acrossX ? new Vector3(x + across, y, z) : new Vector3(x, y, z + across);
            Vector3 Size(float across, float h) => acrossX ? new Vector3(across, h, depth) : new Vector3(depth, h, across);
            float half = span / 2f;
            foreach (var side in new[] { -1f, 1f })
            {
                yield return new Decor(At(side * (half - 0.35f), top / 2f), Size(0.7f, top), kind, true);
                yield return new Decor(At(side * (half - 1.1f), clear - 0.35f), Size(0.8f, 0.7f), kind, true);
            }
            yield return new Decor(At(0f, (clear + top) / 2f), Size(span, top - clear), kind, true);
            yield return new Decor(At(0f, top + 0.12f), Size(span + 0.4f, 0.24f), DecorKind.Stone, false);
        }
    }
}
