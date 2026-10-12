using System.Collections;
using System.Collections.Generic;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.View
{
    /// <summary>
    /// Builds the stadium in code at load time (nothing big ships in the data file): an oval outfield with mowing
    /// stripes, the 22-yard pitch with creases and footmarks, boundary rope and advertising boards, black sight
    /// screens for the white ball, tiered stands with an instanced crowd, roofs and floodlight towers. Time-sliced so
    /// the menu stays responsive while it builds. Materials come from a handful of template materials (one per shader
    /// variant) the editor setup creates, so the right variants are in the build.
    /// </summary>
    public class Stadium : MonoBehaviour
    {
        [Header("Templates (set by the editor)")]
        public Material Plain;        // Standard, no keywords
        public Material Detail;       // Standard with _DETAIL_MULX2
        public Material Emissive;     // Standard with _EMISSION
        public Material Instanced;    // Standard with GPU instancing (crowd)
        public Material SkyTemplate;  // Skybox/Procedural
        public Texture2D GrassTex, SoilTex, ConcreteTex;
        public Light Sun;

        public float Progress { get; private set; }
        public bool Ready { get; private set; }

        Material pitchMat, groundMat, skyMat, floodMat, screenMat;
        readonly List<Material> owned = new List<Material>();
        Crowd crowd;
        Renderer pitchRenderer;
        PitchType pitchType = PitchType.Flat;
        TimeOfDay timeOfDay = TimeOfDay.Day;
        readonly List<Light> floodLights = new List<Light>();

        static readonly string[] Sponsors =
        {
            "NORTHWIND COLA", "SS PORTFOLIO", "BLUE HERON BANK", "KESTREL AIR", "PIXELFORGE", "SUNFIELD TEA", "ORBIT MOBILE",
            "LANTERN INSURANCE", "COPPERLEAF", "MERIDIAN TYRES", "VOLTA ENERGY", "HARBOUR FREIGHT", "QUILL PAYMENTS",
            "DATA & AI PLATFORMS", "RIVERSTONE", "ACE PADS", "GOLDEN GULL", "ZENITH WATCHES",
        };

        Material Make(Material template, Color color, Texture tex = null, float tiling = 1f, float smooth = 0.1f)
        {
            var m = new Material(template);
            m.color = color;
            if (tex) { m.mainTexture = tex; m.mainTextureScale = new Vector2(tiling, tiling); }
            if (m.HasProperty("_Glossiness")) m.SetFloat("_Glossiness", smooth);
            if (m.HasProperty("_Metallic")) m.SetFloat("_Metallic", 0f);
            owned.Add(m);
            return m;
        }

        GameObject Part(string name, Mesh mesh, Material mat, Transform parent = null, bool shadows = false)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent ? parent : transform, false);
            go.AddComponent<MeshFilter>().sharedMesh = mesh;
            var r = go.AddComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = shadows ? UnityEngine.Rendering.ShadowCastingMode.On : UnityEngine.Rendering.ShadowCastingMode.Off;
            r.receiveShadows = true;
            go.isStatic = false;
            return go;
        }

        public IEnumerator Build(PitchType pitch, TimeOfDay time)
        {
            Ready = false;
            Progress = 0f;
            pitchType = pitch;
            timeOfDay = time;
            float a = Geo.BoundarySquare, b = Geo.BoundaryStraight;

            // ---- outfield: mowing stripes (generated) x grass detail
            var stripes = StripeTexture();
            groundMat = Make(Detail, Color.white, stripes, 1f, 0.05f);
            if (groundMat.HasProperty("_DetailAlbedoMap"))
            {
                groundMat.SetTexture("_DetailAlbedoMap", GrassTex);
                groundMat.SetTextureScale("_DetailAlbedoMap", new Vector2(70f, 70f));
            }
            var ground = Part("Outfield", MeshKit.Ellipse(a + 14f, b + 14f, 96, 10, 1f / ((b + 14f) * 2f)), groundMat);
            // UVs are in units of the ellipse diameter, offset so the stripes texture spans it once.
            var gm = ground.GetComponent<MeshFilter>().sharedMesh;
            var uvs = gm.uv;
            for (int i = 0; i < uvs.Length; i++) uvs[i] += new Vector2(0.5f, 0.5f);
            gm.uv = uvs;
            var surround = Part("Surround", MeshKit.Ellipse(a + 60f, b + 60f, 64, 3, 0.05f), Make(Plain, new Color(0.18f, 0.28f, 0.14f), GrassTex, 30f));
            surround.transform.position = new Vector3(0, -0.02f, 0);
            Progress = 0.1f; yield return null;

            // ---- the pitch, footmarks and creases
            pitchMat = Make(Plain, Color.white, SoilTex, 1f, 0.05f);
            ApplyPitch(pitch);
            var p = Part("Pitch", MeshKit.Rect(Geo.PitchWidth, Geo.PitchLength + 4.4f, true), pitchMat);
            p.transform.position = new Vector3(0, 0.004f, 0);
            pitchRenderer = p.GetComponent<Renderer>();
            pitchMat.mainTextureScale = new Vector2(1f / 3f, 1f / 3f);
            var worn = Make(Plain, new Color(0.55f, 0.45f, 0.33f), SoilTex, 0.5f, 0f);
            for (int end = 0; end < 2; end++)
            {
                float inward = Geo.Inward(end);
                foreach (float x in new[] { -0.42f, 0.42f })
                {
                    var fm = Part("Footmarks", MeshKit.Rect(0.75f, 1.8f, true), worn, p.transform);
                    fm.transform.position = new Vector3(x, 0.006f, Geo.StumpsZ(end) + inward * 1.6f);
                }
                // Rough outside off for the spinners, a little further down.
                foreach (float x in new[] { -0.7f, 0.7f })
                {
                    var rough = Part("Rough", MeshKit.Rect(0.5f, 1.6f, true), worn, p.transform);
                    rough.transform.position = new Vector3(x, 0.006f, Geo.StumpsZ(end) + inward * 3.8f);
                }
            }
            var white = Make(Plain, new Color(0.96f, 0.96f, 0.94f), null, 1f, 0.2f);
            for (int end = 0; end < 2; end++)
            {
                float inward = Geo.Inward(end);
                Line(new Vector3(0, 0, Geo.PoppingZ(end)), 3.66f, 0.05f, white);           // popping crease
                Line(new Vector3(0, 0, Geo.StumpsZ(end)), 2.64f, 0.05f, white);            // bowling crease
                foreach (float x in new[] { -Geo.ReturnCreaseHalf, Geo.ReturnCreaseHalf })  // return creases
                {
                    var rc = Part("ReturnCrease", MeshKit.Rect(0.05f, 2.44f + 1.22f), white, p.transform);
                    rc.transform.position = new Vector3(x, 0.008f, Geo.StumpsZ(end) + inward * (Geo.CreaseDepth - (2.44f + 1.22f) * 0.5f));
                }
                // Wide guide lines on the popping crease (limited overs).
                foreach (float x in new[] { -Geo.WideLineOff, Geo.WideLineOff })
                {
                    var wl = Part("WideGuide", MeshKit.Rect(0.04f, 0.6f), white, p.transform);
                    wl.transform.position = new Vector3(x, 0.008f, Geo.PoppingZ(end) + inward * 0.3f);
                }
            }
            // The 30-yard circle: dashes around two semicircles joined by straights.
            var dashes = new List<Vector3>();
            for (int i = 0; i < 160; i++)
            {
                float t = i / 160f * Mathf.PI * 2f;
                float x = Mathf.Sin(t) * Geo.InnerCircle;
                float z = Mathf.Cos(t) * Geo.InnerCircle + Mathf.Sign(Mathf.Cos(t)) * Geo.HalfPitch;
                dashes.Add(new Vector3(x, 0.01f, z));
            }
            var dashMesh = MeshKit.Rect(0.5f, 0.06f);
            foreach (var d in dashes)
            {
                var dg = Part("Circle", dashMesh, white);
                dg.transform.position = d;
                dg.transform.rotation = Quaternion.LookRotation(new Vector3(d.x, 0, d.z - Mathf.Sign(d.z) * Geo.HalfPitch));
            }
            Progress = 0.25f; yield return null;

            // ---- rope, boards, sight screens
            Part("Rope", MeshKit.RopeRing(a, b, 0.06f, 240), Make(Plain, new Color(0.95f, 0.95f, 0.95f), null, 1f, 0.3f));
            var font = Resources.GetBuiltinResource<Font>("LegacyRuntime.ttf");
            Color[] boardColors = { new Color(0.08f, 0.12f, 0.35f), new Color(0.55f, 0.05f, 0.1f), new Color(0.05f, 0.3f, 0.2f), new Color(0.1f, 0.1f, 0.12f), new Color(0.45f, 0.2f, 0.02f) };
            var boardMats = new Material[boardColors.Length];
            for (int i = 0; i < boardColors.Length; i++) boardMats[i] = Make(Emissive, boardColors[i], null, 1f, 0.4f);
            foreach (var bm in boardMats) bm.SetColor("_EmissionColor", bm.color * 0.6f);
            int boards = 64;
            var boardMesh = MeshKit.Box(new Vector3(6.6f, 0.9f, 0.12f));
            for (int i = 0; i < boards; i++)
            {
                float t = (i + 0.5f) / boards * Mathf.PI * 2f;
                if (Mathf.Abs(Mathf.Cos(t)) > 0.985f) continue; // gap for the sight screens
                var pos = Geo.RopePoint(t, -3.2f);
                var outward = new Vector3(pos.x / (a * a), 0, pos.z / (b * b)).normalized;
                var bg = Part("Board", boardMesh, boardMats[i % boardMats.Length]);
                bg.transform.position = pos + Vector3.up * 0.45f;
                bg.transform.rotation = Quaternion.LookRotation(-outward);
                if (font)
                {
                    var tm = new GameObject("Text").AddComponent<TextMesh>();
                    tm.transform.SetParent(bg.transform, false);
                    tm.transform.localPosition = new Vector3(0, 0, -0.07f);
                    tm.text = Sponsors[(i * 7) % Sponsors.Length];
                    tm.font = font;
                    tm.GetComponent<MeshRenderer>().sharedMaterial = font.material;
                    tm.fontSize = 48;
                    tm.characterSize = 0.06f;
                    tm.anchor = TextAnchor.MiddleCenter;
                    tm.alignment = TextAlignment.Center;
                    tm.color = Color.white;
                }
                if (i % 8 == 0) yield return null;
            }
            screenMat = Make(Plain, new Color(0.03f, 0.03f, 0.035f), null, 1f, 0.1f);
            for (int end = 0; end < 2; end++)
            {
                var s = Part("SightScreen", MeshKit.Box(new Vector3(20f, 8f, 0.4f)), screenMat, null, true);
                s.transform.position = new Vector3(0, 4.2f, (b + 6f) * (end == 0 ? -1f : 1f));
            }
            Progress = 0.45f; yield return null;

            // ---- stands, roofs and the crowd
            var concrete = Make(Plain, new Color(0.78f, 0.78f, 0.8f), ConcreteTex, 0.15f, 0.05f);
            var roofMat = Make(Plain, new Color(0.85f, 0.87f, 0.9f), null, 1f, 0.5f);
            var seats = new List<Matrix4x4>();
            float inner = 10f;
            float[][] sectors = { new[] { 0.28f, 1.42f }, new[] { 1.72f, 2.86f }, new[] { 3.42f, 4.56f }, new[] { 4.86f, 6.0f } };
            foreach (var sec in sectors)
            {
                Part("Stand", MeshKit.Stand(a, b, inner, sec[0], sec[1], 24, 18, 0.9f, 0.5f, 1.6f, seats, 0.62f), concrete, null, false);
                Part("Roof", MeshKit.Roof(a, b, inner + 8f, inner + 18f, 14f, 15.5f, sec[0], sec[1], 24), roofMat);
                yield return null;
            }
            crowd = gameObject.AddComponent<Crowd>();
            crowd.Build(seats, Instanced, 0.72f);
            Progress = 0.7f; yield return null;

            // ---- floodlights
            var tower = Make(Plain, new Color(0.55f, 0.56f, 0.6f), null, 1f, 0.4f);
            floodMat = Make(Emissive, new Color(0.9f, 0.92f, 0.95f), null, 1f, 0.6f);
            for (int i = 0; i < 4; i++)
            {
                float t = (i + 0.5f) * Mathf.PI * 0.5f;
                var basePos = new Vector3(Mathf.Sin(t) * (a + inner + 26f), 0f, Mathf.Cos(t) * (b + inner + 26f));
                var mast = Part("FloodMast", MeshKit.Box(new Vector3(1.4f, 50f, 1.4f)), tower);
                mast.transform.position = basePos + Vector3.up * 25f;
                var head = Part("FloodBank", MeshKit.Box(new Vector3(10f, 6f, 0.6f)), floodMat);
                head.transform.position = basePos + Vector3.up * 51f;
                head.transform.LookAt(new Vector3(0, -30f, 0)); // the bank faces down into the bowl
            }
            Progress = 0.85f; yield return null;

            // ---- sky and light
            skyMat = new Material(SkyTemplate);
            owned.Add(skyMat);
            RenderSettings.skybox = skyMat;
            ApplyTime(time);
            Progress = 1f;
            Ready = true;
        }

        void Line(Vector3 centre, float width, float depth, Material m)
        {
            var go = Part("Crease", MeshKit.Rect(width, depth), m);
            go.transform.position = centre + Vector3.up * 0.008f;
        }

        /// <summary>Mowing stripes and a slightly worn square around the pitch: 256 px, spans the whole outfield.</summary>
        static Texture2D StripeTexture()
        {
            const int n = 256;
            var tex = new Texture2D(n, n, TextureFormat.RGBA32, true) { name = "Stripes", wrapMode = TextureWrapMode.Clamp, filterMode = FilterMode.Trilinear, anisoLevel = 4 };
            var px = new Color32[n * n];
            float metresPerPx = (Geo.BoundaryStraight + 14f) * 2f / n;
            for (int y = 0; y < n; y++)
            {
                for (int x = 0; x < n; x++)
                {
                    float mx = (x - n * 0.5f) * metresPerPx, mz = (y - n * 0.5f) * metresPerPx;
                    // Stripes across the pitch direction, 6 m wide, plus a softer cross-cut.
                    float stripe = Mathf.Repeat(mz / 6f, 2f) < 1f ? 1f : 0.86f;
                    float cross = Mathf.Repeat(mx / 12f, 2f) < 1f ? 1f : 0.96f;
                    float v = stripe * cross;
                    // The square (where pitches are cut) is slightly paler.
                    if (Mathf.Abs(mx) < 12f && Mathf.Abs(mz) < 14f) v *= 1.04f;
                    var c = new Color(0.47f * v, 0.55f * v, 0.42f * v);
                    px[y * n + x] = c;
                }
            }
            tex.SetPixels32(px);
            tex.Apply(true, true);
            return tex;
        }

        public void ApplyPitch(PitchType type)
        {
            pitchType = type;
            if (!pitchMat) return;
            switch (type)
            {
                case PitchType.Green: pitchMat.color = new Color(0.62f, 0.72f, 0.45f); break;
                case PitchType.Dusty: pitchMat.color = new Color(1.0f, 0.86f, 0.7f); break;
                default: pitchMat.color = new Color(0.9f, 0.83f, 0.66f); break;
            }
        }

        /// <summary>Sun, sky, ambient light and the floodlights for the time of day.</summary>
        public void ApplyTime(TimeOfDay time)
        {
            timeOfDay = time;
            if (!Sun) return;
            switch (time)
            {
                case TimeOfDay.Day:
                    Sun.transform.rotation = Quaternion.Euler(52f, -35f, 0f);
                    Sun.color = new Color(1f, 0.96f, 0.9f);
                    Sun.intensity = 1.25f;
                    RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
                    RenderSettings.ambientSkyColor = new Color(0.55f, 0.65f, 0.8f);
                    RenderSettings.ambientEquatorColor = new Color(0.45f, 0.5f, 0.45f);
                    RenderSettings.ambientGroundColor = new Color(0.25f, 0.27f, 0.2f);
                    if (skyMat) { skyMat.SetFloat("_SunSize", 0.04f); skyMat.SetFloat("_AtmosphereThickness", 0.9f); skyMat.SetColor("_SkyTint", new Color(0.5f, 0.55f, 0.65f)); skyMat.SetFloat("_Exposure", 1.25f); }
                    SetFlood(0f);
                    break;
                case TimeOfDay.Dusk:
                    Sun.transform.rotation = Quaternion.Euler(14f, -60f, 0f);
                    Sun.color = new Color(1f, 0.72f, 0.48f);
                    Sun.intensity = 1.0f;
                    RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
                    RenderSettings.ambientSkyColor = new Color(0.45f, 0.42f, 0.55f);
                    RenderSettings.ambientEquatorColor = new Color(0.5f, 0.38f, 0.3f);
                    RenderSettings.ambientGroundColor = new Color(0.2f, 0.17f, 0.14f);
                    if (skyMat) { skyMat.SetFloat("_SunSize", 0.06f); skyMat.SetFloat("_AtmosphereThickness", 1.6f); skyMat.SetColor("_SkyTint", new Color(0.65f, 0.45f, 0.4f)); skyMat.SetFloat("_Exposure", 1.1f); }
                    SetFlood(0.6f);
                    break;
                default: // night under lights: the "sun" stands in for the floodlights high above
                    Sun.transform.rotation = Quaternion.Euler(68f, 30f, 0f);
                    Sun.color = new Color(0.95f, 0.97f, 1f);
                    Sun.intensity = 1.05f;
                    RenderSettings.ambientMode = UnityEngine.Rendering.AmbientMode.Trilight;
                    RenderSettings.ambientSkyColor = new Color(0.12f, 0.14f, 0.22f);
                    RenderSettings.ambientEquatorColor = new Color(0.18f, 0.2f, 0.22f);
                    RenderSettings.ambientGroundColor = new Color(0.1f, 0.12f, 0.08f);
                    if (skyMat) { skyMat.SetFloat("_SunSize", 0f); skyMat.SetFloat("_AtmosphereThickness", 0.3f); skyMat.SetColor("_SkyTint", new Color(0.1f, 0.12f, 0.2f)); skyMat.SetFloat("_Exposure", 0.12f); }
                    SetFlood(1f);
                    break;
            }
            if (crowd) crowd.SetNight(time == TimeOfDay.Night);
            DynamicGI.UpdateEnvironment();
        }

        void SetFlood(float k)
        {
            if (floodMat) floodMat.SetColor("_EmissionColor", new Color(1f, 0.98f, 0.92f) * (0.3f + k * 6f));
        }

        public void Cheer(float amount) { if (crowd) crowd.Cheer(amount); }

        void OnDestroy()
        {
            foreach (var m in owned) if (m) Destroy(m);
        }
    }
}
