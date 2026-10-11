using System;
using UnityEngine;

namespace Arena.Map
{
    [Serializable]
    public class MapPalette
    {
        public Material Ground;
        public Material Floor;
        public Material[] Walls;
        public Material Roof;
        public Material Wood;
        public Material Metal;
        public Material Stone;
        public Material Accent;
        public Material NeonTrim;
        public Material NeonAlt;
        public Material Glow;
        public Material SiteA;
        public Material SiteB;
        public Material Lane;
        public Material Water;
        public Material Board;
        public Material Cloth;
        public Material Foliage;
        public Material Window;
    }

    /// <summary>Builds a <see cref="MapDefinition"/> out of textured boxes, plus the branded gantry.</summary>
    public static class MapBuilder
    {
        // Metres per texture repeat. Zero fits one texture per face.
        const float GroundTile = 4f, WallTile = 3f, FloorTile = 3f, RoofTile = 4f, StoneTile = 2f;
        const float ContainerTile = 2.6f, AccentTile = 2f, CrateTile = 0f, ClothTile = 3f;
        /// <summary>Unity's built-in "Ignore Raycast" layer (index 2; Physics.IgnoreRaycastLayer is its mask).</summary>
        public const int IgnoreRaycastLayer = 2;

        public static GameObject Build(MapDefinition def, MapPalette p)
        {
            var root = new GameObject($"Map {def.Name}");
            root.transform.position = def.Origin;
            var world = new GameObject("Geometry");
            world.transform.SetParent(root.transform, false);

            float sizeX = def.MaxX - def.MinX, sizeZ = def.MaxZ - def.MinZ;
            var mid = new Vector3((def.MinX + def.MaxX) / 2f, 0f, (def.MinZ + def.MaxZ) / 2f);
            Box(world, "Ground", mid + Vector3.down * 0.5f, new Vector3(sizeX, 1f, sizeZ), p.Ground, GroundTile);

            // Buildings: every solid cell group becomes a block of varied height, some with a neon roof trim.
            int n = 0;
            foreach (var b in def.SolidBlocks())
            {
                float x0 = def.MinX + b.xMin, z0 = def.MinZ + b.yMin;
                float h = def.WallHeight.x + Hash(b.xMin, b.yMin) * (def.WallHeight.y - def.WallHeight.x);
                var center = new Vector3(x0 + b.width / 2f, h / 2f, z0 + b.height / 2f);
                var size = new Vector3(b.width, h, b.height);
                int wall = n++ % p.Walls.Length;
                Box(world, $"Block {n}", center, size, p.Walls[wall], WallTile);
                if (Hash(b.yMin, b.xMin) > 1f - def.TrimChance)
                    Box(world, $"Trim {n}", new Vector3(center.x, h + 0.06f, center.z), new Vector3(b.width + 0.08f, 0.12f, b.height + 0.08f),
                        Hash(b.xMin + 7, b.yMin) > 0.7f ? p.NeonAlt : p.NeonTrim, 0f, collider: false);
                BuildRoof(world, def, p, b, x0, z0, h, wall);
                BuildWindows(world, def, p, b, x0, z0, h);
            }

            foreach (var w in def.Water)
            {
                Box(world, "Water", new Vector3(w.center.x, 0.04f, w.center.y), new Vector3(w.width, 0.04f, w.height), p.Water, 8f, collider: false);
                // An invisible wall over the water on the Ignore Raycast layer: it stops bodies and the NavMesh,
                // while shots and bot sight lines (which skip that layer) fly straight over.
                var barrier = new GameObject("Water barrier") { layer = IgnoreRaycastLayer };
                barrier.transform.SetParent(world.transform, false);
                barrier.transform.localPosition = new Vector3(w.center.x, 15f, w.center.y);
                barrier.AddComponent<BoxCollider>().size = new Vector3(w.width, 30f, w.height);
            }

            foreach (var r in def.Ramps)
            {
                var dir = r.Top - r.Bottom;
                var go = new GameObject($"Ramp ({r.Kind})");
                go.transform.SetParent(world.transform, false);
                go.transform.localPosition = new Vector3(r.Bottom.x, r.BaseY, r.Bottom.y);
                go.transform.localRotation = Quaternion.LookRotation(new Vector3(dir.x, 0f, dir.y));
                var (mat, tile) = PropMaterial(p, r.Kind);
                var mesh = BoxMesh.Wedge(new Vector3(r.Width, r.Rise, dir.magnitude), tile > 0f ? tile : StoneTile);
                go.AddComponent<MeshFilter>().sharedMesh = mesh;
                go.AddComponent<MeshRenderer>().sharedMaterial = mat;
                go.AddComponent<MeshCollider>().sharedMesh = mesh;
            }

            foreach (var d in def.Blockers)
            {
                var c = new Vector3((d.x + d.z) / 2f, 2.25f, (d.y + d.w) / 2f);
                Box(world, "Door frame", c, new Vector3(d.z - d.x, 4.5f, d.w - d.y), p.Walls[0], WallTile);
                Box(world, "Door trim", new Vector3(c.x, 4.56f, c.z), new Vector3(d.z - d.x + 0.06f, 0.12f, d.w - d.y + 0.06f), p.NeonTrim, 0f, collider: false);
            }

            foreach (var r in def.Roofs)
            {
                Box(world, "Roof", new Vector3(r.center.x, 4.7f, r.center.y), new Vector3(r.width, 1f, r.height), p.Roof, RoofTile);
                Box(world, "Covered floor", new Vector3(r.center.x, 0.01f, r.center.y), new Vector3(r.width, 0.02f, r.height), p.Floor, FloorTile, collider: false);
            }

            int containers = 0;
            foreach (var prop in def.Props)
            {
                Material mat;
                float tile;
                if (prop.Kind == PropKind.Container)
                {
                    mat = p.Walls[containers++ % 2 == 0 ? 0 : p.Walls.Length - 1];
                    tile = ContainerTile;
                }
                else
                {
                    (mat, tile) = PropMaterial(p, prop.Kind);
                    // Big wooden or metal props are decks (bridges, stages): tile them instead of fitting one crate face.
                    if (prop.Kind != PropKind.Stone && Mathf.Max(prop.Size.x, prop.Size.z) > 4f) tile = FloorTile;
                }
                Box(world, $"Prop ({prop.Kind})", prop.Center + Vector3.up * (prop.Size.y / 2f), prop.Size, mat, tile);
            }

            foreach (var d in def.Decor)
            {
                var (mat, tile) = d.Kind switch
                {
                    DecorKind.Wall => (p.Walls[0], WallTile),
                    DecorKind.Metal => (p.Metal, StoneTile),
                    DecorKind.Wood => (p.Wood, CrateTile),
                    DecorKind.Roof => (p.Roof, RoofTile),
                    DecorKind.Accent => (p.Accent, AccentTile),
                    DecorKind.Neon => (p.NeonTrim, 0f),
                    DecorKind.Glow => (p.Glow, 0f),
                    DecorKind.Stone => (p.Stone, StoneTile),
                    DecorKind.Cloth => (p.Cloth, ClothTile),
                    DecorKind.Foliage => (p.Foliage, 0f),
                    DecorKind.Window => (p.Window, 0f),
                    _ => (p.Water, 8f),
                };
                Box(world, $"Decor ({d.Kind})", d.Center, d.Size, mat, tile, collider: d.Solid);
            }

            foreach (var dome in def.Domes)
                Dome(world, p, p.Walls[0], new Vector3(dome.x, dome.y, dome.z), dome.w);

            foreach (var lane in def.Lanes)
                Box(world, "Lane", new Vector3(lane.center.x, 0.015f, lane.center.y), new Vector3(lane.width, 0.03f, lane.height), p.Lane, 0f, collider: false);

            foreach (var site in def.Sites)
            {
                var mat = site.Letter == "A" ? p.SiteA : p.SiteB;
                var c = new Vector3(site.Center.x, site.BaseY + 0.02f, site.Center.y);
                Box(world, $"Site {site.Letter} plate", c, new Vector3(site.Size, 0.04f, site.Size), mat, 0f, collider: false);
                Box(world, $"Site {site.Letter} core", c + Vector3.up * 0.01f, new Vector3(site.Size - 1.2f, 0.05f, site.Size - 1.2f), p.Accent, AccentTile, collider: false);
                var sign = Label(root, $"Site {site.Letter} sign", site.Letter, new Vector3(site.Center.x, site.BaseY + 7.5f, site.Center.y), 96, 0.5f, mat.GetColor("_EmissionColor"));
                sign.AddComponent<Billboard>();
            }

            BuildBrand(root, def, p);
            BuildPerimeter(world, def);
            return root;
        }

