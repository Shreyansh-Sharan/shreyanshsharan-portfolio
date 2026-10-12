using System;
using UnityEngine;

namespace Cricket.Sim
{
    public enum ShotType : byte { Auto, Defend, Leave, Drive, Cut, Pull, Sweep, Flick }
    public enum Footwork : byte { Auto, Front, Back, Charge }
    public enum Contact : byte { None, Middle, Edge, Miss }
    public enum EdgeKind : byte { None, Outside, Inside, Top }
    public enum Timing : byte { NoShot, VeryEarly, Early, Perfect, Late, VeryLate }

    /// <summary>What the batter asked for: shot, feet, direction and when he swung.</summary>
    [Serializable]
    public struct ShotInput
    {
        public ShotType Type;
        public Footwork Feet;
        /// <summary>Intended direction, degrees (0 straight back past the bowler, +90 point, -90 square leg).</summary>
        public float Aim;
        public bool Loft;
        /// <summary>Whether a swing was made at all (Leave also counts as a decision).</summary>
        public bool Played;
        /// <summary>Bat arrival minus ball arrival at the contact point, seconds (negative = early).</summary>
        public float TimingError;
    }

    /// <summary>A shot's coverage and character.</summary>
    public struct ShotSpec
    {
        public ShotType Type;
        public string Name;
        public float DirMin, DirMax;          // reachable directions (deg)
        public float UMin, UMax;              // line covered (m, + off side, relative to middle stump + guard shuffle)
        public float HMin, HMax;              // height covered at contact (m)
        public float LenMin, LenMax;          // ideal pitching distance from the stumps (m)
        public Footwork Feet;                 // natural footwork
        public float BatSpeed;                // m/s at the sweet spot
        public float GroundElevation, LoftElevation;
        /// <summary>Seconds from pressing the shot to the bat reaching the ball (the downswing).</summary>
        public float Lead;
    }

    public struct ContactContext
    {
        public BatFrame Frame;
        /// <summary>The ball as it reaches the batter's contact plane.</summary>
        public Vector3 BallPos, BallVel;
        /// <summary>Where it pitched, measured from the batter's stumps (m), or -1 for a full toss.</summary>
        public float Length;
        /// <summary>How far the ball moved sideways after the batter had to commit (seam/turn off the pitch), m.</summary>
        public float LateMovement;
        public bool Spin;
        public float BatterSkill;   // 0..1
        public float BatterPower;   // 0..1
        public float Guard;         // sideways shuffle of the batter (m, + towards off)
        /// <summary>Timing window multiplier (difficulty assist for humans, 1 = normal).</summary>
        public float Window;
    }

    public struct ShotResult
    {
        public ShotType Shot;
        public Footwork Feet;
        public Contact Contact;
        public EdgeKind Edge;
        public Timing Timing;
        public float Quality;          // 0..1 for middled shots
        public Vector3 ExitVel;
        public Vector3 ExitSpin;
        public float Direction;        // actual direction (deg)
        public bool PlayedOn;          // inside edge onto the stumps
        public bool HitWicket;         // trod on / swung into his own stumps
        public string Note;            // short description for commentary and the timing readout
    }

