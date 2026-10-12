using System.Runtime.InteropServices;
using UnityEngine;

namespace Cricket.Core
{
    /// <summary>
    /// Talks to the page that embeds the game (the portfolio site).
    /// Out: window.parent.postMessage({ source: 'cricket', type, payload }) with type ready | started | code | error |
    /// left | result, plus ad requests { source: 'cricket', type: 'adbreak' | 'rewarded', placement, id }.
    /// In: messages the page posts into the game's window, queued by the jslib and polled here each frame:
    /// { type: 'start', query } to start a preloaded game, { type: 'adbreak-done' | 'ad-started' | 'reward-granted' |
    /// 'reward-skipped', id }.
    /// </summary>
    public static class WebBridge
    {
#if UNITY_WEBGL && !UNITY_EDITOR
        [DllImport("__Internal")] static extern void CricketPost(string type, string payload);
        [DllImport("__Internal")] static extern void CricketAd(string type, string placement, string id);
        [DllImport("__Internal")] static extern string CricketPoll();
        [DllImport("__Internal")] static extern int CricketEmbedded();
#endif

        public static void Post(string type, string payload = "")
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            CricketPost(type, payload ?? "");
#else
            Debug.Log($"[WebBridge] {type}: {payload}");
#endif
        }

        public static void RequestAd(string type, string placement, string id)
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            CricketAd(type, placement ?? "", id ?? "");
#else
            Debug.Log($"[WebBridge] ad request {type} ({placement}) #{id}");
#endif
        }

        /// <summary>Next message from the page as JSON, or null.</summary>
        public static string Poll()
        {
#if UNITY_WEBGL && !UNITY_EDITOR
            var s = CricketPoll();
            return string.IsNullOrEmpty(s) ? null : s;
#else
            return null;
#endif
        }

        /// <summary>Whether a host page is around to answer (false when the build is opened on its own).</summary>
        public static bool Embedded
        {
            get
            {
#if UNITY_WEBGL && !UNITY_EDITOR
                return CricketEmbedded() != 0;
#else
                return false;
#endif
            }
        }

        [System.Serializable]
        public class Inbound
        {
            public string type;
            public string id;
            public string query;
        }
    }
}
