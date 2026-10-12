using System.Collections.Generic;
using Cricket.Game;
using Cricket.Sim;
using Unity.Netcode;
using UnityEngine;

namespace Cricket.Net
{
    /// <summary>
    /// Online 1v1, host-authoritative. The host's MatchDirector simulates everything; this object (spawned by the host)
    /// streams compact snapshots of the field 20 times a second (unreliable), the match state as JSON when it changes,
    /// game events, and each delivery's release so the guest can fly the ball locally (smooth, and so the guest's
    /// batting timing is judged against the ball he actually sees). The guest sends Commands (shots with their locally
    /// measured timing, run calls, bowling choices with the locally read release meter).
    /// </summary>
    public class NetMatch : NetworkBehaviour
    {
        public static NetMatch Instance { get; private set; }
        public static System.Action<string> OnGuestTeam;

        float sendAt, stateAt;
        int lastStateHash;
        readonly List<(float at, Snapshot s)> buffer = new List<(float, Snapshot)>();
        const float InterpDelay = 0.12f;

        public override void OnNetworkSpawn()
        {
            Instance = this;
            var d = MatchDirector.Instance;
            if (d == null) return;
            d.Online = true;
            if (IsServer)
            {
                d.IsAuthority = true;
                d.LocalSide = 0;
                d.OnEvent += Forward;
            }
            else
            {
                d.IsAuthority = false;
                d.LocalSide = 1;
            }
        }

        public override void OnNetworkDespawn()
        {
            var d = MatchDirector.Instance;
            if (d != null) d.OnEvent -= Forward;
            if (Instance == this) Instance = null;
        }

        // ------------------------------------------------------------------ host -> guest

        void Update()
        {
            var d = MatchDirector.Instance;
            if (d == null || !IsSpawned) return;
            if (IsServer)
            {
                if (Time.unscaledTime >= sendAt)
                {
                    sendAt = Time.unscaledTime + 0.05f;
                    var snap = Snapshot.Capture(d, Time.unscaledTime);
                    SnapshotRpc(snap.ToBytes(), d.RunUpDuration, d.MeterHalfWidth, d.Marker, (byte)d.SelectedDelivery, d.AroundWicket, (byte)d.Signal, d.AimAngle, d.Guard, d.Charging);
                }
                if (Time.unscaledTime >= stateAt)
                {
                    stateAt = Time.unscaledTime + 0.5f;
                    var json = JsonUtility.ToJson(d.State);
                    int h = json.GetHashCode();
                    if (h != lastStateHash)
                    {
                        lastStateHash = h;
                        StateRpc(json);
                    }
                }
            }
            else ClientInterpolate(d);
        }

        void Forward(GameEvent e)
        {
            var d = MatchDirector.Instance;
            if (e.Type == EvType.Release)
            {
                var b = d.Ball;
                ReleaseRpc(b.Pos, b.Vel, b.Spin, b.SwingCoef, b.SwingDir, b.SeamKick, b.BounceJitter, (byte)d.Plan.Type, d.Plan.SpeedKmh, JsonUtility.ToJson(d.Env));
            }
            if (e.Type == EvType.ReviewStart) ReviewRpc(JsonUtility.ToJson(d.Review));
            // Score changes go out straight away so the guest's scoreboard keeps up.
            if (e.Type == EvType.Wicket || e.Type == EvType.Four || e.Type == EvType.Six || e.Type == EvType.Runs || e.Type == EvType.Dot || e.Type == EvType.OverEnd || e.Type == EvType.InningsEnd || e.Type == EvType.MatchEnd || e.Type == EvType.Toss || e.Type == EvType.BowlerChange)
                stateAt = 0f;
            EventRpc((byte)e.Type, e.I, e.J, e.F, e.P, e.Text ?? "");
        }

