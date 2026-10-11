using System;
using System.IO;
using System.Linq;
using System.Reflection;
using Arena.Core;
using Arena.Fx;
using Arena.Game;
using Arena.Map;
using Arena.UI;
using Unity.AI.Navigation;
using Unity.Netcode;
using Unity.Netcode.Components;
using Unity.Netcode.Transports.SinglePlayer;
using Unity.Netcode.Transports.UTP;
using UnityEditor;
using UnityEditor.Build;
using UnityEditor.SceneManagement;
using UnityEngine;
using UnityEngine.AI;
using UnityEngine.Rendering;
using UnityEngine.Rendering.PostProcessing;
using Object = UnityEngine.Object;

namespace Arena.EditorTools
{
    /// <summary>
    /// Generates everything the game needs from code: materials, characters, prefabs, every map, the
    /// NavMesh, post-processing and the scene, then builds WebGL straight into the portfolio site.
    /// Menu: Arena → … Batch mode: Unity -batchmode -quit -projectPath . -executeMethod Arena.EditorTools.ArenaSetup.GenerateAndBuild
    /// </summary>
    public static class ArenaSetup
    {
        const string Generated = "Assets/Arena/Generated";
        const string ScenePath = "Assets/Arena/Scenes/Arena.unity";
        const string TexturesDir = "Assets/Arena/Textures";
        const string ModelsDir = "Assets/Arena/Models";
        const string PostResourcesPath = "Packages/com.unity.postprocessing/PostProcessing/PostProcessResources.asset";

        [MenuItem("Arena/1. Generate Scene and Prefabs", priority = 1)]
        public static void Generate()
        {
            foreach (var dir in new[] { "Materials", "Prefabs", "Animations", "PostFx" })
                Directory.CreateDirectory($"{Generated}/{dir}");
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            AssetDatabase.Refresh();
            BoxMesh.ClearCache();

            var m = CreateMaterials();
            var palettes = Maps.All.Select(CreatePalette).ToArray();
            var operatorArt = ImportCharacter("Operator");
            var robotArt = ImportCharacter("Robot");
            var player = SavePrefab(BuildCharacter("Player", false, m, operatorArt), "Player");
            var bot = SavePrefab(BuildCharacter("Bot", true, m, robotArt ?? operatorArt), "Bot");
            var pickup = SavePrefab(BuildPickup(m), "Pickup");
            var match = SavePrefab(BuildMatch(), "Match");

            BuildScene(m, palettes, player, bot, pickup, match);
            ConfigurePlayer();
            AssetDatabase.SaveAssets();
            Debug.Log("Arena: scene and prefabs generated. Next: Arena → 2. Build WebGL into Portfolio Site.");
        }

        [MenuItem("Arena/2. Build WebGL into Portfolio Site", priority = 2)]
        public static void BuildWebGL()
        {
            if (!File.Exists(ScenePath)) Generate();
            ConfigurePlayer();
            var output = Path.GetFullPath(Path.Combine(Application.dataPath, "../../../site/public/games/arena"));
            EditorUserBuildSettings.SwitchActiveBuildTarget(BuildTargetGroup.WebGL, BuildTarget.WebGL);
            var report = BuildPipeline.BuildPlayer(new BuildPlayerOptions
            {
                scenes = new[] { ScenePath },
                locationPathName = output,
                target = BuildTarget.WebGL,
                options = BuildOptions.None,
            });
            Debug.Log($"Arena: WebGL build {report.summary.result}, {report.summary.totalSize / (1024f * 1024f):0.0} MB → {output}");
        }

        public static void GenerateAndBuild()
        {
            Generate();
            BuildWebGL();
        }

        // ---------------- Materials and textures ----------------

        class Mats
        {
            public Material Body, Visor, Gun, Glow, Pad, Fx, Skybox;
            public Material[] PickupMats;
        }

