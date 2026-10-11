using System;
using UnityEngine;

namespace Arena.Map
{
    [Serializable]
    public class MapPalette
    {
        public Material Ground;
        public Material TunnelFloor;
        public Material[] Walls;
        public Material Roof;
        public Material Wood;
        public Material Metal;
        public Material Stone;
        public Material NeonTrim;
        public Material SiteA;
        public Material SiteB;
        public Material Lane;
    }

    /// <summary>Builds the Dunes map from <see cref="DunesLayout"/> out of simple boxes.</summary>
    public static class MapBuilder
    {
        public static GameObject Build(MapPalette p)
        {
            var root = new GameObject("Map");
            var world = new GameObject("Geometry");
            world.transform.SetParent(root.transform, false);

            float sizeX = DunesLayout.MaxX - DunesLayout.MinX, sizeZ = DunesLayout.MaxZ - DunesLayout.MinZ;
            Box(world, "Ground", new Vector3(0, -0.5f, (DunesLayout.MinZ + DunesLayout.MaxZ) / 2f), new Vector3(sizeX, 1f, sizeZ), p.Ground);

            // Buildings: every solid cell group becomes a block of varied height, some with a neon roof trim.
            int n = 0;
            foreach (var b in DunesLayout.SolidBlocks())
            {
                float x0 = DunesLayout.MinX + b.xMin, z0 = DunesLayout.MinZ + b.yMin;
                float h = 5f + Hash(b.xMin, b.yMin) * 4.5f;
                var center = new Vector3(x0 + b.width / 2f, h / 2f, z0 + b.height / 2f);
                var size = new Vector3(b.width, h, b.height);
                var mat = p.Walls[(n++) % p.Walls.Length];
                Box(world, $"Block {n}", center, size, mat);
                if (Hash(b.yMin, b.xMin) > 0.45f)
                    Box(world, $"Trim {n}", new Vector3(center.x, h + 0.06f, center.z), new Vector3(b.width + 0.08f, 0.12f, b.height + 0.08f), p.NeonTrim, collider: false);
            }

            foreach (var d in DunesLayout.Blockers)
            {
                var c = new Vector3((d.x + d.z) / 2f, 2.25f, (d.y + d.w) / 2f);
                Box(world, "Door frame", c, new Vector3(d.z - d.x, 4.5f, d.w - d.y), p.Walls[0]);
                Box(world, "Door trim", new Vector3(c.x, 4.56f, c.z), new Vector3(d.z - d.x + 0.06f, 0.12f, d.w - d.y + 0.06f), p.NeonTrim, collider: false);
            }

            foreach (var r in DunesLayout.Roofs)
            {
                Box(world, "Tunnel roof", new Vector3(r.center.x, 4.7f, r.center.y), new Vector3(r.width, 1f, r.height), p.Roof);
                Box(world, "Tunnel floor", new Vector3(r.center.x, 0.01f, r.center.y), new Vector3(r.width, 0.02f, r.height), p.TunnelFloor, collider: false);
            }

            foreach (var prop in DunesLayout.Props)
            {
                var mat = prop.Kind == DunesLayout.PropKind.Wood ? p.Wood : prop.Kind == DunesLayout.PropKind.Metal ? p.Metal : p.Stone;
                Box(world, $"Crate ({prop.Kind})", prop.Center + Vector3.up * (prop.Size.y / 2f), prop.Size, mat);
            }

            // Glowing lane lines along the main routes.
            Box(world, "Lane mid", new Vector3(0, 0.015f, -3), new Vector3(0.25f, 0.03f, 64), p.Lane, collider: false);
            Box(world, "Lane long", new Vector3(39, 0.015f, -6), new Vector3(0.25f, 0.03f, 54), p.Lane, collider: false);
            Box(world, "Lane tunnels", new Vector3(-39, 0.025f, -14), new Vector3(0.25f, 0.03f, 38), p.Lane, collider: false);

            foreach (var site in DunesLayout.Sites)
            {
                var mat = site.letter == "A" ? p.SiteA : p.SiteB;
                var c = new Vector3(site.center.x, 0.02f, site.center.y);
                Box(world, $"Site {site.letter} plate", c, new Vector3(site.size, 0.04f, site.size), mat, collider: false);
                Box(world, $"Site {site.letter} core", c + Vector3.up * 0.01f, new Vector3(site.size - 1.2f, 0.05f, site.size - 1.2f), p.Ground, collider: false);
                Letter(root, site.letter, new Vector3(site.center.x, 7.5f, site.center.y), mat);
            }

            return root;
        }

        static GameObject Box(GameObject parent, string name, Vector3 center, Vector3 size, Material mat, bool collider = true)
        {
            var go = GameObject.CreatePrimitive(PrimitiveType.Cube);
            go.name = name;
            go.transform.SetParent(parent.transform, false);
            go.transform.localPosition = center;
            go.transform.localScale = size;
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            if (!collider) UnityEngine.Object.DestroyImmediate(go.GetComponent<Collider>());
            return go;
        }

        static void Letter(GameObject parent, string letter, Vector3 position, Material mat)
        {
            var go = new GameObject($"Site {letter} sign");
            go.transform.SetParent(parent.transform, false);
            go.transform.localPosition = position;
            var text = go.AddComponent<TextMesh>();
            text.text = letter;
            text.characterSize = 0.5f;
            text.fontSize = 96;
            text.anchor = TextAnchor.MiddleCenter;
            text.alignment = TextAlignment.Center;
            text.color = mat.GetColor("_EmissionColor");
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            text.font = font;
            go.GetComponent<MeshRenderer>().sharedMaterial = font.material;
            go.AddComponent<Billboard>();
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