        [Rpc(SendTo.NotServer, Delivery = RpcDelivery.Unreliable)]
        void SnapshotRpc(byte[] data, float runUp, float meterHalf, Vector3 marker, byte delivery, bool around, byte signal, float aim, float guard, bool charging)
        {
            var d = MatchDirector.Instance;
            if (d == null) return;
            Snapshot s;
            try { s = Snapshot.FromBytes(data); }
            catch { return; }
            buffer.Add((Time.unscaledTime, s));
            if (buffer.Count > 20) buffer.RemoveAt(0);
            d.ApplyRemoteExtras(runUp, meterHalf, marker, (DeliveryType)delivery, around, (UmpireSignal)signal, aim, guard, charging);
            d.SetPhaseRemote(s.Phase, s.PhaseTime);
        }

        [Rpc(SendTo.NotServer)]
        void StateRpc(string json)
        {
            var d = MatchDirector.Instance;
            if (d == null) return;
            try
            {
                d.State = JsonUtility.FromJson<MatchState>(json);
                d.SyncClientFrame();
            }
            catch (System.Exception e) { Debug.LogWarning($"Cricket: bad state from host ({e.Message})"); }
        }

        [Rpc(SendTo.NotServer)]
        void EventRpc(byte type, int i, int j, float f, Vector3 p, string text)
        {
            var d = MatchDirector.Instance;
            if (d == null) return;
            var e = new GameEvent { Type = (EvType)type, I = i, J = j, F = f, P = p, Text = string.IsNullOrEmpty(text) ? null : text };
            d.ClientEvent(e);
        }

        [Rpc(SendTo.NotServer)]
        void ReleaseRpc(Vector3 pos, Vector3 vel, Vector3 spin, float swing, Vector3 swingDir, float seam, float jitter, byte type, float kmh, string envJson)
        {
            var d = MatchDirector.Instance;
            if (d == null) return;
            try { d.Env = JsonUtility.FromJson<Env>(envJson); } catch { }
            var b = new BallState { Pos = pos, Vel = vel, Spin = spin, SwingCoef = swing, SwingDir = swingDir, SeamKick = seam, BounceJitter = jitter };
            d.ClientRelease(b, (DeliveryType)type, kmh);
        }

        [Rpc(SendTo.NotServer)]
        void ReviewRpc(string json)
        {
            var d = MatchDirector.Instance;
            if (d == null) return;
            try { d.Review = JsonUtility.FromJson<ReviewInfo>(json); } catch { }
        }

        void ClientInterpolate(MatchDirector d)
        {
            if (buffer.Count == 0) return;
            float renderAt = Time.unscaledTime - InterpDelay;
            int i = 0;
            while (i < buffer.Count - 2 && buffer[i + 1].at <= renderAt) i++;
            var a = buffer[i];
            var b = buffer[Mathf.Min(i + 1, buffer.Count - 1)];
            float t = b.at > a.at ? Mathf.Clamp01((renderAt - a.at) / (b.at - a.at)) : 1f;
            Snapshot.Apply(a.s, b.s, t, d.Actors);
            d.RefreshRoles();
            if (!d.ClientFlying)
            {
                d.Ball.Pos = Vector3.Lerp(a.s.BallPos, b.s.BallPos, t);
                d.Ball.Spin = b.s.BallSpin;
                d.BallVisible = b.s.BallVisible;
            }
        }

        // ------------------------------------------------------------------ guest -> host

        public void Send(Command c)
        {
            if (!IsSpawned) return;
            CommandRpc((byte)c.Type, c.I, c.A, c.B, c.C);
        }

        [Rpc(SendTo.Server)]
        void CommandRpc(byte type, int i, float a, float b, float c, RpcParams rpc = default)
        {
            var d = MatchDirector.Instance;
            if (d == null) return;
            // The guest controls side 1.
            d.Submit(new Command { Type = (CmdType)type, Side = 1, I = i, A = a, B = b, C = c });
        }

        public void SendTeam(string json)
        {
            if (IsSpawned && !IsServer) TeamRpc(json);
        }

        [Rpc(SendTo.Server)]
        void TeamRpc(string json, RpcParams rpc = default)
        {
            OnGuestTeam?.Invoke(json);
        }
    }
}
