using System.Collections.Generic;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>
    /// CPU batting: reads the delivery (with errors that grow with pace, movement and lower skill), picks a stroke from
    /// line, length and the match situation (required rate, wickets in hand, how set he is), aims for gaps, times it with
    /// difficulty-based error, and calls the runs.
    /// </summary>
    public static class BattingAI
    {
        /// <summary>0 = blocking it out, 1 = all-out attack.</summary>
        public static float Aggression(MatchDirector d)
        {
            var st = d.State;
            var inn = d.Inn;
            var rules = st.ActiveRules;
            float a;
            int ballsLeft = st.BallsLeft;
            int wkLeft = Mathf.Min(rules.MaxWickets, d.BattingTeam.Players.Count - 1) - inn.Wickets;
            if (inn.Target > 0)
            {
                float rrr = st.RequiredRate;
                a = Mathf.InverseLerp(5f, 13f, rrr);
                if (ballsLeft < 18) a = Mathf.Max(a, Mathf.InverseLerp(4f, 9f, rrr));
            }
            else
            {
                float progress = inn.LegalBalls / (float)(rules.Overs * 6);
                a = st.IsPowerplay ? 0.55f : progress > 0.75f ? 0.85f : 0.4f;
                if (rules.Overs >= 40 && progress < 0.6f) a -= 0.15f;
            }
            if (st.InSuperOver) a = 0.95f;
            // Wickets in hand: fewer means caution, unless time is running out.
            a -= Mathf.Clamp01((4 - wkLeft) / 4f) * 0.35f * Mathf.Clamp01(ballsLeft / 24f);
            var card = inn.Card(inn.Striker);
            if (card != null && card.Balls < 6) a -= 0.15f; // playing himself in
            return Mathf.Clamp01(a);
        }

        public static bool WantsToCharge(MatchDirector d, Rng rng)
        {
            var bowler = d.FieldingTeam.Players[d.Inn.Bowler];
            if (!Deliveries.IsSpinStyle(bowler.Bowl)) return false;
            return rng.Chance(0.06f + Aggression(d) * 0.12f);
        }

        public static void Decide(MatchDirector d, Rng rng)
        {
            var batter = d.BattingTeam.Players[d.Inn.Striker];
            float skill = batter.Bat01;
            float aggression = Aggression(d);
            var diff = d.State.Setup.Difficulty;
            var f = d.Frame;
            bool spin = Deliveries.Get(d.Plan.Type).IsSpin;

            // Perception: the ball as the batter reads it.
            float length = d.PitchedLength();
            float noise = Mathf.Lerp(0.18f, 0.06f, skill) * (diff == Difficulty.Easy ? 1.3f : diff == Difficulty.Hard ? 0.75f : 1f);
            var natural = Shots.NaturalFeet(length, spin);
            if (d.Charging) natural = Footwork.Charge;
            var at = d.CrossPoint(natural);
            float u = f.OffsetOff(at) - d.Guard + rng.Gauss() * noise;
            float h = at.y + rng.Gauss() * noise;
            float perceivedLen = length < 0f ? -1f : length + rng.Gauss() * noise * 4f;
            // Googly/arm ball misread: the batter plays for the stock ball's line.
            if ((d.Plan.Type == DeliveryType.Googly || d.Plan.Type == DeliveryType.ArmBall) && rng.Chance(0.45f - skill * 0.3f)) u -= 0.18f * (d.Plan.Type == DeliveryType.Googly ? -1f : 1f);

            bool onStumps = PredictHitsStumps(d, out var atStumps);
            var input = new ShotInput { Played = true, Feet = natural };

            bool wide = u > 0.75f;
            bool short_ = perceivedLen > 7.5f;
            bool full = perceivedLen >= 0f && perceivedLen < 4.8f || perceivedLen < 0f;

            // Leave or defend?
            if (wide && !onStumps && aggression < 0.65f && rng.Chance(0.75f))
            {
                input.Type = ShotType.Leave;
            }
            else if (onStumps && !full && !short_ && aggression < 0.45f + skill * 0.1f && rng.Chance(0.7f))
            {
                input.Type = ShotType.Defend;
                input.Aim = rng.Range(-20f, 20f);
            }
            else if (h > 1.6f && aggression < 0.5f)
            {
                input.Type = ShotType.Leave; // sways out of the way of a bouncer
            }
            else
            {
                // Attack: pick the stroke for the ball, then the gap.
                if (short_ && h > 0.8f) input.Type = u > 0.35f ? ShotType.Cut : ShotType.Pull;
                else if (short_ && u > 0.35f) input.Type = ShotType.Cut;
                else if (u < -0.15f) input.Type = ShotType.Flick;
                else if (spin && full && aggression > 0.5f && rng.Chance(0.3f)) input.Type = ShotType.Sweep;
                else input.Type = ShotType.Drive;
                input.Loft = aggression > 0.55f && rng.Chance((aggression - 0.45f) * 0.9f);
                var spec = Shots.Get(input.Type);
                input.Aim = FindGap(d, spec.DirMin, spec.DirMax, input.Loft, PreferredAim(input.Type, u), rng);
                if (input.Type == ShotType.Sweep || input.Type == ShotType.Drive) input.Feet = Footwork.Front;
                if (input.Type == ShotType.Cut || input.Type == ShotType.Pull) input.Feet = Footwork.Back;
                if (d.Charging) input.Feet = Footwork.Charge;
            }
            // Wrong footwork now and then.
            if (input.Feet != Footwork.Charge && rng.Chance(0.08f * (1.2f - skill))) input.Feet = input.Feet == Footwork.Front ? Footwork.Back : Footwork.Front;

            // Timing.
            float sigma = (diff == Difficulty.Easy ? 0.05f : diff == Difficulty.Hard ? 0.026f : 0.036f) * (1.35f - 0.55f * skill);
            float pace = d.Plan.SpeedKmh / 3.6f;
            sigma *= Mathf.Sqrt(Mathf.Max(0.6f, pace / 30f));
            input.TimingError = rng.Gauss() * sigma;
            if (input.Type == ShotType.Leave) input.TimingError = 0f;

            float lead = Shots.Get(input.Type == ShotType.Leave ? ShotType.Defend : input.Type).Lead;
            float tCross = d.CrossTime(input.Feet);
            if (tCross < 0f) tCross = d.CrossTime(Footwork.Auto);
            d.QueueAiShot(input, Mathf.Max(0.05f, tCross - lead + input.TimingError));
        }

        static float PreferredAim(ShotType t, float u)
        {
            switch (t)
            {
                case ShotType.Drive: return u > 0.3f ? 45f : u > 0.05f ? 15f : -15f;
                case ShotType.Cut: return 100f;
                case ShotType.Pull: return -75f;
                case ShotType.Sweep: return -95f;
                case ShotType.Flick: return -55f;
                default: return 0f;
            }
        }

        /// <summary>Picks a direction within [min,max] away from fielders (deep ones for lofts, ring ones for ground shots).</summary>
        static float FindGap(MatchDirector d, float min, float max, bool loft, float preferred, Rng rng)
        {
            var f = d.Frame;
            var angles = new List<float>();
            for (int i = MatchDirector.FirstFielder; i < MatchDirector.FirstFielder + MatchDirector.FielderCount; i++)
            {
                var a = d.Actors[i];
                if (!a.Visible || a.Kind == ActorKind.Keeper || a.Kind == ActorKind.Bowler) continue;
                float dist = Vector3.Distance(a.Pos, f.Origin);
                if (loft ? dist < 40f : dist > 40f) continue;
                angles.Add(f.AngleOf(a.Pos));
            }
            float best = preferred, bestScore = float.MinValue;
            for (float ang = min; ang <= max; ang += 4f)
            {
                float nearest = 180f;
                foreach (var x in angles) nearest = Mathf.Min(nearest, Mathf.Abs(Mathf.DeltaAngle(ang, x)));
                float score = nearest - Mathf.Abs(ang - preferred) * 0.25f + rng.Range(0f, 4f);
                if (score > bestScore) { bestScore = score; best = ang; }
            }
            return best;
        }

        static bool PredictHitsStumps(MatchDirector d, out Vector3 at)
        {
            var s = d.Ball;
            var f = d.Frame;
            var prev = s.Pos;
            at = s.Pos;
            for (int i = 0; i < 1200; i++)
            {
                BallPhysics.Step(ref s, d.Env, BallPhysics.Dt);
                float a = f.OffsetFwd(prev), b = f.OffsetFwd(s.Pos);
                if (a >= 0f && b < 0f)
                {
                    at = Vector3.Lerp(prev, s.Pos, a / Mathf.Max(1e-5f, a - b));
                    return Mathf.Abs(f.OffsetOff(at)) < Geo.StumpsHalfWidth + 0.06f && at.y < Geo.StumpHeight + 0.05f;
                }
                prev = s.Pos;
            }
            return false;
        }

        /// <summary>Calls for (or refuses) runs while the ball is in play.</summary>
        public static void RunningCalls(MatchDirector d, Rng rng)
        {
            if (d.Phase != Phase.BallLive || d.BallCaught) return;
            if (d.Striker.Pose == Pose.Shot && d.Striker.PoseTime < 0.45f) return;
            float aggression = Aggression(d);
            if (d.BoundaryLikely())
            {
                if (!d.AnyRunning && d.LiveTime > 0.5f) d.CallRun();
                return;
            }
            if (d.IsAirCatchChance()) return; // wait and see if it's caught
            float tBall = d.EstimatedReturnTime();
            if (!d.AnyRunning)
            {
                if (d.LiveTime < 0.45f) return;
                bool startOfFirst = d.Runners[0].AtEnd == d.Inn.StrikerEnd;
                float tRun = 17.7f / 6.6f + (startOfFirst ? 0.35f : 0.8f);
                float threshold = Mathf.Lerp(0.9f, 0.05f, aggression);
                if (tBall - tRun > threshold) d.CallRun();
            }
            else
            {
                // Mid-run: send back if it's hopeless and they haven't gone far; slide the bat in on a close one.
                for (int k = 0; k < 2; k++)
                {
                    float t = d.RunnerTimeToGround(k);
                    if (t < 0f) continue;
                    if (d.BallHeld && tBall < t - 0.4f && d.RunnerProgress(k) < 0.35f) { d.CallBack(); return; }
                    if (t < 0.5f && tBall < t + 0.6f) d.SlideBat();
                }
            }
        }
    }
}
