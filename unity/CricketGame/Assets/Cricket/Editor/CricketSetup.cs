using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Reflection;
using Cricket.Core;
using Cricket.Fx;
using Cricket.Game;
using Cricket.Net;
using Cricket.UI;
using Cricket.View;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.Rendering;
using UnityEngine.Rendering.PostProcessing;
using Object = UnityEngine.Object;

namespace Cricket.EditorTools
{
    /// <summary>
    /// One-click setup: imports the assets with small-build settings, makes the handful of materials the game needs,
    /// the character prefab (Quaternius body + clips, LODs, or a fallback mannequin), the network prefab, the scene
    /// and the player settings, then builds WebGL straight into the portfolio site.
    /// Menu: Cricket → 1. Generate Scene and Prefabs / 2. Build WebGL into Portfolio Site.
    /// Batch: Unity -batchmode -quit -projectPath unity/CricketGame -executeMethod Cricket.EditorTools.CricketSetup.GenerateAndBuild
    /// </summary>
    public static class CricketSetup
    {
        const string Root = "Assets/Cricket";
        const string Generated = Root + "/Generated";
        const string ScenePath = Root + "/Scenes/Cricket.unity";
        const string ModelPath = Root + "/Models/Cricketer.glb";
        const string PostResourcesPath = "Packages/com.unity.postprocessing/PostProcessing/PostProcessResources.asset";
        const string OutputRelative = "../../site/public/games/cricket";

        static readonly Dictionary<string, string> ClipMap = new Dictionary<string, string>
        {
            { "idle", "Idle_Loop" }, { "walk", "Walk_Loop" }, { "jog", "Jog_Fwd_Loop" }, { "sprint", "Sprint_Loop" },
            { "crouch", "Crouch_Idle_Loop" }, { "pickup", "PickUp_Table" }, { "roll", "Roll" }, { "jumpstart", "Jump_Start" },
            { "jumploop", "Jump_Loop" }, { "jumpland", "Jump_Land" }, { "dance", "Dance_Loop" }, { "talk", "Idle_Talking_Loop" },
            { "hit", "Hit_Chest" }, { "throw", "OverhandThrow" }, { "slidestart", "Slide_Start" }, { "slide", "Slide_Loop" },
            { "slideexit", "Slide_Exit" }, { "fold", "Idle_FoldArms_Loop" }, { "getup", "LayToIdle" }, { "yes", "Yes" }, { "no", "Idle_No_Loop" },
        };

        [MenuItem("Cricket/1. Generate Scene and Prefabs", priority = 1)]
        public static void Generate()
        {
            foreach (var dir in new[] { "Materials", "Prefabs", "PostFx" }) Directory.CreateDirectory($"{Generated}/{dir}");
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            AssetDatabase.Refresh();

            var m = CreateMaterials();
            var cricketer = SavePrefab(BuildCricketer(m), "Cricketer", false);
            var netMatch = SavePrefab(BuildNetMatch(), "NetMatch", true);
            BuildScene(m, cricketer, netMatch);
            ConfigurePlayer();
            WriteLinkXml();
            AssetDatabase.SaveAssets();
            Debug.Log("Cricket: scene and prefabs generated. Next: Cricket → 2. Build WebGL into Portfolio Site.");
        }

