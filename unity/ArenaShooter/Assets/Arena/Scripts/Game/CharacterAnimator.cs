using UnityEngine;

namespace Arena.Game
{
    /// <summary>
    /// Crossfades a character model between idle and run on the legacy Animation component. Speed comes
    /// from how far the character moved since last frame, so it works the same for the local player,
    /// interpolated remote players and server-driven bots.
    /// </summary>
    public class CharacterAnimator : MonoBehaviour
    {
        public Animation Animation;
        public AnimationClip Idle;
        public AnimationClip Run;
        [Tooltip("Ground speed (m/s) at which the run clip plays at normal speed.")]
        public float RunClipSpeed = 6.5f;

        const string IdleState = "idle", RunState = "run";

        Vector3 last;
        float speed;
        bool running, started, hasIdle;

        void Awake()
        {
            // glTFast imports legacy clips; anything else can't play on Animation, so the model just stands.
            if (!Animation || !Run || !Run.legacy)
            {
                enabled = false;
                return;
            }
            Animation.playAutomatically = false;
            Animation.cullingType = AnimationCullingType.BasedOnRenderers;
            if (!Animation.GetClip(RunState)) Animation.AddClip(Run, RunState);
            if (Idle && Idle.legacy && !Animation.GetClip(IdleState)) Animation.AddClip(Idle, IdleState);
            foreach (AnimationState state in Animation) state.wrapMode = WrapMode.Loop;
            hasIdle = Animation.GetClip(IdleState) != null;
            last = transform.position;
        }

        void LateUpdate()
        {
            var p = transform.position;
            var delta = p - last;
            last = p;
            delta.y = 0f;
            float dt = Mathf.Max(Time.deltaTime, 0.0001f);
            float measured = delta.magnitude / dt;
            if (measured > 30f) measured = 0f; // teleports and respawns
            speed = Mathf.Lerp(speed, measured, 1f - Mathf.Exp(-dt * 10f));

            bool run = speed > 1.2f;
            if (run != running || !started)
            {
                running = run;
                started = true;
                if (run || !hasIdle) Animation.CrossFade(RunState, 0.2f);
                else Animation.CrossFade(IdleState, 0.25f);
            }
            var runState = Animation[RunState];
            if (runState != null)
                runState.speed = running ? Mathf.Clamp(speed / RunClipSpeed, 0.55f, 1.6f) : hasIdle ? 1f : 0f;
        }
    }
}
