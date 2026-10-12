using System;
using System.Collections;
using Cricket.Fx;
using Cricket.Game;
using Cricket.Net;
using Cricket.Sim;
using Cricket.UI;
using Cricket.View;
using Unity.Netcode;
using Unity.Netcode.Transports.UTP;
using UnityEngine;

namespace Cricket.Core
{
    /// <summary>
    /// Entry point. Shows the menu at once, builds the stadium in the background, reads launch options (URL or a
    /// "start" message from the page that preloaded the game), and runs a quick match against the CPU or a 1v1 online
    /// match (host with a code, or join). Asks the page for ad breaks at natural pauses.
    /// </summary>
    public class CricketBootstrap : MonoBehaviour
    {
        public static CricketBootstrap Instance { get; private set; }

        [Header("Scene")]
        public MatchDirector Director;
        public Stadium Stadium;
        public NetworkManager Network;
        public UnityTransport OnlineTransport;
        public GameObject NetMatchPrefab;

        public string Status { get; private set; } = "";
        public string Error { get; private set; } = "";
        public string JoinCode { get; private set; } = "";
        public bool Busy { get; private set; }
        public bool InMatch { get; private set; }
        public bool StadiumReady => Stadium == null || Stadium.Ready;
        public float StadiumProgress => Stadium == null ? 1f : Stadium.Progress;

        LaunchOptions pending;
        LaunchOptions last;
        string guestTeamJson;
        float guestJoinedAt = -1f;
        bool waitingForGuest;

        void Awake()
        {
            Instance = this;
            Application.runInBackground = true;
            Application.targetFrameRate = 60;
#if UNITY_WEBGL && !UNITY_EDITOR
            LaunchOptions.Current = LaunchOptions.FromUrl(Application.absoluteURL);
#endif
            if (Network != null)
            {
                if (NetMatchPrefab) Network.AddNetworkPrefab(NetMatchPrefab);
                Network.OnServerStarted += OnServerStarted;
                Network.OnClientConnectedCallback += OnClientConnected;
                Network.OnClientDisconnectCallback += OnClientDisconnected;
            }
            if (OnlineTransport != null)
            {
                // Match state goes over as JSON; allow messages bigger than the default.
                OnlineTransport.MaxPayloadSize = 256 * 1024;
                OnlineTransport.MaxSendQueueSize = 1024 * 1024;
            }
            NetMatch.OnGuestTeam = json => guestTeamJson = json;
            if (Director) Director.OnEvent += OnMatchEvent;
        }

        IEnumerator Start()
        {
            WebBridge.Post("ready");
            var opts = LaunchOptions.Current;
            if (opts.Mode == LaunchMode.Quick || opts.Mode == LaunchMode.Host || opts.Mode == LaunchMode.Join) pending = opts;
            // Build the stadium in the background (time-sliced) while the menu shows.
            if (Stadium != null) yield return Stadium.Build(opts.Pitch, opts.Time);
            WebBridge.Post("loaded");
            Sfx.Ambience(true, 0.18f);
        }

        void Update()
        {
            // Messages from the page: start a preloaded game, ad replies.
            for (int i = 0; i < 8; i++)
            {
                var json = WebBridge.Poll();
                if (json == null) break;
                WebBridge.Inbound msg = null;
                try { msg = JsonUtility.FromJson<WebBridge.Inbound>(json); } catch { }
                if (msg == null) continue;
                if (msg.type == "start" && !InMatch && !Busy)
                {
                    var o = LaunchOptions.FromQuery(msg.query);
                    LaunchOptions.Current = o;
                    pending = o.Mode == LaunchMode.Menu || o.Mode == LaunchMode.Lobby ? null : o;
                    if (pending == null) Hud.Open(true);
                }
                else if (msg.type == "mute") AudioListener.volume = 0f;
                else if (msg.type == "unmute") AudioListener.volume = Settings.Volume;
                else AdService.Instance?.OnMessage(msg);
            }

            if (pending != null && StadiumReady && !Busy)
            {
                var o = pending;
                pending = null;
                Launch(o);
            }

            // Host: start once the guest is here (and has had a moment to send his team).
            if (waitingForGuest && guestJoinedAt > 0f && (guestTeamJson != null || Time.unscaledTime - guestJoinedAt > 4f))
            {
                waitingForGuest = false;
                StartOnline();
            }
            // Guest: send our team to the host once the match object exists.
            if (sendTeamWhenReady && NetMatch.Instance != null && NetMatch.Instance.IsSpawned)
            {
                sendTeamWhenReady = false;
                var mine = last?.ToSetup().Teams[0];
                if (mine != null) NetMatch.Instance.SendTeam(JsonUtility.ToJson(mine));
            }
        }

        bool sendTeamWhenReady;

        /// <summary>Starts what the options ask for (from the menu or the page).</summary>
        public void Launch(LaunchOptions o)
        {
            if (Busy) return;
            if (!StadiumReady) { pending = o; Status = "Building the stadium…"; return; }
            last = o;
            LaunchOptions.Current = o;
            Error = "";
            switch (o.Mode)
            {
                case LaunchMode.Host: Host(o); break;
                case LaunchMode.Join: Join(o); break;
                default: StartQuick(o); break;
            }
        }

        void Prepare(LaunchOptions o)
        {
            Stadium?.ApplyPitch(o.Pitch);
            Stadium?.ApplyTime(o.Time);
            Sfx.Ambience(true, o.Time == TimeOfDay.Night ? 0.4f : 0.32f);
        }

