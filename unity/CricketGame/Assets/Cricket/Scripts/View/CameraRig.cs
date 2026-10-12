using Cricket.Core;
using Cricket.Game;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.View
{
    public enum CamMode { Auto, Broadcast, BehindBatter, Bowler, Follow, SideOn, Tracking, TopDown, Orbit, Celebration, Replay }

    /// <summary>
    /// Broadcast-style camera direction: the telephoto end-on shot from behind the bowler, a behind-the-batter view
    /// for batting, a behind-the-bowler view for bowling, a high wide shot that follows the ball in play, side-on for
    /// run outs and replays, the ball-tracking view for reviews, a top-down view for setting the field, and an orbit
    /// around the ground for menus and breaks. Cuts between phases like a TV director; follows smoothly within them.
    /// </summary>
    [RequireComponent(typeof(Camera))]
    public class CameraRig : MonoBehaviour
    {
        public static CameraRig Instance { get; private set; }
        public Camera Cam { get; private set; }
        public CamMode Mode { get; private set; } = CamMode.Orbit;
        public bool FieldEditor;

        Vector3 pos, look;
        float fov = 50f;
        CamMode lastMode;
        Phase lastPhase;
        float modeTime;
        float orbitAngle;
        int replayAngle;

        void Awake()
        {
            Instance = this;
            Cam = GetComponent<Camera>();
            pos = new Vector3(0, 60, -120);
            look = Vector3.zero;
        }

        public static string BattingCamName => Settings.BattingCam == 0 ? "Behind the batter" : "Broadcast";
        public static string BowlingCamName => Settings.BowlingCam == 0 ? "Behind the bowler" : "Broadcast";

        CamMode Choose(MatchDirector d)
        {
            var rec = ReplayRecorder.Instance;
            if (rec != null && rec.Playing) return CamMode.Replay;
            if (FieldEditor) return CamMode.TopDown;
            switch (d.Phase)
            {
                case Phase.Loading:
                case Phase.Menu:
                case Phase.Toss:
                case Phase.InningsIntro:
                case Phase.InningsBreak:
                case Phase.MatchEnd:
                    return CamMode.Orbit;
                case Phase.ChooseBowler:
                    return CamMode.Broadcast;
                case Phase.Review:
                    return d.Review.Lbw ? CamMode.Tracking : CamMode.SideOn;
                case Phase.BallLive:
                    return d.LastShot.Contact == Contact.Middle || d.LastShot.Contact == Contact.Edge ? CamMode.Follow : PlayCam(d);
                case Phase.Dead:
                    if (d.Signal == UmpireSignal.Out && d.PhaseTime > 0.8f) return CamMode.Celebration;
                    return lastMode == CamMode.Follow || lastMode == CamMode.Celebration ? lastMode : PlayCam(d);
                default:
                    return PlayCam(d);
            }
        }

        CamMode PlayCam(MatchDirector d)
        {
            if (d.LocalBats) return Settings.BattingCam == 0 ? CamMode.BehindBatter : CamMode.Broadcast;
            if (d.LocalBowls) return Settings.BowlingCam == 0 ? CamMode.Bowler : CamMode.Broadcast;
            return CamMode.Broadcast;
        }

        void LateUpdate()
        {
            var d = MatchDirector.Instance;
            float dt = Time.unscaledDeltaTime;
            var mode = d == null ? CamMode.Orbit : Choose(d);
            bool cut = mode != Mode || (d != null && d.Phase != lastPhase && (d.Phase == Phase.PreDelivery || d.Phase == Phase.Review));
            if (mode != Mode) { lastMode = Mode; Mode = mode; modeTime = 0f; if (mode == CamMode.Replay) replayAngle = (replayAngle + 1) % 2; }
            if (d != null) lastPhase = d.Phase;
            modeTime += dt;

            Vector3 wantPos, wantLook;
            float wantFov;
            Shot(d, mode, out wantPos, out wantLook, out wantFov);
            float k = cut ? 1f : 1f - Mathf.Exp(-dt * (mode == CamMode.Follow ? 3.5f : mode == CamMode.Orbit ? 1.5f : 6f));
            if (mode == CamMode.Follow && modeTime < 0.05f) k = 1f;
            pos = Vector3.Lerp(pos, wantPos, k);
            look = Vector3.Lerp(look, wantLook, mode == CamMode.Follow ? 1f - Mathf.Exp(-dt * 8f) : k);
            fov = Mathf.Lerp(fov, wantFov, cut ? 1f : 1f - Mathf.Exp(-dt * 4f));
            transform.position = pos;
            transform.rotation = Quaternion.LookRotation(look - pos);
            Cam.fieldOfView = fov;
            Cam.farClipPlane = 900f;
            Cam.nearClipPlane = mode == CamMode.BehindBatter || mode == CamMode.Bowler ? 0.1f : 0.5f;
        }

        void Shot(MatchDirector d, CamMode mode, out Vector3 p, out Vector3 l, out float f)
        {
            var up = Vector3.up;
            if (d == null || d.Inn == null && mode != CamMode.Orbit) mode = CamMode.Orbit;
            BatFrame frame = d != null && d.Inn != null ? d.Frame : BatFrame.For(1, true);
            var striker = frame.Origin;
            var bowlEnd = frame.Origin + frame.Fwd * Geo.PitchLength;
            switch (mode)
            {
                case CamMode.Broadcast:
                    // Telephoto from high behind the bowler's arm, like the TV end-on camera.
                    p = bowlEnd + frame.Fwd * 62f + up * 11f + frame.Off * -0.6f;
                    l = striker + frame.Fwd * 4.5f + up * 0.6f;
                    f = 13f;
                    if (d.Phase == Phase.BallLive && d.LastShot.Contact == Contact.None) { l = Vector3.Lerp(l, d.Ball.Pos, 0.4f); f = 18f; }
                    break;
                case CamMode.BehindBatter:
                    p = striker - frame.Fwd * 4.2f + up * 1.85f + frame.Off * (d.Striker.LeftHanded ? 0.25f : -0.25f) * 0f;
                    l = striker + frame.Fwd * 14f + up * 0.9f;
                    f = 46f;
                    break;
                case CamMode.Bowler:
                    {
                        var bowler = d.BowlerActor;
                        var bpos = bowler != null ? bowler.Pos : bowlEnd + frame.Fwd * 10f;
                        if (d.Phase == Phase.PreDelivery)
                        {
                            p = bowlEnd + frame.Fwd * 7f + up * 3.2f;
                            l = d.Marker + up * 0.2f - frame.Fwd * 3f;
                            f = 42f;
                        }
                        else
                        {
                            p = bpos + frame.Fwd * 3.8f + up * 2.6f;
                            p.x = Mathf.Lerp(p.x, 0f, 0.6f);
                            l = striker + up * 0.8f;
                            f = 40f;
                        }
                        break;
                    }
                case CamMode.Follow:
                    {
                        // High, wide shot from the far side of the ground, keeping the ball and the chase in frame.
                        var ballPos = d.Ball.Pos;
                        var flat = new Vector3(ballPos.x, 0f, ballPos.z);
                        var dir = flat.sqrMagnitude > 4f ? flat.normalized : -frame.Fwd;
                        p = -dir * 42f + up * 34f + frame.Origin * 0.3f;
                        l = Vector3.Lerp(ballPos, flat, 0.5f);
                        float dist = Vector3.Distance(p, l);
                        float width = Mathf.Clamp(14f + flat.magnitude * 0.35f + ballPos.y * 0.8f, 18f, 60f);
                        f = Mathf.Clamp(2f * Mathf.Atan(width * 0.5f / dist) * Mathf.Rad2Deg * 0.6f, 12f, 55f);
                        break;
                    }
                case CamMode.SideOn:
                    p = striker + frame.Fwd * Geo.CreaseDepth - frame.Off * 26f + up * 2.2f;
                    l = striker + frame.Fwd * Geo.CreaseDepth + up * 0.6f;
                    f = 22f;
                    break;
                case CamMode.Tracking:
                    {
                        // Ball-tracking view: from above and behind the bowler's stumps, slowly moving round.
                        float t = Mathf.Clamp01(d.PhaseTime / d.ReviewDuration);
                        var behind = bowlEnd + frame.Fwd * 6f + up * 4.5f;
                        var side = striker + frame.Fwd * 7f - frame.Off * 9f + up * 3f;
                        p = Vector3.Lerp(behind, side, Mathf.SmoothStep(0f, 1f, Mathf.Clamp01((t - 0.55f) / 0.35f)));
                        l = striker + frame.Fwd * 2.5f + up * 0.35f;
                        f = 32f;
                        break;
                    }
                case CamMode.TopDown:
                    p = frame.Origin + frame.Fwd * 18f + up * 150f - frame.Fwd * 0.01f;
                    l = frame.Origin + frame.Fwd * 18f;
                    f = 52f;
                    break;
                case CamMode.Celebration:
                    {
                        var who = d.BowlerActor != null ? d.BowlerActor : d.Striker;
                        var wp = who.Pos;
                        p = wp + who.Forward * 6f + up * 1.9f + Vector3.Cross(up, who.Forward) * 2f;
                        l = wp + up * 1.3f;
                        f = 30f;
                        break;
                    }
                case CamMode.Replay:
                    {
                        var rec = ReplayRecorder.Instance;
                        var bp = rec.BallPos;
                        if (rec.Kind == 1 || replayAngle == 0)
                        {
                            // Low behind the batter, following the ball up.
                            p = striker - frame.Fwd * 6f + up * 2.2f - frame.Off * 2f;
                            l = Vector3.Lerp(striker + frame.Fwd * 10f + up, bp, 0.7f);
                            f = 34f;
                        }
                        else
                        {
                            p = striker + frame.Fwd * 3f + frame.Off * 14f + up * 2.4f;
                            l = Vector3.Lerp(striker + up * 0.6f, bp, 0.5f);
                            f = 24f;
                        }
                        break;
                    }
                default:
                    {
                        orbitAngle += Time.unscaledDeltaTime * 4f;
                        float a = orbitAngle * Mathf.Deg2Rad;
                        p = new Vector3(Mathf.Sin(a) * 95f, 38f, Mathf.Cos(a) * 105f);
                        l = new Vector3(0, 0, 0);
                        f = 42f;
                        break;
                    }
            }
        }

        /// <summary>Ground point under the mouse (for the bowling marker, aiming and moving fielders).</summary>
        public bool GroundPoint(Vector2 screen, out Vector3 point)
        {
            point = default;
            if (!Cam) return false;
            var ray = Cam.ScreenPointToRay(screen);
            if (Mathf.Abs(ray.direction.y) < 1e-4f) return false;
            float t = -ray.origin.y / ray.direction.y;
            if (t < 0f) return false;
            point = ray.origin + ray.direction * t;
            return true;
        }
    }
}
