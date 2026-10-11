using System;
using Arena.Map;
using Unity.Netcode;
using Unity.Netcode.Transports.SinglePlayer;
using Unity.Netcode.Transports.UTP;
using UnityEngine;

namespace Arena.Core
{
    /// <summary>
    /// Entry point. Reads launch options (from the page URL when embedded), then starts a solo match
    /// against bots, hosts an online match with a join code, or joins one.
    /// </summary>
    public class ArenaBootstrap : MonoBehaviour
    {
        public static ArenaBootstrap Instance { get; private set; }

        [Header("Networking")]
        public NetworkManager Network;
        public UnityTransport OnlineTransport;
        public SinglePlayerTransport OfflineTransport;

        [Header("Network prefabs")]
        public GameObject PlayerPrefab;
        public GameObject BotPrefab;
        public GameObject PickupPrefab;
        public GameObject MatchPrefab;

        [Header("Scene")]
        public Camera MenuCamera;

        public string Status { get; private set; } = "";
        public string JoinCode { get; private set; } = "";
        public bool Busy { get; private set; }
        public bool InGame => Network != null && Network.IsListening;

        void Awake()
        {
            Instance = this;
            Application.runInBackground = true;
            Application.targetFrameRate = 120;

            Network.NetworkConfig.PlayerPrefab = PlayerPrefab;
            foreach (var prefab in new[] { PlayerPrefab, BotPrefab, PickupPrefab, MatchPrefab })
                Network.AddNetworkPrefab(prefab);

            Network.OnServerStarted += OnServerStarted;
            Network.OnClientDisconnectCallback += OnClientDisconnected;

#if UNITY_WEBGL && !UNITY_EDITOR
            LaunchOptions.Current = LaunchOptions.FromUrl(Application.absoluteURL);
#endif
        }

        void Start()
        {
            MapRuntime.Activate(Maps.IndexOf(LaunchOptions.Current.Map));
            WebBridge.Post("ready");
            if (LaunchOptions.Current.Mode != LaunchMode.Menu) StartGame(LaunchOptions.Current);
        }

        public async void StartGame(LaunchOptions options)
        {
            if (Busy || InGame) return;
            LaunchOptions.Current = options;
            // Hosts (and solo) play their chosen map; joiners switch when the host's match syncs it.
            if (options.Mode != LaunchMode.Join) MapRuntime.Activate(Maps.IndexOf(options.Map));
            Busy = true;
            JoinCode = "";
            try
            {
                switch (options.Mode)
                {
                    case LaunchMode.Solo:
                        Status = "Starting...";
                        Network.NetworkConfig.NetworkTransport = OfflineTransport;
                        if (!Network.StartHost()) throw new Exception("Could not start the match.");
                        break;

                    case LaunchMode.Host:
                        Status = "Creating online match...";
                        UseOnlineTransport();
                        JoinCode = await SessionService.HostAsync();
                        WebBridge.Post("code", JoinCode);
                        break;

                    case LaunchMode.Join:
                        Status = $"Joining {options.Code}...";
                        UseOnlineTransport();
                        await SessionService.JoinAsync(options.Code);
                        JoinCode = options.Code;
                        break;
                }
                Status = "";
                WebBridge.Post("started", options.Mode.ToString().ToLowerInvariant());
            }
            catch (Exception e)
            {
                Debug.LogException(e);
                Status = options.Mode == LaunchMode.Join
                    ? "Couldn't join. Check the code and that the match is still running."
                    : "Couldn't start online play. Try solo mode, or check the Unity services setup.";
                WebBridge.Post("error", e.Message);
                LaunchOptions.Current.Mode = LaunchMode.Menu;
                if (Network.IsListening) Network.Shutdown();
            }
            finally
            {
                Busy = false;
            }
        }

        void UseOnlineTransport()
        {
            // Secure WebSockets everywhere so browser and desktop players can share a match.
            OnlineTransport.UseWebSockets = true;
            Network.NetworkConfig.NetworkTransport = OnlineTransport;
        }

        void OnServerStarted()
        {
            if (!Network.IsServer) return;
            var match = Instantiate(MatchPrefab);
            match.GetComponent<NetworkObject>().Spawn();
        }

        void OnClientDisconnected(ulong clientId)
        {
            if (Network == null || Network.IsServer) return;
            if (clientId == Network.LocalClientId || clientId == NetworkManager.ServerClientId)
            {
                Status = "Disconnected from the host.";
                ReturnToMenu();
            }
        }

        public async void Leave()
        {
            if (SessionService.Session != null) await SessionService.LeaveAsync();
            else if (Network.IsListening) Network.Shutdown();
            ReturnToMenu();
            WebBridge.Post("left");
        }

        void ReturnToMenu()
        {
            JoinCode = "";
            LaunchOptions.Current.Mode = LaunchMode.Menu;
            if (MenuCamera) MenuCamera.gameObject.SetActive(true);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }

        void OnDestroy()
        {
            if (Network != null)
            {
                Network.OnServerStarted -= OnServerStarted;
                Network.OnClientDisconnectCallback -= OnClientDisconnected;
            }
        }
    }
}
