using System;
using UnityEngine;

namespace Cricket.Core
{
    /// <summary>
    /// Ad hooks for the host page. At natural pauses the game asks for an ad break ({type:'adbreak', placement, id}),
    /// or for a rewarded ad ({type:'rewarded'}), then mutes and pauses until the page answers with
    /// {type:'adbreak-done'} or {type:'reward-granted'|'reward-skipped'} (matching id). The page may first send
    /// {type:'ad-started'} to say an ad is really showing; without that the game resumes after a short grace period,
    /// so nothing hangs while the page side doesn't implement ads (or when the build runs on its own).
    /// </summary>
    public class AdService : MonoBehaviour
    {
        public static AdService Instance { get; private set; }
        public static bool Showing => Instance != null && Instance.pending != null;

        class Pending
        {
            public string Id;
            public bool Rewarded;
            public Action<bool> Done;
            public float Asked;
            public bool Started;
            public bool PausedTime;
        }

        Pending pending;
        int counter;
        float savedScale = 1f;
        const float AckGrace = 2.5f;      // seconds to wait for 'ad-started' before giving up
        const float MaxAdLength = 150f;   // safety net once an ad is running

        void Awake() { Instance = this; }

        /// <summary>Interstitial at a natural pause (end of innings, end of match, between matches).</summary>
        public static void AdBreak(string placement, Action done, bool pauseTime = true)
        {
            if (Instance == null) { done?.Invoke(); return; }
            Instance.Ask("adbreak", placement, _ => done?.Invoke(), pauseTime);
        }

        /// <summary>Rewarded ad (e.g. an extra DRS review). Callback gets true when the reward was earned.</summary>
        public static void Rewarded(string placement, Action<bool> done)
        {
            if (Instance == null) { done?.Invoke(false); return; }
            Instance.Ask("rewarded", placement, done, true);
        }

        void Ask(string type, string placement, Action<bool> done, bool pauseTime)
        {
            if (pending != null) { done?.Invoke(false); return; }
            if (!WebBridge.Embedded)
            {
                // Nobody to show an ad: carry on (a rewarded ad isn't granted).
                done?.Invoke(false);
                return;
            }
            var id = $"c{++counter}";
            pending = new Pending { Id = id, Rewarded = type == "rewarded", Done = done, Asked = Time.realtimeSinceStartup, PausedTime = pauseTime };
            AudioListener.pause = true;
            if (pauseTime)
            {
                savedScale = Time.timeScale;
                Time.timeScale = 0f;
            }
            WebBridge.RequestAd(type, placement, id);
        }

        /// <summary>Called by the bootstrap for each message from the page.</summary>
        public void OnMessage(WebBridge.Inbound msg)
        {
            if (pending == null || msg == null) return;
            if (!string.IsNullOrEmpty(msg.id) && msg.id != pending.Id) return;
            switch (msg.type)
            {
                case "ad-started": pending.Started = true; break;
                case "adbreak-done": Finish(!pending.Rewarded); break;
                case "reward-granted": Finish(true); break;
                case "reward-skipped": Finish(false); break;
            }
        }

        void Update()
        {
            if (pending == null) return;
            float waited = Time.realtimeSinceStartup - pending.Asked;
            if (!pending.Started && waited > AckGrace) Finish(false);
            else if (waited > MaxAdLength) Finish(false);
        }

        void Finish(bool reward)
        {
            var p = pending;
            pending = null;
            AudioListener.pause = false;
            if (p.PausedTime) Time.timeScale = savedScale <= 0f ? 1f : savedScale;
            p.Done?.Invoke(reward);
        }
    }
}
