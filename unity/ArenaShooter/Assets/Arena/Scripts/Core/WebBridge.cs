using System.Runtime.InteropServices;
using UnityEngine;

namespace Arena.Core
{
    /// <summary>
    /// Sends events to the hosting page (the portfolio site) via window.parent.postMessage as
    /// { source: 'arena', type, payload }. Types: ready, started (mode), code (join code), map (map id
    /// once a match is running: dunes | harbor | frost | sandstorm | villa | bazaar), error, left. The page picks the map
    /// with ?map= and the spawn primary with ?gun=.
    /// </summary>
    public static class WebBridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void ArenaPost(string type, string payload);
#endif

        public static void Post(string type, string payload = "")
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            ArenaPost(type, payload ?? "");
#else
            Debug.Log($"[WebBridge] {type}: {payload}");
#endif
        }
    }
}
