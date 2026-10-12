using System;
using System.Collections.Generic;
using UnityEngine;

namespace Cricket.Sim
{
    /// <summary>The ball in flight or on the ground. Plain data so it can be copied, predicted, sent and replayed.</summary>
    [Serializable]
    public struct BallState
    {
        public Vector3 Pos;
        public Vector3 Vel;
        /// <summary>Angular velocity (rad/s, world axes).</summary>
        public Vector3 Spin;
        /// <summary>Swing force coefficient (0 = none). Applies along SwingDir until the ball first lands or is hit.</summary>
        public float SwingCoef;
        public Vector3 SwingDir;
        /// <summary>Sideways jag (radians) the seam gives on the first bounce on the pitch; rolled at release so predictions are exact.</summary>
        public float SeamKick;
        /// <summary>Restitution jitter for the first bounce, rolled at release.</summary>
        public float BounceJitter;
        public int Bounces;
        public bool Rolling;
        public bool Stopped;
        public bool Pitched;          // has landed at least once since release / the bat
        public Vector3 FirstBounce;   // where it first landed
        public float Time;

        public float Speed => Vel.magnitude;
        public float Kmh => Vel.magnitude * 3.6f;
    }

    public struct StepResult
    {
        public bool Bounced;
        public bool OnPitch;
        public Vector3 BouncePos;
        public float ImpactSpeed;
    }

    /// <summary>
    /// Cricket ball flight and ground contact:
    ///  - gravity and quadratic air drag (Cd 0.45) relative to the wind,
    ///  - conventional/reverse swing as a sideways force from the seam (coefficient from speed, ball age and conditions),
    ///  - Magnus force from spin (drift, dip, lift of a back-spun lofted hit),
    ///  - bounce with a restitution coefficient and a Coulomb friction impulse at the contact point, which turns spin into
    ///    sideways turn (spinners), slows back-spun seamers, and is capped at rolling,
    ///  - seam deviation off the pitch, rolling resistance and grass drag on the outfield.
    /// </summary>
    public static class BallPhysics
    {
        public const float Cd = 0.45f;
        public const float Dt = 1f / 500f;
        const float R = Geo.BallRadius;

        public static float DragK(in Env e) => 0.5f * e.AirDensity * Cd * Geo.BallArea / Geo.BallMass;
        public static float SideK(in Env e) => 0.5f * e.AirDensity * Geo.BallArea / Geo.BallMass;

        /// <summary>Advances the ball by dt (internally in fixed sub-steps). Reports the first bounce in the interval.</summary>
        public static StepResult Advance(ref BallState s, in Env env, float dt)
        {
            var result = new StepResult();
            if (s.Stopped) { s.Time += dt; return result; }
            int n = Mathf.Max(1, Mathf.CeilToInt(dt / Dt - 0.001f));
            float h = dt / n;
            for (int i = 0; i < n; i++)
            {
                var r = Step(ref s, env, h);
                if (r.Bounced && !result.Bounced) result = r;
                if (s.Stopped) { s.Time += (n - i - 1) * h; break; }
            }
            return result;
        }

