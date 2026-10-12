using System;
using UnityEngine;

namespace Cricket.Sim
{
    public enum Zone : byte { InLine, UmpiresCall, Outside, OutsideOff, OutsideLeg, Hitting, Missing, NotApplicable }

    /// <summary>Ball-tracking verdict for an LBW: where it pitched, where it hit the pad, and whether it would hit the stumps.</summary>
    [Serializable]
    public struct LbwTrack
    {
        public bool FullToss;
        public Vector3 Pitched;
        public Vector3 Impact;
        public Vector3 AtStumps;      // projected centre of the ball in the plane of the stumps
        public Zone Pitching;         // InLine / OutsideOff / OutsideLeg
        public Zone ImpactZone;       // InLine / UmpiresCall / Outside (relative to the line of the stumps)
        public bool ImpactOffSide;    // impact outside the line was on the off side
        public Zone Wickets;          // Hitting / UmpiresCall / Missing
        public bool ShotOffered;

        /// <summary>Out on the tracking alone, treating umpire's call components as "out".</summary>
        public bool OutIfCallsGo(bool callsOut)
        {
            if (Pitching == Zone.OutsideLeg) return false;
            bool impactOk = ImpactZone == Zone.InLine || (ImpactZone == Zone.UmpiresCall && callsOut) || ((ImpactZone == Zone.Outside || ImpactZone == Zone.UmpiresCall) && ImpactOffSide && !ShotOffered);
            bool wicketsOk = Wickets == Zone.Hitting || (Wickets == Zone.UmpiresCall && callsOut);
            return impactOk && wicketsOk;
        }

        public bool HasUmpiresCall => ImpactZone == Zone.UmpiresCall || Wickets == Zone.UmpiresCall;
    }

    public enum ReviewOutcome : byte { Overturned, Stands, UmpiresCall }

    public static class Umpiring
    {
        const float R = Geo.BallRadius;

        /// <summary>Builds the tracking verdict. Offsets use the batter frame (+ off side).</summary>
        public static LbwTrack Track(BatFrame f, bool pitchedBeforeImpact, Vector3 pitched, Vector3 impact, Vector3 atStumps, bool shotOffered)
        {
            var t = new LbwTrack { FullToss = !pitchedBeforeImpact, Pitched = pitched, Impact = impact, AtStumps = atStumps, ShotOffered = shotOffered };
            float half = Geo.StumpsHalfWidth;
            if (!pitchedBeforeImpact) t.Pitching = Zone.NotApplicable;
            else
            {
                float pu = f.OffsetOff(pitched);
                t.Pitching = pu < -(half + R) ? Zone.OutsideLeg : pu > half + R ? Zone.OutsideOff : Zone.InLine;
            }
            float iu = f.OffsetOff(impact);
            t.ImpactOffSide = iu > 0f;
            float ia = Mathf.Abs(iu);
            t.ImpactZone = ia <= half ? Zone.InLine : ia <= half + R ? Zone.UmpiresCall : Zone.Outside;

            float su = Mathf.Abs(f.OffsetOff(atStumps));
            float top = Geo.StumpHeight + Geo.BailHeight;
            // Hitting if at least half the ball is inside the zone (centre inside), umpire's call if only part of it is.
            bool centreIn = su <= half && atStumps.y <= top;
            bool touches = su <= half + R && atStumps.y <= top + R;
            t.Wickets = centreIn ? Zone.Hitting : touches ? Zone.UmpiresCall : Zone.Missing;
            return t;
        }

        /// <summary>
        /// The on-field umpire's call: he judges the same things with human error (worse on close ones, slightly cautious).
        /// </summary>
        public static bool UmpireGivesLbw(LbwTrack t, BatFrame f, Rng rng, float accuracy = 1f)
        {
            float noise = 1.4f - Mathf.Clamp01(accuracy) * 0.6f;
            float half = Geo.StumpsHalfWidth;
            float pu = t.FullToss ? 0f : f.OffsetOff(t.Pitched) + rng.Gauss() * 0.035f * noise;
            if (!t.FullToss && pu < -(half + R)) return false;
            float iu = f.OffsetOff(t.Impact) + rng.Gauss() * 0.03f * noise;
            bool impactIn = Mathf.Abs(iu) <= half + R * 0.5f;
            if (!impactIn && (iu < 0f || t.ShotOffered)) return false;
            float su = f.OffsetOff(t.AtStumps) + rng.Gauss() * 0.05f * noise;
            float sy = t.AtStumps.y + rng.Gauss() * 0.07f * noise;
            // Benefit of the doubt: only gives it when it looks clearly on target.
            return Mathf.Abs(su) <= half + R * 0.3f && sy <= Geo.StumpHeight + 0.01f;
        }

        /// <summary>Whether the umpire hears/sees a nick on a ball that passed the bat.</summary>
        public static bool UmpireHearsEdge(bool edged, float closeness01, Rng rng)
        {
            if (edged) return rng.Chance(0.9f);
            return rng.Chance(0.04f * closeness01);
        }

        public static ReviewOutcome ReviewLbw(LbwTrack t, bool givenOut)
        {
            if (givenOut)
            {
                if (t.OutIfCallsGo(false)) return ReviewOutcome.Stands;         // clearly out
                if (t.OutIfCallsGo(true)) return ReviewOutcome.UmpiresCall;     // only out because of umpire's call
                return ReviewOutcome.Overturned;
            }
            if (t.OutIfCallsGo(false)) return ReviewOutcome.Overturned;
            if (t.OutIfCallsGo(true)) return ReviewOutcome.UmpiresCall;
            return ReviewOutcome.Stands;
        }

        public static string ZoneText(Zone z)
        {
            switch (z)
            {
                case Zone.InLine: return "IN LINE";
                case Zone.UmpiresCall: return "UMPIRE'S CALL";
                case Zone.Outside: return "OUTSIDE";
                case Zone.OutsideOff: return "OUTSIDE OFF";
                case Zone.OutsideLeg: return "OUTSIDE LEG";
                case Zone.Hitting: return "HITTING";
                case Zone.Missing: return "MISSING";
                default: return "—";
            }
        }

        /// <summary>Wide (limited-overs guidelines): outside the wide guide on the off side, or past leg stump.</summary>
        public static bool IsWide(BatFrame f, Vector3 atCrease, float guard, bool touchedBatOrBody)
        {
            if (touchedBatOrBody) return false;
            float u = f.OffsetOff(atCrease);
            // The guide moves with a batter who shuffles across.
            float offLine = Geo.WideLineOff + Mathf.Max(0f, guard);
            float legLine = -(Geo.StumpsHalfWidth + Geo.WideLineLeg) + Mathf.Min(0f, guard);
            return u > offLine || u < legLine || atCrease.y > 2.1f;
        }
    }
}
