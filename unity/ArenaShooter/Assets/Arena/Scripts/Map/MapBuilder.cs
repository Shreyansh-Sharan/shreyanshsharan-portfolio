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
    }

    /// <summary>Builds a <see cref="MapDefinition"/> out of textured boxes, plus the branded gantry.</summary>
    public static class MapBuilder
    {
        // Metres per texture repeat. Zero fits one texture per face.
        const float GroundTile = 4f, WallTile = 3f, FloorTile = 3f, RoofTile = 4f, StoneTile = 2f;
        const float ContainerTile = 2.6f, AccentTile = 2f, CrateTile = 0f;

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
                switch (prop.Kind)
                {
                    case PropKind.Wood: mat = p.Wood; tile = CrateTile; break;
                    case PropKind.Metal: mat = p.Metal; tile = CrateTile; break;
                    case PropKind.Container: mat = p.Walls[containers++ % 2 == 0 ? 0 : p.Walls.Length - 1]; tile = ContainerTile; break;
                    default: mat = p.Stone; tile = StoneTile; break;
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
                    _ => (p.Water, 8f),
                };
                Box(world, $"Decor ({d.Kind})", d.Center, d.Size, mat, tile, collider: d.Solid);
            }

            foreach (var lane in def.Lanes)
                Box(world, "Lane", new Vector3(lane.center.x, 0.015f, lane.center.y), new Vector3(lane.width, 0.03f, lane.height), p.Lane, 0f, collider: false);

            foreach (var site in def.Sites)
            {
                var mat = site.Letter == "A" ? p.SiteA : p.SiteB;
                var c = new Vector3(site.Center.x, 0.02f, site.Center.y);
                Box(world, $"Site {site.Letter} plate", c, new Vector3(site.Size, 0.04f, site.Size), mat, 0f, collider: false);
                Box(world, $"Site {site.Letter} core", c + Vector3.up * 0.01f, new Vector3(site.Size - 1.2f, 0.05f, site.Size - 1.2f), p.Accent, AccentTile, collider: false);
                var sign = Label(root, $"Site {site.Letter} sign", site.Letter, new Vector3(site.Center.x, 7.5f, site.Center.y), 96, 0.5f, mat.GetColor("_EmissionColor"));
                sign.AddComponent<Billboard>();
            }

            BuildBrand(root, def, p);
            BuildPerimeter(world, def);
            return root;
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