        void StartQuick(LaunchOptions o)
        {
            Prepare(o);
            var setup = o.ToSetup();
            setup.SideNames = new[] { o.Name, "CPU" };
            Director.IsAuthority = true;
            Director.Online = false;
            Director.LocalSide = 0;
            Director.SideHuman = new[] { true, false };
            Director.StartMatch(setup);
            InMatch = true;
            Status = "";
            Hud.Open(false);
            WebBridge.Post("started", "quick");
        }

        async void Host(LaunchOptions o)
        {
            Busy = true;
            Status = "Creating an online match…";
            Hud.Open(false);
            try
            {
                UseOnlineTransport();
                JoinCode = await SessionService.HostAsync();
                WebBridge.Post("code", JoinCode);
                Status = "Waiting for your opponent to join…";
                waitingForGuest = true;
                guestTeamJson = null;
                guestJoinedAt = -1f;
                Prepare(o);
            }
            catch (Exception e)
            {
                Fail(e, "Couldn't create the online match.");
            }
            finally { Busy = false; }
        }

        async void Join(LaunchOptions o)
        {
            Busy = true;
            Status = $"Joining {o.Code}…";
            Hud.Open(false);
            try
            {
                UseOnlineTransport();
                await SessionService.JoinAsync(o.Code);
                JoinCode = o.Code;
                Status = "Connected. Waiting for the host to start…";
                Director.IsAuthority = false;
                Director.Online = true;
                Director.LocalSide = 1;
                Director.SideHuman = new[] { true, true };
                sendTeamWhenReady = true;
                InMatch = true;
                WebBridge.Post("started", "join");
            }
            catch (Exception e)
            {
                Fail(e, "Couldn't join. Check the code and that the match is still open.");
            }
            finally { Busy = false; }
        }

        void Fail(Exception e, string summary)
        {
            Debug.LogException(e);
            Status = summary;
            Error = SessionService.Explain(e);
            WebBridge.Post("error", Error);
            if (Network != null && Network.IsListening) Network.Shutdown();
            InMatch = false;
        }

        void UseOnlineTransport()
        {
            // Secure WebSockets so browser players can connect through Relay.
            OnlineTransport.UseWebSockets = true;
            Network.NetworkConfig.NetworkTransport = OnlineTransport;
        }

        void OnServerStarted()
        {
            if (!Network.IsServer || !NetMatchPrefab) return;
            var go = Instantiate(NetMatchPrefab);
            go.GetComponent<NetworkObject>().Spawn();
        }

        void OnClientConnected(ulong id)
        {
            if (Network.IsServer && id != NetworkManager.ServerClientId && waitingForGuest)
            {
                guestJoinedAt = Time.unscaledTime;
                Status = "Opponent joined!";
            }
        }

        void OnClientDisconnected(ulong id)
        {
            if (Network == null) return;
            if (Network.IsServer && id != NetworkManager.ServerClientId && InMatch)
            {
                Status = "Your opponent left the match.";
                ReturnToMenu();
            }
            else if (!Network.IsServer && (id == Network.LocalClientId || id == NetworkManager.ServerClientId))
            {
                Status = "Disconnected from the host.";
                ReturnToMenu();
            }
        }

        void StartOnline()
        {
            var o = last ?? LaunchOptions.Current;
            var setup = o.ToSetup();
            TeamProfile guest = null;
            if (!string.IsNullOrEmpty(guestTeamJson))
            {
                try { guest = JsonUtility.FromJson<TeamProfile>(guestTeamJson); } catch { }
            }
            if (guest != null)
            {
                guest.Validate();
                if (guest.Id == setup.Teams[0].Id) { guest.Id += "-away"; guest.Name += " (away)"; }
                setup.Teams[1] = guest;
            }
            setup.Online = true;
            setup.ManualFielding = false;
            Director.IsAuthority = true;
            Director.Online = true;
            Director.LocalSide = 0;
            Director.SideHuman = new[] { true, true };
            Director.StartMatch(setup);
            InMatch = true;
            Status = "";
            WebBridge.Post("started", "host");
        }

        public async void Leave()
        {
            Time.timeScale = 1f;
            waitingForGuest = false;
            if (SessionService.Session != null) await SessionService.LeaveAsync();
            if (Network != null && Network.IsListening) Network.Shutdown();
            ReturnToMenu();
            WebBridge.Post("left");
        }

        void ReturnToMenu()
        {
            InMatch = false;
            JoinCode = "";
            if (Director != null)
            {
                Director.IsAuthority = true;
                Director.Online = false;
                Director.SetPhase(Phase.Menu);
                foreach (var a in Director.Actors) a.Visible = false;
                Director.BallVisible = false;
            }
            Hud.Open(true);
        }

        /// <summary>Another match with the same settings, after an ad break between matches.</summary>
        public void Rematch()
        {
            var o = last ?? LaunchOptions.Current;
            AdService.AdBreak("between-matches", () => StartQuick(o));
        }

        void OnMatchEvent(GameEvent e)
        {
            if (e.Type == EvType.MatchEnd)
            {
                WebBridge.Post("result", Director.State.Result);
                // Natural pause: the match is over.
                if (!Director.Online) AdService.AdBreak("match-end", null);
            }
        }

        void OnDestroy()
        {
            if (Network != null)
            {
                Network.OnServerStarted -= OnServerStarted;
                Network.OnClientConnectedCallback -= OnClientConnected;
                Network.OnClientDisconnectCallback -= OnClientDisconnected;
            }
        }
    }
}