        static Material Mat(string name, Color color, float smoothness = 0.15f, float metallic = 0f, Color? emission = null, string shader = "Standard", Texture texture = null)
        {
            var path = $"{Generated}/Materials/{name}.mat";
            var mat = AssetDatabase.LoadAssetAtPath<Material>(path);
            if (mat == null)
            {
                mat = new Material(Shader.Find(shader));
                AssetDatabase.CreateAsset(mat, path);
            }
            mat.shader = Shader.Find(shader);
            if (mat.HasProperty("_Color")) mat.SetColor("_Color", color);
            if (mat.HasProperty("_MainTex")) mat.SetTexture("_MainTex", texture);
            if (mat.HasProperty("_Glossiness")) mat.SetFloat("_Glossiness", smoothness);
            if (mat.HasProperty("_Metallic")) mat.SetFloat("_Metallic", metallic);
            if (emission.HasValue)
            {
                mat.EnableKeyword("_EMISSION");
                mat.SetColor("_EmissionColor", emission.Value);
                mat.globalIlluminationFlags = MaterialGlobalIlluminationFlags.None;
            }
            else mat.DisableKeyword("_EMISSION");
            mat.enableInstancing = true;
            EditorUtility.SetDirty(mat);
            return mat;
        }

        /// <summary>Imports a tileable texture (repeat, mipmaps, crunch-compressed for a small WebGL build).</summary>
        static Texture2D Tex(string path, int maxSize)
        {
            if (!File.Exists(path))
            {
                Debug.LogWarning($"Arena: texture {path} is missing; using a flat colour.");
                return null;
            }
            if (AssetImporter.GetAtPath(path) is TextureImporter importer)
            {
                bool dirty = importer.wrapMode != TextureWrapMode.Repeat || importer.maxTextureSize != maxSize || !importer.mipmapEnabled
                             || !importer.crunchedCompression || importer.anisoLevel != 4 || importer.textureType != TextureImporterType.Default;
                if (dirty)
                {
                    importer.textureType = TextureImporterType.Default;
                    importer.sRGBTexture = true;
                    importer.wrapMode = TextureWrapMode.Repeat;
                    importer.mipmapEnabled = true;
                    importer.filterMode = FilterMode.Trilinear;
                    importer.anisoLevel = 4;
                    importer.maxTextureSize = maxSize;
                    importer.textureCompression = TextureImporterCompression.Compressed;
                    importer.crunchedCompression = true;
                    importer.compressionQuality = 50;
                    importer.SaveAndReimport();
                }
            }
            return AssetDatabase.LoadAssetAtPath<Texture2D>(path);
        }

        static Texture2D MapTex(string name, int maxSize = 512) => string.IsNullOrEmpty(name) ? null : Tex($"{TexturesDir}/{name}.jpg", maxSize);

        static Mats CreateMaterials()
        {
            var m = new Mats
            {
                Body = Mat("Body", Color.white, 0.45f, 0.2f),
                Visor = Mat("Visor", new Color(0.1f, 0.1f, 0.12f), 0.9f, 0f, new Color(0.9f, 0.95f, 1f) * 1.6f),
                Gun = Mat("Gun", new Color(0.12f, 0.13f, 0.16f), 0.6f, 0.7f),
                Glow = Mat("GunGlow", Color.white, 0.5f, 0f, new Color(1f, 0.6f, 0.2f) * 2f),
                Pad = Mat("PickupPad", Color.white, 0.4f, 0f, Color.white),
                PickupMats = new[]
                {
                    Mat("PickupHealth", new Color(0.3f, 1f, 0.45f), 0.6f, 0f, new Color(0.3f, 1f, 0.45f) * 1.8f),
                    Mat("PickupShield", new Color(0.25f, 0.85f, 1f), 0.6f, 0f, new Color(0.25f, 0.85f, 1f) * 1.8f),
                    Mat("PickupOverdrive", new Color(1f, 0.55f, 0.1f), 0.6f, 0f, new Color(1f, 0.55f, 0.1f) * 2f),
                    Mat("PickupHaste", new Color(0.85f, 0.4f, 1f), 0.6f, 0f, new Color(0.85f, 0.4f, 1f) * 1.8f),
                },
                Fx = Mat("Fx", Color.white, 0f, 0f, null, "Sprites/Default"),
            };

            var sky = Mat("Sky", Color.white, 0f, 0f, null, "Skybox/Procedural");
            sky.SetFloat("_SunSize", 0.05f);
            sky.SetFloat("_AtmosphereThickness", 1.15f);
            sky.SetColor("_SkyTint", new Color(0.95f, 0.62f, 0.45f));
            sky.SetColor("_GroundColor", new Color(0.55f, 0.42f, 0.32f));
            sky.SetFloat("_Exposure", 1.25f);
            m.Skybox = sky;
            AssetDatabase.SaveAssets();
            return m;
        }