        static (Material, float) PropMaterial(MapPalette p, PropKind kind) => kind switch
        {
            PropKind.Wood => (p.Wood, CrateTile),
            PropKind.Metal => (p.Metal, CrateTile),
            PropKind.Container => (p.Walls[0], ContainerTile),
            _ => (p.Stone, StoneTile),
        };

        /// <summary>Finishes a building's top: pitched tile roofs (two wedges meeting at a ridge) or a parapet rim, maybe with a dome.</summary>
        static void BuildRoof(GameObject parent, MapDefinition def, MapPalette p, RectInt b, float x0, float z0, float h, int wall)
        {
            float w = b.width, d = b.height, cx = x0 + w / 2f, cz = z0 + d / 2f;
            switch (def.RoofStyle)
            {
                case RoofStyle.Gable:
                {
                    const float eave = 0.35f;
                    bool ridgeAlongX = w >= d;
                    float run = (ridgeAlongX ? d : w) / 2f, length = (ridgeAlongX ? w : d) + eave * 2f;
                    float rise = Mathf.Min(2.6f, run * 0.6f);
                    var mesh = BoxMesh.Wedge(new Vector3(length, rise, run + eave), RoofTile);
                    foreach (var side in new[] { -1f, 1f })
                    {
                        var go = new GameObject("Tile roof");
                        go.transform.SetParent(parent.transform, false);
                        // Each half starts at the eave (just past the wall) and climbs to the ridge over the centre line.
                        go.transform.localPosition = ridgeAlongX
                            ? new Vector3(cx, h - 0.05f, cz + side * (run + eave))
                            : new Vector3(cx + side * (run + eave), h - 0.05f, cz);
                        float yaw = ridgeAlongX ? (side < 0f ? 0f : 180f) : (side < 0f ? 90f : -90f);
                        go.transform.localRotation = Quaternion.Euler(0f, yaw, 0f);
                        go.AddComponent<MeshFilter>().sharedMesh = mesh;
                        go.AddComponent<MeshRenderer>().sharedMaterial = p.Roof;
                    }
                    break;
                }
                case RoofStyle.Parapet:
                {
                    const float t = 0.35f, ph = 0.8f;
                    var mat = p.Walls[wall];
                    Box(parent, "Parapet", new Vector3(cx, h + ph / 2f, z0 + t / 2f), new Vector3(w, ph, t), mat, WallTile, collider: false);
                    Box(parent, "Parapet", new Vector3(cx, h + ph / 2f, z0 + d - t / 2f), new Vector3(w, ph, t), mat, WallTile, collider: false);
                    Box(parent, "Parapet", new Vector3(x0 + t / 2f, h + ph / 2f, cz), new Vector3(t, ph, Mathf.Max(0.1f, d - 2f * t)), mat, WallTile, collider: false);
                    Box(parent, "Parapet", new Vector3(x0 + w - t / 2f, h + ph / 2f, cz), new Vector3(t, ph, Mathf.Max(0.1f, d - 2f * t)), mat, WallTile, collider: false);
                    float small = Mathf.Min(w, d);
                    if (small >= 7f && Hash(b.xMin + 3, b.yMin + 11) < def.DomeChance)
                        Dome(parent, p, mat, new Vector3(cx, h, cz), Mathf.Min(small * 0.62f, 11f));
                    break;
                }
            }
        }

