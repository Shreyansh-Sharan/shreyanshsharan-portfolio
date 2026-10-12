// Offline match test: runs the real MatchDirector (CPU v CPU) headless at 60 steps per simulated second and reports
// scores, how wickets fell, boundaries and extras, and any phase that gets stuck.
// Build and run: python3 Tools/MatchSim/run.py [t20|t10|odi|super] [matches] [overs]
using System;
using System.Collections.Generic;
using System.Reflection;
using Cricket;
using Cricket.Game;
using Cricket.Sim;
using UnityEngine;

static class Program
{
    static void Call(object o, string method)
    {
        var m = o.GetType().GetMethod(method, BindingFlags.Instance | BindingFlags.NonPublic | BindingFlags.Public);
        m?.Invoke(o, null);
    }

    static bool verbose;

    static int Main(string[] args)
    {
        string fmt = args.Length > 0 ? args[0] : "t20";
        int matches = args.Length > 1 ? int.Parse(args[1]) : 3;
        int overs = args.Length > 2 ? int.Parse(args[2]) : 0;
        Settings.Replays = args.Length > 3 && args[3] == "replays";
        verbose = Array.IndexOf(args, "verbose") >= 0;
        var format = fmt == "t10" ? MatchFormat.T10 : fmt == "odi" ? MatchFormat.ODI : fmt == "super" ? MatchFormat.SuperOver : MatchFormat.T20;
        int failures = 0;
        var totals = new Dictionary<string, float>();
        for (int m = 0; m < matches; m++)
        {
            var pitch = (PitchType)(m % 3);
            var time = (TimeOfDay)(m % 3);
            var diff = (Difficulty)((m + 1) % 3);
            var d = new MatchDirector();
            Call(d, "Awake");
            var rec = new ReplayRecorder();
            Call(rec, "Awake");
            d.IsAuthority = true;
            d.SideHuman = new[] { false, false };
            var teams = TeamStore.BuiltIn;
            var setup = new MatchSetup
            {
                Format = format, Overs = overs, Difficulty = diff, Pitch = pitch, Time = time, Seed = 1000 + m * 17,
                Teams = new[] { teams[m % teams.Count].Clone(), teams[(m + 3) % teams.Count].Clone() },
            };
            var counts = new Dictionary<string, int>();
            var trace = new List<string>();
            MatchDirector.Trace = t => { trace.Add(t); if (trace.Count > 6) trace.RemoveAt(0); };
            void Count(string k) { counts.TryGetValue(k, out var v); counts[k] = v + 1; }
            d.OnEvent += e =>
            {
                switch (e.Type)
                {
                    case EvType.Wicket:
                        Count("W:" + (Dismissal)e.I);
                        if (verbose && (Dismissal)e.I == Dismissal.RunOut)
                            Console.WriteLine("        " + string.Join("\n        ", trace));
                        if (verbose && (Dismissal)e.I == Dismissal.RunOut)
                            Console.WriteLine($"      run out: live {d.LiveTime:0.0}s, holder {(d.BallHolder != null ? d.BallHolder.Kind + " " + d.BallHolder.SpotName : "-")}, shot {d.LastShot.Shot}/{d.LastShot.Contact} q{d.LastShot.Quality:0.00}, " +
                                string.Join(" | ", Array.ConvertAll(d.Runners, r => $"at {r.AtEnd} to {r.ToEnd} run {r.Running} z {r.A.Pos.z:0.0}")));
                        break;
                    case EvType.Four: Count("4s"); break;
                    case EvType.Six: Count("6s"); break;
                    case EvType.Wide: Count("wides"); break;
                    case EvType.NoBall: Count("no-balls"); break;
                    case EvType.Drop: Count("drops"); break;
                    case EvType.Catch: Count("catches"); break;
                    case EvType.ReviewStart: Count("reviews"); break;
                    case EvType.ReviewResult: Count("review:" + (ReviewOutcome)e.I); break;
                    case EvType.Appeal: Count("appeals"); break;
                    case EvType.Edge: Count("edges"); break;
                    case EvType.Beaten: Count("beaten"); break;
                    case EvType.DirectHit: Count("direct hits"); break;
                    case EvType.Throw: Count("throws"); break;
                    case EvType.Release: Count("deliveries"); break;
                    case EvType.BatHit: Count(e.F > 0.85f ? "hit:great" : e.F > 0.6f ? "hit:good" : "hit:poor"); Count("timing:" + (Timing)e.I); break;
                }
            };
            d.StartMatch(setup);
            float dt = 1f / 60f;
            Time.deltaTime = Time.unscaledDeltaTime = dt;
            Phase last = d.Phase;
            float inPhase = 0f, simTime = 0f;
            string stuck = null;
            try
            {
                for (int f = 0; f < 60 * 60 * 60 * 6; f++)
                {
                    Time.time += dt; Time.unscaledTime += dt; Time.realtimeSinceStartup += dt; Time.frameCount++;
                    Call(d, "Update");
                    Call(d, "LateUpdate");
                    Call(rec, "LateUpdate");
                    simTime += dt;
                    if (d.Phase != last) { last = d.Phase; inPhase = 0f; }
                    else inPhase += dt;
                    if (d.Phase == Phase.MatchEnd) break;
                    if (inPhase > 60f) { stuck = $"stuck in {d.Phase} for 60 s (ball live {d.LiveTime:0.0} s, ball {d.Ball.Pos} v {d.Ball.Vel} held {d.BallHolder != null}, running {d.AnyRunning})"; break; }
                }
            }
            catch (Exception e)
            {
                stuck = "EXCEPTION " + (e.InnerException ?? e);
            }
            var st = d.State;
            Console.WriteLine($"=== Match {m + 1}: {st.Setup.Teams[0].Name} v {st.Setup.Teams[1].Name} — {st.Rules.Label}, {pitch} pitch, {time}, {diff} ({simTime / 60f:0} sim min)");
            foreach (var inn in st.Innings)
            {
                var top = inn.Batting.FindAll(c => c.Batted);
                top.Sort((a, b) => b.Runs.CompareTo(a.Runs));
                var best = inn.Bowling.FindAll(b => b.Balls > 0);
                best.Sort((a, b) => b.Wickets != a.Wickets ? b.Wickets.CompareTo(a.Wickets) : a.Runs.CompareTo(b.Runs));
                var team = st.Setup.Teams[inn.BattingTeam];
                var bowl = st.Setup.Teams[1 - inn.BattingTeam];
                Console.WriteLine($"   {(inn.SuperOver ? "SO " : "")}{team.Short} {st.ScoreText(inn)} ({inn.OversText} ov, RR {inn.RunRate:0.00}, extras {inn.Extras})  top: {(top.Count > 0 ? $"{team.Players[top[0].Player].Surname()} {top[0].Runs}({top[0].Balls})" : "-")}  best: {(best.Count > 0 ? $"{bowl.Players[best[0].Player].Surname()} {best[0].Wickets}-{best[0].Runs}" : "-")}  reviews left {inn.BatReviews}/{inn.BowlReviews}");
            }
            Console.WriteLine($"   Result: {(string.IsNullOrEmpty(st.Result) ? "(none)" : st.Result)}");
            var dist = new int[8];
            foreach (var inn in st.Innings) foreach (var b in inn.Log) if (b.Extra == ExtraType.None || b.Extra == ExtraType.NoBall) dist[Math.Min(7, b.Runs)]++;
            Console.WriteLine($"   runs off the bat per ball: dots {dist[0]}, 1s {dist[1]}, 2s {dist[2]}, 3s {dist[3]}, 4s {dist[4]}, 6s {dist[6]}");
            var keys = new List<string>(counts.Keys);
            keys.Sort();
            Console.WriteLine("   " + string.Join(", ", keys.ConvertAll(k => $"{k} {counts[k]}")));
            foreach (var k in keys) { totals.TryGetValue(k, out var v); totals[k] = v + counts[k]; }
            if (stuck != null) { failures++; Console.WriteLine("   PROBLEM: " + stuck); }
        }
        Console.WriteLine(failures == 0 ? "All matches completed." : $"{failures} match(es) had problems.");
        return failures == 0 ? 0 : 1;
    }
}
