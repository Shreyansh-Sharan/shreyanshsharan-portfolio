using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>CPU captain and bowler: picks who bowls, sets the field for the phase of the innings, and mixes up
    /// deliveries (new-ball swing, hard lengths, bouncers, yorkers and slower balls at the death, spinners' variations).</summary>
    public static class BowlingAI
    {
        public struct Choice
        {
            public DeliveryType Type;
            public Vector3 Target;
            public bool Around;
        }

        static float Progress(MatchDirector d) => d.Inn.LegalBalls / (float)Mathf.Max(6, d.State.ActiveRules.Overs * 6);
        static bool Death(MatchDirector d) => Progress(d) >= 0.75f || d.State.InSuperOver;

        public static int ChooseBowler(MatchDirector d, Rng rng)
        {
            var eligible = d.EligibleBowlers();
            var team = d.FieldingTeam;
            var inn = d.Inn;
            int best = eligible[0];
            float bestScore = float.MinValue;
            bool death = Death(d), powerplay = d.State.IsPowerplay;
            // The bowler from two overs ago keeps his end if he's going well (bowlers work in pairs).
            int twoAgo = -1;
            if (inn.Log.Count > 0)
            {
                int over = inn.Over - 2;
                foreach (var b in inn.Log) if (b.Over == over) { twoAgo = b.Bowler; break; }
            }
            foreach (int i in eligible)
            {
                var p = team.Players[i];
                bool spin = Deliveries.IsSpinStyle(p.Bowl);
                float score = p.Bowling;
                if (!p.CanBowl) score -= 40f;
                if ((powerplay || death) && !spin) score += 12f;
                if (!powerplay && !death && spin) score += 10f;
                if (d.State.Setup.Pitch == PitchType.Dusty && spin) score += 10f;
                if (d.State.Setup.Pitch == PitchType.Green && !spin) score += 8f;
                if (i == twoAgo) score += 6f;
                var fielder = d.FielderFor(i);
                if (fielder != null) score -= (100f - fielder.Stamina) * 0.3f;
                var card = inn.Bowling.Find(b => b.Player == i);
                if (card != null && card.Balls >= 6) score -= (card.Economy - 7.5f) * 2f - card.Wickets * 3f;
                score += rng.Range(0f, 5f);
                if (score > bestScore) { bestScore = score; best = i; }
            }
            return best;
        }

        public static FieldPreset ChoosePreset(MatchDirector d, PlayerProfile bowler)
        {
            bool spin = Deliveries.IsSpinStyle(bowler.Bowl);
            var st = d.State;
            if (Death(d)) return FieldPreset.Death;
            if (st.IsPowerplay) return spin ? FieldPreset.Balanced : FieldPreset.Attacking;
            if (st.Current.Target > 0)
            {
                float rrr = st.RequiredRate;
                if (rrr > 10f) return spin ? FieldPreset.SpinAttack : FieldPreset.Attacking;
                if (rrr < 6f) return FieldPreset.Defensive;
            }
            return spin && st.Setup.Pitch == PitchType.Dusty ? FieldPreset.SpinAttack : FieldPreset.Balanced;
        }

        public static Choice ChooseDelivery(MatchDirector d, Rng rng)
        {
            var bowler = d.FieldingTeam.Players[d.Inn.Bowler];
            var types = Deliveries.For(bowler.Bowl);
            var f = d.Frame;
            bool death = Death(d);
            float ballAge = d.Inn.LegalBalls / 6f;
            var weights = new float[types.Length];
            for (int i = 0; i < types.Length; i++)
            {
                switch (types[i])
                {
                    case DeliveryType.SeamUp: weights[i] = 3f; break;
                    case DeliveryType.Outswing: weights[i] = ballAge < 10f ? 2.5f : 1f; break;
                    case DeliveryType.Inswing: weights[i] = ballAge < 10f ? 1.8f : 0.8f; break;
                    case DeliveryType.Bouncer: weights[i] = d.Inn.BouncersThisOver < d.State.ActiveRules.BouncersPerOver ? (death ? 1.2f : 0.8f) : 0f; break;
                    case DeliveryType.Yorker: weights[i] = death ? 3.5f : 0.5f; break;
                    case DeliveryType.SlowerBall: weights[i] = death ? 2.2f : 0.6f; break;
                    case DeliveryType.OffBreak: case DeliveryType.LegBreak: weights[i] = 4f; break;
                    case DeliveryType.ArmBall: weights[i] = 1f; break;
                    case DeliveryType.Googly: weights[i] = 1.4f; break;
                }
            }
            float total = 0f;
            foreach (var w in weights) total += w;
            float pick = rng.Range(0f, total);
            var type = types[0];
            for (int i = 0; i < types.Length; i++) { pick -= weights[i]; if (pick <= 0f) { type = types[i]; break; } }

            var spec = Deliveries.Get(type);
            float diffNoise = d.State.Setup.Difficulty == Difficulty.Easy ? 1.4f : d.State.Setup.Difficulty == Difficulty.Hard ? 0.7f : 1f;
            float length = spec.DefaultLength + rng.Gauss() * 0.5f * diffNoise;
            float line;
            switch (type)
            {
                case DeliveryType.Yorker: line = rng.Chance(death ? 0.3f : 0.1f) ? 0.7f : 0.02f; break; // wide yorker sometimes
                case DeliveryType.Bouncer: line = -0.1f; break;
                case DeliveryType.Outswing: line = 0.22f; break;
                case DeliveryType.Inswing: line = 0.05f; break;
                case DeliveryType.LegBreak: line = 0.05f; break;
                case DeliveryType.OffBreak: line = 0.32f; break;
                default: line = 0.15f; break;
            }
            line += rng.Gauss() * 0.08f * diffNoise;
            bool around = Deliveries.IsSpinStyle(bowler.Bowl) && rng.Chance(0.08f);
            return new Choice { Type = type, Target = f.Local(line, length), Around = around };
        }

        public static float ReleaseError(MatchDirector d, PlayerProfile bowler, Rng rng)
        {
            float sigma = d.State.Setup.Difficulty == Difficulty.Easy ? 0.75f : d.State.Setup.Difficulty == Difficulty.Hard ? 0.32f : 0.5f;
            sigma *= 1.3f - 0.6f * bowler.Bowl01;
            var fielder = d.FielderFor(bowler == null ? -1 : d.Inn.Bowler);
            if (fielder != null) sigma *= Mathf.Lerp(1.25f, 1f, fielder.Stamina / 100f);
            return Mathf.Clamp(rng.Gauss() * sigma, -1.1f, 1.1f);
        }
    }
}