        /// <summary>A tiled dome on a short drum, with a glowing finial. <paramref name="baseCenter"/> is the roof point it sits on.</summary>
        static void Dome(GameObject parent, MapPalette p, Material drum, Vector3 baseCenter, float diameter)
        {
            Box(parent, "Dome drum", baseCenter + Vector3.up * 0.6f, new Vector3(diameter * 0.8f, 1.2f, diameter * 0.8f), drum, WallTile, collider: false);
            var sphere = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            sphere.name = "Dome";
            UnityEngine.Object.DestroyImmediate(sphere.GetComponent<Collider>());
            sphere.transform.SetParent(parent.transform, false);
            sphere.transform.localPosition = baseCenter + Vector3.up * 1.2f;
            sphere.transform.localScale = new Vector3(diameter * 0.82f, diameter * 0.7f, diameter * 0.82f);
            sphere.GetComponent<MeshRenderer>().sharedMaterial = p.Accent;
            Box(parent, "Dome finial", baseCenter + Vector3.up * (1.2f + diameter * 0.35f + 0.5f), new Vector3(0.25f, 1f, 0.25f), p.NeonAlt, 0f, collider: false);
        }

        /// <summary>Windows with sills on building faces that look onto open ground, a floor apart on tall blocks.</summary>
        static void BuildWindows(GameObject parent, MapDefinition def, MapPalette p, RectInt b, float x0, float z0, float h)
        {
            if (def.WindowChance <= 0f || h < 4.6f) return;
            const float spacing = 3.4f;
            float x1 = x0 + b.width, z1 = z0 + b.height;
            var faces = new[]
            {
                (new Vector2(x0, z0), Vector2.right, Vector2.down, (float)b.width),
                (new Vector2(x0, z1), Vector2.right, Vector2.up, (float)b.width),
                (new Vector2(x0, z0), Vector2.up, Vector2.left, (float)b.height),
                (new Vector2(x1, z0), Vector2.up, Vector2.right, (float)b.height),
            };
            foreach (var (start, along, normal, length) in faces)
            {
                int count = Mathf.FloorToInt(length / spacing);
                float pad = (length - count * spacing) / 2f + spacing / 2f;
                for (int i = 0; i < count; i++)
                {
                    var pt = start + along * (pad + i * spacing);
                    var outside = pt + normal * 0.6f;
                    if (!def.IsWalkable(outside.x, outside.y)) continue;
                    if (Hash(Mathf.RoundToInt(pt.x * 3f) + 101, Mathf.RoundToInt(pt.y * 3f) + 57) > def.WindowChance) continue;
                    bool alongX = along.x != 0f;
                    for (float y = 3.4f; y + 1.2f < h; y += 3.3f)
                    {
                        var c = new Vector3(pt.x + normal.x * 0.05f, y, pt.y + normal.y * 0.05f);
                        Box(parent, "Window", c, alongX ? new Vector3(1.1f, 1.5f, 0.1f) : new Vector3(0.1f, 1.5f, 1.1f), p.Window, 0f, collider: false);
                        var sill = new Vector3(pt.x + normal.x * 0.12f, y - 0.82f, pt.y + normal.y * 0.12f);
                        Box(parent, "Sill", sill, alongX ? new Vector3(1.45f, 0.14f, 0.26f) : new Vector3(0.26f, 0.14f, 1.45f), p.Stone, 0f, collider: false);
                    }
                }
            }
        }

