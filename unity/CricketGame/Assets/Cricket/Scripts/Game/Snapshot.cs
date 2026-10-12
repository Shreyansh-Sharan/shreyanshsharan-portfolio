using System;
using System.IO;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>
    /// A frame of everything visible on the field (15 people and the ball), small enough to send 20 times a second and
    /// to keep a few seconds of for replays.
    /// </summary>
    public struct Snapshot
    {
        public float Time;
        public Phase Phase;
        public float PhaseTime;
        public Vector3 BallPos;
        public Vector3 BallSpin;
        public bool BallVisible;
        public ActorSnap[] Actors;

        public struct ActorSnap
        {
            public Vector3 Pos, Vel, Look;
            public float Yaw, PoseTime, Aim;
            public Pose Pose;
            public byte Variant;
            public sbyte Team, Player;
            public ActorKind Kind;
            public bool Visible, HasBall, Left;
        }

        public static Snapshot Capture(MatchDirector d, float time)
        {
            var s = new Snapshot
            {
                Time = time,
                Phase = d.Phase,
                PhaseTime = d.PhaseTime,
                BallPos = d.Ball.Pos,
                BallSpin = d.Ball.Spin,
                BallVisible = d.BallVisible,
                Actors = new ActorSnap[d.Actors.Length],
            };
            for (int i = 0; i < d.Actors.Length; i++)
            {
                var a = d.Actors[i];
                s.Actors[i] = new ActorSnap
                {
                    Pos = a.Pos, Vel = a.Vel, Look = a.Look, Yaw = a.Yaw, PoseTime = a.PoseTime, Aim = a.Aim, Pose = a.Pose, Variant = a.Variant,
                    Team = (sbyte)a.Team, Player = (sbyte)a.Player, Kind = a.Kind, Visible = a.Visible, HasBall = a.HasBall, Left = a.LeftHanded,
                };
            }
            return s;
        }

        /// <summary>Writes this frame (or the blend of two) into display actors.</summary>
        public static void Apply(Snapshot a, Snapshot b, float t, Actor[] into)
        {
            for (int i = 0; i < into.Length && i < a.Actors.Length; i++)
            {
                var x = a.Actors[i];
                var y = b.Actors != null && i < b.Actors.Length ? b.Actors[i] : x;
                var o = into[i];
                o.Pos = Vector3.Lerp(x.Pos, y.Pos, t);
                o.Vel = Vector3.Lerp(x.Vel, y.Vel, t);
                o.Look = Vector3.Lerp(x.Look, y.Look, t);
                o.Yaw = Mathf.LerpAngle(x.Yaw, y.Yaw, t);
                o.Aim = Mathf.Lerp(x.Aim, y.Aim, t);
                bool same = x.Pose == y.Pose && x.Variant == y.Variant;
                o.Pose = t < 0.5f || !same ? x.Pose : y.Pose;
                o.Variant = x.Variant;
                o.PoseTime = same ? Mathf.Lerp(x.PoseTime, y.PoseTime, t) : x.PoseTime;
                o.Team = x.Team;
                o.Player = x.Player;
                o.Kind = x.Kind;
                o.Visible = x.Visible;
                o.HasBall = x.HasBall;
                o.LeftHanded = x.Left;
            }
        }

        // ---- compact binary form for the network (about 600 bytes)

        public byte[] ToBytes()
        {
            using var ms = new MemoryStream(700);
            using var w = new BinaryWriter(ms);
            w.Write(Time);
            w.Write((byte)Phase);
            w.Write(PhaseTime);
            W(w, BallPos); W(w, BallSpin);
            w.Write(BallVisible);
            w.Write((byte)Actors.Length);
            foreach (var a in Actors)
            {
                W(w, a.Pos); W(w, a.Vel); W(w, a.Look);
                w.Write((short)Mathf.RoundToInt(Mathf.Repeat(a.Yaw, 360f) * 10f));
                w.Write((ushort)Mathf.Clamp(a.PoseTime * 1000f, 0, 65535));
                w.Write((short)Mathf.RoundToInt(Mathf.Clamp(a.Aim, -3000f, 3000f) * 10f));
                w.Write((byte)a.Pose);
                w.Write(a.Variant);
                w.Write(a.Team);
                w.Write(a.Player);
                w.Write((byte)a.Kind);
                w.Write((byte)((a.Visible ? 1 : 0) | (a.HasBall ? 2 : 0) | (a.Left ? 4 : 0)));
            }
            w.Flush();
            return ms.ToArray();
        }

        public static Snapshot FromBytes(byte[] data)
        {
            using var ms = new MemoryStream(data);
            using var r = new BinaryReader(ms);
            var s = new Snapshot
            {
                Time = r.ReadSingle(),
                Phase = (Phase)r.ReadByte(),
                PhaseTime = r.ReadSingle(),
                BallPos = R(r),
                BallSpin = R(r),
                BallVisible = r.ReadBoolean(),
            };
            int n = r.ReadByte();
            s.Actors = new ActorSnap[n];
            for (int i = 0; i < n; i++)
            {
                var a = new ActorSnap { Pos = R(r), Vel = R(r), Look = R(r) };
                a.Yaw = r.ReadInt16() / 10f;
                a.PoseTime = r.ReadUInt16() / 1000f;
                a.Aim = r.ReadInt16() / 10f;
                a.Pose = (Pose)r.ReadByte();
                a.Variant = r.ReadByte();
                a.Team = r.ReadSByte();
                a.Player = r.ReadSByte();
                a.Kind = (ActorKind)r.ReadByte();
                byte f = r.ReadByte();
                a.Visible = (f & 1) != 0;
                a.HasBall = (f & 2) != 0;
                a.Left = (f & 4) != 0;
                s.Actors[i] = a;
            }
            return s;
        }

        static void W(BinaryWriter w, Vector3 v) { w.Write(v.x); w.Write(v.y); w.Write(v.z); }
        static Vector3 R(BinaryReader r) => new Vector3(r.ReadSingle(), r.ReadSingle(), r.ReadSingle());
    }
}
