using System;
using UnityEngine;

namespace Cricket.Sim
{
    public enum BowlStyle { Fast, Medium, OffSpin, LegSpin }

    public enum DeliveryType
    {
        SeamUp, Inswing, Outswing, Bouncer, Yorker, SlowerBall, // pace
        OffBreak, ArmBall,                                      // finger spin
        LegBreak, Googly,                                       // wrist spin
    }

    /// <summary>What a delivery type does: pace relative to the bowler's stock ball, default length, swing and spin.</summary>
    public struct DeliverySpec
    {
        public DeliveryType Type;
        public string Name;
        public string Short;
        public float SpeedFactor;
        /// <summary>Default landing distance from the batter's stumps (m) for the marker.</summary>
        public float DefaultLength;
        /// <summary>+1 swings away from a right-hander (to the off side), -1 into him, 0 seam up (random wobble).</summary>
        public float Swing;
        /// <summary>Seam presentation: multiplies seam movement off the pitch.</summary>
        public float Seam;
        /// <summary>Spin rate (rev/s).</summary>
        public float RevsPerSec;
        /// <summary>Turn direction in the bowler's frame: +1 turns to the bowler's right (a right-armer's off-break).</summary>
        public float Break;
        /// <summary>Fraction of the spin that is side spin (turn); the rest is top spin (+) or back spin (-).</summary>
        public float SideSpin, TopSpin;
        public bool IsSpin;
    }

    public static class Deliveries
    {
        public static readonly DeliverySpec[] All =
        {
            new DeliverySpec { Type = DeliveryType.SeamUp, Name = "Seam up", Short = "SEAM", SpeedFactor = 1f, DefaultLength = 6.5f, Swing = 0f, Seam = 1.3f, RevsPerSec = 18f, TopSpin = -1f },
            new DeliverySpec { Type = DeliveryType.Inswing, Name = "Inswinger", Short = "IN", SpeedFactor = 0.98f, DefaultLength = 5.5f, Swing = -1f, Seam = 0.9f, RevsPerSec = 16f, TopSpin = -1f },
            new DeliverySpec { Type = DeliveryType.Outswing, Name = "Outswinger", Short = "OUT", SpeedFactor = 0.98f, DefaultLength = 5.5f, Swing = 1f, Seam = 0.9f, RevsPerSec = 16f, TopSpin = -1f },
            new DeliverySpec { Type = DeliveryType.Bouncer, Name = "Bouncer", Short = "BNCR", SpeedFactor = 1.03f, DefaultLength = 12f, Swing = 0f, Seam = 0.8f, RevsPerSec = 20f, TopSpin = -1f },
            new DeliverySpec { Type = DeliveryType.Yorker, Name = "Yorker", Short = "YRKR", SpeedFactor = 1.01f, DefaultLength = 1.6f, Swing = 0f, Seam = 0.6f, RevsPerSec = 16f, TopSpin = -1f },
            new DeliverySpec { Type = DeliveryType.SlowerBall, Name = "Slower ball", Short = "SLOW", SpeedFactor = 0.78f, DefaultLength = 6f, Swing = 0f, Seam = 1f, RevsPerSec = 9f, TopSpin = 0.6f },
            new DeliverySpec { Type = DeliveryType.OffBreak, Name = "Off-break", Short = "OFF", SpeedFactor = 1f, DefaultLength = 4.6f, RevsPerSec = 25f, Break = 1f, SideSpin = 0.8f, TopSpin = 0.45f, IsSpin = true, Seam = 0.3f },
            new DeliverySpec { Type = DeliveryType.ArmBall, Name = "Arm ball", Short = "ARM", SpeedFactor = 1.08f, DefaultLength = 5f, RevsPerSec = 20f, Break = 0f, Swing = -0.35f, SideSpin = 0.1f, TopSpin = -0.9f, IsSpin = true, Seam = 0.5f },
            new DeliverySpec { Type = DeliveryType.LegBreak, Name = "Leg-break", Short = "LEG", SpeedFactor = 1f, DefaultLength = 4.8f, RevsPerSec = 28f, Break = -1f, SideSpin = 0.85f, TopSpin = 0.4f, IsSpin = true, Seam = 0.3f },
            new DeliverySpec { Type = DeliveryType.Googly, Name = "Googly", Short = "GOOG", SpeedFactor = 0.97f, DefaultLength = 4.6f, RevsPerSec = 26f, Break = 1f, SideSpin = 0.7f, TopSpin = 0.65f, IsSpin = true, Seam = 0.3f },
        };

        public static DeliverySpec Get(DeliveryType t) => All[(int)t];

