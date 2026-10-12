using System;
using System.Collections.Generic;
using System.Text;
using UnityEngine;

namespace Cricket.Sim
{
    public enum MatchFormat : byte { T20, T10, ODI, SuperOver }
    public enum ExtraType : byte { None, Wide, NoBall, Bye, LegBye }
    public enum Dismissal : byte { None, Bowled, Caught, Lbw, RunOut, Stumped, HitWicket }
    public enum Difficulty : byte { Easy, Normal, Hard }

    /// <summary>Playing conditions per format (limited-overs rules).</summary>
    [Serializable]
    public struct FormatRules
    {
        public MatchFormat Format;
        public int Overs;
        public int MaxOversPerBowler;
        public int PowerplayOvers;
        public int MaxOutsidePowerplay;
        public int MaxOutside;
        public int Reviews;
        public int BouncersPerOver;
        public int MaxWickets;

        public static FormatRules For(MatchFormat f, int oversOverride = 0)
        {
            FormatRules r;
            switch (f)
            {
                case MatchFormat.T10:
                    r = new FormatRules { Format = f, Overs = 10, MaxOversPerBowler = 2, PowerplayOvers = 3, MaxOutsidePowerplay = 2, MaxOutside = 5, Reviews = 1, BouncersPerOver = 1, MaxWickets = 10 };
                    break;
                case MatchFormat.ODI:
                    r = new FormatRules { Format = f, Overs = 50, MaxOversPerBowler = 10, PowerplayOvers = 10, MaxOutsidePowerplay = 2, MaxOutside = 5, Reviews = 2, BouncersPerOver = 2, MaxWickets = 10 };
                    break;
                case MatchFormat.SuperOver:
                    r = SuperOverRules();
                    break;
                default:
                    r = new FormatRules { Format = MatchFormat.T20, Overs = 20, MaxOversPerBowler = 4, PowerplayOvers = 6, MaxOutsidePowerplay = 2, MaxOutside = 5, Reviews = 2, BouncersPerOver = 1, MaxWickets = 10 };
                    break;
            }
            if (oversOverride > 0 && f != MatchFormat.SuperOver)
            {
                r.Overs = Mathf.Clamp(oversOverride, 1, 50);
                r.MaxOversPerBowler = Mathf.Max(1, Mathf.CeilToInt(r.Overs / 5f));
                r.PowerplayOvers = Mathf.Max(1, Mathf.RoundToInt(r.Overs * 0.3f));
            }
            return r;
        }

        public static FormatRules SuperOverRules() =>
            new FormatRules { Format = MatchFormat.SuperOver, Overs = 1, MaxOversPerBowler = 1, PowerplayOvers = 0, MaxOutsidePowerplay = 5, MaxOutside = 5, Reviews = 1, BouncersPerOver = 1, MaxWickets = 2 };

        public string Label => Format == MatchFormat.SuperOver ? "Super Over" : Format == MatchFormat.ODI ? $"{Overs}-over ODI" : Format == MatchFormat.T10 ? "T10" : Overs == 20 ? "T20" : $"{Overs}-over";
    }

    [Serializable]
    public class BatterCard
    {
        public int Player;
        public int Runs, Balls, Fours, Sixes;
        public bool Batted, Out;
        public Dismissal How;
        public int Bowler = -1, Fielder = -1;
        public float StrikeRate => Balls > 0 ? Runs * 100f / Balls : 0f;
    }

    [Serializable]
    public class BowlerCard
    {
        public int Player;
        public int Balls, Runs, Wickets, Maidens, Wides, NoBalls, Dots;
        public int OverRuns; // runs in the current over (for maidens)
        public string Overs => $"{Balls / 6}.{Balls % 6}";
        public float Economy => Balls > 0 ? Runs * 6f / Balls : 0f;
    }