        public static StepResult Step(ref BallState s, in Env env, float h)
        {
            var result = new StepResult();
            s.Time += h;
            if (s.Stopped) return result;

            var rel = s.Vel - env.Wind;
            float speed = rel.magnitude;
            var acc = new Vector3(0f, -env.Gravity, 0f);
            acc -= rel * (DragK(env) * speed);

            if (!s.Rolling)
            {
                if (s.SwingCoef != 0f) acc += s.SwingDir * (SideK(env) * s.SwingCoef * speed * speed);
                // Magnus: F = 1/2 rho A Cl v^2 with Cl ~ 0.5 * (r w / v), capped. As a vector: k * (w x v).
                var magnus = Vector3.Cross(s.Spin, rel) * (0.25f * env.AirDensity * Geo.BallArea * R / Geo.BallMass);
                float cap = 0.3f * SideK(env) * speed * speed; // Cl <= 0.3
                float m = magnus.magnitude;
                if (m > cap && m > 0f) magnus *= cap / m;
                acc += magnus;
                // Spin decays slowly in the air.
                s.Spin *= 1f - 0.08f * h;
            }
            else
            {
                acc.y = 0f;
                var flat = new Vector3(s.Vel.x, 0f, s.Vel.z);
                float v = flat.magnitude;
                if (v > 1e-4f) acc -= flat / v * (env.RollingFriction * env.Gravity + env.GrassDrag * v);
            }

            var prevVel = s.Vel;
            s.Vel += acc * h;
            if (s.Rolling)
            {
                // Friction can stop the ball but never push it backwards.
                var a = new Vector3(prevVel.x, 0f, prevVel.z);
                var b = new Vector3(s.Vel.x, 0f, s.Vel.z);
                if (Vector3.Dot(a, b) <= 0f || b.magnitude < 0.05f)
                {
                    s.Vel = Vector3.zero;
                    s.Stopped = true;
                    return result;
                }
                s.Vel.y = 0f;
                s.Pos += s.Vel * h;
                s.Pos.y = R;
                // Keep spin consistent with rolling (for the visual).
                s.Spin = Vector3.Cross(Vector3.up, s.Vel) / R;
                return result;
            }

            s.Pos += s.Vel * h;
            if (s.Pos.y <= R && s.Vel.y < 0f)
            {
                s.Pos.y = R;
                bool onPitch = Geo.OnPitch(s.Pos);
                result.Bounced = true;
                result.OnPitch = onPitch;
                result.BouncePos = new Vector3(s.Pos.x, 0f, s.Pos.z);
                result.ImpactSpeed = s.Vel.magnitude;
                Bounce(ref s, onPitch ? env.Pitch : env.Outfield, !s.Pitched && onPitch);
                if (!s.Pitched) s.FirstBounce = result.BouncePos;
                s.Pitched = true;
                s.Bounces++;
                s.SwingCoef = 0f;
            }
            return result;
        }

        static void Bounce(ref BallState s, in Surface surf, bool firstOnPitch)
        {
            float vy = s.Vel.y;
            float e = Mathf.Clamp(surf.Restitution + (firstOnPitch ? s.BounceJitter : 0f), 0.05f, 0.9f);
            // Bounces get deader at low impact speeds on grass.
            if (surf.SpinGrip == 0f) e *= Mathf.Clamp01(0.55f + Mathf.Abs(vy) * 0.12f);
            float newVy = -vy * e;

            var vh = new Vector3(s.Vel.x, 0f, s.Vel.z);
            var contact = new Vector3(0f, -R, 0f);
            var slip = vh + Vector3.Cross(s.Spin, contact);
            slip.y = 0f;
            float limit = surf.Friction * (1f + e) * Mathf.Abs(vy);
            if (surf.SpinGrip > 0f && vh.sqrMagnitude > 1e-6f)
            {
                // On the pitch the slip along the line of travel (pace) and across it (spin turn) are treated apart:
                // the former with Coulomb friction, the latter with the seam's grip.
                var along = vh.normalized;
                var across = new Vector3(along.z, 0f, -along.x);
                float sAlong = Vector3.Dot(slip, along), sAcross = Vector3.Dot(slip, across);
                float dAlong = Mathf.Min(limit, Mathf.Abs(sAlong) * (2f / 7f)) * -Mathf.Sign(sAlong);
                float dAcross = Mathf.Min(limit * 1.5f, Mathf.Abs(sAcross) * (2f / 7f) * surf.SpinGrip) * -Mathf.Sign(sAcross);
                var dvVec = along * dAlong + across * dAcross;
                vh += dvVec;
                s.Spin += Vector3.Cross(contact, dvVec) / (0.4f * R * R);
            }
            else
            {
                float slipMag = slip.magnitude;
                if (slipMag > 1e-4f)
                {
                    // Coulomb impulse (as a velocity change), capped at the change that makes the ball roll (2/7 of the
                    // slip for a uniform sphere, I = 2/5 m r^2).
                    float dv = Mathf.Min(limit, slipMag * (2f / 7f));
                    var dvVec = -slip / slipMag * dv;
                    vh += dvVec;
                    s.Spin += Vector3.Cross(contact, dvVec) / (0.4f * R * R);
                }
            }
            vh *= surf.PaceRetention;
            if (firstOnPitch && s.SeamKick != 0f)
            {
                float c = Mathf.Cos(s.SeamKick), sn = Mathf.Sin(s.SeamKick);
                vh = new Vector3(vh.x * c + vh.z * sn, 0f, -vh.x * sn + vh.z * c);
            }
            s.Vel = new Vector3(vh.x, newVy, vh.z);
            if (newVy < 0.7f && surf.SpinGrip == 0f)
            {
                // Too little bounce left: it runs along the grass.
                s.Vel.y = 0f;
                s.Rolling = true;
            }
            else if (newVy < 0.35f)
            {
                s.Vel.y = 0f;
                s.Rolling = true;
            }
        }