        [MenuItem("Cricket/2. Build WebGL into Portfolio Site", priority = 2)]
        public static void BuildWebGL()
        {
            if (!File.Exists(ScenePath)) Generate();
            ConfigurePlayer();
            WriteLinkXml();
            var output = Path.GetFullPath(Path.Combine(Application.dataPath, "..", OutputRelative));
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
            var report = UnityEditor.BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            });
            Debug.Log($"Cricket: WebGL build {report.summary.result}, {report.summary.totalSize / (1024f * 1024f):0.0} MB → {output}");
            if (Application.isBatchMode && report.summary.result != UnityEditor.Build.Reporting.BuildResult.Succeeded) EditorApplication.Exit(1);
        }

        /// <summary>Batch-mode entry point: generate everything, then build.</summary>
        public static void GenerateAndBuild()
        {
            Generate();
            BuildWebGL();
        }

        // ------------------------------------------------------------------ materials

        class Mats
        {
            public Material Plain, Detail, Emissive, Instanced, Sky, Line, Ball, Stump, Bail, Wood, Prop, SkinLight, SkinDark, Kit, Eyes;
            public Texture2D Grass, Soil, Concrete;
        }

        static Material Mat(string name, string shader, Color color, float smooth = 0.1f, Texture tex = null)
        {
            var path = $"{Generated}/Materials/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            var sh = Shader.Find(shader);
            if (sh == null) { Debug.LogWarning($"Cricket: shader {shader} not found; using Standard."); sh = Shader.Find("Standard"); }
            if (mat == null)
            {
                mat = new Material(sh);
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = sh;
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", color);
            if (mat.HasProperty("_MainTex")) mat.SetTexture("_MainTex", tex);
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", smooth);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", 0f);
            mat.DisableKeyword("_EMISSION");
            mat.DisableKeyword("_DETAIL_MULX2");
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>Imports a texture small and compressed (crunched DXT/ETC; WebGL picks what the GPU supports).</summary>
        static Texture2D Tex(string path, int maxSize, bool srgb = true)
        {
            if (!File.Exists(path)) { Debug.LogWarning($"Cricket: {path} is missing."); return null; }
            if (AssetImporter.GetAtPath(path) is TextureImporter imp)
            {
                bool dirty = imp.maxTextureSize != maxSize || !imp.crunchedCompression || imp.wrapMode != TextureWrapMode.Repeat || !imp.mipmapEnabled;
                if (dirty)
                {
                    imp.textureType = TextureImporterType.Default;
                    imp.sRGBTexture = srgb;
                    imp.wrapMode = TextureWrapMode.Repeat;
                    imp.mipmapEnabled = true;
                    imp.filterMode = FilterMode.Trilinear;
                    imp.anisoLevel = 4;
                    imp.maxTextureSize = maxSize;
                    imp.textureCompression = TextureImporterCompression.Compressed;
                    imp.crunchedCompression = true;
                    imp.compressionQuality = 50;
                    imp.SaveAndReimport();
                }
            }
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        static Mats CreateMaterials()
        {
            var m = new Mats
            {
                Grass = Tex($"{Root}/Textures/Grass005_Color.jpg", 1024),
                Soil = Tex($"{Root}/Textures/Ground109_Color.jpg", 1024),
                Concrete = Tex($"{Root}/Textures/Concrete034_Color.jpg", 512),
            };
            var skinLightTex = Tex($"{Root}/Models/CricketerSkin_Light.jpg", 512);
            var skinDarkTex = Tex($"{Root}/Models/CricketerSkin_Dark.jpg", 512);

            // One template per shader variant the runtime needs (the stadium is built from copies of these).
            m.Plain = Mat("Template_Plain", "Standard", Color.white);
            m.Detail = Mat("Template_Detail", "Standard", Color.white, 0.05f);
            m.Detail.EnableKeyword("_DETAIL_MULX2");
            m.Detail.SetTexture("_DetailAlbedoMap", m.Grass);
            m.Emissive = Mat("Template_Emissive", "Standard", Color.white, 0.4f);
            m.Emissive.EnableKeyword("_EMISSION");
            m.Emissive.SetColor("_EmissionColor", Color.black);
            m.Emissive.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            m.Instanced = Mat("Template_Instanced", "Standard", Color.white, 0.05f);
            m.Instanced.enableInstancing = true;
            m.Sky = Mat("Sky", "Skybox/Procedural", Color.white);
            m.Line = Mat("Line", "Sprites/Default", Color.white);
            m.Ball = Mat("Ball", "Standard", new Color(0.97f, 0.97f, 0.95f), 0.75f);
            m.Stump = Mat("Stump", "Standard", new Color(0.92f, 0.9f, 0.84f), 0.35f);
            m.Bail = Mat("Bail", "Standard", new Color(0.95f, 0.93f, 0.88f), 0.4f);
            m.Bail.EnableKeyword("_EMISSION");
            m.Bail.SetColor("_EmissionColor", Color.black);
            m.Wood = Mat("BatWood", "Standard", new Color(0.86f, 0.74f, 0.52f), 0.35f);
            m.Prop = Mat("Prop", "Standard", Color.white, 0.25f);
            m.Prop.enableInstancing = true;
            m.Kit = Mat("Kit", "Standard", Color.white, 0.2f);
            m.Eyes = Mat("Eyes", "Standard", new Color(0.12f, 0.1f, 0.09f), 0.8f);
            m.SkinLight = Mat("SkinLight", "Standard", Color.white, 0.25f, skinLightTex);
            m.SkinDark = Mat("SkinDark", "Standard", Color.white, 0.25f, skinDarkTex);
            AssetDatabase.SaveAssets();
            return m;
        }

        // ------------------------------------------------------------------ character

        static void UseLegacyAnimation(string path)
        {
            var importer = AssetImporter.GetAtPath(path);
            if (importer == null) return;
            var so = new SerializedObject(importer);
            var method = so.FindProperty("importSettings.animationMethod");
            if (method == null) { Debug.LogWarning($"Cricket: couldn't find glTFast animation settings for {path}."); return; }
            const int legacy = 1; // GLTFast.AnimationMethod.Legacy
            var clip = AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().FirstOrDefault();
            if (method.intValue == legacy && (clip == null || clip.legacy)) return;
            method.intValue = legacy;
            so.ApplyModifiedPropertiesWithoutUndo();
            importer.SaveAndReimport();
        }

        static Transform FindDeep(Transform t, string name)
        {
            if (t.name == name) return t;
            foreach (Transform c in t)
            {
                var f = FindDeep(c, name);
                if (f) return f;
            }
            return null;
        }

        static GameObject BuildCricketer(Mats m)
        {
            var root = new GameObject("Cricketer");
            GameObject model = null;
            var clips = new List<AnimationClip>();
            var keys = new List<string>();
            if (File.Exists(ModelPath))
            {
                UseLegacyAnimation(ModelPath);
                var asset = AssetDatabase.LoadAssetAtPath<GameObject>(ModelPath);
                if (asset != null)
                {
                    model = (GameObject)Object.Instantiate(asset);
                    var all = AssetDatabase.LoadAllAssetsAtPath(ModelPath).OfType<AnimationClip>().ToList();
                    foreach (var kv in ClipMap)
                    {
                        var clip = all.FirstOrDefault(x => x.name == kv.Value) ?? all.FirstOrDefault(x => x.name.EndsWith(kv.Value, StringComparison.Ordinal));
                        if (clip == null) continue;
                        if (!clip.legacy) { Debug.LogWarning($"Cricket: clip {clip.name} isn't legacy; re-import the model."); continue; }
                        clips.Add(clip);
                        keys.Add(kv.Key);
                    }
                }
                else Debug.LogWarning("Cricket: Cricketer.glb didn't import (is glTFast installed?). Using the fallback mannequin.");
            }
            if (model == null) model = BuildMannequin(m);
            model.name = "Model";
            model.transform.SetParent(root.transform, false);
            foreach (var old in model.GetComponentsInChildren<Animation>(true)) Object.DestroyImmediate(old);
            foreach (var old in model.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(old);
            var anim = model.AddComponent<Animation>();
            anim.playAutomatically = false;

            var c = root.AddComponent<Cricketer>();
            c.Anim = anim;
            c.Clips = clips.ToArray();
            c.ClipKeys = keys.ToArray();
            c.SkinLight = m.SkinLight;
            c.SkinDark = m.SkinDark;
            c.Plain = m.Prop;
            c.Wood = m.Wood;

            // Materials: our own Standard ones (one shared kit material coloured per person with property blocks).
            var bodies = new List<SkinnedMeshRenderer>();
            Renderer lod0Extra = null, lod0Extra2 = null;
            foreach (var r in model.GetComponentsInChildren<Renderer>(true))
            {
                r.shadowCastingMode = ShadowCastingMode.On;
                if (r is SkinnedMeshRenderer skinned) { skinned.updateWhenOffscreen = false; skinned.quality = SkinQuality.Bone2; }
                var mats = r.sharedMaterials;
                for (int i = 0; i < mats.Length; i++)
                {
                    string n = mats[i] ? mats[i].name : "";
                    if (n.Contains("Skin")) { mats[i] = m.SkinLight; c.SkinSlot = i; }
                    else if (n.Contains("Shirt")) { mats[i] = m.Kit; c.ShirtSlot = i; }
                    else if (n.Contains("Trousers")) { mats[i] = m.Kit; c.TrousersSlot = i; }
                    else if (n.Contains("Shoes")) { mats[i] = m.Kit; c.ShoesSlot = i; }
                    else if (n.Contains("Brow") || n.Contains("Eye")) mats[i] = m.Eyes;
                    else mats[i] = m.Kit;
                }
                r.sharedMaterials = mats;
                if (r.name.Contains("Body") && r is SkinnedMeshRenderer smr) bodies.Add(smr);
                else if (r.name.Contains("Eye")) { if (lod0Extra == null) lod0Extra = r; else lod0Extra2 = r; }
                if (r.name.Contains("Eyes") || r.name.Contains("Eyebrows")) r.shadowCastingMode = ShadowCastingMode.Off;
            }
            c.Bodies = bodies.ToArray();

            // LODs: full body (with eyes) up close, the decimated body further away, culled when tiny.
            var lod0 = model.GetComponentsInChildren<Renderer>(true).Where(r => !r.name.Contains("LOD1")).ToArray();
            var lod1 = model.GetComponentsInChildren<Renderer>(true).Where(r => r.name.Contains("LOD1")).ToArray();
            if (lod1.Length > 0)
            {
                var group = root.AddComponent<LODGroup>();
                group.SetLODs(new[] { new LOD(0.09f, lod0), new LOD(0.006f, lod1) });
                group.RecalculateBounds();
                foreach (var r in lod1) r.shadowCastingMode = ShadowCastingMode.Off;
            }
            return root;
        }

        /// <summary>Stand-in character when the model is missing: a bone hierarchy with the same names, made of capsules.</summary>
        static GameObject BuildMannequin(Mats m)
        {
            var root = new GameObject("Mannequin");
            Transform Bone(string name, Transform parent, Vector3 local)
            {
                var t = new GameObject(name).transform;
                t.SetParent(parent, false);
                t.localPosition = local;
                return t;
            }
            void Limb(Transform from, Transform to, float radius, Material mat)
            {
                var g = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                Object.DestroyImmediate(g.GetComponent<Collider>());
                g.name = "Mesh";
                g.transform.SetParent(from, false);
                var d = to.position - from.position;
                g.transform.position = from.position + d * 0.5f;
                g.transform.up = d.normalized;
                g.transform.localScale = new Vector3(radius * 2f, d.magnitude * 0.5f + radius * 0.5f, radius * 2f);
                g.GetComponent<Renderer>().sharedMaterial = mat;
            }
            var pelvis = Bone("pelvis", root.transform, new Vector3(0, 0.95f, 0));
            var s1 = Bone("spine_01", pelvis, new Vector3(0, 0.12f, 0));
            var s2 = Bone("spine_02", s1, new Vector3(0, 0.12f, 0));
            var s3 = Bone("spine_03", s2, new Vector3(0, 0.14f, 0));
            var neck = Bone("neck_01", s3, new Vector3(0, 0.18f, 0));
            var head = Bone("Head", neck, new Vector3(0, 0.08f, 0));
            var headTop = Bone("HeadTop", head, new Vector3(0, 0.22f, 0));
            Transform[] Arm(string s, float side)
            {
                var clav = Bone("clavicle_" + s, s3, new Vector3(side * 0.04f, 0.14f, 0));
                var up = Bone("upperarm_" + s, clav, new Vector3(side * 0.16f, 0f, 0));
                var lo = Bone("lowerarm_" + s, up, new Vector3(0, -0.28f, 0));
                var hand = Bone("hand_" + s, lo, new Vector3(0, -0.26f, 0));
                var fing = Bone("middle_01_" + s, hand, new Vector3(0, -0.1f, 0));
                return new[] { up, lo, hand, fing };
            }
            Transform[] Leg(string s, float side)
            {
                var th = Bone("thigh_" + s, pelvis, new Vector3(side * 0.1f, -0.02f, 0));
                var ca = Bone("calf_" + s, th, new Vector3(0, -0.43f, 0));
                var ft = Bone("foot_" + s, ca, new Vector3(0, -0.44f, 0));
                var ball = Bone("ball_" + s, ft, new Vector3(0, -0.05f, 0.14f));
                return new[] { th, ca, ft, ball };
            }
            var al = Arm("l", -1f); var ar = Arm("r", 1f); var ll = Leg("l", -1f); var lr = Leg("r", 1f);
            Limb(pelvis, s3, 0.16f, m.Kit);
            Limb(neck, headTop, 0.11f, m.SkinLight);
            foreach (var a in new[] { al, ar }) { Limb(a[0], a[1], 0.05f, m.Kit); Limb(a[1], a[2], 0.045f, m.SkinLight); }
            foreach (var l in new[] { ll, lr }) { Limb(l[0], l[1], 0.075f, m.Kit); Limb(l[1], l[2], 0.06f, m.Kit); Limb(l[2], l[3], 0.05f, m.Kit); }
            return root;
        }

        static GameObject BuildNetMatch()
        {
            var go = new GameObject("NetMatch");
            go.AddComponent<NetworkObject>();
            go.AddComponent<NetMatch>();
            return go;
        }

        static GameObject SavePrefab(GameObject go, string name, bool network)
        {
            var path = $"{Generated}/Prefabs/{name}.prefab";
            var asset = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            if (network)
            {
                // Make sure the NetworkObject has its GlobalObjectIdHash before anything references it.
                var no = asset.GetComponent<NetworkObject>();
                typeof(NetworkObject).GetMethod("OnValidate", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)?.Invoke(no, null);
            }
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            return asset;
        }

        // ------------------------------------------------------------------ post-processing

        static PostProcessProfile Profile(string name, Action<PostProcessProfile> fill)
        {
            var path = $"{Generated}/PostFx/{name}.asset";
            AssetDatabase.DeleteAsset(path);
            var p = ScriptableObject.CreateInstance<PostProcessProfile>();
            AssetDatabase.CreateAsset(p, path);
            fill(p);
            foreach (var s in p.settings) AssetDatabase.AddObjectToAsset(s, p);
            EditorUtility.SetDirty(p);
            AssetDatabase.SaveAssets();
            return p;
        }

        static void BuildPostFx(GameObject app, Camera cam)
        {
            var resources = AssetDatabase.LoadAssetAtPath<PostProcessResources>(PostResourcesPath);
            if (resources == null) { Debug.LogWarning("Cricket: Post Processing resources not found; no post effects."); return; }
            var look = Profile("CricketLook", p =>
            {
                var bloom = p.AddSettings<Bloom>();
                bloom.intensity.Override(0.6f);
                bloom.threshold.Override(1.1f);
                bloom.softKnee.Override(0.5f);
                bloom.fastMode.Override(true);
                var g = p.AddSettings<ColorGrading>();
                g.gradingMode.Override(GradingMode.HighDefinitionRange);
                g.tonemapper.Override(Tonemapper.ACES);
                g.postExposure.Override(0.25f);
                g.saturation.Override(10f);
                g.contrast.Override(8f);
                var v = p.AddSettings<Vignette>();
                v.intensity.Override(0.22f);
                v.smoothness.Override(0.45f);
            });
            var blur = Profile("CricketMenuBlur", p =>
            {
                var dof = p.AddSettings<DepthOfField>();
                dof.focusDistance.Override(0.3f);
                dof.aperture.Override(1.2f);
                dof.focalLength.Override(90f);
                dof.kernelSize.Override(KernelSize.Small);
            });
            var volumes = new GameObject("Post Volumes").transform;
            PostProcessVolume Vol(string n, PostProcessProfile prof, float prio, float w)
            {
                var go = new GameObject(n);
                go.transform.SetParent(volumes, false);
                var vol = go.AddComponent<PostProcessVolume>();
                vol.isGlobal = true;
                vol.priority = prio;
                vol.weight = w;
                vol.sharedProfile = prof;
                return vol;
            }
            Vol("Look", look, 0f, 1f);
            var fx = app.AddComponent<PostFx>();
            fx.Resources = resources;
            fx.BlurVolume = Vol("Menu blur", blur, 10f, 1f);
            cam.allowHDR = true;
            var layer = cam.gameObject.AddComponent<PostProcessLayer>();
            PostFx.Configure(layer, resources);
            fx.Layer = layer;
        }

        // ------------------------------------------------------------------ scene

        static void BuildScene(Mats m, GameObject cricketer, GameObject netMatch)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.shadows = LightShadows.Hard;
            sun.shadowStrength = 0.8f;
            sun.transform.rotation = Quaternion.Euler(52f, -35f, 0f);
            RenderSettings.sun = sun;
            RenderSettings.skybox = m.Sky;
            RenderSettings.fog = false;
            RenderSettings.ambientMode = AmbientMode.Trilight;

            var camGo = new GameObject("Main Camera") { tag = "MainCamera" };
            var cam = camGo.AddComponent<Camera>();
            cam.fieldOfView = 42f;
            cam.farClipPlane = 900f;
            camGo.AddComponent<AudioListener>();
            camGo.AddComponent<CameraRig>();
            camGo.transform.position = new Vector3(0, 40, -110);

            var stadiumGo = new GameObject("Stadium");
            var stadium = stadiumGo.AddComponent<Stadium>();
            stadium.Plain = m.Plain;
            stadium.Detail = m.Detail;
            stadium.Emissive = m.Emissive;
            stadium.Instanced = m.Instanced;
            stadium.SkyTemplate = m.Sky;
            stadium.GrassTex = m.Grass;
            stadium.SoilTex = m.Soil;
            stadium.ConcreteTex = m.Concrete;
            stadium.Sun = sun;

            var netGo = new GameObject("NetworkManager");
            var network = netGo.AddComponent<NetworkManager>();
            var transport = netGo.AddComponent<UnityTransport>();
            network.NetworkConfig ??= new NetworkConfig();
            network.NetworkConfig.NetworkTransport = transport;
            network.NetworkConfig.TickRate = 30;
            network.NetworkConfig.ConnectionApproval = false;
            network.NetworkConfig.PlayerPrefab = null;

            var app = new GameObject("Cricket");
            var director = app.AddComponent<MatchDirector>();
            app.AddComponent<ReplayRecorder>();
            app.AddComponent<AdService>();
            var view = app.AddComponent<MatchView>();
            view.CricketerPrefab = cricketer;
            view.BallMaterial = m.Ball;
            view.LineMaterial = m.Line;
            view.StumpMaterial = m.Stump;
            view.BailMaterial = m.Bail;
            view.Stadium = stadium;
            app.AddComponent<Hud>();
            app.AddComponent<Controls>();
            var boot = app.AddComponent<CricketBootstrap>();
            boot.Director = director;
            boot.Stadium = stadium;
            boot.Network = network;
            boot.OnlineTransport = transport;
            boot.NetMatchPrefab = netMatch;
            BuildPostFx(app, cam);

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }

        // ------------------------------------------------------------------ player settings (small, fast WebGL)

        public static void ConfigurePlayer()
        {
            PlayerSettings.companyName = "Shreyansh Sharan";
            PlayerSettings.productName = "Cricket";
            PlayerSettings.runInBackground = true;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.stripEngineCode = true;
            PlayerSettings.WebGL.template = "PROJECT:Cricket";
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Brotli;
            PlayerSettings.WebGL.decompressionFallback = true; // works on static hosts that don't send Content-Encoding
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
            PlayerSettings.WebGL.nameFilesAsHashes = false;
            PlayerSettings.WebGL.showDiagnostics = false;
            PlayerSettings.WebGL.initialMemorySize = 64;
            PlayerSettings.WebGL.memoryGrowthMode = WebGLMemoryGrowthMode.Geometric;
            PlayerSettings.WebGL.maximumMemorySize = 1024;
            PlayerSettings.WebGL.powerPreference = WebGLPowerPreference.HighPerformance;
            var webgl = NamedBuildTarget.WebGL;
            PlayerSettings.SetManagedStrippingLevel(webgl, ManagedStrippingLevel.High);
            PlayerSettings.SetIl2CppCodeGeneration(webgl, Il2CppCodeGeneration.OptimizeSize);
            PlayerSettings.SetIl2CppCompilerConfiguration(webgl, Il2CppCompilerConfiguration.Master);
            PlayerSettings.SetScriptingDefineSymbols(webgl, "UNITY_POST_PROCESSING_STACK_V2");
            SetWebGLCodeOptimization("DiskSizeLTO");
            ConfigureShaderStripping();
            QualitySettings.SetQualityLevel(Mathf.Min(3, QualitySettings.names.Length - 1), true);
            QualitySettings.shadowDistance = 140f;
            QualitySettings.shadowCascades = 2;
            QualitySettings.antiAliasing = 0;
        }

        /// <summary>Unity 6's WebGL "Code Optimization" (disk size with LTO) lives in the WebGL editor extension; set it if present.</summary>
        static void SetWebGLCodeOptimization(string value)
        {
            try
            {
                var type = AppDomain.CurrentDomain.GetAssemblies().Select(a => a.GetType("UnityEditor.WebGL.UserBuildSettings")).FirstOrDefault(t => t != null);
                var prop = type?.GetProperty("codeOptimization", BindingFlags.Public | BindingFlags.Static);
                if (prop == null) return;
                prop.SetValue(null, Enum.Parse(prop.PropertyType, value));
            }
            catch (Exception e)
            {
                Debug.Log($"Cricket: couldn't set WebGL code optimization ({e.Message}); set it to Disk Size with LTO in the Build Profile.");
            }
        }

        /// <summary>No lightmaps, no fog, no unused instancing variants: fewer shader variants in the build.</summary>
        static void ConfigureShaderStripping()
        {
            var gs = AssetDatabase.LoadAssetAtPath<Object>("ProjectSettings/GraphicsSettings.asset");
            if (gs == null) return;
            var so = new SerializedObject(gs);
            void Set(string name, int v) { var p = so.FindProperty(name); if (p != null) p.intValue = v; }
            void SetBool(string name, bool v) { var p = so.FindProperty(name); if (p != null) p.boolValue = v; }
            Set("m_LightmapStripping", 1);
            SetBool("m_LightmapKeepPlain", true);
            SetBool("m_LightmapKeepDirCombined", false);
            SetBool("m_LightmapKeepDynamicPlain", false);
            SetBool("m_LightmapKeepDynamicDirCombined", false);
            SetBool("m_LightmapKeepShadowMask", false);
            SetBool("m_LightmapKeepSubtractive", false);
            Set("m_FogStripping", 1);
            SetBool("m_FogKeepLinear", false);
            SetBool("m_FogKeepExp", false);
            SetBool("m_FogKeepExp2", false);
            Set("m_InstancingStripping", 0);
            so.ApplyModifiedPropertiesWithoutUndo();
        }

        /// <summary>Keeps what reflection needs under High stripping (Netcode, services, Newtonsoft, our serialized state).</summary>
        static void WriteLinkXml()
        {
            var path = Path.Combine(Application.dataPath, "Cricket/link.xml");
            const string xml =
@"<linker>
  <!-- Netcode for GameObjects, Unity Transport and Multiplayer Services use reflection and generated code. -->
  <assembly fullname=""Unity.Netcode.Runtime"" preserve=""all"" />
  <assembly fullname=""Unity.Networking.Transport"" preserve=""all"" />
  <assembly fullname=""Unity.Services.Core"" preserve=""all"" />
  <assembly fullname=""Unity.Services.Core.Internal"" preserve=""all"" />
  <assembly fullname=""Unity.Services.Core.Configuration"" preserve=""all"" ignoreIfMissing=""1"" />
  <assembly fullname=""Unity.Services.Core.Registration"" preserve=""all"" ignoreIfMissing=""1"" />
  <assembly fullname=""Unity.Services.Authentication"" preserve=""all"" />
  <assembly fullname=""Unity.Services.Multiplayer"" preserve=""all"" />
  <assembly fullname=""Unity.Services.QoS"" preserve=""all"" ignoreIfMissing=""1"" />
  <assembly fullname=""Unity.Services.Wire.Internal"" preserve=""all"" ignoreIfMissing=""1"" />
  <assembly fullname=""Newtonsoft.Json"" preserve=""all"" ignoreIfMissing=""1"" />
  <!-- glTFast is only used to import the character in the editor; kept if anything references it at runtime. -->
  <assembly fullname=""glTFast"" ignoreIfMissing=""1"">
    <namespace fullname=""GLTFast"" preserve=""nothing"" />
  </assembly>
  <!-- Match state, teams and reviews are serialized with JsonUtility (saves and the online state). -->
  <assembly fullname=""Assembly-CSharp"">
    <namespace fullname=""Cricket.Sim"" preserve=""all"" />
    <type fullname=""Cricket.Game.ReviewInfo"" preserve=""all"" />
    <type fullname=""Cricket.Core.WebBridge/Inbound"" preserve=""all"" />
    <type fullname=""Cricket.Net.NetMatch"" preserve=""all"" />
  </assembly>
</linker>
";
            if (!File.Exists(path) || File.ReadAllText(path) != xml)
            {
                File.WriteAllText(path, xml);
                AssetDatabase.ImportAsset("Assets/Cricket/link.xml");
            }
        }
    }
}