    [Serializable]
    public class BallRecord
    {
        public int Over, Ball;               // over index, legal ball in the over (1-6) at the time
        public int Bowler, Striker;
        public int Runs;                     // off the bat
        public int Extras;
        public ExtraType Extra;
        public bool Wicket;
        public Dismissal How;
        public bool Four, Six;
        public Vector3 Pitched;              // first bounce
        public Vector3 End;                  // where it was fielded or crossed the rope
        public float Kmh;
        public byte Delivery;
        public byte Shot;
        public byte StrikerEnd;              // for drawing the wagon wheel and pitch map in a batter's frame
        public bool LeftHand;
        public string Symbol => Wicket ? "W" : Extra == ExtraType.Wide ? (Extras > 1 ? $"{Extras}wd" : "wd") : Extra == ExtraType.NoBall ? (Runs > 0 ? $"{Runs}nb" : "nb")
            : Extra == ExtraType.Bye ? $"{Extras}b" : Extra == ExtraType.LegBye ? $"{Extras}lb" : Runs == 0 ? "•" : Runs.ToString();
    }

    [Serializable]
    public class FallOfWicket { public int Runs, Wicket, Player; public string Overs; }

    [Serializable]
    public class InningsState
    {
        public int BattingTeam;      // 0 or 1
        public int Runs, Wickets, LegalBalls;
        public int Byes, LegByes, Wides, NoBalls;
        public int Target = -1;      // runs needed to win (second innings), -1 none
        public int Striker, NonStriker = 1, Bowler = -1, LastOverBowler = -1;
        public int NextBatter = 2;
        public int StrikerEnd = 1;   // the end the striker is at (bowling end is the other one)
        public int BatReviews, BowlReviews; // reviews left for the batting and fielding sides this innings
        public bool FreeHit;
        public int BouncersThisOver;
        public int PartnershipRuns, PartnershipBalls;
        public bool Complete;
        public bool SuperOver;
        public List<BatterCard> Batting = new List<BatterCard>();
        public List<BowlerCard> Bowling = new List<BowlerCard>();
        public List<BallRecord> Log = new List<BallRecord>();
        public List<FallOfWicket> Wickets_ = new List<FallOfWicket>();

        public int Extras => Byes + LegByes + Wides + NoBalls;
        public int Over => LegalBalls / 6;
        public int BallInOver => LegalBalls % 6;
        public string OversText => $"{LegalBalls / 6}.{LegalBalls % 6}";
        public int BowlingEnd => 1 - StrikerEnd;
        public float RunRate => LegalBalls > 0 ? Runs * 6f / LegalBalls : 0f;

        public BatterCard Card(int player) { foreach (var b in Batting) if (b.Player == player) return b; return null; }

        public BowlerCard BowlerCard(int player)
        {
            foreach (var b in Bowling) if (b.Player == player) return b;
            var c = new BowlerCard { Player = player };
            Bowling.Add(c);
            return c;
        }
    }

    /// <summary>What happened on one ball, decided by the simulation and applied to the score.</summary>
    public struct BallOutcome
    {
        public int RunsBat;           // runs credited to the batter (run or boundary)
        public int RunsRun;           // runs physically run (for strike rotation), excluding boundary
        public ExtraType Extra;
        public int ExtraRuns;         // byes/leg byes/wide runs run (wides and no-balls add the 1-run penalty themselves)
        public bool Four, Six;
        public bool Wicket;
        public Dismissal How;
        public bool StrikerOut;       // false: non-striker (run out)
        public int Fielder;           // fielding-side player index credited
        public Vector3 Pitched, End;
        public float Kmh;
        public DeliveryType Delivery;
        public ShotType Shot;
        public int StrikerEnd;
        public bool LeftHand;
    }

    [Serializable]
    public class MatchSetup
    {
        public MatchFormat Format = MatchFormat.T20;
        public int Overs;                    // 0 = format default
        public Difficulty Difficulty = Difficulty.Normal;
        public PitchType Pitch = PitchType.Flat;
        public TimeOfDay Time = TimeOfDay.Day;
        public bool ManualFielding;
        public bool SuperOverOnTie = true;
        public int Seed = 12345;
        public TeamProfile[] Teams = new TeamProfile[2];
        public bool Online;
        public string[] SideNames = { "You", "CPU" };
    }

    [Serializable]
    public class MatchState
    {
        public MatchSetup Setup = new MatchSetup();
        public FormatRules Rules;
        public List<InningsState> Innings = new List<InningsState>();
        public int TossWinner = -1;
        public bool TossWinnerBats = true;
        public bool Finished;
        public int Winner = -1;              // -1 tie / undecided
        public string Result = "";
        public int SuperOvers;