        public static DeliveryType[] For(BowlStyle style)
        {
            switch (style)
            {
                case BowlStyle.OffSpin: return new[] { DeliveryType.OffBreak, DeliveryType.ArmBall };
                case BowlStyle.LegSpin: return new[] { DeliveryType.LegBreak, DeliveryType.Googly };
                default: return new[] { DeliveryType.SeamUp, DeliveryType.Inswing, DeliveryType.Outswing, DeliveryType.Bouncer, DeliveryType.Yorker, DeliveryType.SlowerBall };
            }
        }

        public static bool IsSpinStyle(BowlStyle s) => s == BowlStyle.OffSpin || s == BowlStyle.LegSpin;

        /// <summary>Stock release speed (km/h) for a bowler of this style and pace rating (0..1).</summary>
        public static float StockKmh(BowlStyle style, float pace01)
        {
            switch (style)
            {
                case BowlStyle.Fast: return Mathf.Lerp(136f, 150f, pace01);
                case BowlStyle.Medium: return Mathf.Lerp(120f, 134f, pace01);
                case BowlStyle.OffSpin: return Mathf.Lerp(78f, 90f, pace01);
                default: return Mathf.Lerp(74f, 88f, pace01);
            }
        }
    }

    /// <summary>Everything decided about one delivery before it is released.</summary>
    [Serializable]
    public struct DeliveryPlan
    {
        public DeliveryType Type;
        public BowlStyle Style;
        public bool LeftArm;
        public bool AroundWicket;
        /// <summary>Aimed landing point (world, y = 0) before release error.</summary>
        public Vector3 Target;
        public float SpeedKmh;
        /// <summary>Release meter result: 0 perfect, +-1 at the edges of the meter, beyond 1 overstepped / lost it.</summary>
        public float ReleaseError;
        public bool NoBall;
    }

    /// <summary>
    /// Turns a delivery plan into a released ball: release point, spin vector, swing, then solves the launch direction
    /// so the ball (with drag, swing and Magnus) lands on the aimed spot (plus the release error).
    /// </summary>
    public static class DeliverySolver
    {
        public static Vector3 ReleasePoint(int bowlingEnd, bool leftArm, bool around, bool spin)
        {
            float inward = Geo.Inward(bowlingEnd);
            var travel = new Vector3(0f, 0f, inward);
            var bowlerRight = new Vector3(travel.z, 0f, -travel.x);
            // Right-armer over the wicket releases just to his left of the stumps (arm next to the stumps).
            float side = (leftArm ? 1f : -1f) * (around ? -1f : 1f);
            float wide = spin ? 0.32f : 0.42f;
            if (around) wide += 0.35f;
            var p = Geo.Stumps(bowlingEnd) + travel * (spin ? 0.75f : 0.95f) + bowlerRight * side * wide;
            p.y = spin ? 2.05f : 2.2f;
            return p;
        }

        /// <summary>
        /// Builds the released ball. The rng rolls the seam jag and bounce jitter now so a prediction of the path is
        /// exactly what will happen.
        /// </summary>
        public static BallState Release(DeliveryPlan plan, int bowlingEnd, Vector3 batterOff, float ballAgeOvers, float bowlerSkill01, in Env env, Rng rng, out Vector3 aimedAt)
        {
            var spec = Deliveries.Get(plan.Type);
            var release = ReleasePoint(bowlingEnd, plan.LeftArm, plan.AroundWicket, spec.IsSpin);
            float inward = Geo.Inward(bowlingEnd);
            var travel = new Vector3(0f, 0f, inward);
            var bowlerRight = new Vector3(travel.z, 0f, -travel.x);
            var topAxis = new Vector3(travel.z, 0f, -travel.x); // cross(up, travel): top spin axis
            float speed = plan.SpeedKmh / 3.6f;

            var s = new BallState { Pos = release };
            // Spin: side spin about the direction of travel, top/back spin about the horizontal axis.
            float w = spec.RevsPerSec * 2f * Mathf.PI;
            if (spec.IsSpin)
            {
                float breakSign = spec.Break * (plan.LeftArm ? -1f : 1f);
                // Spin about +travel makes the contact point slip to the bowler's right, so friction pushes the ball to his
                // left (see BallPhysics.Bounce); a turn to his right needs spin about -travel.
                var side = travel * (-breakSign * spec.SideSpin * w);
                var top = topAxis * (spec.TopSpin * w);
                // A tilted axis gives some drift away from the turn in the air.
                var vertical = Vector3.up * (-breakSign * 0.2f * w);
                s.Spin = side + top + vertical;
                if (spec.Break == 0f) s.Spin = topAxis * (spec.TopSpin * w) + travel * (spec.SideSpin * w * (plan.LeftArm ? -1f : 1f));
            }
            else
            {
                s.Spin = topAxis * (spec.TopSpin * w);
            }

            // Swing relative to the batter on strike: an outswinger moves away from him (to his off side), an inswinger
            // into his pads, whichever hand he bats with.
            float coef = 0f;
            if (!spec.IsSpin)
            {
                coef = BallPhysics.SwingCoefficient(speed, ballAgeOvers, env.SwingFactor, bowlerSkill01);
                if (spec.Swing == 0f) coef *= rng.Range(-0.35f, 0.35f);
                else coef *= spec.Swing;
                if (plan.Type == DeliveryType.Bouncer || plan.Type == DeliveryType.Yorker) coef *= 0.5f;
            }
            else if (spec.Swing != 0f)
            {
                coef = 0.08f * spec.Swing * env.SwingFactor;
            }
            s.SwingCoef = Mathf.Abs(coef);
            s.SwingDir = coef >= 0f ? batterOff : -batterOff;

            s.SeamKick = rng.Gauss() * env.Pitch.SeamDegrees * spec.Seam * Mathf.Deg2Rad * (spec.IsSpin ? 0.5f : 1f);
            s.BounceJitter = rng.Gauss() * env.Pitch.BounceJitter;

            // Release error: misses the spot by up to ~half a metre in line and a metre and a half in length.
            float err = Mathf.Clamp(plan.ReleaseError, -2f, 2f);
            float skillSpread = Mathf.Lerp(1.4f, 0.6f, bowlerSkill01);
            var target = plan.Target;
            target += travel * (err * 0.9f * skillSpread + rng.Gauss() * 0.25f * skillSpread);
            target += bowlerRight * (Mathf.Abs(err) * 0.25f * skillSpread * (rng.Value < 0.5f ? -1f : 1f) + rng.Gauss() * 0.1f * skillSpread);
            target.y = 0f;
            aimedAt = target;

            s.Vel = Solve(s, target, speed, env);
            return s;
        }