        static MapPalette CreatePalette(MapDefinition def)
        {
            var t = def.Textures;
            var look = def.Look;
            string id = def.Id;
            var walls = new Material[t.Walls.Length];
            for (int i = 0; i < walls.Length; i++)
                walls[i] = Mat($"{id}_Wall{i}", look.WallTints[i % look.WallTints.Length], 0.08f, 0f, null, "Standard", MapTex(t.Walls[i]));

            Color orange = new Color(1f, 0.5f, 0.12f), blue = new Color(0.3f, 0.6f, 1f);
            return new MapPalette
            {
                Ground = Mat($"{id}_Ground", Color.white, 0.05f, 0f, null, "Standard", MapTex(t.Ground, 1024)),
                Floor = Mat($"{id}_Floor", new Color(0.9f, 0.9f, 0.9f), 0.1f, 0f, null, "Standard", MapTex(t.Floor)),
                Walls = walls,
                Roof = Mat($"{id}_Roof", new Color(0.8f, 0.8f, 0.8f), 0.1f, 0f, null, "Standard", MapTex(t.Roof)),
                Wood = Mat($"{id}_Wood", Color.white, 0.15f, 0f, null, "Standard", MapTex(t.Wood)),
                Metal = Mat($"{id}_Metal", Color.white, 0.45f, 0.4f, null, "Standard", MapTex(t.Metal)),
                Stone = Mat($"{id}_Stone", new Color(0.92f, 0.9f, 0.88f), 0.1f, 0f, null, "Standard", MapTex(t.Stone)),
                Accent = Mat($"{id}_Accent", Color.white, 0.3f, 0f, null, "Standard", MapTex(t.Accent)),
                NeonTrim = Mat($"{id}_Neon", look.Neon, 0.5f, 0f, look.Neon * 2.2f),
                NeonAlt = Mat($"{id}_NeonAlt", look.NeonAlt, 0.5f, 0f, look.NeonAlt * 2.2f),
                Glow = Mat($"{id}_Glow", look.Glow, 0.5f, 0f, look.Glow * 3f),
                SiteA = Mat($"{id}_SiteA", orange, 0.4f, 0f, new Color(1f, 0.45f, 0.08f) * 2f),
                SiteB = Mat($"{id}_SiteB", blue, 0.4f, 0f, new Color(0.25f, 0.55f, 1f) * 2f),
                Lane = Mat($"{id}_Lane", look.Neon, 0.5f, 0f, look.Neon * 1.4f),
                Water = Mat($"{id}_Water", new Color(0.03f, 0.07f, 0.13f), 0.95f, 0.3f),
                Board = Mat($"{id}_Board", new Color(0.04f, 0.045f, 0.07f), 0.6f, 0.3f, new Color(0.02f, 0.03f, 0.06f)),
            };
        }

        // ---------------- Characters ----------------

        class CharacterArt
        {
            public GameObject Model;
            public Material Material;
            public AnimationClip Idle, Run;
        }

        /// <summary>
        /// Loads a rigged GLB (glTFast import) plus its idle GLB. The run clip comes with the model; the idle
        /// clip was rigged separately, so it's retargeted onto the model's skeleton (rotations only).
        /// Returns null when the model isn't available, and the caller falls back to a simple body.
        /// </summary>
        static CharacterArt ImportCharacter(string name)
        {
            string modelPath = $"{ModelsDir}/{name}.glb", idlePath = $"{ModelsDir}/{name}_Idle.glb";
            if (!File.Exists(modelPath))
            {
                Debug.LogWarning($"Arena: {modelPath} not found; using the simple body.");
                return null;
            }
            UseLegacyAnimation(modelPath);
            if (File.Exists(idlePath)) UseLegacyAnimation(idlePath);

            var model = AssetDatabase.LoadAssetAtPath<GameObject>(modelPath);
            if (model == null)
            {
                Debug.LogWarning($"Arena: {modelPath} didn't import (is glTFast installed?); using the simple body.");
                return null;
            }

            var art = new CharacterArt
            {
                Model = model,
                Material = Mat($"{name}Body", Color.white, 0.3f, 0.1f, null, "Standard", Tex($"{ModelsDir}/{name}_Albedo.jpg", 1024)),
                Run = FirstClip(modelPath),
            };
            var hips = FindDeep(model.transform, "Hips");
            var idleSource = File.Exists(idlePath) ? FirstClip(idlePath) : null;
            if (idleSource != null && hips != null) art.Idle = RetargetClip(idleSource, $"{name}_Idle", hips.localPosition);
            if (art.Run == null || !art.Run.legacy) Debug.LogWarning($"Arena: {name} has no legacy run clip; it will stand still.");
            return art;
        }