        public InningsState Current => Innings.Count > 0 ? Innings[Innings.Count - 1] : null;
        public TeamProfile Batting => Setup.Teams[Current.BattingTeam];
        public TeamProfile Fielding => Setup.Teams[1 - Current.BattingTeam];
        public bool InSuperOver => Current != null && Current.SuperOver;
        public FormatRules ActiveRules => InSuperOver ? FormatRules.SuperOverRules() : Rules;

        public void Begin(MatchSetup setup)
        {
            Setup = setup;
            Rules = FormatRules.For(setup.Format, setup.Overs);
            Innings.Clear();
            Finished = false;
            Winner = -1;
            Result = "";
            SuperOvers = 0;
        }

        public InningsState StartInnings(int battingTeam, bool superOver = false)
        {
            var inn = new InningsState { BattingTeam = battingTeam, SuperOver = superOver };
            var rules = superOver ? FormatRules.SuperOverRules() : Rules;
            inn.BatReviews = inn.BowlReviews = rules.Reviews;
            var team = Setup.Teams[battingTeam];
            // Batting order: the team's order; a super over sends in the best three hitters.
            var order = new List<int>();
            for (int i = 0; i < team.Players.Count; i++) order.Add(i);
            if (superOver) order.Sort((a, b) => team.Players[b].Batting.CompareTo(team.Players[a].Batting));
            foreach (var p in order) inn.Batting.Add(new BatterCard { Player = p });
            inn.Striker = order[0];
            inn.NonStriker = order[1];
            inn.Batting[0].Batted = inn.Batting[1].Batted = true;
            inn.NextBatter = 2;
            inn.StrikerEnd = 1;
            if (Innings.Count > 0)
            {
                // Chasing when the previous innings was the first half of the same kind (match or super over).
                var prev = Current;
                if (prev.SuperOver == superOver && prev.Target < 0) inn.Target = prev.Runs + 1;
            }
            Innings.Add(inn);
            return inn;
        }

        public int BattingOrderIndex(int player)
        {
            var inn = Current;
            for (int i = 0; i < inn.Batting.Count; i++) if (inn.Batting[i].Player == player) return i;
            return -1;
        }

