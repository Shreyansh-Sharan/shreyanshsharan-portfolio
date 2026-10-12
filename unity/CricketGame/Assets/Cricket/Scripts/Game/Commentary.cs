using Cricket.Sim;

namespace Cricket.Game
{
    /// <summary>On-screen commentary lines, generated from what happened (no text packs to load).</summary>
    public static class Commentary
    {
        static string Pick(Rng rng, params string[] lines) => lines[rng.Range(0, lines.Length)];

        public static string Four(string batter, ShotResult shot, Rng rng)
        {
            string stroke = ShotWord(shot);
            if (shot.Contact == Contact.Edge) return Pick(rng, $"Edged and four! {batter} gets away with that one through the vacant slip area.", $"Off the edge, past the keeper, four. Lucky {batter}.");
            return Pick(rng,
                $"FOUR! A glorious {stroke} from {batter}, the fielder had no chance.",
                $"Beautifully timed! {batter} threads the {stroke} into the gap for four.",
                $"Crack! That's raced away for four. {batter} is seeing it like a football.",
                $"Four more! Pierces the field with a crisp {stroke}.");
        }

        public static string Six(string batter, Rng rng) => Pick(rng,
            $"SIX! {batter} has launched that into the crowd!",
            $"That is huge! {batter} clears the rope with ease.",
            $"Up, up and away! Maximum for {batter}.",
            $"Oh my word, that's gone all the way. Six!");

        public static string Wide(Rng rng) => Pick(rng, "Wide, called by the umpire. Strayed too far.", "That's a wide. Extra run to the total.", "Down the leg side and signalled wide.");

        public static string Runs(int runs, ExtraType extra, string batter, Rng rng)
        {
            if (extra == ExtraType.Bye) return $"{runs} bye{(runs > 1 ? "s" : "")}, the keeper couldn't gather it.";
            if (extra == ExtraType.LegBye) return $"{runs} leg bye{(runs > 1 ? "s" : "")} off the pads.";
            if (extra == ExtraType.Wide) return $"Wide, and they scamper {runs} more.";
            switch (runs)
            {
                case 1: return Pick(rng, $"Worked away for a single by {batter}.", "Quick single, good running.", "Pushed into the gap, they take one.");
                case 2: return Pick(rng, "Placed into the gap and they come back for two.", $"Two runs, excellent running from {batter} and his partner.");
                case 3: return "Three runs! Chased down just inside the rope.";
                default: return $"{runs} runs, all run!";
            }
        }

        public static string Dot(MatchDirector d, ShotResult shot, string batter, Rng rng)
        {
            if (shot.Contact == Contact.Miss) return Pick(rng, $"Beaten! Past the outside edge, {batter} had a waft at that.", "Played and missed. Lovely delivery.", "Whistles past the edge. So close.");
            if (shot.Shot == ShotType.Leave) return Pick(rng, $"{batter} shoulders arms and lets that go.", "Left alone outside off. Good judgement.");
            if (shot.Shot == ShotType.Defend) return Pick(rng, "Solid in defence, straight back to the bowler.", "Dead bat, no run.", $"{batter} gets right behind that one.");
            return Pick(rng, "Straight to the fielder, no run.", "Good fielding saves a run there.", "Dot ball. Pressure building.");
        }

        public static string Drop(string fielder, Rng rng) => Pick(rng, $"Dropped! {fielder} put that down. That could be costly.", $"Oh, a chance goes down! {fielder} couldn't hold on.", "Put down! Should've been taken.");

        public static string Wicket(MatchDirector d, BallOutcome o, string batter, string bowler, Rng rng)
        {
            switch (o.How)
            {
                case Dismissal.Bowled: return Pick(rng, $"BOWLED HIM! {bowler} knocks back the stumps and {batter} has to go.", $"Timber! The bails are flying and {batter} is bowled.", $"Through the gate! {bowler} cleans up {batter}.");
                case Dismissal.Caught:
                    if (d.LastShot.Contact == Contact.Edge) return Pick(rng, $"Edged and taken! {bowler} gets his man, {batter} caught.", $"Nicked off! A thin edge and it's held. {batter} departs.");
                    return Pick(rng, $"Caught! {batter} picks out the fielder and {bowler} strikes.", $"In the air... and taken! {batter} has to walk.", "Holds on! A fine catch and a big wicket.");
                case Dismissal.Lbw: return Pick(rng, $"Trapped in front! {batter} is LBW to {bowler}.", $"Up goes the finger, plumb LBW. {batter} is gone.");
                case Dismissal.Stumped: return $"Stumped! {batter} was miles out of his ground.";
                case Dismissal.RunOut: return Pick(rng, "Run out! A terrible mix-up between the batters.", "Short of his ground. Run out!");
                case Dismissal.HitWicket: return $"Hit wicket! {batter} has knocked his own stumps.";
                default: return $"{batter} is out.";
            }
        }

        public static string EndOfOver(MatchState st, Rng rng)
        {
            var inn = st.Current;
            string score = $"{st.Batting.Name} {st.ScoreText(inn)} after {inn.Over} over{(inn.Over == 1 ? "" : "s")}";
            if (inn.Target > 0) return $"End of the over: {score}. They need {st.RunsNeeded} from {st.BallsLeft} balls.";
            return $"End of the over: {score}, run rate {inn.RunRate:0.00}.";
        }

        static string ShotWord(ShotResult s)
        {
            switch (s.Shot)
            {
                case ShotType.Drive: return s.Direction > 30f ? "cover drive" : s.Direction < -10f ? "on-drive" : "straight drive";
                case ShotType.Cut: return "cut";
                case ShotType.Pull: return "pull";
                case ShotType.Sweep: return "sweep";
                case ShotType.Flick: return "flick";
                default: return "shot";
            }
        }
    }
}