        /// <summary>
        /// Swing coefficient for a seam-up delivery. Conventional swing peaks around 110-125 km/h with a newish ball and
        /// fades at express pace; an old ball bowled very fast reverses (negative).
        /// </summary>
        public static float SwingCoefficient(float speedMs, float ballAgeOvers, float swingFactor, float bowlerSkill01)
        {
            float newness = Mathf.Clamp(1f - ballAgeOvers / 30f, 0.2f, 1f);
            float shape;
            if (speedMs < 32f) shape = Mathf.Lerp(0.45f, 1f, Mathf.InverseLerp(20f, 32f, speedMs));
            else shape = Mathf.Lerp(1f, 0.25f, Mathf.InverseLerp(32f, 41f, speedMs));
            float conventional = 0.25f * shape * newness * swingFactor * Mathf.Lerp(0.7f, 1.1f, bowlerSkill01);
            float reverse = 0f;
            if (ballAgeOvers > 25f && speedMs > 35f)
                reverse = -0.2f * Mathf.InverseLerp(35f, 41f, speedMs) * Mathf.InverseLerp(25f, 40f, ballAgeOvers) * swingFactor;
            return conventional + reverse;
        }

        /// <summary>Crossing of the plane z = planeZ between two positions.</summary>
        public static bool CrossesZ(Vector3 a, Vector3 b, float planeZ, out Vector3 at)
        {
            at = default;
            float da = a.z - planeZ, db = b.z - planeZ;
            if (da == 0f && db == 0f) return false;
            if (da * db > 0f) return false;
            float t = da / (da - db);
            at = Vector3.Lerp(a, b, t);
            return true;
        }

        /// <summary>Whether a ball centre at this point (in the plane of the stumps at that end) hits the wicket.</summary>
        public static bool HitsStumps(Vector3 p, int end)
        {
            return Mathf.Abs(p.x) <= Geo.StumpsHalfWidth + R && p.y <= Geo.StumpHeight + Geo.BailHeight + R * 0.6f && p.y > -0.01f;
        }

        /// <summary>Predicts the path: positions every `interval` seconds for up to `seconds`, stopping when it stops.</summary>
        public static void Predict(BallState s, in Env env, float seconds, float interval, List<Vector3> into, List<int> bouncesAt = null)
        {
            into.Clear();
            bouncesAt?.Clear();
            into.Add(s.Pos);
            float t = 0f;
            while (t < seconds && !s.Stopped)
            {
                int before = s.Bounces;
                Advance(ref s, env, interval);
                t += interval;
                into.Add(s.Pos);
                if (bouncesAt != null && s.Bounces != before) bouncesAt.Add(into.Count - 1);
            }
        }
    }
}