        /// <summary>Records one ball and updates strike, bowler figures, extras, wickets and partnership.</summary>
        public void Apply(BallOutcome o)
        {
            var inn = Current;
            var rules = ActiveRules;
            var bowler = inn.BowlerCard(inn.Bowler);
            var striker = inn.Card(inn.Striker);
            bool legal = o.Extra != ExtraType.Wide && o.Extra != ExtraType.NoBall;
            bool freeHit = inn.FreeHit;

            int penalty = (o.Extra == ExtraType.Wide || o.Extra == ExtraType.NoBall) ? 1 : 0;
            int total = o.RunsBat + o.ExtraRuns + penalty;
            inn.Runs += total;
            inn.PartnershipRuns += total;
            switch (o.Extra)
            {
                case ExtraType.Wide: inn.Wides += 1 + o.ExtraRuns; bowler.Wides++; break;
                case ExtraType.NoBall: inn.NoBalls += 1; inn.Byes += o.ExtraRuns; bowler.NoBalls++; break;
                case ExtraType.Bye: inn.Byes += o.ExtraRuns; break;
                case ExtraType.LegBye: inn.LegByes += o.ExtraRuns; break;
            }
            int conceded = o.RunsBat + (o.Extra == ExtraType.Wide ? 1 + o.ExtraRuns : 0) + (o.Extra == ExtraType.NoBall ? 1 : 0);
            bowler.Runs += conceded;
            bowler.OverRuns += conceded;

            if (o.Extra != ExtraType.Wide)
            {
                striker.Balls++;
                striker.Runs += o.RunsBat;
                if (o.Four) striker.Fours++;
                if (o.Six) striker.Sixes++;
                inn.PartnershipBalls++;
            }
            if (legal)
            {
                inn.LegalBalls++;
                bowler.Balls++;
                if (total == 0) bowler.Dots++;
            }

            var rec = new BallRecord
            {
                Over = (inn.LegalBalls - (legal ? 1 : 0)) / 6,
                Ball = legal ? (inn.LegalBalls - 1) % 6 + 1 : inn.LegalBalls % 6,
                Bowler = inn.Bowler,
                Striker = inn.Striker,
                Runs = o.RunsBat,
                Extras = o.ExtraRuns + penalty,
                Extra = o.Extra,
                Four = o.Four,
                Six = o.Six,
                Pitched = o.Pitched,
                End = o.End,
                Kmh = o.Kmh,
                Delivery = (byte)o.Delivery,
                Shot = (byte)o.Shot,
                StrikerEnd = (byte)o.StrikerEnd,
                LeftHand = o.LeftHand,
            };

            // Free hit: only a run out stands.
            bool wicket = o.Wicket && (!freeHit || o.How == Dismissal.RunOut);
            if (o.Wicket && o.Extra == ExtraType.Wide && o.How != Dismissal.Stumped && o.How != Dismissal.RunOut && o.How != Dismissal.HitWicket) wicket = false;
            if (o.Wicket && o.Extra == ExtraType.NoBall && o.How != Dismissal.RunOut) wicket = false;
            if (wicket)
            {
                rec.Wicket = true;
                rec.How = o.How;
                int outPlayer = o.StrikerOut ? inn.Striker : inn.NonStriker;
                var card = inn.Card(outPlayer);
                card.Out = true;
                card.How = o.How;
                card.Bowler = o.How == Dismissal.RunOut ? -1 : inn.Bowler;
                card.Fielder = o.Fielder;
                if (o.How != Dismissal.RunOut) bowler.Wickets++;
                inn.Wickets++;
                inn.Wickets_.Add(new FallOfWicket { Runs = inn.Runs, Wicket = inn.Wickets, Player = outPlayer, Overs = inn.OversText });
                inn.PartnershipRuns = inn.PartnershipBalls = 0;
            }
            inn.Log.Add(rec);

            // Strike: odd runs physically run swap ends; a boundary doesn't.
            int ran = o.Four || o.Six ? 0 : (o.Extra == ExtraType.Wide || o.Extra == ExtraType.Bye || o.Extra == ExtraType.LegBye ? o.ExtraRuns : o.RunsRun);
            if (o.Extra == ExtraType.NoBall && !(o.Four || o.Six)) ran = Mathf.Max(o.RunsRun, o.ExtraRuns);
            if (ran % 2 == 1) Swap(inn);

            if (wicket)
            {
                // The new batter takes the dismissed batter's place (after any strike swap from runs completed).
                int outPlayer = o.StrikerOut ? rec.Striker : (rec.Striker == inn.Striker ? inn.NonStriker : inn.Striker);
                bool allOut = inn.Wickets >= Mathf.Min(rules.MaxWickets, Setup.Teams[inn.BattingTeam].Players.Count - 1);
                if (!allOut && inn.NextBatter < inn.Batting.Count)
                {
                    var next = inn.Batting[inn.NextBatter++];
                    next.Batted = true;
                    if (inn.Striker == outPlayer) inn.Striker = next.Player;
                    else inn.NonStriker = next.Player;
                    // After a catch the new batter is always on strike (2022 laws).
                    if (o.How == Dismissal.Caught && inn.Striker != next.Player) Swap(inn);
                }
            }

            inn.FreeHit = o.Extra == ExtraType.NoBall;
            if (legal && inn.LegalBalls % 6 == 0) EndOver(inn);
            CheckInningsComplete();
        }

        void EndOver(InningsState inn)
        {
            var bowler = inn.BowlerCard(inn.Bowler);
            if (bowler.OverRuns == 0 && bowler.Balls % 6 == 0) bowler.Maidens++;
            bowler.OverRuns = 0;
            inn.LastOverBowler = inn.Bowler;
            inn.Bowler = -1;
            inn.BouncersThisOver = 0;
            Swap(inn);
            // The bowling end changes every over; the new striker is at the other end.
            inn.StrikerEnd = 1 - inn.StrikerEnd;
        }

        static void Swap(InningsState inn)
        {
            int t = inn.Striker;
            inn.Striker = inn.NonStriker;
            inn.NonStriker = t;
        }