        /// <summary>glTFast's editor import defaults to Mecanim clips; the game drives a legacy Animation component.</summary>
        static void UseLegacyAnimation(string path)
        {
            var importer = AssetImporter.GetAtPath(path);
            if (importer == null) return;
            var so = new SerializedObject(importer);
            var method = so.FindProperty("importSettings.animationMethod");
            if (method == null)
            {
                Debug.LogWarning($"Arena: couldn't find glTFast animation settings for {path}.");
                return;
            }
            const int legacy = 1; // GLTFast.AnimationMethod.Legacy
            var clip = FirstClip(path);
            if (method.intValue == legacy && (clip == null || clip.legacy)) return;
            method.intValue = legacy;
            so.ApplyModifiedPropertiesWithoutUndo();
            importer.SaveAndReimport();
        }

        static AnimationClip FirstClip(string path) =>
            AssetDatabase.LoadAllAssetsAtPath(path).OfType<AnimationClip>().FirstOrDefault(c => !c.name.StartsWith("__preview", StringComparison.Ordinal));

        static Transform FindDeep(Transform t, string name)
        {
            if (t.name == name) return t;
            foreach (Transform child in t)
            {
                var found = FindDeep(child, name);
                if (found) return found;
            }
            return null;
        }

        /// <summary>
        /// Copies a clip's bone rotations (bone names match between Meshy rigs) and the hips' motion relative
        /// to its first frame, re-based on the target's hips. Bone lengths stay the target's own.
        /// </summary>
        static AnimationClip RetargetClip(AnimationClip source, string name, Vector3 hipsRest)
        {
            var clip = new AnimationClip { name = name, legacy = true, wrapMode = WrapMode.Loop, frameRate = source.frameRate };
            int rotations = 0;
            foreach (var binding in AnimationUtility.GetCurveBindings(source))
            {
                if (binding.type != typeof(Transform)) continue;
                string prop = binding.propertyName;
                bool position = prop.IndexOf("LocalPosition", StringComparison.OrdinalIgnoreCase) >= 0;
                bool rotation = prop.IndexOf("LocalRotation", StringComparison.OrdinalIgnoreCase) >= 0
                                || prop.IndexOf("localEulerAngles", StringComparison.OrdinalIgnoreCase) >= 0;
                if (!position && !rotation) continue;
                bool hips = binding.path == "Hips" || binding.path.EndsWith("/Hips", StringComparison.Ordinal);
                if (position && !hips) continue;

                var curve = AnimationUtility.GetEditorCurve(source, binding);
                if (curve == null) continue;
                char axis = prop[prop.Length - 1];
                if (position)
                {
                    int i = axis == 'x' ? 0 : axis == 'y' ? 1 : 2;
                    float offset = hipsRest[i] - curve.Evaluate(0f);
                    var keys = curve.keys;
                    for (int k = 0; k < keys.Length; k++) keys[k].value += offset;
                    curve.keys = keys;
                }
                else rotations++;
                AnimationUtility.SetEditorCurve(clip, binding, curve);
            }
            if (rotations == 0)
            {
                Debug.LogWarning($"Arena: no rotation curves found in {source.name}; {name} skipped.");
                return null;
            }
            clip.EnsureQuaternionContinuity();
            var path = $"{Generated}/Animations/{name}.anim";
            AssetDatabase.DeleteAsset(path);
            AssetDatabase.CreateAsset(clip, path);
            return clip;
        }

