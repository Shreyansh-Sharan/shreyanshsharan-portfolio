using System.IO;
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

namespace Arena.EditorTools
{
    /// <summary>
    /// Generates everything the game needs from code: materials, prefabs, the map, the NavMesh and the
    /// scene, then builds WebGL straight into the portfolio site. Menu: Arena → …
    /// Batch mode: Unity -batchmode -quit -projectPath . -executeMethod Arena.EditorTools.ArenaSetup.GenerateAndBuild
    /// </summary>
    public static class ArenaSetup
    {
        const string Generated = "Assets/Arena/Generated";
        const string ScenePath = "Assets/Arena/Scenes/Arena.unity";

        [MenuItem("Arena/1. Generate Scene and Prefabs", priority = 1)]
        public static void Generate()
        {
            Directory.CreateDirectory(Generated + "/Materials");
            Directory.CreateDirectory(Generated + "/Prefabs");
            Directory.CreateDirectory(Path.GetDirectoryName(ScenePath));
            AssetDatabase.Refresh();

            var m = CreateMaterials();
            var player = SavePrefab(BuildCharacter("Player", false, m), "Player");
            var bot = SavePrefab(BuildCharacter("Bot", true, m), "Bot");
            var pickup = SavePrefab(BuildPickup(m), "Pickup");
            var match = SavePrefab(BuildMatch(), "Match");

            BuildScene(m, player, bot, pickup, match);
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

        // ---------------- Materials ----------------

        class Mats
        {
            public MapPalette Palette;
            public Material Body, Visor, Gun, Glow, Pad, Fx, Skybox;
            public Material[] PickupMats;
        }

        static Material Mat(string name, Color color, float smoothness = 0.15f, float metallic = 0f, Color? emission = null, string shader = "Standard")
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

        static Mats CreateMaterials()
        {
            var m = new Mats();
            Color teal = new Color(0.1f, 0.85f, 0.9f);
            m.Palette = new MapPalette
            {
                Ground = Mat("Ground", new Color(0.83f, 0.68f, 0.48f), 0.05f),
                TunnelFloor = Mat("TunnelFloor", new Color(0.42f, 0.36f, 0.3f), 0.1f),
                Walls = new[]
                {
                    Mat("WallSand", new Color(0.88f, 0.74f, 0.54f), 0.08f),
                    Mat("WallLight", new Color(0.93f, 0.84f, 0.68f), 0.08f),
                    Mat("WallDusk", new Color(0.78f, 0.6f, 0.45f), 0.08f),
                },
                Roof = Mat("Roof", new Color(0.36f, 0.3f, 0.26f), 0.1f),
                Wood = Mat("Wood", new Color(0.6f, 0.42f, 0.24f), 0.15f),
                Metal = Mat("MetalCrate", new Color(0.22f, 0.4f, 0.55f), 0.45f, 0.4f),
                Stone = Mat("Stone", new Color(0.7f, 0.64f, 0.56f), 0.1f),
                NeonTrim = Mat("NeonTrim", teal, 0.5f, 0f, teal * 2.2f),
                SiteA = Mat("SiteA", new Color(1f, 0.5f, 0.12f), 0.4f, 0f, new Color(1f, 0.45f, 0.08f) * 2f),
                SiteB = Mat("SiteB", new Color(0.3f, 0.6f, 1f), 0.4f, 0f, new Color(0.25f, 0.55f, 1f) * 2f),
                Lane = Mat("Lane", teal, 0.5f, 0f, teal * 1.4f),
            };
            m.Body = Mat("Body", Color.white, 0.45f, 0.2f);
            m.Visor = Mat("Visor", new Color(0.1f, 0.1f, 0.12f), 0.9f, 0f, new Color(0.9f, 0.95f, 1f) * 1.6f);
            m.Gun = Mat("Gun", new Color(0.12f, 0.13f, 0.16f), 0.6f, 0.7f);
            m.Glow = Mat("GunGlow", Color.white, 0.5f, 0f, new Color(1f, 0.6f, 0.2f) * 2f);
            m.Pad = Mat("PickupPad", Color.white, 0.4f, 0f, Color.white);
            m.PickupMats = new[]
            {
                Mat("PickupHealth", new Color(0.3f, 1f, 0.45f), 0.6f, 0f, new Color(0.3f, 1f, 0.45f) * 1.8f),
                Mat("PickupShield", new Color(0.25f, 0.85f, 1f), 0.6f, 0f, new Color(0.25f, 0.85f, 1f) * 1.8f),
                Mat("PickupOverdrive", new Color(1f, 0.55f, 0.1f), 0.6f, 0f, new Color(1f, 0.55f, 0.1f) * 2f),
                Mat("PickupHaste", new Color(0.85f, 0.4f, 1f), 0.6f, 0f, new Color(0.85f, 0.4f, 1f) * 1.8f),
            };
            m.Fx = Mat("Fx", Color.white, 0f, 0f, null, "Sprites/Default");

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

        static GameObject BuildCharacter(string name, bool isBot, Mats m)
        {
            var root = new GameObject(name);
            var body = Part("Body", PrimitiveType.Capsule, root.transform, new Vector3(0, 0.9f, 0), new Vector3(0.8f, 0.9f, 0.8f), m.Body);
            var pack = Part("Backpack", PrimitiveType.Cube, root.transform, new Vector3(0, 1.1f, -0.38f), new Vector3(0.48f, 0.55f, 0.22f), m.Body);
            var visor = Part("Visor", PrimitiveType.Cube, root.transform, new Vector3(0, 1.52f, 0.3f), new Vector3(0.5f, 0.13f, 0.14f), m.Visor);

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
            combatant.BodyRenderers = new Renderer[] { body.GetComponent<Renderer>(), pack.GetComponent<Renderer>(), visor.GetComponent<Renderer>() };
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

        // ---------------- Scene ----------------

        static void BuildScene(Mats m, GameObject player, GameObject bot, GameObject pickup, GameObject match)
        {
            var scene = EditorSceneManager.NewScene(NewSceneSetup.EmptyScene, NewSceneMode.Single);

            var sun = new GameObject("Sun").AddComponent<Light>();
            sun.type = LightType.Directional;
            sun.color = new Color(1f, 0.92f, 0.8f);
            sun.intensity = 1.3f;
            sun.shadows = LightShadows.Soft;
            sun.shadowStrength = 0.75f;
            sun.transform.rotation = Quaternion.Euler(42f, -35f, 0f);

            RenderSettings.skybox = m.Skybox;
            RenderSettings.sun = sun;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = new Color(0.62f, 0.62f, 0.72f);
            RenderSettings.ambientEquatorColor = new Color(0.58f, 0.48f, 0.38f);
            RenderSettings.ambientGroundColor = new Color(0.28f, 0.22f, 0.17f);
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = new Color(0.88f, 0.72f, 0.55f);
            RenderSettings.fogStartDistance = 45f;
            RenderSettings.fogEndDistance = 170f;

            var map = MapBuilder.Build(m.Palette);
            foreach (var t in map.GetComponentsInChildren<Transform>())
                GameObjectUtility.SetStaticEditorFlags(t.gameObject, StaticEditorFlags.BatchingStatic | StaticEditorFlags.OccluderStatic | StaticEditorFlags.OccludeeStatic);

            var surface = map.AddComponent<NavMeshSurface>();
            surface.collectObjects = CollectObjects.Children;
            surface.useGeometry = NavMeshCollectGeometry.PhysicsColliders;
            surface.BuildNavMesh();
            var navPath = $"{Generated}/DunesNavMesh.asset";
            AssetDatabase.DeleteAsset(navPath);
            AssetDatabase.CreateAsset(surface.navMeshData, navPath);

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
