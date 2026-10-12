using System.Collections.Generic;
using UnityEngine;

namespace Cricket.View
{
    /// <summary>Procedural meshes: the bat, the ground, oval rings and ropes, stepped stands, boxes and the crowd figure.</summary>
    public static class MeshKit
    {
        class Builder
        {
            public readonly List<Vector3> V = new List<Vector3>();
            public readonly List<Vector3> N = new List<Vector3>();
            public readonly List<Vector2> U = new List<Vector2>();
            public readonly List<int> T = new List<int>();

            public void Quad(Vector3 a, Vector3 b, Vector3 c, Vector3 d, Vector2 ua, Vector2 ub, Vector2 uc, Vector2 ud)
            {
                int i = V.Count;
                var n = Vector3.Cross(b - a, d - a).normalized;
                V.Add(a); V.Add(b); V.Add(c); V.Add(d);
                N.Add(n); N.Add(n); N.Add(n); N.Add(n);
                U.Add(ua); U.Add(ub); U.Add(uc); U.Add(ud);
                // Front face is the side cross(b - a, d - a) points to (Unity: clockwise seen from the front).
                T.Add(i); T.Add(i + 1); T.Add(i + 3);
                T.Add(i + 1); T.Add(i + 2); T.Add(i + 3);
            }

            public void Box(Vector3 c, Vector3 size, float uvScale = 1f)
            {
                var h = size * 0.5f;
                Vector3 p(float x, float y, float z) => c + new Vector3(h.x * x, h.y * y, h.z * z);
                // +z, -z, +x, -x, +y, -y faces (counter-clockwise when viewed from outside for Unity's winding via Quad).
                Quad(p(-1, -1, 1), p(1, -1, 1), p(1, 1, 1), p(-1, 1, 1), new Vector2(0, 0), new Vector2(size.x * uvScale, 0), new Vector2(size.x * uvScale, size.y * uvScale), new Vector2(0, size.y * uvScale));
                Quad(p(1, -1, -1), p(-1, -1, -1), p(-1, 1, -1), p(1, 1, -1), new Vector2(0, 0), new Vector2(size.x * uvScale, 0), new Vector2(size.x * uvScale, size.y * uvScale), new Vector2(0, size.y * uvScale));
                Quad(p(1, -1, 1), p(1, -1, -1), p(1, 1, -1), p(1, 1, 1), new Vector2(0, 0), new Vector2(size.z * uvScale, 0), new Vector2(size.z * uvScale, size.y * uvScale), new Vector2(0, size.y * uvScale));
                Quad(p(-1, -1, -1), p(-1, -1, 1), p(-1, 1, 1), p(-1, 1, -1), new Vector2(0, 0), new Vector2(size.z * uvScale, 0), new Vector2(size.z * uvScale, size.y * uvScale), new Vector2(0, size.y * uvScale));
                Quad(p(-1, 1, 1), p(1, 1, 1), p(1, 1, -1), p(-1, 1, -1), new Vector2(0, 0), new Vector2(size.x * uvScale, 0), new Vector2(size.x * uvScale, size.z * uvScale), new Vector2(0, size.z * uvScale));
                Quad(p(-1, -1, -1), p(1, -1, -1), p(1, -1, 1), p(-1, -1, 1), new Vector2(0, 0), new Vector2(size.x * uvScale, 0), new Vector2(size.x * uvScale, size.z * uvScale), new Vector2(0, size.z * uvScale));
            }

            public Mesh Build(string name)
            {
                var m = new Mesh { name = name };
                if (V.Count > 65000) m.indexFormat = UnityEngine.Rendering.IndexFormat.UInt32;
                m.SetVertices(V);
                m.SetNormals(N);
                m.SetUVs(0, U);
                m.SetTriangles(T, 0);
                m.RecalculateBounds();
                return m;
            }
        }

