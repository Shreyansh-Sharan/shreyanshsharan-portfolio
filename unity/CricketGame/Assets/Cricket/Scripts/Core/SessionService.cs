using System;
using System.Threading.Tasks;
using Unity.Services.Authentication;
using Unity.Services.Core;
using Unity.Services.Multiplayer;
using UnityEngine;

namespace Cricket.Core
{
    /// <summary>
    /// 1v1 online through Unity Multiplayer Services: a private session over Relay with secure WebSockets (so browsers
    /// can play), joined by code. Needs the Unity project linked to a Unity Cloud project with Relay and Lobby on; when it
    /// isn't, the real error is passed up so the menu can show it.
    /// </summary>
    public static class SessionService
    {
        public const int MaxPlayers = 2;
        public static ISession Session { get; private set; }

        static async Task EnsureSignedIn()
        {
            if (UnityServices.State != ServicesInitializationState.Initialized)
            {
                // A random profile per tab, so two tabs in one browser count as two players.
                var options = new InitializationOptions().SetProfile("p" + UnityEngine.Random.Range(100000, 999999));
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
                catch (Exception e) { Debug.LogWarning($"Leaving session failed: {e.Message}"); }
            }
        }

        /// <summary>A readable explanation of a services failure, with the fix when it's the usual setup problem.</summary>
        public static string Explain(Exception e)
        {
            var msg = e.Message ?? e.GetType().Name;
            if (e.InnerException != null && !string.IsNullOrEmpty(e.InnerException.Message)) msg += " (" + e.InnerException.Message + ")";
            string lower = msg.ToLowerInvariant();
            if (lower.Contains("project") && (lower.Contains("id") || lower.Contains("link")) || lower.Contains("cloud project") || lower.Contains("unauthorized") || lower.Contains("403"))
                msg += " — the game's Unity project must be linked to a Unity Cloud project with Relay and Lobby enabled (see REBUILD.md).";
            return msg;
        }
    }
}