        // ---------------- Prefabs ----------------

        static GameObject Part(string name, PrimitiveType type, Transform parent, Vector3 pos, Vector3 scale, Material mat, Vector3? euler = null)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            Object.DestroyImmediate(go.GetComponent<Collider>());
            go.transform.SetParent(parent, false);
            go.transform.localPosition = pos;
            go.transform.localScale = scale;
            go.transform.localEulerAngles = euler ?? Vector3.zero;
            go.GetComponent<MeshRenderer>().sharedMaterial = mat;
            return go;
        }

        static GameObject BuildCharacter(string name, bool isBot, Mats m, CharacterArt art)
        {
            var root = new GameObject(name);
            Renderer[] body;
            float tint;
            if (art != null)
            {
                // Meshy rigs are authored in metres (1.8 m tall, feet at the origin) under a 0.01-scaled
                // Armature, so the model goes in as is: no normalising by bounds.
                var model = (GameObject)Object.Instantiate(art.Model);
                model.name = "Model";
                model.transform.SetParent(root.transform, false);
                model.transform.localPosition = Vector3.zero;
                model.transform.localRotation = Quaternion.identity;
                model.transform.localScale = Vector3.one;
                foreach (var old in model.GetComponentsInChildren<Animation>(true)) Object.DestroyImmediate(old);
                foreach (var old in model.GetComponentsInChildren<Collider>(true)) Object.DestroyImmediate(old);
                var animation = model.AddComponent<Animation>();
                animation.playAutomatically = false;

                body = model.GetComponentsInChildren<Renderer>(true);
                foreach (var r in body)
                {
                    r.sharedMaterials = Enumerable.Repeat(art.Material, r.sharedMaterials.Length).ToArray();
                    r.shadowCastingMode = ShadowCastingMode.On;
                    if (r is SkinnedMeshRenderer skinned) skinned.updateWhenOffscreen = false;
                }

                var animator = root.AddComponent<CharacterAnimator>();
                animator.Animation = animation;
                animator.Run = art.Run;
                animator.Idle = art.Idle;
                tint = 0.4f;
            }
            else
            {
                var capsule = Part("Body", PrimitiveType.Capsule, root.transform, new Vector3(0, 0.9f, 0), new Vector3(0.8f, 0.9f, 0.8f), m.Body);
                var pack = Part("Backpack", PrimitiveType.Cube, root.transform, new Vector3(0, 1.1f, -0.38f), new Vector3(0.48f, 0.55f, 0.22f), m.Body);
                var visor = Part("Visor", PrimitiveType.Cube, root.transform, new Vector3(0, 1.52f, 0.3f), new Vector3(0.5f, 0.13f, 0.14f), m.Visor);
                body = new[] { capsule.GetComponent<Renderer>(), pack.GetComponent<Renderer>(), visor.GetComponent<Renderer>() };
                tint = 1f;
            }

            var head = new GameObject("Head").transform;
            head.SetParent(root.transform, false);
            head.localPosition = new Vector3(0, 1.6f, 0);

            var gun = Part("Gun", PrimitiveType.Cube, head, new Vector3(0.3f, -0.3f, 0.35f), new Vector3(0.12f, 0.15f, 0.62f), m.Gun);
            var glow = Part("GunGlow", PrimitiveType.Cube, gun.transform, new Vector3(0, 0.55f, 0.05f), new Vector3(0.6f, 0.15f, 0.8f), m.Glow);
            var muzzle = new GameObject("Muzzle").transform;
            muzzle.SetParent(gun.transform, false);
            muzzle.localPosition = new Vector3(0, 0, 0.55f);

            var netObj = root.AddComponent<NetworkObject>();
            netObj.DontDestroyWithOwner = false;
            var nt = root.AddComponent<NetworkTransform>();
            nt.AuthorityMode = isBot ? NetworkTransform.AuthorityModes.Server : NetworkTransform.AuthorityModes.Owner;
            nt.SyncRotAngleX = false;
            nt.SyncRotAngleZ = false;
            nt.SyncScaleX = nt.SyncScaleY = nt.SyncScaleZ = false;
            nt.Interpolate = true;

            // Hitboxes stay simple 1.8 m capsules; the top 0.35 m counts as the head.
            Collider hit;
            if (isBot)
            {
                var capsule = root.AddComponent<CapsuleCollider>();
                capsule.center = new Vector3(0, 0.9f, 0);
                capsule.height = 1.8f;
                capsule.radius = 0.4f;
                hit = capsule;
                var agent = root.AddComponent<NavMeshAgent>();
                agent.radius = 0.4f;
                agent.height = 1.8f;
                agent.baseOffset = 0f;
                agent.enabled = false;
            }
            else
            {
                var cc = root.AddComponent<CharacterController>();
                cc.center = new Vector3(0, 0.9f, 0);
                cc.height = 1.8f;
                cc.radius = 0.4f;
                cc.stepOffset = 0.4f;
                cc.slopeLimit = 50f;
                cc.skinWidth = 0.04f;
                hit = cc;
            }

            var combatant = root.AddComponent<Combatant>();
            combatant.IsBot = isBot;
            combatant.Eye = head;
            combatant.BodyRenderers = body;
            combatant.BodyTint = tint;
            combatant.GunRenderers = new Renderer[] { gun.GetComponent<Renderer>(), glow.GetComponent<Renderer>() };
            combatant.HitCollider = hit;

            var weapon = root.AddComponent<Weapon>();
            weapon.Muzzle = muzzle;

            if (isBot) root.AddComponent<BotBrain>();
            else
            {
                var pc = root.AddComponent<PlayerController>();
                pc.Head = head;
                pc.GunModel = gun.transform;
            }
            return root;
        }

