using System;
using UnityEngine;

namespace Cricket.Sim
{
    public enum PitchType { Green, Flat, Dusty }
    public enum TimeOfDay { Day, Dusk, Night }

    /// <summary>How a surface treats the ball when it lands on it.</summary>
    [Serializable]
    public struct Surface
    {
        /// <summary>Vertical coefficient of restitution (bounce height ratio is its square).</summary>
        public float Restitution;
        /// <summary>Sliding friction between ball and surface during the impact (grip: drives spin turn and pace loss).</summary>
        public float Friction;
        /// <summary>Random spread of the restitution (uneven bounce).</summary>
        public float BounceJitter;
        /// <summary>Standard deviation (degrees) of the sideways jag a seam-up ball takes off this surface.</summary>
        public float SeamDegrees;
        /// <summary>Extra fraction of horizontal speed kept after the bounce (soft surfaces "hold" the ball).</summary>
        public float PaceRetention;
        /// <summary>How well the seam bites sideways: fraction of the rolling limit of the sideways slip that friction removes
        /// (drives spin turn; pure Coulomb sliding under-predicts it because the seam digs into the surface).</summary>
        public float SpinGrip;
    }

    /// <summary>Pitch and outfield behaviour by pitch type, plus wear as a match goes on.</summary>
    public static class Surfaces
    {
        public static Surface Pitch(PitchType type, float wear01 = 0f)
        {
            Surface s;
            switch (type)
            {
                case PitchType.Green: // grass on it: bouncy, quick, seams around, little turn
                    s = new Surface { Restitution = 0.58f, Friction = 0.16f, BounceJitter = 0.03f, SeamDegrees = 1.6f, PaceRetention = 0.99f, SpinGrip = 0.45f };
                    break;
                case PitchType.Dusty: // dry and cracked: low, slow, grips and turns, uneven
                    s = new Surface { Restitution = 0.47f, Friction = 0.30f, BounceJitter = 0.05f, SeamDegrees = 0.7f, PaceRetention = 0.96f, SpinGrip = 1.25f };
                    break;
                default: // flat road: true bounce, little help for anyone
                    s = new Surface { Restitution = 0.53f, Friction = 0.18f, BounceJitter = 0.015f, SeamDegrees = 0.5f, PaceRetention = 0.99f, SpinGrip = 0.65f };
                    break;
            }
            // Wear: the surface dries and breaks up, so it grips more and bounces less evenly.
            wear01 = Mathf.Clamp01(wear01);
            s.Friction += 0.05f * wear01;
            s.SpinGrip += 0.4f * wear01;
            s.BounceJitter += 0.03f * wear01;
            s.Restitution -= 0.03f * wear01;
            return s;
        }

        /// <summary>The mown outfield: soft, absorbs the bounce quickly.</summary>
        public static readonly Surface Outfield = new Surface { Restitution = 0.38f, Friction = 0.5f, BounceJitter = 0.04f, SeamDegrees = 0f, PaceRetention = 0.97f, SpinGrip = 0f };
    }

    /// <summary>Everything about the air and the ground that the ball physics needs.</summary>
    [Serializable]
    public struct Env
    {
        public float Gravity;
        public float AirDensity;
        /// <summary>Wind velocity (m/s), horizontal.</summary>
        public Vector3 Wind;
        /// <summary>Humidity/cloud factor for swing: ~0.7 dry and sunny, 1.0 normal, ~1.3 overcast/humid (or under lights).</summary>
        public float SwingFactor;
        public Surface Pitch;
        public Surface Outfield;
        /// <summary>Rolling resistance coefficient on the outfield (fast outfield ~0.08).</summary>
        public float RollingFriction;
        /// <summary>Speed-proportional grass drag while rolling (1/s).</summary>
        public float GrassDrag;

        public static Env Make(PitchType pitch, TimeOfDay time, Vector3 wind, float wear01 = 0f)
        {
            return new Env
            {
                Gravity = 9.81f,
                AirDensity = 1.2f,
                Wind = new Vector3(wind.x, 0f, wind.z),
                SwingFactor = time == TimeOfDay.Day ? 0.85f : time == TimeOfDay.Dusk ? 1.05f : 1.2f, // the ball swings more under lights
                Pitch = Surfaces.Pitch(pitch, wear01),
                Outfield = Surfaces.Outfield,
                RollingFriction = 0.085f,
                GrassDrag = 0.11f,
            };
        }
    }

    /// <summary>Small deterministic random source shared by the simulation (System.Random, not UnityEngine.Random,
    /// so the host can reproduce a delivery and the offline sanity sim runs outside Unity).</summary>
    public sealed class Rng
    {
        System.Random r;
        public Rng(int seed) { r = new System.Random(seed); }
        public float Value => (float)r.NextDouble();
        public float Range(float a, float b) => a + (b - a) * (float)r.NextDouble();
        public int Range(int a, int bExclusive) => r.Next(a, bExclusive);
        public bool Chance(float p) => r.NextDouble() < p;
        /// <summary>Standard normal sample (Box-Muller).</summary>
        public float Gauss()
        {
            double u1 = 1.0 - r.NextDouble(), u2 = r.NextDouble();
            return (float)(Math.Sqrt(-2.0 * Math.Log(u1)) * Math.Sin(2.0 * Math.PI * u2));
        }
    }
}
