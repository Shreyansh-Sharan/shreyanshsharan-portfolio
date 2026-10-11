using System.Collections.Generic;
using UnityEngine;

namespace Arena.Map
{
    /// <summary>
    /// Box meshes with world-scaled UVs, so textures keep one density on every wall instead of stretching
    /// with the box. Side faces run u along the ground and v up; top and bottom map x/z. A tile size of
    /// zero fits the texture once per face (crates). Meshes are shared per size.
    /// </summary>
    public static class BoxMesh
    {
        static readonly Dictionary<(int, int, int, int), Mesh> Cache = new Dictionary<(int, int, int, int), Mesh>();

        public static void ClearCache()
        {
            Cache.Clear();
            WedgeCache.Clear();
        }

        public static Mesh Get(Vector3 size, float tile)
        {
            var key = (Mathf.RoundToInt(size.x * 100), Mathf.RoundToInt(size.y * 100), Mathf.RoundToInt(size.z * 100), Mathf.RoundToInt(tile * 100));
            if (Cache.TryGetValue(key, out var mesh) && mesh) return mesh;
            mesh = Build(size, tile);
            Cache[key] = mesh;
            return mesh;
        }

        static readonly (Vector3 n, Vector3 u, Vector3 v)[] Faces =
        {
            (Vector3.right, Vector3.forward, Vector3.up),
            (Vector3.left, Vector3.back, Vector3.up),
            (Vector3.forward, Vector3.left, Vector3.up),
            (Vector3.back, Vector3.right, Vector3.up),
            (Vector3.up, Vector3.right, Vector3.forward),
            (Vector3.down, Vector3.right, Vector3.back),
        };

        static Mesh Build(Vector3 size, float tile)
        {
            var verts = new List<Vector3>(24);
            var normals = new List<Vector3>(24);
            var uvs = new List<Vector2>(24);
            var tris = new List<int>(36);
            var half = size * 0.5f;
            foreach (var (n, u, v) in Faces)
            {
                float hn = Mathf.Abs(Vector3.Dot(half, n));
                float hu = Mathf.Abs(Vector3.Dot(half, u));
                float hv = Mathf.Abs(Vector3.Dot(half, v));
                float su = tile > 0f ? 2f * hu / tile : 1f;
                float sv = tile > 0f ? 2f * hv / tile : 1f;
                int start = verts.Count;
                for (int i = 0; i < 4; i++)
                {
                    float a = i == 1 || i == 2 ? 1f : 0f, b = i >= 2 ? 1f : 0f;
                    verts.Add(n * hn + u * Mathf.Lerp(-hu, hu, a) + v * Mathf.Lerp(-hv, hv, b));
                    normals.Add(n);
                    uvs.Add(new Vector2(a * su, b * sv));
                }
                // Unity's front faces wind clockwise: cross(b - a, c - a) points out of the face.
                bool flip = Vector3.Dot(Vector3.Cross(verts[start + 1] - verts[start], verts[start + 2] - verts[start]), n) < 0f;
                if (flip) tris.AddRange(new[] { start, start + 2, start + 1, start, start + 3, start + 2 });
                else tris.AddRange(new[] { start, start + 1, start + 2, start, start + 2, start + 3 });
            }
            var mesh = new Mesh { name = $"Box {size.x:0.##}x{size.y:0.##}x{size.z:0.##} t{tile:0.#}" };
            mesh.SetVertices(verts);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            return mesh;
        }

        static readonly Dictionary<(int, int, int, int), Mesh> WedgeCache = new Dictionary<(int, int, int, int), Mesh>();

        /// <summary>
        /// A wedge (ramp, or half a gable roof): <paramref name="size"/>.x wide, rising from 0 at z = 0 to size.y at
        /// z = size.z, with a flat bottom at y = 0. The pivot is the middle of the low edge. UVs are world-scaled like boxes.
        /// </summary>
        public static Mesh Wedge(Vector3 size, float tile)
        {
            var key = (Mathf.RoundToInt(size.x * 100), Mathf.RoundToInt(size.y * 100), Mathf.RoundToInt(size.z * 100), Mathf.RoundToInt(tile * 100));
            if (WedgeCache.TryGetValue(key, out var cached) && cached) return cached;

            float hx = size.x / 2f, h = size.y, l = size.z;
            var verts = new List<Vector3>(18);
            var normals = new List<Vector3>(18);
            var uvs = new List<Vector2>(18);
            var tris = new List<int>(24);
            float U(float metres) => tile > 0f ? metres / tile : metres / Mathf.Max(0.01f, Mathf.Max(size.x, Mathf.Max(h, l)));

            void Face(Vector3[] p, Vector2[] uv)
            {
                var n = Vector3.Cross(p[1] - p[0], p[2] - p[0]).normalized;
                // Faces point away from the wedge's centre. As for boxes, triangle (p0, p1, p2) faces along cross(p1 - p0, p2 - p0).
                var centre = new Vector3(0f, h / 3f, l * 2f / 3f);
                var mid = Vector3.zero;
                foreach (var v in p) mid += v;
                mid /= p.Length;
                bool outward = Vector3.Dot(n, mid - centre) > 0f;
                if (!outward) n = -n;
                int start = verts.Count;
                for (int i = 0; i < p.Length; i++)
                {
                    verts.Add(p[i]);
                    normals.Add(n);
                    uvs.Add(uv[i]);
                }
                for (int i = 1; i + 1 < p.Length; i++)
                {
                    if (outward) tris.AddRange(new[] { start, start + i, start + i + 1 });
                    else tris.AddRange(new[] { start, start + i + 1, start + i });
                }
            }

            float slope = Mathf.Sqrt(l * l + h * h);
            Vector3 a = new Vector3(-hx, 0, 0), b = new Vector3(hx, 0, 0), c = new Vector3(hx, h, l), d = new Vector3(-hx, h, l);
            Vector3 e = new Vector3(-hx, 0, l), f = new Vector3(hx, 0, l);
            Face(new[] { a, b, c, d }, new[] { new Vector2(0, 0), new Vector2(U(size.x), 0), new Vector2(U(size.x), U(slope)), new Vector2(0, U(slope)) });
            Face(new[] { e, f, c, d }, new[] { new Vector2(0, 0), new Vector2(U(size.x), 0), new Vector2(U(size.x), U(h)), new Vector2(0, U(h)) });
            Face(new[] { a, b, f, e }, new[] { new Vector2(0, 0), new Vector2(U(size.x), 0), new Vector2(U(size.x), U(l)), new Vector2(0, U(l)) });
            Face(new[] { a, e, d }, new[] { new Vector2(0, 0), new Vector2(U(l), 0), new Vector2(U(l), U(h)) });
            Face(new[] { b, f, c }, new[] { new Vector2(0, 0), new Vector2(U(l), 0), new Vector2(U(l), U(h)) });

            var mesh = new Mesh { name = $"Wedge {size.x:0.##}x{size.y:0.##}x{size.z:0.##} t{tile:0.#}" };
            mesh.SetVertices(verts);
            mesh.SetNormals(normals);
            mesh.SetUVs(0, uvs);
            mesh.SetTriangles(tris, 0);
            mesh.RecalculateBounds();
            mesh.RecalculateTangents();
            WedgeCache[key] = mesh;
            return mesh;
        }
    }
}