        static GameObject BuildPickup(Mats m)
        {
            var root = new GameObject("Pickup");
            root.AddComponent<NetworkObject>();
            var pickup = root.AddComponent<Pickup>();
            var pad = Part("Pad", PrimitiveType.Cylinder, root.transform, new Vector3(0, -0.85f, 0), new Vector3(1.8f, 0.04f, 1.8f), m.Pad);
            var spinner = new GameObject("Spinner").transform;
            spinner.SetParent(root.transform, false);

            var health = new GameObject("Health");
            health.transform.SetParent(spinner, false);
            Part("Bar", PrimitiveType.Cube, health.transform, Vector3.zero, new Vector3(0.7f, 0.22f, 0.22f), m.PickupMats[0]);
            Part("Bar", PrimitiveType.Cube, health.transform, Vector3.zero, new Vector3(0.22f, 0.7f, 0.22f), m.PickupMats[0]);

            var shield = new GameObject("Shield");
            shield.transform.SetParent(spinner, false);
            Part("Disc", PrimitiveType.Cylinder, shield.transform, Vector3.zero, new Vector3(0.65f, 0.06f, 0.65f), m.PickupMats[1], new Vector3(90, 0, 0));
            Part("Core", PrimitiveType.Sphere, shield.transform, Vector3.zero, Vector3.one * 0.3f, m.PickupMats[1]);

            var overdrive = new GameObject("Overdrive");
            overdrive.transform.SetParent(spinner, false);
            Part("Gem", PrimitiveType.Cube, overdrive.transform, Vector3.zero, Vector3.one * 0.45f, m.PickupMats[2], new Vector3(45, 0, 45));

            var haste = new GameObject("Haste");
            haste.transform.SetParent(spinner, false);
            Part("Chevron", PrimitiveType.Cube, haste.transform, new Vector3(0, 0.12f, 0), new Vector3(0.6f, 0.12f, 0.12f), m.PickupMats[3], new Vector3(0, 0, 30));
            Part("Chevron", PrimitiveType.Cube, haste.transform, new Vector3(0, -0.12f, 0), new Vector3(0.6f, 0.12f, 0.12f), m.PickupMats[3], new Vector3(0, 0, -30));

            pickup.Visuals = new[] { health, shield, overdrive, haste };
            pickup.Spinner = spinner;
            pickup.Pad = pad.GetComponent<Renderer>();
            return root;
        }

        static GameObject BuildMatch()
        {
            var root = new GameObject("Match");
            root.AddComponent<NetworkObject>();
            root.AddComponent<MatchManager>();
            return root;
        }

