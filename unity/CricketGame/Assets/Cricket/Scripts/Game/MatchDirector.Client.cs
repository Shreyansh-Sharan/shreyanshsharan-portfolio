using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>The online guest's side of the director: it doesn't simulate the match, it mirrors the host and flies
    /// each delivery locally so the batting timing matches what the guest sees.</summary>
    public partial class MatchDirector
    {
        public bool ClientFlying { get; private set; }
        public float RunUpDuration => runUpDuration;

        /// <summary>Per-frame work when this machine is not the authority.</summary>
        void ClientUpdate(float dt)
        {
            PhaseTime += dt;
            foreach (var a in Actors) a.PoseTime += dt;
            if (Phase == Phase.RunUp && runUpDuration > 0f)
            {
                float meterStart = runUpDuration - MeterDuration;
                MeterValue = Mathf.Clamp01((PhaseTime - meterStart) / MeterDuration);
                MeterRunning = LocalBowls && float.IsNaN(clientRelease);
            }
            if (ClientFlying)
            {
                BallPhysics.Advance(ref Ball, Env, dt);
                BallVisible = true;
                // Once the host says the ball is live (hit, padded, past the keeper), snapshots take over.
                if (Phase != Phase.BallInFlight && Phase != Phase.RunUp) ClientFlying = false;
                if (Ball.Time > 3f) ClientFlying = false;
            }
        }

        float clientRelease = float.NaN;

        public void ApplyRemoteExtras(float runUp, float meterHalf, Vector3 marker, DeliveryType delivery, bool around, UmpireSignal signal, float aim, float guard, bool charging)
        {
            runUpDuration = runUp;
            MeterHalfWidth = meterHalf;
            // The guest's own bowling choices are kept locally (they're sent to the host); the host's echo would lag.
            if (!LocalBowls)
            {
                Marker = marker;
                SelectedDelivery = delivery;
                AroundWicket = around;
            }
            if (!LocalBats) { AimAngle = aim; Guard = guard; }
            Signal = signal;
            Charging = charging;
        }

        public void SetPhaseRemote(Phase p, float time)
        {
            if (p != Phase)
            {
                if (p == Phase.PreDelivery) { clientRelease = float.NaN; released = false; shotPending = false; shotResolved = false; }
                if (p == Phase.RunUp) clientRelease = float.NaN;
                Phase = p;
                PhaseTime = time;
                Raise(GameEvent.Make(EvType.PhaseChange, (int)p));
            }
            else if (Mathf.Abs(PhaseTime - time) > 0.25f) PhaseTime = time;
        }

        public void SyncClientFrame()
        {
            var inn = State.Current;
            if (inn == null || State.Setup.Teams == null || State.Setup.Teams[inn.BattingTeam] == null) return;
            var team = State.Setup.Teams[inn.BattingTeam];
            if (inn.Striker < 0 || inn.Striker >= team.Players.Count) return;
            strikerRight = !team.Players[inn.Striker].LeftHandBat;
            frame = BatFrame.For(inn.StrikerEnd, strikerRight);
            batterId = inn.Striker;
        }

        public void RefreshRoles()
        {
            foreach (var a in Actors)
            {
                if (a.Kind == ActorKind.Bowler) BowlerActor = a;
                if (a.Kind == ActorKind.Keeper) KeeperActor = a;
            }
        }

        public void ClientEvent(GameEvent e)
        {
            if (e.Type == EvType.Message && e.F > 0f) { Banner = e.Text; BannerTime = e.F; }
            Raise(e);
        }

        public void ClientRelease(BallState ball, DeliveryType type, float kmh)
        {
            SyncClientFrame();
            Ball = ball;
            Ball.Time = 0f;
            plan.Type = type;
            plan.SpeedKmh = kmh;
            LastKmh = kmh;
            released = true;
            releasedBall = ball;
            ClientFlying = true;
            BallVisible = true;
            shotPending = false;
            shotResolved = false;
            PredictForBatter();
        }

        /// <summary>The guest's release press: read the meter here, send the value.</summary>
        public float ClientMeterPress()
        {
            clientRelease = MeterValue;
            return MeterValue;
        }
    }
}