    public static class Shots
    {
        public static readonly ShotSpec[] All =
        {
            default, // Auto
            new ShotSpec { Type = ShotType.Defend, Name = "Defence", DirMin = -70, DirMax = 70, UMin = -0.38f, UMax = 0.5f, HMin = 0f, HMax = 1.5f, LenMin = 0f, LenMax = 20f, Feet = Footwork.Auto, BatSpeed = 2.5f, GroundElevation = -10f, LoftElevation = -6f, Lead = 0.14f },
            new ShotSpec { Type = ShotType.Leave, Name = "Leave", Lead = 0f },
            new ShotSpec { Type = ShotType.Drive, Name = "Drive", DirMin = -50, DirMax = 85, UMin = -0.3f, UMax = 0.75f, HMin = 0f, HMax = 0.85f, LenMin = 1.6f, LenMax = 5.8f, Feet = Footwork.Front, BatSpeed = 19.5f, GroundElevation = 3f, LoftElevation = 29f, Lead = 0.2f },
            new ShotSpec { Type = ShotType.Cut, Name = "Cut", DirMin = 60, DirMax = 150, UMin = 0.2f, UMax = 1.25f, HMin = 0.2f, HMax = 1.35f, LenMin = 6.5f, LenMax = 14f, Feet = Footwork.Back, BatSpeed = 20f, GroundElevation = 2f, LoftElevation = 24f, Lead = 0.18f },
            new ShotSpec { Type = ShotType.Pull, Name = "Pull", DirMin = -155, DirMax = -20, UMin = -0.55f, UMax = 0.5f, HMin = 0.55f, HMax = 2.1f, LenMin = 7f, LenMax = 14f, Feet = Footwork.Back, BatSpeed = 22f, GroundElevation = 4f, LoftElevation = 26f, Lead = 0.2f },
            new ShotSpec { Type = ShotType.Sweep, Name = "Sweep", DirMin = -170, DirMax = -40, UMin = -0.55f, UMax = 0.7f, HMin = 0f, HMax = 0.75f, LenMin = 1.5f, LenMax = 5.5f, Feet = Footwork.Front, BatSpeed = 17f, GroundElevation = 2f, LoftElevation = 27f, Lead = 0.22f },
            new ShotSpec { Type = ShotType.Flick, Name = "Flick", DirMin = -115, DirMax = 5, UMin = -0.75f, UMax = 0.2f, HMin = 0f, HMax = 0.95f, LenMin = 0f, LenMax = 9f, Feet = Footwork.Auto, BatSpeed = 17.5f, GroundElevation = 3f, LoftElevation = 27f, Lead = 0.17f },
        };

        public static ShotSpec Get(ShotType t) => All[(int)t];

        /// <summary>Base windows (s) for perfect / good / poor timing.</summary>
        public const float Perfect = 0.022f, Good = 0.055f, Poor = 0.1f;

        public static Timing ClassifyTiming(float err, float window)
        {
            float a = Mathf.Abs(err);
            if (a <= Perfect * window) return Timing.Perfect;
            if (a <= Poor * window) return err < 0 ? Timing.Early : Timing.Late;
            return err < 0 ? Timing.VeryEarly : Timing.VeryLate;
        }

        /// <summary>Picks the natural footwork for a ball pitching at this length (m from the stumps).</summary>
        public static Footwork NaturalFeet(float length, bool spin)
        {
            if (length < 0f) return Footwork.Front; // full toss
            return length < (spin ? 5.6f : 6.4f) ? Footwork.Front : Footwork.Back;
        }

        /// <summary>
        /// "Auto" shot: the stroke a batter would play for this aim, footwork and ball (used for the main shot button,
        /// so players pick direction and feet and the game picks the stroke, as modern cricket games do).
        /// </summary>
        public static ShotType Choose(float aim, Footwork feet, float u, float h, float length, bool spin)
        {
            bool back = feet == Footwork.Back || (feet == Footwork.Auto && NaturalFeet(length, spin) == Footwork.Back);
            if (h > 1.05f && aim < 30f) return ShotType.Pull;
            if (aim >= 60f && (back || u > 0.45f)) return ShotType.Cut;
            if (aim <= -25f)
            {
                if (back && h > 0.5f) return ShotType.Pull;
                return ShotType.Flick;
            }
            if (back && h > 0.9f) return aim > 20f ? ShotType.Cut : ShotType.Pull;
            return ShotType.Drive;
        }

        static float OutsideRange(float v, float min, float max) => v < min ? min - v : v > max ? v - max : 0f;