        static GameObject SavePrefab(GameObject go, string name)
        {
            var path = $"{Generated}/Prefabs/{name}.prefab";
            var asset = PrefabUtility.SaveAsPrefabAsset(go, path);
            Object.DestroyImmediate(go);
            // Make sure the NetworkObject has its GlobalObjectIdHash before anything references it.
            var networkObject = asset.GetComponent<NetworkObject>();
            typeof(NetworkObject).GetMethod("OnValidate", BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public)
                ?.Invoke(networkObject, null);
            EditorUtility.SetDirty(asset);
            AssetDatabase.SaveAssets();
            return asset;
        }

        // ---------------- Post-processing ----------------

        static PostProcessProfile Profile(string name, Action<PostProcessProfile> fill)
        {
            var path = $"{Generated}/PostFx/{name}.asset";
            AssetDatabase.DeleteAsset(path);
            var profile = ScriptableObject.CreateInstance<PostProcessProfile>();
            AssetDatabase.CreateAsset(profile, path);
            fill(profile);
            foreach (var settings in profile.settings) AssetDatabase.AddObjectToAsset(settings, profile);
            EditorUtility.SetDirty(profile);
            AssetDatabase.SaveAssets();
            return profile;
        }

        static PostProcessVolume Volume(Transform parent, string name, PostProcessProfile profile, float priority, float weight)
        {
            var go = new GameObject(name);
            go.transform.SetParent(parent, false);
            var volume = go.AddComponent<PostProcessVolume>();
            volume.isGlobal = true;
            volume.priority = priority;
            volume.weight = weight;
            volume.sharedProfile = profile;
            return volume;
        }

        static PostFx BuildPostFx(GameObject app, Camera menuCamera)
        {
            var resources = AssetDatabase.LoadAssetAtPath<PostProcessResources>(PostResourcesPath);
            if (resources == null)
            {
                Debug.LogWarning("Arena: Post Processing package resources not found; the game runs without post effects.");
                return null;
            }

            var look = Profile("ArenaLook", p =>
            {
                var bloom = p.AddSettings<Bloom>();
                bloom.intensity.Override(0.75f);
                bloom.threshold.Override(1.05f);
                bloom.softKnee.Override(0.55f);
                bloom.diffusion.Override(6.5f);
                bloom.fastMode.Override(true);
                var grading = p.AddSettings<ColorGrading>();
                grading.gradingMode.Override(GradingMode.HighDefinitionRange);
                grading.tonemapper.Override(Tonemapper.ACES);
                grading.postExposure.Override(0.35f);
                grading.saturation.Override(8f);
                grading.contrast.Override(6f);
                var vignette = p.AddSettings<Vignette>();
                vignette.intensity.Override(0.28f);
                vignette.smoothness.Override(0.45f);
            });
            var blur = Profile("ArenaMenuBlur", p =>
            {
                var dof = p.AddSettings<DepthOfField>();
                dof.focusDistance.Override(0.3f);
                dof.aperture.Override(1.2f);
                dof.focalLength.Override(95f);
                dof.kernelSize.Override(KernelSize.Medium);
                var vignette = p.AddSettings<Vignette>();
                vignette.intensity.Override(0.45f);
                vignette.smoothness.Override(0.5f);
            });
            var dash = Profile("ArenaDash", p =>
            {
                var motion = p.AddSettings<MotionBlur>();
                motion.shutterAngle.Override(220f);
                motion.sampleCount.Override(8);
            });

            var volumes = new GameObject("Post Volumes").transform;
            var fx = app.AddComponent<PostFx>();
            fx.Resources = resources;
            Volume(volumes, "Look", look, 0f, 1f);
            fx.BlurVolume = Volume(volumes, "Menu blur", blur, 10f, 1f);
            fx.DashVolume = Volume(volumes, "Dash blur", dash, 5f, 0f);

            menuCamera.allowHDR = true;
            PostFx.Configure(menuCamera.gameObject.AddComponent<PostProcessLayer>(), resources);
            return fx;
        }

        // ---------------- Scene ----------------

        static void BuildScene(Mats m, MapPalette[] palettes, GameObject player, GameObject bot, GameObject pickup, GameObject match)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.shadows = LightShadows.Soft;
            RenderSettings.skybox = m.Skybox;
            RenderSettings.sun = sun;