        /// <summary>The batters ran between overs only by the strike swap; physically the striker now faces from the other end.</summary>
        public void CheckInningsComplete()
        {
            var inn = Current;
            var rules = ActiveRules;
            int maxWk = Mathf.Min(rules.MaxWickets, Setup.Teams[inn.BattingTeam].Players.Count - 1);
            if (inn.Wickets >= maxWk || inn.LegalBalls >= rules.Overs * 6 || (inn.Target > 0 && inn.Runs >= inn.Target))
                inn.Complete = true;
        }

        public int BallsLeft => ActiveRules.Overs * 6 - Current.LegalBalls;
        public int RunsNeeded => Current.Target > 0 ? Current.Target - Current.Runs : 0;
        public float RequiredRate => Current.Target > 0 && BallsLeft > 0 ? RunsNeeded * 6f / BallsLeft : 0f;
        public bool IsPowerplay => !InSuperOver && Current.Over < Rules.PowerplayOvers;

        /// <summary>After an innings ends: decides what comes next. Returns false when the match is over.</summary>
        public bool NextInnings(out int battingTeam, out bool superOver)
        {
            var inn = Current;
            battingTeam = 1 - inn.BattingTeam;
            superOver = inn.SuperOver;
            bool chaseInnings = inn.Target > 0;
            if (!chaseInnings) return true; // second innings (or second half of the super over) next

            // A chase just ended.
            int a = inn.BattingTeam, b = 1 - a;
            if (inn.Runs >= inn.Target)
            {
                Finish(a, inn.SuperOver ? $"{Setup.Teams[a].Name} win the Super Over" : $"{Setup.Teams[a].Name} won by {Mathf.Min(ActiveRules.MaxWickets, Setup.Teams[a].Players.Count - 1) - inn.Wickets} wicket{(10 - inn.Wickets == 1 ? "" : "s")} ({BallsLeft} ball{(BallsLeft == 1 ? "" : "s")} left)");
                return false;
            }
            if (inn.Runs == inn.Target - 1)
            {
                if (Setup.SuperOverOnTie && SuperOvers < 3)
                {
                    SuperOvers++;
                    // The side that batted second in the match bats first in the super over.
                    battingTeam = inn.BattingTeam;
                    superOver = true;
                    return true;
                }
                Finish(-1, "Match tied");
                return false;
            }
            int margin = inn.Target - 1 - inn.Runs;
            Finish(b, inn.SuperOver ? $"{Setup.Teams[b].Name} win the Super Over" : $"{Setup.Teams[b].Name} won by {margin} run{(margin == 1 ? "" : "s")}");
            return false;
        }

        void Finish(int winner, string text)
        {
            Finished = true;
            Winner = winner;
            Result = text;
        }

        public string DismissalText(InningsState inn, BatterCard c)
        {
            if (!c.Batted) return "";
            if (!c.Out) return "not out";
            var bowl = Setup.Teams[1 - inn.BattingTeam];
            string B(int i) => i >= 0 && i < bowl.Players.Count ? bowl.Players[i].Surname() : "?";
            switch (c.How)
            {
                case Dismissal.Bowled: return $"b {B(c.Bowler)}";
                case Dismissal.Caught: return c.Fielder == c.Bowler ? $"c & b {B(c.Bowler)}" : $"c {(c.Fielder == bowl.Keeper ? "†" : "")}{B(c.Fielder)} b {B(c.Bowler)}";
                case Dismissal.Lbw: return $"lbw b {B(c.Bowler)}";
                case Dismissal.Stumped: return $"st †{B(c.Fielder)} b {B(c.Bowler)}";
                case Dismissal.HitWicket: return $"hit wicket b {B(c.Bowler)}";
                case Dismissal.RunOut: return $"run out ({B(c.Fielder)})";
                default: return "out";
            }
        }

        public string ThisOver()
        {
            var inn = Current;
            if (inn == null) return "";
            var sb = new StringBuilder();
            int over = inn.Over;
            bool overJustEnded = inn.LegalBalls > 0 && inn.LegalBalls % 6 == 0 && inn.Bowler < 0;
            if (overJustEnded) over--;
            foreach (var b in inn.Log) if (b.Over == over) sb.Append(b.Symbol).Append(' ');
            return sb.ToString().TrimEnd();
        }

        public string ScoreText(InningsState inn) => inn.Wickets >= 10 ? $"{inn.Runs}" : $"{inn.Runs}/{inn.Wickets}";
    }
}