        /// <summary>Finds the launch velocity of the given speed that lands the ball at target (first bounce).</summary>
        public static Vector3 Solve(BallState s, Vector3 target, float speed, in Env env)
        {
            var from = s.Pos;
            var flat = new Vector3(target.x - from.x, 0f, target.z - from.z);
            float yaw = Mathf.Atan2(flat.x, flat.z);
            float pitch = -Mathf.Atan2(from.y, flat.magnitude) * 0.6f;
            float dPitch = 0.02f;
            float lastErr = 0f, lastPitch = 0f;
            bool havePrev = false;
            for (int iter = 0; iter < 12; iter++)
            {
                var land = Landing(s, from, yaw, pitch, speed, env, out bool landed);
                var dl = new Vector3(land.x - from.x, 0f, land.z - from.z);
                // Range error along the aim direction; line error sideways.
                var aimDir = flat.normalized;
                float rangeErr = Vector3.Dot(flat - dl, aimDir);
                float lineErr = Vector3.Cross(aimDir, (target - land)).y; // signed sideways miss
                // Yaw: rotate by the angle subtended by the line miss.
                yaw += lineErr / Mathf.Max(1f, dl.magnitude);
                if (!landed) rangeErr = -5f;
                if (havePrev && Mathf.Abs(rangeErr - lastErr) > 1e-4f)
                {
                    float slope = (rangeErr - lastErr) / (pitch - lastPitch);
                    float next = pitch - rangeErr / slope;
                    lastErr = rangeErr; lastPitch = pitch;
                    pitch = Mathf.Clamp(next, -1.2f, 1.2f);
                }
                else
                {
                    lastErr = rangeErr; lastPitch = pitch; havePrev = true;
                    pitch += rangeErr > 0 ? dPitch : -dPitch;
                }
                if (Mathf.Abs(rangeErr) < 0.01f && Mathf.Abs(lineErr) < 0.01f) break;
            }
            return Launch(yaw, pitch, speed);
        }

        static Vector3 Launch(float yaw, float pitch, float speed)
        {
            float c = Mathf.Cos(pitch);
            return new Vector3(Mathf.Sin(yaw) * c, Mathf.Sin(pitch), Mathf.Cos(yaw) * c) * speed;
        }

        static Vector3 Landing(BallState s, Vector3 from, float yaw, float pitch, float speed, in Env env, out bool landed)
        {
            s.Pos = from;
            s.Vel = Launch(yaw, pitch, speed);
            s.Bounces = 0;
            s.Pitched = false;
            s.Time = 0f;
            for (int i = 0; i < 2000; i++)
            {
                var r = BallPhysics.Step(ref s, env, BallPhysics.Dt);
                if (r.Bounced) { landed = true; return r.BouncePos; }
            }
            landed = false;
            return s.Pos;
        }
    }
}
