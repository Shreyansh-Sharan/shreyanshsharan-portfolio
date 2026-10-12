using System.Collections.Generic;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>
    /// Keeps the frames of the current ball (30 per second) and plays back the big moments (wickets, sixes) in slow
    /// motion from other camera angles. Costs nothing until a replay is shown.
    /// </summary>
    public class ReplayRecorder : MonoBehaviour
    {
        public static ReplayRecorder Instance { get; private set; }

        readonly List<Snapshot> frames = new List<Snapshot>(512);
        float clock, nextAt;
        bool recording;
        public bool Playing { get; private set; }
        public bool WantsReplay { get; private set; }
        public float PlayTime { get; private set; }
        public float Speed = 0.45f;
        public int Kind; // 0 wicket, 1 six
        public readonly Actor[] Display = new Actor[MatchDirector.ActorCount];
        public Vector3 BallPos { get; private set; }
        public bool BallVisible { get; private set; }
        float start, end;

        void Awake()
        {
            Instance = this;
            for (int i = 0; i < Display.Length; i++) Display[i] = new Actor { Index = i };
        }

        public void BeginBall()
        {
            frames.Clear();
            clock = 0f;
            nextAt = 0f;
            recording = true;
            WantsReplay = false;
        }

        public void EndBall(bool interesting, BallOutcome outcome)
        {
            recording = false;
            WantsReplay = interesting && Settings.Replays && frames.Count > 10;
            Kind = outcome.Six ? 1 : 0;
        }

        void LateUpdate()
        {
            var d = MatchDirector.Instance;
            if (d == null) return;
            if (recording && !Playing && frames.Count < 600)
            {
                clock += Time.deltaTime;
                if (clock >= nextAt)
                {
                    frames.Add(Snapshot.Capture(d, clock));
                    nextAt = clock + 1f / 30f;
                }
            }
            if (Playing)
            {
                PlayTime += Time.unscaledDeltaTime * Speed;
                float t = start + PlayTime;
                if (t >= end) { Playing = false; return; }
                int i = 0;
                while (i < frames.Count - 2 && frames[i + 1].Time < t) i++;
                var a = frames[i];
                var b = frames[Mathf.Min(i + 1, frames.Count - 1)];
                float k = b.Time > a.Time ? Mathf.Clamp01((t - a.Time) / (b.Time - a.Time)) : 0f;
                Snapshot.Apply(a, b, k, Display);
                BallPos = Vector3.Lerp(a.BallPos, b.BallPos, k);
                BallVisible = a.BallVisible;
            }
        }

        public void Play()
        {
            if (frames.Count < 2) return;
            // From just before release to a couple of seconds after the shot.
            start = Mathf.Max(0f, frames[0].Time);
            foreach (var f in frames) if (f.Phase == Phase.BallInFlight) { start = Mathf.Max(0f, f.Time - 0.6f); break; }
            end = Mathf.Min(frames[frames.Count - 1].Time, start + (Kind == 1 ? 4.5f : 3.6f));
            PlayTime = 0f;
            Playing = true;
            WantsReplay = false;
        }

        public void Stop() { Playing = false; WantsReplay = false; }
    }
}
