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

        public static void ClearCache() => Cache.Clear();

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
    }
}