            // Every map lives in the one scene, hundreds of metres apart; only the active one is enabled.
            var mapsRoot = new GameObject("Maps");
            var roots = new GameObject[Maps.All.Length];
            for (int i = 0; i < roots.Length; i++)
            {
                roots[i] = MapBuilder.Build(Maps.All[i], palettes[i]);
                roots[i].transform.SetParent(mapsRoot.transform, true);
            }
            foreach (var t in mapsRoot.GetComponentsInChildren<Transform>(true))
            {
                var go = t.gameObject;
                if (go.GetComponent<TextMesh>() || go.GetComponent<Billboard>()) continue;
                GameObjectUtility.SetStaticEditorFlags(go, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic);
            }

            // One NavMesh covering all maps, baked while every map is enabled.
            var surface = mapsRoot.AddComponent<NavMeshSurface>();
            surface.collectObjects = CollectObjects.Children;
            surface.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            surface.BuildNavMesh();
            AssetDatabase.DeleteAsset($"{Generated}/DunesNavMesh.asset");
            var navPath = $"{Generated}/ArenaNavMesh.asset";
            AssetDatabase.DeleteAsset(navPath);
            AssetDatabase.CreateAsset(surface.navMeshData, navPath);

            var runtime = mapsRoot.AddComponent<MapRuntime>();
            runtime.Roots = roots;
            runtime.Sun = sun;
            runtime.Skybox = m.Skybox;
            for (int i = 1; i < roots.Length; i++) roots[i].SetActive(false);
            MapRuntime.ApplyLook(Maps.All[0].Look, sun, m.Skybox);

            var networkGo = new GameObject("NetworkManager");
            var network = networkGo.AddComponent<NetworkManager>();
            var online = networkGo.AddComponent<UnityTransport>();
            var offline = networkGo.AddComponent<SinglePlayerTransport>();
            network.NetworkConfig ??= new NetworkConfig();
            network.NetworkConfig.NetworkTransport = online;
            network.NetworkConfig.TickRate = 30;
            network.NetworkConfig.ConnectionApproval = false;

            var menuCam = new GameObject("Menu Camera");
            menuCam.tag = "MainCamera";
            var cam = menuCam.AddComponent<Camera>();
            cam.fieldOfView = 55f;
            cam.farClipPlane = 400f;
            menuCam.AddComponent<AudioListener>();
            menuCam.AddComponent<MenuOrbit>();

            var app = new GameObject("Arena");
            var boot = app.AddComponent<ArenaBootstrap>();
            boot.Network = network;
            boot.OnlineTransport = online;
            boot.OfflineTransport = offline;
            boot.PlayerPrefab = player;
            boot.BotPrefab = bot;
            boot.PickupPrefab = pickup;
            boot.MatchPrefab = match;
            boot.MenuCamera = cam;
            app.AddComponent<ArenaHud>();
            app.AddComponent<FxLibrary>().GlowMaterial = m.Fx;
            BuildPostFx(app, cam);

            EditorSceneManager.SaveScene(scene, ScenePath);
            EditorBuildSettings.scenes = new[] { new EditorBuildSettingsScene(ScenePath, true) };
        }

        static void ConfigurePlayer()
        {
            PlayerSettings.companyName = "Shreyansh Sharan";
            PlayerSettings.productName = "Dunes Arena";
            PlayerSettings.runInBackground = true;
            PlayerSettings.colorSpace = ColorSpace.Linear;
            PlayerSettings.WebGL.template = "PROJECT:Arena";
            PlayerSettings.WebGL.compressionFormat = WebGLCompressionFormat.Gzip;
            PlayerSettings.WebGL.decompressionFallback = true; // static hosts like GitHub Pages don't send Content-Encoding
            PlayerSettings.WebGL.dataCaching = true;
            PlayerSettings.WebGL.exceptionSupport = WebGLExceptionSupport.ExplicitlyThrownExceptionsOnly;
            PlayerSettings.SetManagedStrippingLevel(NamedBuildTarget.WebGL, ManagedStrippingLevel.Medium);
        }
    }
}