        /// <summary>
        /// The teaser set piece: a gantry spanning a main lane with a backlit board, an emissive frame,
        /// a neon "SHREYANSH SHARAN" sign and an "SS" logo diamond, readable from both sides.
        /// </summary>
        static void BuildBrand(GameObject root, MapDefinition def, MapPalette p)
        {
            var brand = new GameObject("Brand: Shreyansh Sharan");
            brand.transform.SetParent(root.transform, false);
            brand.transform.localPosition = def.BrandPosition;
            brand.transform.localRotation = Quaternion.Euler(0f, def.BrandYaw, 0f);

            const float width = 30f, height = 7f, pillarX = 15.5f;
            float baseY = def.BrandHeight, cy = baseY + height / 2f;

            foreach (var side in new[] { -1f, 1f })
            {
                Box(brand, "Pillar", new Vector3(side * pillarX, (baseY + height) / 2f, 0f), new Vector3(1f, baseY + height, 1f), p.Metal, StoneTile);
                Box(brand, "Pillar light", new Vector3(side * pillarX, baseY + height + 0.2f, 0f), new Vector3(1.2f, 0.4f, 1.2f), p.NeonAlt, 0f, collider: false);
            }
            Box(brand, "Board", new Vector3(0f, cy, 0f), new Vector3(width, height, 0.5f), p.Board, 0f, collider: false);
            Box(brand, "Frame top", new Vector3(0f, baseY + height, 0f), new Vector3(width + 0.4f, 0.25f, 0.7f), p.NeonTrim, 0f, collider: false);
            Box(brand, "Frame bottom", new Vector3(0f, baseY, 0f), new Vector3(width + 0.4f, 0.25f, 0.7f), p.NeonTrim, 0f, collider: false);
            Box(brand, "Frame left", new Vector3(-width / 2f, cy, 0f), new Vector3(0.25f, height, 0.7f), p.NeonTrim, 0f, collider: false);
            Box(brand, "Frame right", new Vector3(width / 2f, cy, 0f), new Vector3(0.25f, height, 0.7f), p.NeonTrim, 0f, collider: false);
            Box(brand, "Divider", new Vector3(-7.5f, cy, 0f), new Vector3(0.18f, height - 1.2f, 0.65f), p.NeonAlt, 0f, collider: false);

            // Logo: "SS" inside a neon diamond, on the left third of the board.
            var logoCenter = new Vector3(-11.3f, cy, 0f);
            for (int i = 0; i < 4; i++)
            {
                var edge = Box(brand, "Logo edge", Vector3.zero, new Vector3(5f, 0.22f, 0.66f), p.NeonAlt, 0f, collider: false);
                float a = 45f + 90f * i;
                var dir = Quaternion.Euler(0f, 0f, a) * Vector3.up;
                edge.transform.localPosition = logoCenter + dir * 2.4f;
                edge.transform.localRotation = Quaternion.Euler(0f, 0f, a);
            }

            var look = def.Look;
            foreach (var face in new[] { -1f, 1f })
            {
                // TextMesh reads correctly from its -Z side, so the back copy is turned around.
                var rot = face < 0f ? Quaternion.identity : Quaternion.Euler(0f, 180f, 0f);
                var z = face * 0.32f;
                Brand(brand, "SS logo", "SS", new Vector3(logoCenter.x, cy + 0.05f, z), rot, 120, 0.21f, look.NeonAlt, FontStyle.Bold);
                Brand(brand, "Name", "SHREYANSH SHARAN", new Vector3(3.6f, cy + 0.7f, z), rot, 120, 0.135f, look.Neon, FontStyle.Bold);
                Brand(brand, "Tagline", $"PORTFOLIO ARENA  ·  {def.Name.ToUpperInvariant()}", new Vector3(3.6f, cy - 1.75f, z), rot, 80, 0.07f, Color.white, FontStyle.Normal);
            }
        }