        /// <summary>
        /// The bat: origin at the grip, +Y runs down the blade to the toe, +Z out of the face. Full length 0.965 m,
        /// blade 108 mm wide with a ridged back.
        /// </summary>
        public static Mesh Bat()
        {
            var b = new Builder();
            // Handle (an 8-sided tube) from y = -0.16 (top) to y = 0.15 (shoulders).
            const int sides = 8;
            float r = 0.017f, y0 = -0.16f, y1 = 0.16f;
            for (int i = 0; i < sides; i++)
            {
                float a0 = i * Mathf.PI * 2f / sides, a1 = (i + 1) * Mathf.PI * 2f / sides;
                var p0 = new Vector3(Mathf.Cos(a0) * r, 0, Mathf.Sin(a0) * r);
                var p1 = new Vector3(Mathf.Cos(a1) * r, 0, Mathf.Sin(a1) * r);
                b.Quad(p1 + Vector3.up * y0, p0 + Vector3.up * y0, p0 + Vector3.up * y1, p1 + Vector3.up * y1, Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
            }
            // Blade: face at z = +0.012, back hump up to z = -0.03 in the middle, edges 0.02 thick.
            float yb0 = 0.16f, yb1 = 0.80f, hw = 0.054f;
            int rows = 6;
            for (int i = 0; i < rows; i++)
            {
                float ya = Mathf.Lerp(yb0, yb1, i / (float)rows), yb = Mathf.Lerp(yb0, yb1, (i + 1) / (float)rows);
                float ha = Hump(i / (float)rows), hb = Hump((i + 1) / (float)rows);
                // face
                b.Quad(new Vector3(-hw, ya, 0.012f), new Vector3(hw, ya, 0.012f), new Vector3(hw, yb, 0.012f), new Vector3(-hw, yb, 0.012f), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
                // back: two slopes to the spine
                b.Quad(new Vector3(hw, ya, -0.008f), new Vector3(0, ya, -ha), new Vector3(0, yb, -hb), new Vector3(hw, yb, -0.008f), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
                b.Quad(new Vector3(0, ya, -ha), new Vector3(-hw, ya, -0.008f), new Vector3(-hw, yb, -0.008f), new Vector3(0, yb, -hb), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
                // edges
                b.Quad(new Vector3(hw, ya, 0.012f), new Vector3(hw, ya, -0.008f), new Vector3(hw, yb, -0.008f), new Vector3(hw, yb, 0.012f), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
                b.Quad(new Vector3(-hw, ya, -0.008f), new Vector3(-hw, ya, 0.012f), new Vector3(-hw, yb, 0.012f), new Vector3(-hw, yb, -0.008f), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
            }
            // toe and shoulders
            b.Quad(new Vector3(-hw, yb1, 0.012f), new Vector3(hw, yb1, 0.012f), new Vector3(hw, yb1, -0.008f), new Vector3(-hw, yb1, -0.008f), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
            b.Quad(new Vector3(hw, yb0, 0.012f), new Vector3(-hw, yb0, 0.012f), new Vector3(-hw, yb0, -0.008f), new Vector3(hw, yb0, -0.008f), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
            return b.Build("Bat");

            static float Hump(float t) => 0.012f + 0.022f * Mathf.Sin(Mathf.Clamp01(t * 1.1f) * Mathf.PI);
        }

        /// <summary>An elliptical disc (the playing area and beyond) with UVs in metres.</summary>
        public static Mesh Ellipse(float a, float b, int segments, int rings, float uvScale)
        {
            var bld = new Builder();
            for (int r = 0; r < rings; r++)
            {
                float k0 = r / (float)rings, k1 = (r + 1) / (float)rings;
                for (int s = 0; s < segments; s++)
                {
                    float t0 = s * Mathf.PI * 2f / segments, t1 = (s + 1) * Mathf.PI * 2f / segments;
                    Vector3 P(float k, float t) => new Vector3(Mathf.Sin(t) * a * k, 0f, Mathf.Cos(t) * b * k);
                    var p00 = P(k0, t0); var p01 = P(k0, t1); var p11 = P(k1, t1); var p10 = P(k1, t0);
                    Vector2 Uv(Vector3 p) => new Vector2(p.x * uvScale, p.z * uvScale);
                    bld.Quad(p00, p01, p11, p10, Uv(p00), Uv(p01), Uv(p11), Uv(p10));
                }
            }
            var m = bld.Build("Ground");
            // The quads above face down (tangent x radial); flip so they face up.
            Flip(m);
            return m;
        }

        public static void Flip(Mesh m)
        {
            var tris = m.triangles;
            for (int i = 0; i < tris.Length; i += 3) { int t = tris[i]; tris[i] = tris[i + 1]; tris[i + 1] = t; }
            m.triangles = tris;
            var n = m.normals;
            for (int i = 0; i < n.Length; i++) n[i] = -n[i];
            m.normals = n;
        }

        /// <summary>Flat rectangle on the ground (x width, z length) centred at origin, UVs 0..1 (or metres).</summary>
        public static Mesh Rect(float width, float length, bool metresUv = false)
        {
            var b = new Builder();
            float hw = width * 0.5f, hl = length * 0.5f;
            var uvMax = metresUv ? new Vector2(width, length) : Vector2.one;
            b.Quad(new Vector3(-hw, 0, -hl), new Vector3(-hw, 0, hl), new Vector3(hw, 0, hl), new Vector3(hw, 0, -hl),
                new Vector2(0, 0), new Vector2(0, uvMax.y), new Vector2(uvMax.x, uvMax.y), new Vector2(uvMax.x, 0));
            return b.Build("Rect");
        }

        public static Mesh Box(Vector3 size, float uvScale = 1f)
        {
            var b = new Builder();
            b.Box(Vector3.zero, size, uvScale);
            return b.Build("Box");
        }

        /// <summary>A tube following the boundary ellipse (the rope).</summary>
        public static Mesh RopeRing(float a, float b, float radius, int segments)
        {
            var bld = new Builder();
            const int sides = 6;
            for (int s = 0; s < segments; s++)
            {
                float t0 = s * Mathf.PI * 2f / segments, t1 = (s + 1) * Mathf.PI * 2f / segments;
                var c0 = new Vector3(Mathf.Sin(t0) * a, radius, Mathf.Cos(t0) * b);
                var c1 = new Vector3(Mathf.Sin(t1) * a, radius, Mathf.Cos(t1) * b);
                var out0 = new Vector3(c0.x / a, 0, c0.z / b).normalized;
                var out1 = new Vector3(c1.x / a, 0, c1.z / b).normalized;
                for (int k = 0; k < sides; k++)
                {
                    float u0 = k * Mathf.PI * 2f / sides, u1 = (k + 1) * Mathf.PI * 2f / sides;
                    Vector3 R(Vector3 c, Vector3 o, float u) => c + (o * Mathf.Cos(u) + Vector3.up * Mathf.Sin(u)) * radius;
                    bld.Quad(R(c0, out0, u0), R(c1, out1, u0), R(c1, out1, u1), R(c0, out0, u1), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
                }
            }
            return bld.Build("Rope");
        }

        /// <summary>
        /// Stepped seating for a sector of an oval: `steps` rows rising from inner radius (scale of the ellipse) outward.
        /// Returns the seat positions (for the crowd) through `seats`.
        /// </summary>
        public static Mesh Stand(float a, float b, float innerScale, float t0, float t1, int segments, int steps, float rowDepth, float rowRise, float baseHeight, List<Matrix4x4> seats, float seatSpacing)
        {
            var bld = new Builder();
            for (int s = 0; s < segments; s++)
            {
                float ta = Mathf.Lerp(t0, t1, s / (float)segments), tb = Mathf.Lerp(t0, t1, (s + 1) / (float)segments);
                for (int r = 0; r < steps; r++)
                {
                    float k0 = innerScale + r * rowDepth, k1 = innerScale + (r + 1) * rowDepth;
                    float y = baseHeight + r * rowRise, y1 = y + rowRise;
                    Vector3 P(float k, float t, float h) => new Vector3(Mathf.Sin(t) * (a + k), h, Mathf.Cos(t) * (b + k));
                    // riser (faces the field), then tread
                    bld.Quad(P(k0, ta, y), P(k0, tb, y), P(k0, tb, y1), P(k0, ta, y1), new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, rowRise), new Vector2(0, rowRise));
                    bld.Quad(P(k0, ta, y1), P(k0, tb, y1), P(k1, tb, y1), P(k1, ta, y1), new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, rowDepth), new Vector2(0, rowDepth));
                    if (seats != null && r % 1 == 0)
                    {
                        float arc = (tb - ta) * ((a + b) * 0.5f + k0);
                        int n = Mathf.Max(1, Mathf.FloorToInt(arc / seatSpacing));
                        for (int i = 0; i < n; i++)
                        {
                            float t = Mathf.Lerp(ta, tb, (i + 0.5f) / n);
                            var p = P(k0 + rowDepth * 0.45f, t, y1);
                            var face = -new Vector3(Mathf.Sin(t), 0, Mathf.Cos(t));
                            seats.Add(Matrix4x4.TRS(p, Quaternion.LookRotation(face), Vector3.one));
                        }
                    }
                }
                // back wall
                {
                    float k = innerScale + steps * rowDepth;
                    float top = baseHeight + steps * rowRise + 2.5f;
                    Vector3 P(float t, float h) => new Vector3(Mathf.Sin(t) * (a + k), h, Mathf.Cos(t) * (b + k));
                    bld.Quad(P(ta, 0), P(tb, 0), P(tb, top), P(ta, top), new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, top), new Vector2(0, top));
                    // front wall under the first row
                    Vector3 Q(float t, float h) => new Vector3(Mathf.Sin(t) * (a + innerScale), h, Mathf.Cos(t) * (b + innerScale));
                    bld.Quad(Q(ta, 0), Q(tb, 0), Q(tb, baseHeight), Q(ta, baseHeight), new Vector2(0, 0), new Vector2(1, 0), new Vector2(1, baseHeight), new Vector2(0, baseHeight));
                }
            }
            var m = bld.Build("Stand");
            Flip(m);
            return m;
        }

        /// <summary>A roof canopy over a stand sector.</summary>
        public static Mesh Roof(float a, float b, float k0, float k1, float h0, float h1, float t0, float t1, int segments)
        {
            var bld = new Builder();
            for (int s = 0; s < segments; s++)
            {
                float ta = Mathf.Lerp(t0, t1, s / (float)segments), tb = Mathf.Lerp(t0, t1, (s + 1) / (float)segments);
                Vector3 P(float k, float t, float h) => new Vector3(Mathf.Sin(t) * (a + k), h, Mathf.Cos(t) * (b + k));
                bld.Quad(P(k0, ta, h0), P(k0, tb, h0), P(k1, tb, h1), P(k1, ta, h1), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
                bld.Quad(P(k1, ta, h1), P(k1, tb, h1), P(k0, tb, h0), P(k0, ta, h0), Vector2.zero, Vector2.right, Vector2.one, Vector2.up);
            }
            return bld.Build("Roof");
        }

        /// <summary>A seated spectator, very low poly: torso block and a head block (separate meshes so each gets its own colour).</summary>
        public static Mesh CrowdTorso()
        {
            var b = new Builder();
            b.Box(new Vector3(0, 0.35f, 0), new Vector3(0.42f, 0.55f, 0.26f));
            b.Box(new Vector3(-0.12f, 0.12f, 0.18f), new Vector3(0.14f, 0.16f, 0.4f));
            b.Box(new Vector3(0.12f, 0.12f, 0.18f), new Vector3(0.14f, 0.16f, 0.4f));
            return b.Build("CrowdTorso");
        }

        public static Mesh CrowdHead()
        {
            var b = new Builder();
            b.Box(new Vector3(0, 0.76f, 0.02f), new Vector3(0.2f, 0.24f, 0.22f));
            return b.Build("CrowdHead");
        }
    }
}