        public static ShotResult Resolve(ShotInput input, ContactContext c, Rng rng)
        {
            var r = new ShotResult { Shot = input.Type, Feet = input.Feet };
            var f = c.Frame;
            float u = f.OffsetOff(c.BallPos) - c.Guard;
            float h = c.BallPos.y;
            float vin = c.BallVel.magnitude;

            if (!input.Played || input.Type == ShotType.Leave)
            {
                r.Contact = Contact.None;
                r.Timing = Timing.NoShot;
                r.Shot = ShotType.Leave;
                r.Note = input.Played ? "Left alone" : "No shot";
                return r;
            }
            if (input.Type == ShotType.Auto) input.Type = Choose(input.Aim, input.Feet, u, h, c.Length, c.Spin);
            r.Shot = input.Type;
            var spec = Get(input.Type);
            var feet = input.Feet == Footwork.Auto ? (spec.Feet == Footwork.Auto ? NaturalFeet(c.Length, c.Spin) : spec.Feet) : input.Feet;
            r.Feet = feet;
            r.Timing = ClassifyTiming(input.TimingError, c.Window);

            // Coverage of the line and height.
            float du = OutsideRange(u, spec.UMin, spec.UMax);
            float dh = OutsideRange(h, spec.HMin, spec.HMax);
            float zoneMiss = Mathf.Sqrt(du * du + dh * dh);
            float zoneQ = Mathf.Clamp01(1f - zoneMiss / 0.35f);

            // Footwork and length: the wrong foot cramps the stroke.
            float lengthQ = 1f;
            if (c.Length >= 0f)
            {
                float lenOff = OutsideRange(c.Length, spec.LenMin, spec.LenMax);
                lengthQ = Mathf.Clamp01(1f - lenOff * 0.12f);
            }
            if (feet == Footwork.Front && c.Length > 8f) lengthQ *= 0.65f;      // lunging at a short ball
            if (feet == Footwork.Back && c.Length >= 0f && c.Length < 3.5f) lengthQ *= 0.7f; // stuck on the crease to a full one
            if (input.Type == ShotType.Sweep && !c.Spin && vin > 30f) lengthQ *= 0.6f;   // sweeping the quicks

            float err = input.TimingError;
            float window = Mathf.Max(0.3f, c.Window);
            float timingQ;
            float a = Mathf.Abs(err);
            if (a <= Perfect * window) timingQ = 1f;
            else if (a <= Good * window) timingQ = Mathf.Lerp(1f, 0.75f, (a - Perfect * window) / ((Good - Perfect) * window));
            else if (a <= Poor * window) timingQ = Mathf.Lerp(0.75f, 0.35f, (a - Good * window) / ((Poor - Good) * window));
            else timingQ = 0f;

            float skill = Mathf.Lerp(0.82f, 1f, c.BatterSkill);
            float late = Mathf.Max(0f, c.LateMovement - 0.04f);

            // Swing and miss: badly mistimed, or the ball simply wasn't where the bat went.
            float pMiss = timingQ <= 0f ? 0.85f : Mathf.Clamp01(zoneMiss > 0.45f ? 0.9f : (1f - zoneQ) * 0.55f + late * 1.5f - c.BatterSkill * 0.05f);
            if (input.Type == ShotType.Defend) pMiss *= 0.6f;
            if (rng.Chance(pMiss))
            {
                r.Contact = Contact.Miss;
                r.Note = timingQ <= 0f ? (err < 0 ? "Through the shot far too early" : "Beaten for pace") : late > 0.05f ? "Beaten by the movement" : "Played and missed";
                return r;
            }

            float pEdge = Mathf.Clamp(0.03f + 0.55f * (1f - zoneQ) + 0.28f * (1f - timingQ) + late * 2.2f + (1f - lengthQ) * 0.3f - 0.04f * c.BatterSkill, 0f, 0.85f);
            if (input.Type == ShotType.Defend) pEdge *= 0.7f;
            var up = Vector3.up;
            if (rng.Chance(pEdge))
            {
                r.Contact = Contact.Edge;
                bool topEdge = (input.Type == ShotType.Pull || input.Type == ShotType.Sweep) && rng.Chance(0.55f);
                float centre = (spec.UMin + spec.UMax) * 0.5f;
                if (topEdge)
                {
                    r.Edge = EdgeKind.Top;
                    float dir = rng.Range(-175f, -95f) * (input.Type == ShotType.Pull ? 1f : 1f);
                    float el = rng.Range(48f, 78f);
                    float speed = rng.Range(14f, 24f);
                    r.Direction = dir;
                    r.ExitVel = Launch(f, dir, el, speed);
                    r.ExitSpin = Vector3.Cross(up, r.ExitVel.normalized) * rng.Range(-60f, 60f);
                    r.Note = "Top edge!";
                }
                else if (u > centre - 0.05f)
                {
                    r.Edge = EdgeKind.Outside;
                    bool thin = rng.Chance(0.55f);
                    float dir = thin ? rng.Range(150f, 176f) : rng.Range(105f, 150f);
                    float el = thin ? rng.Range(1f, 12f) : rng.Range(-6f, 18f);
                    float speed = vin * (thin ? rng.Range(0.6f, 0.8f) : rng.Range(0.35f, 0.6f)) + (input.Type == ShotType.Defend ? -4f : 2f);
                    r.Direction = dir;
                    r.ExitVel = Launch(f, dir, el, Mathf.Max(4f, speed));
                    r.Note = thin ? "Outside edge" : "Thick outside edge";
                }
                else
                {
                    r.Edge = EdgeKind.Inside;
                    // Inside edge: onto the pads, past leg stump, or back onto the stumps.
                    bool lineOnStumps = Mathf.Abs(f.OffsetOff(c.BallPos)) < Geo.StumpsHalfWidth + 0.1f;
                    if (lineOnStumps && rng.Chance(0.35f))
                    {
                        r.PlayedOn = true;
                        r.Direction = rng.Range(170f, 190f);
                        r.ExitVel = Launch(f, r.Direction, rng.Range(-10f, 2f), vin * 0.35f);
                        r.Note = "Dragged on!";
                    }
                    else
                    {
                        float dir = rng.Range(-178f, -135f);
                        r.Direction = dir;
                        r.ExitVel = Launch(f, dir, rng.Range(-8f, 25f), vin * rng.Range(0.3f, 0.55f));
                        r.Note = "Inside edge";
                    }
                }
                return r;
            }

            // Middled (to a degree).
            float q = Mathf.Clamp01(timingQ * Mathf.Lerp(0.55f, 1f, zoneQ) * lengthQ * skill);
            r.Contact = Contact.Middle;
            r.Quality = q;

            float aim = Mathf.Clamp(input.Aim, spec.DirMin, spec.DirMax);
            // Early closes the face (ball goes leg side), late opens it (off side / behind square).
            float skew = Mathf.Clamp(err * 320f, -40f, 40f);
            float direction = aim + skew + rng.Gauss() * (1f - q) * 12f;
            r.Direction = direction;

            float batSpeed = spec.BatSpeed * Mathf.Lerp(0.3f, 1f, q) * Mathf.Lerp(0.9f, 1.12f, c.BatterPower) * (input.Loft ? 1.12f : 1f);
            // Collision: effective bat-ball restitution ~0.5 with a bat effective mass of ~0.9 kg.
            const float qA = 0.25f;
            float speedOut = qA * vin * Mathf.Lerp(0.6f, 1f, q) + (1f + qA) * batSpeed;
            float elevation;
            if (input.Type == ShotType.Defend)
            {
                speedOut = Mathf.Min(speedOut, rng.Range(2.5f, 6.5f));
                elevation = rng.Range(-14f, -3f);
            }
            else if (input.Loft)
            {
                // Mistimed lofts go too high (skied) or too flat (straight to a fielder).
                elevation = spec.LoftElevation + rng.Gauss() * (1f - q) * 12f + (err > 0 ? 6f : 0f) * (1f - q);
            }
            else
            {
                elevation = spec.GroundElevation + (1f - q) * rng.Range(-2f, 14f) + rng.Gauss() * 1.5f;
                if (input.Type == ShotType.Pull && h > 1.35f) elevation += 9f; // hooking a bouncer goes in the air
            }
            r.ExitVel = Launch(f, direction, elevation, speedOut);
            var horizontal = new Vector3(r.ExitVel.x, 0f, r.ExitVel.z).normalized;
            var topAxis = new Vector3(horizontal.z, 0f, -horizontal.x);
            r.ExitSpin = input.Loft || elevation > 12f ? -topAxis * (rng.Range(18f, 32f) * 2f * Mathf.PI) : topAxis * (rng.Range(4f, 12f) * 2f * Mathf.PI);

            // Rare: overbalancing into the stumps on the back foot.
            if (feet == Footwork.Back && (input.Type == ShotType.Pull || input.Type == ShotType.Cut) && q < 0.45f && rng.Chance(0.02f)) r.HitWicket = true;

            r.Note = r.Timing == Timing.Perfect ? (q > 0.85f ? "Perfectly timed" : "Well timed") : r.Timing == Timing.Early ? "A touch early" : r.Timing == Timing.Late ? "A touch late" : "Mistimed";
            return r;
        }

        public static Vector3 Launch(BatFrame f, float dirDeg, float elevationDeg, float speed)
        {
            float e = elevationDeg * Mathf.Deg2Rad;
            return (f.Direction(dirDeg) * Mathf.Cos(e) + Vector3.up * Mathf.Sin(e)) * speed;
        }
    }
}
