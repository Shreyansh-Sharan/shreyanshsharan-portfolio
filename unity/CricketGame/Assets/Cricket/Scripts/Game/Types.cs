using System;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>What a character is doing; drives both the base animation clip and the procedural layer.</summary>
    public enum Pose : byte
    {
        Hidden, Idle, Walk, Run, Stance, Shot, Slide, BatSlide,
        RunUp, Deliver, FollowThrough,
        KeeperCrouch, KeeperTake, Ready, Dive, Catch, Pickup, Throw,
        Celebrate, Appeal, Dejected, UmpireIdle, UmpireSignal, Leave, HitByBall, GetUp,
    }

    public enum ActorKind : byte { Striker, NonStriker, Bowler, Keeper, Fielder, Umpire }

    public enum UmpireSignal : byte { None, Out, Four, Six, Wide, NoBall, Bye, LegBye, FreeHit, DeadBall, ReviewTv }

    /// <summary>A person on the field. The host simulates these; clients and replays only display them.</summary>
    public class Actor
    {
        public int Index;            // slot in the director's actor list
        public int Team = -1;        // 0/1, -1 for umpires
        public int Player = -1;      // index in the team
        public ActorKind Kind;
        public Vector3 Pos;
        public float Yaw;            // degrees, 0 = +z
        public Vector3 Vel;
        public Pose Pose = Pose.Idle;
        public float PoseTime;
        public byte Variant;         // shot type, delivery type, signal...
        public float Aim;            // shot direction or throw direction (deg)
        public Vector3 Look;         // where the hands/head go (ball for catches and takes)
        public bool HasBall;
        public bool Visible = true;
        public bool LeftHanded;      // bats / bowls left-handed for this role
        public float Speed => new Vector3(Vel.x, 0, Vel.z).magnitude;

        // Simulation-only state
        public Vector3 Home;
        public float MaxSpeed = 7.2f;
        public float Accel = 9f;
        public float Skill = 0.6f;   // fielding 0..1
        public float Stamina = 100f; // bowlers
        public string SpotName = "";

        public void SetPose(Pose p, byte variant = 0)
        {
            if (Pose == p && Variant == variant) return;
            Pose = p;
            Variant = variant;
            PoseTime = 0f;
        }

        public Vector3 Forward => Quaternion.Euler(0f, Yaw, 0f) * Vector3.forward;

        public void Face(Vector3 target, float dt = -1f, float rate = 540f)
        {
            var d = target - Pos;
            d.y = 0f;
            if (d.sqrMagnitude < 1e-4f) return;
            float want = Mathf.Atan2(d.x, d.z) * Mathf.Rad2Deg;
            Yaw = dt < 0f ? want : Mathf.MoveTowardsAngle(Yaw, want, rate * dt);
        }

        /// <summary>Moves towards a point with acceleration and top speed; returns true when there.</summary>
        public bool MoveTo(Vector3 target, float dt, float speedScale = 1f, float arriveRadius = 0.25f)
        {
            var d = target - Pos;
            d.y = 0f;
            float dist = d.magnitude;
            float vmax = MaxSpeed * speedScale;
            if (dist < arriveRadius)
            {
                Vel = Vector3.MoveTowards(Vel, Vector3.zero, Accel * 2f * dt);
                Pos += Vel * dt;
                return Vel.magnitude < 0.3f;
            }
            // Brake in time to stop at the target.
            float want = Mathf.Min(vmax, Mathf.Sqrt(2f * Accel * Mathf.Max(0f, dist - arriveRadius * 0.5f)));
            var desired = d / dist * want;
            Vel = Vector3.MoveTowards(Vel, desired, Accel * dt);
            Pos += Vel * dt;
            if (Vel.sqrMagnitude > 0.5f) Face(Pos + Vel, dt, 720f);
            return false;
        }

        /// <summary>Time to reach a point from a standstill-ish start (reaction excluded).</summary>
        public float TimeTo(Vector3 p)
        {
            var d = p - Pos;
            d.y = 0f;
            float dist = d.magnitude;
            float v0 = Mathf.Max(0f, Vector3.Dot(Vel, dist > 0.01f ? d / dist : Vector3.zero));
            float tAcc = (MaxSpeed - v0) / Accel;
            float dAcc = v0 * tAcc + 0.5f * Accel * tAcc * tAcc;
            if (dist <= dAcc)
            {
                // Solve 0.5 a t^2 + v0 t = dist
                return (-v0 + Mathf.Sqrt(v0 * v0 + 2f * Accel * dist)) / Accel;
            }
            return tAcc + (dist - dAcc) / MaxSpeed;
        }
    }

    public enum Phase : byte
    {
        Loading, Menu, Toss, InningsIntro, ChooseBowler, PreDelivery, RunUp, BallInFlight, BallLive, Dead, Review, Replay, InningsBreak, MatchEnd,
    }

    public enum CmdType : byte
    {
        None, Shot, Run, Back, Slide, PickBowler, PickDelivery, SetTarget, StartRunUp, Release, FieldPreset, MoveFielder,
        Review, TossCall, TossChoice, Continue, WicketSide, Guard, Charge, FieldMove, FieldCatch, FieldThrow, FieldSwitch, Aim, SkipReplay, Rematch,
    }

    /// <summary>An input from a player (local or remote). Side 0 is the host/local player, 1 the guest/CPU side.</summary>
    [Serializable]
    public struct Command
    {
        public CmdType Type;
        public byte Side;
        public int I;
        public float A, B, C;

        public static Command Make(CmdType t, int side, int i = 0, float a = 0f, float b = 0f, float c = 0f) =>
            new Command { Type = t, Side = (byte)side, I = i, A = a, B = b, C = c };
    }

    public enum EvType : byte
    {
        None, Release, Bounce, BatHit, Edge, Beaten, PadHit, StumpsBroken, Four, Six, Wicket, Wide, NoBall, FreeHit, Runs, Dot,
        OverEnd, InningsEnd, MatchEnd, Appeal, NotOut, ReviewStart, ReviewResult, Catch, Drop, DirectHit, Fielded, Throw, Signal,
        Commentary, Toss, Milestone, Celebrate, PhaseChange, Leave, BowlerChange, Message,
    }

    [Serializable]
    public struct GameEvent
    {
        public EvType Type;
        public int I, J;
        public float F;
        public Vector3 P;
        public string Text;

        public static GameEvent Make(EvType t, int i = 0, int j = 0, float f = 0f, string text = null) => new GameEvent { Type = t, I = i, J = j, F = f, Text = text };
    }

    /// <summary>The DRS verdict as shown on screen.</summary>
    [Serializable]
    public class ReviewInfo
    {
        public bool Active;
        public bool Lbw;            // LBW (tracking) or caught (edge detection)
        public int ReviewingTeam;
        public bool OriginalOut;
        public LbwTrack Track;
        public bool Edge;           // edge detection result for caught reviews
        public ReviewOutcome Outcome;
        public bool FinalOut;
        public float Time;
        public Vector3[] Path = new Vector3[0];
        public int ImpactIndex;
    }
}