        static void Brand(GameObject parent, string name, string text, Vector3 pos, Quaternion rot, int fontSize, float charSize, Color color, FontStyle style)
        {
            var go = Label(parent, name, text, pos, fontSize, charSize, color, style);
            go.transform.localRotation = rot;
            go.AddComponent<NeonText>().Color = color;
        }

        /// <summary>Invisible walls around the bounds, so open edges (quays) can't be walked off.</summary>
        static void BuildPerimeter(GameObject parent, MapDefinition def)
        {
            const float h = 40f, t = 2f;
            float sx = def.MaxX - def.MinX, sz = def.MaxZ - def.MinZ;
            float cx = (def.MinX + def.MaxX) / 2f, cz = (def.MinZ + def.MaxZ) / 2f;
            Wall(parent, new Vector3(cx, h / 2f, def.MaxZ + t / 2f), new Vector3(sx + 2 * t, h, t));
            Wall(parent, new Vector3(cx, h / 2f, def.MinZ - t / 2f), new Vector3(sx + 2 * t, h, t));
            Wall(parent, new Vector3(def.MaxX + t / 2f, h / 2f, cz), new Vector3(t, h, sz));
            Wall(parent, new Vector3(def.MinX - t / 2f, h / 2f, cz), new Vector3(t, h, sz));
        }

        static void Wall(GameObject parent, Vector3 center, Vector3 size)
        {
            var go = new GameObject("Boundary");
            go.transform.SetParent(parent.transform, false);
            go.transform.localPosition = center;
            go.AddComponent<BoxCollider>().size = size;
        }

        static GameObject Box(GameObject parent, string name, Vector3 center, Vector3 size, Material mat, float tile, bool collider = true)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            go.transform.localPosition = center;
            go.AddComponent<MeshFilter>().sharedMesh = BoxMesh.Get(size, tile);
            go.AddComponent<MeshRenderer>().sharedMaterial = mat;
            if (collider) go.AddComponent<BoxCollider>().size = size;
            return go;
        }

        static GameObject Label(GameObject parent, string name, string value, Vector3 position, int fontSize, float charSize, Color color, FontStyle style = FontStyle.Normal)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent.transform, false);
            go.transform.localPosition = position;
            var text = go.AddComponent<TextMesh>();
            text.text = value;
            text.characterSize = charSize;
            text.fontSize = fontSize;
            text.fontStyle = style;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = color;
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.font = font;
            go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            return go;
        }

        static float Hash(int a, int b)
        {
            unchecked
            {
                uint h = (uint)(a * 374761393 + b * 668265263);
                h = (h ^ (h >> 13)) * 1274126177;
                return (h & 0xFFFF) / 65535f;
            }
        }
    }
}
