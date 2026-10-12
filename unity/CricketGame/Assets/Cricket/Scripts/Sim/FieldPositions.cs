using System;
using System.Collections.Generic;
using UnityEngine;

namespace Cricket.Sim
{
    /// <summary>A named fielding position: angle around the striker's stumps (0 straight, +off) and distance (m).</summary>
    [Serializable]
    public struct FieldSpot
    {
        public string Name;
        public float Angle;
        public float Dist;
        public FieldSpot(string name, float angle, float dist) { Name = name; Angle = angle; Dist = dist; }
    }

    public enum FieldPreset : byte { Attacking, Balanced, Defensive, Death, SpinAttack }

    /// <summary>Standard positions and the captain's presets (nine fielders; the bowler and keeper are extra).</summary>
    public static class Fields
    {
        public static readonly FieldSpot FirstSlip = new FieldSpot("1st slip", 162, 19);
        public static readonly FieldSpot SecondSlip = new FieldSpot("2nd slip", 156, 20);
        public static readonly FieldSpot ThirdSlip = new FieldSpot("3rd slip", 150, 21);
        public static readonly FieldSpot Gully = new FieldSpot("Gully", 128, 21);
        public static readonly FieldSpot Point = new FieldSpot("Point", 95, 22);
        public static readonly FieldSpot BackwardPoint = new FieldSpot("Backward point", 112, 23);
        public static readonly FieldSpot Cover = new FieldSpot("Cover", 62, 24);
        public static readonly FieldSpot ExtraCover = new FieldSpot("Extra cover", 42, 25);
        public static readonly FieldSpot MidOff = new FieldSpot("Mid-off", 16, 24);
        public static readonly FieldSpot MidOn = new FieldSpot("Mid-on", -16, 24);
        public static readonly FieldSpot Midwicket = new FieldSpot("Midwicket", -58, 24);
        public static readonly FieldSpot SquareLeg = new FieldSpot("Square leg", -95, 22);
        public static readonly FieldSpot ShortFineLeg = new FieldSpot("Short fine leg", -148, 20);
        public static readonly FieldSpot ShortLeg = new FieldSpot("Short leg", -105, 5.5f);
        public static readonly FieldSpot SillyPoint = new FieldSpot("Silly point", 100, 5.5f);
        public static readonly FieldSpot LegSlip = new FieldSpot("Leg slip", -162, 14);
        public static readonly FieldSpot FineLeg = new FieldSpot("Fine leg", -155, 60);
        public static readonly FieldSpot ThirdMan = new FieldSpot("Third man", 148, 60);
        public static readonly FieldSpot DeepPoint = new FieldSpot("Deep point", 98, 58);
        public static readonly FieldSpot DeepCover = new FieldSpot("Deep cover", 55, 62);
        public static readonly FieldSpot LongOff = new FieldSpot("Long-off", 14, 68);
        public static readonly FieldSpot LongOn = new FieldSpot("Long-on", -14, 68);
        public static readonly FieldSpot DeepMidwicket = new FieldSpot("Deep midwicket", -55, 62);
        public static readonly FieldSpot DeepSquareLeg = new FieldSpot("Deep square leg", -98, 58);
        public static readonly FieldSpot DeepFineLeg = new FieldSpot("Deep fine leg", -140, 60);

        public static FieldSpot[] Preset(FieldPreset preset, bool spin)
        {
            switch (preset)
            {
                case FieldPreset.Attacking:
                    return spin
                        ? new[] { FirstSlip, ShortLeg, SillyPoint, Point, Cover, MidOff, MidOn, Midwicket, SquareLeg }
                        : new[] { FirstSlip, SecondSlip, ThirdSlip, Gully, Point, Cover, MidOff, MidOn, FineLeg };
                case FieldPreset.SpinAttack:
                    return new[] { FirstSlip, ShortLeg, SillyPoint, LegSlip, Point, Cover, MidOff, MidOn, Midwicket };
                case FieldPreset.Defensive:
                    return spin
                        ? new[] { Point, Cover, MidOff, MidOn, Midwicket, DeepCover, LongOn, DeepMidwicket, DeepSquareLeg }
                        : new[] { FirstSlip, Point, Cover, MidOff, MidOn, Midwicket, ThirdMan, DeepCover, FineLeg };
                case FieldPreset.Death:
                    return new[] { BackwardPoint, ExtraCover, Midwicket, ShortFineLeg, LongOff, LongOn, DeepMidwicket, DeepPoint, DeepSquareLeg };
                default: // balanced
                    return spin
                        ? new[] { FirstSlip, Point, Cover, MidOff, MidOn, Midwicket, SquareLeg, LongOn, DeepCover }
                        : new[] { FirstSlip, Gully, Point, Cover, MidOff, MidOn, SquareLeg, ThirdMan, FineLeg };
            }
        }

        public static bool Outside(FieldSpot s) => s.Dist > Geo.InnerCircle + 2f;

        /// <summary>
        /// Fielding restrictions: at most `maxOutside` outside the 30-yard circle. Extra deep fielders are brought in
        /// to the edge of the ring (they keep their angle).
        /// </summary>
        public static FieldSpot[] Enforce(FieldSpot[] spots, int maxOutside)
        {
            var result = (FieldSpot[])spots.Clone();
            var deep = new List<int>();
            for (int i = 0; i < result.Length; i++) if (Outside(result[i])) deep.Add(i);
            // Keep the straightest / finest deep fielders out, bring the squarest in.
            deep.Sort((a, b) => Mathf.Abs(Mathf.Abs(result[b].Angle) - 90f).CompareTo(Mathf.Abs(Mathf.Abs(result[a].Angle) - 90f)));
            for (int k = maxOutside; k < deep.Count; k++)
            {
                var s = result[deep[k]];
                s.Name = s.Name.Replace("Deep ", "").Replace("Long-", "Mid-");
                s.Dist = Geo.InnerCircle - 3f;
                result[deep[k]] = s;
            }
            return result;
        }

        /// <summary>Converts a spot to a world position for this striker, kept inside the rope.</summary>
        public static Vector3 ToWorld(FieldSpot s, BatFrame f)
        {
            var p = f.Polar(s.Angle, s.Dist);
            float beyond = Geo.BeyondRope(p, 4f);
            if (beyond > 0f) p -= (p - f.Origin).normalized * beyond;
            p.y = 0f;
            return p;
        }

        /// <summary>Nearest named position for a world point (for the field editor's labels).</summary>
        public static string NameOf(Vector3 p, BatFrame f)
        {
            float a = f.AngleOf(p);
            float d = Vector3.Distance(new Vector3(p.x, 0, p.z), f.Origin);
            FieldSpot[] all = { FirstSlip, SecondSlip, ThirdSlip, Gully, Point, BackwardPoint, Cover, ExtraCover, MidOff, MidOn, Midwicket, SquareLeg, ShortFineLeg, ShortLeg, SillyPoint, LegSlip, FineLeg, ThirdMan, DeepPoint, DeepCover, LongOff, LongOn, DeepMidwicket, DeepSquareLeg };
            string best = "Fielder";
            float bestScore = float.MaxValue;
            foreach (var s in all)
            {
                float score = Mathf.Abs(Mathf.DeltaAngle(a, s.Angle)) * 0.6f + Mathf.Abs(d - s.Dist) * 1.2f;
                if (score < bestScore) { bestScore = score; best = s.Name; }
            }
            return best;
        }
    }
}
