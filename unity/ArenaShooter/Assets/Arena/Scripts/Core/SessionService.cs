using System.Threading.Tasks;
using Unity.Services.Authentication;
using Unity.Services.Core;
using Unity.Services.Multiplayer;
using UnityEngine;

namespace Arena.Core
{
    /// <summary>Online play through Unity Multiplayer Services: Relay over secure WebSockets, joined by code.</summary>
    public static class SessionService
    {
        public const int MaxPlayers = 8;
        public static ISession Session { get; private set; }

        static async Task EnsureSignedIn()
        {
            if (UnityServices.State != ServicesInitializationState.Initialized)
            {
                // A random profile per tab, so two tabs in one browser count as two players.
                var options = new InitializationOptions().SetProfile("p" + Random.Range(100000, 999999));
                await UnityServices.InitializeAsync(options);
            }
            if (!AuthenticationService.Instance.IsSignedIn)
                await AuthenticationService.Instance.SignInAnonymouslyAsync();
        }

        public static async Task<string> HostAsync()
        {
            await EnsureSignedIn();
            var options = new SessionOptions { MaxPlayers = MaxPlayers, IsPrivate = true }
                .WithRelayNetwork(new RelayNetworkOptions(RelayProtocol.WSS));
            Session = await MultiplayerService.Instance.CreateSessionAsync(options);
            return Session.Code;
        }

        public static async Task JoinAsync(string code)
        {
            await EnsureSignedIn();
            Session = await MultiplayerService.Instance.JoinSessionByCodeAsync(code);
        }

        public static async Task LeaveAsync()
        {
            var s = Session;
            Session = null;
            if (s != null)
            {
                try { await s.LeaveAsync(); }
                catch (System.Exception e) { Debug.LogWarning($"Leaving session failed: {e.Message}"); }
            }
        }
    }
}
