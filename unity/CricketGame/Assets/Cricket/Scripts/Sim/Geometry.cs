using UnityEngine;

namespace Cricket.Sim
{
    /// <summary>
    /// Real dimensions of the ground and the ball (metres, kilograms). The pitch runs along Z with its centre at the
    /// origin: end 0's stumps at z = -10.06, end 1's at z = +10.06. Everything in the simulation uses these numbers.
    /// </summary>
    public static class Geo
    {
        public const float PitchLength = 20.12f;         // stumps to stumps (22 yards)
        public const float HalfPitch = PitchLength * 0.5f;
        public const float PitchWidth = 3.05f;           // prepared strip (10 ft)
        public const float CreaseDepth = 1.22f;          // popping crease in front of the stumps (4 ft)
        public const float ReturnCreaseHalf = 1.32f;     // return creases either side of middle stump (8 ft 8 in apart)
        public const float StumpHeight = 0.711f;         // 28 in
        public const float StumpsHalfWidth = 0.1143f;    // the three stumps span 9 in
        public const float StumpRadius = 0.0175f;
        public const float BailHeight = 0.013f;

        public const float BallRadius = 0.036f;          // 71-72 mm diameter
        public const float BallMass = 0.16f;             // 156-163 g
        public const float BallArea = Mathf.PI * BallRadius * BallRadius;

        public const float BoundarySquare = 63f;         // rope distance from the centre of the pitch, square of the wicket (x)
        public const float BoundaryStraight = 68f;       // rope distance from the centre of the pitch, down the ground (z)
        public const float InnerCircle = 27.43f;         // 30 yards
        public const float WideLineOff = 0.9f;           // limited-overs wide guide from middle stump (off side)
        public const float WideLineLeg = 0.2f;           // past leg stump plus a little

        public static float StumpsZ(int end) => end == 0 ? -HalfPitch : HalfPitch;
        /// <summary>Unit direction from this end's stumps towards the other end.</summary>
        public static float Inward(int end) => end == 0 ? 1f : -1f;
        public static float PoppingZ(int end) => StumpsZ(end) + Inward(end) * CreaseDepth;
        public static Vector3 Stumps(int end) => new Vector3(0f, 0f, StumpsZ(end));

        /// <summary>Whether a point on the ground is on the prepared pitch (where the ball grips and bounces truly).</summary>
        public static bool OnPitch(Vector3 p) => Mathf.Abs(p.x) < PitchWidth * 0.5f && Mathf.Abs(p.z) < HalfPitch + CreaseDepth + 0.6f;

        /// <summary>How far past the rope a point is (positive outside). The boundary is an ellipse.</summary>
        public static float BeyondRope(Vector3 p, float inset = 0f)
        {
            float a = BoundarySquare - inset, b = BoundaryStraight - inset;
            float k = Mathf.Sqrt(p.x * p.x / (a * a) + p.z * p.z / (b * b));
            return (k - 1f) * Mathf.Lerp(a, b, Mathf.Abs(p.z) / (Mathf.Abs(p.x) + Mathf.Abs(p.z) + 0.001f));
        }

        public static Vector3 RopePoint(float angleRad, float inset = 0f)
        {
            return new Vector3(Mathf.Sin(angleRad) * (BoundarySquare - inset), 0f, Mathf.Cos(angleRad) * (BoundaryStraight - inset));
        }

        public static bool InsideCircle(Vector3 p)
        {
            // The 30-yard "circle" is two semicircles around each set of stumps joined by straight lines.
            float dz = Mathf.Max(0f, Mathf.Abs(p.z) - HalfPitch);
            return p.x * p.x + dz * dz <= InnerCircle * InnerCircle;
        }
    }

    /// <summary>
    /// A frame centred on a set of stumps, looking down the pitch at the other end, with "off" pointing to the batter's
    /// off side (to the right of the camera for a right-hander, as seen from behind his stumps).
    /// Field positions are given as (angle, distance): angle 0 is straight down the ground, +90 square on the off side
    /// (point), 180 behind the stumps (keeper), -90 square on the leg side.
    /// </summary>
    public struct BatFrame
    {
        public Vector3 Origin, Fwd, Off;

        public static BatFrame For(int strikerEnd, bool rightHanded)
        {
            var fwd = new Vector3(0f, 0f, Geo.Inward(strikerEnd));
            // cross(up, fwd) points to the right of someone looking along fwd; a right-hander's off side.
            var right = new Vector3(fwd.z, 0f, -fwd.x);
            return new BatFrame { Origin = Geo.Stumps(strikerEnd), Fwd = fwd, Off = rightHanded ? right : -right };
        }

        public Vector3 Polar(float angleDeg, float dist)
        {
            float a = angleDeg * Mathf.Deg2Rad;
            return Origin + (Fwd * Mathf.Cos(a) + Off * Mathf.Sin(a)) * dist;
        }

        public Vector3 Local(float off, float fwd, float up = 0f) => Origin + Off * off + Fwd * fwd + Vector3.up * up;

        /// <summary>Angle (degrees) of a world point around the stumps, in the convention above.</summary>
        public float AngleOf(Vector3 p)
        {
            var d = p - Origin;
            return Mathf.Atan2(Vector3.Dot(d, Off), Vector3.Dot(d, Fwd)) * Mathf.Rad2Deg;
        }

        public Vector3 Direction(float angleDeg)
        {
            float a = angleDeg * Mathf.Deg2Rad;
            return Fwd * Mathf.Cos(a) + Off * Mathf.Sin(a);
        }

        public float OffsetOff(Vector3 p) => Vector3.Dot(p - Origin, Off);
        public float OffsetFwd(Vector3 p) => Vector3.Dot(p - Origin, Fwd);
    }
}
