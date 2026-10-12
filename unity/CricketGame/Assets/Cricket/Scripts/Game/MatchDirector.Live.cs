using System.Collections.Generic;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>The ball in play: fielders chase, dive, catch, pick up and throw; batters run, turn, get sent back and
    /// slide their bats in; boundaries, overthrows and run outs.</summary>
    public partial class MatchDirector
    {
        public class Runner
        {
            public Actor A;
            public int AtEnd;        // end he is at / last left
            public int ToEnd;
            public bool Running;
            public bool Sliding;
            public float Lane;
        }

        enum Job { None, Chase, Catch, Back, CoverStumps, Return, Hold, Throwing, Celebrate }

        class FielderPlan
        {
            public Job Job;
            public Vector3 Target;
            public float At;         // time (live clock) of the planned intercept
            public float Reaction;
            public bool Dive;
        }

        public readonly Runner[] Runners = { new Runner(), new Runner() };
        readonly FielderPlan[] plans = new FielderPlan[ActorCount];
        readonly List<Vector3> path = new List<Vector3>();
        readonly List<int> pathBounces = new List<int>();
        const float PathStep = 0.04f;
        float liveTime, planTime;
        int runsCompleted;
        bool runCrossed;
        float humanCallAt = -10f;
        bool throwInFlight;
        Actor throwTarget;
        int throwEnd = -1;
        bool throwDirect;
        Actor lastThrower;
        Actor collector;
        float collectedAt;
        bool caught;
        int boundaryRuns;
        float holdSince;
        Actor heldBy;

        // Manual fielding
        public Actor Controlled { get; private set; }
        Vector3 manualMove;
        float manualMoveAt = -10f;
        float catchPressAt = -10f;
        public float CatchPromptAt { get; private set; } = -1f; // live-clock time the catch arrives (HUD prompt)
        public float LiveTime => liveTime;
        bool manualThrowRequested;
        int manualThrowEnd;
        bool manualThrowDirect;

        public bool ManualFielding => State.Setup.ManualFielding && !Online && HumanBowls && SideHuman[LocalSide] && FieldingSide == LocalSide;

        void ResetLive()
        {
            liveTime = 0f;
            runsCompleted = 0;
            runCrossed = false;
            throwInFlight = false;
            throwTarget = null;
            throwEnd = -1;
            lastThrower = null;
            collector = null;
            caught = false;
            boundaryRuns = 0;
            heldBy = null;
            Controlled = null;
            CatchPromptAt = -1f;
            manualThrowRequested = false;
            humanCallAt = -10f;
            for (int i = 0; i < ActorCount; i++) plans[i] = new FielderPlan();
            for (int r = 0; r < 2; r++)
            {
                Runners[r].A = Actors[r];
                Runners[r].Running = false;
                Runners[r].Sliding = false;
            }
        }

        void BeginLive()
        {
            var inn = Inn;
            liveTime = 0f;
            Runners[0].AtEnd = inn.StrikerEnd;
            Runners[1].AtEnd = inn.BowlingEnd;
            Runners[0].ToEnd = Runners[0].AtEnd;
            Runners[1].ToEnd = Runners[1].AtEnd;
            Runners[0].Lane = strikerRight ? 1.1f : -1.1f;
            Runners[1].Lane = -Runners[0].Lane;
            PlanFielding();
            if (ManualFielding) Controlled = BestManualFielder();
        }

        // ------------------------------------------------------------------ planning

        void PlanFielding()
        {
            planTime = liveTime;
            BallPhysics.Predict(Ball, Env, 9f, PathStep, path, pathBounces);
            int firstBounce = pathBounces.Count > 0 ? pathBounces[0] : path.Count;
            if (bouncedSinceHit || !hitBat) firstBounce = 0;

            Actor best = null;
            float bestT = float.MaxValue;
            int bestIdx = -1;
            bool bestCatch = false, bestDive = false;
            var candidates = new List<(Actor a, float t, int idx, bool c, bool d)>();
            for (int i = FirstFielder; i < FirstFielder + FielderCount; i++)
            {
                var a = Actors[i];
                if (!a.Visible) continue;
                plans[i].Job = Job.None;
                plans[i].Reaction = Vector3.Distance(a.Pos, Ball.Pos) < 25f ? 0.16f : 0.3f;
                if (a == BowlerActor && BowlerActor.Pose == Pose.FollowThrough && liveTime < 0.2f) plans[i].Reaction += 0.15f;
                if (Intercept(a, plans[i].Reaction, firstBounce, out int idx, out bool catchable, out bool dive))
                {
                    float t = idx * PathStep;
                    candidates.Add((a, t, idx, catchable, dive));
                    if (t < bestT) { bestT = t; best = a; bestIdx = idx; bestCatch = catchable; bestDive = dive; }
                }
            }
            if (best == null)
            {
                // Nobody gets there before it stops or reaches the rope: the nearest two chase to where it ends up.
                var end = path[path.Count - 1];
                if (Geo.BeyondRope(end) > -1f) end -= end.normalized * 2f;
                var near = NearestFielders(end, 2);
                foreach (var a in near) { var p = plans[a.Index]; p.Job = Job.Chase; p.Target = end; p.At = planTime + path.Count * PathStep; }
            }
            else
            {
                var p = plans[best.Index];
                p.Job = bestCatch ? Job.Catch : Job.Chase;
                p.Target = path[bestIdx];
                p.At = planTime + bestIdx * PathStep;
                p.Dive = bestDive;
                // A second man backs up in line behind the chaser.
                var second = NearestFielders(path[bestIdx], 3).Find(a => a != best && a != KeeperActor && a != BowlerActor);
                if (second != null)
                {
                    var bp = plans[second.Index];
                    bp.Job = Job.Back;
                    var dir = (path[bestIdx] - frame.Origin);
                    dir.y = 0f;
                    bp.Target = path[bestIdx] + dir.normalized * 10f;
                    if (Geo.BeyondRope(bp.Target, 3f) > 0f) bp.Target = path[bestIdx] + (second.Pos - path[bestIdx]).normalized * 6f;
                }
            }
            // Keeper and bowler cover their stumps (unless they are the chaser).
            var inn = Inn;
            if (KeeperActor != null && plans[KeeperActor.Index].Job == Job.None)
            {
                plans[KeeperActor.Index].Job = Job.CoverStumps;
                plans[KeeperActor.Index].Target = Geo.Stumps(inn.StrikerEnd) - frame.Fwd * 0.6f;
            }
            if (BowlerActor != null && plans[BowlerActor.Index].Job == Job.None)
            {
                plans[BowlerActor.Index].Job = Job.CoverStumps;
                plans[BowlerActor.Index].Target = Geo.Stumps(inn.BowlingEnd) + frame.Fwd * 0.6f;
            }
            if (ManualFielding && Controlled == null) Controlled = best ?? BestManualFielder();
        }

        List<Actor> NearestFielders(Vector3 p, int n)
        {
            var list = new List<Actor>();
            for (int i = FirstFielder; i < FirstFielder + FielderCount; i++) if (Actors[i].Visible) list.Add(Actors[i]);
            list.Sort((a, b) => (a.Pos - p).sqrMagnitude.CompareTo((b.Pos - p).sqrMagnitude));
            if (list.Count > n) list.RemoveRange(n, list.Count - n);
            return list;
        }

        /// <summary>Earliest point on the predicted path this fielder can get to in time (catch before the first bounce,
        /// or stop it along the ground). Dives add reach for a short distance.</summary>
        bool Intercept(Actor a, float reaction, int firstBounce, out int index, out bool catchable, out bool dive)
        {
            index = -1;
            catchable = dive = false;
            for (int i = 1; i < path.Count; i++)
            {
                var p = path[i];
                if (Geo.BeyondRope(p, 0.8f) > 0f) return false;
                float t = i * PathStep;
                bool air = i < firstBounce;
                float h = p.y;
                bool catchHeight = air && h > 0.15f && h < 2.6f;
                bool groundHeight = h < 0.9f;
                if (!catchHeight && !groundHeight) continue;
                var flat = p; flat.y = 0f;
                float dist = Vector3.Distance(new Vector3(a.Pos.x, 0f, a.Pos.z), flat);
                float reach = 0.7f;
                float tRun = reaction + a.TimeTo(flat + (a.Pos - flat).normalized * reach);
                if (dist < reach) tRun = reaction * 0.5f;
                if (tRun <= t)
                {
                    index = i; catchable = catchHeight;
                    return true;
                }
                // Full-length dive: up to 2 m more, but only for the quick ones.
                if (dist > reach && tRun - (1.8f / a.MaxSpeed) - 0.15f <= t && t < 1.6f && (catchHeight || h < 0.6f))
                {
                    index = i; catchable = catchHeight; dive = true;
                    return true;
                }
            }
            return false;
        }

        Actor BestManualFielder()
        {
            var near = NearestFielders(Ball.Pos, 1);
            return near.Count > 0 ? near[0] : null;
        }

        // ------------------------------------------------------------------ update

        void UpdateBallLive(float dt)
        {
            liveTime += dt;
            if (ballDeadQueued)
            {
                MoveFieldersIdle(dt);
                UpdateRunners(dt);
                if (heldBy == null) StepBall(dt);
                else FollowHolder();
                deadTimer -= dt;
                if (deadTimer <= 0f) GoDead();
                return;
            }

            // Ball physics (unless someone holds it).
            if (heldBy == null) StepBall(dt);
            else FollowHolder();
            if (Phase != Phase.BallLive) return;

            UpdateFielders(dt);
            UpdateRunners(dt);
            if (!HumanBats || (liveTime - humanCallAt > 1.2f && Settings.AssistedRunning)) BattingAI.RunningCalls(this, rng);

            // Dead ball: keeper/bowler has it, nobody running.
            bool anyRunning = Runners[0].Running || Runners[1].Running;
            if (heldBy != null && !anyRunning && !throwInFlight)
            {
                holdSince += dt;
                float nearStumps = Mathf.Min(Vector3.Distance(heldBy.Pos, Geo.Stumps(0)), Vector3.Distance(heldBy.Pos, Geo.Stumps(1)));
                if (holdSince > (nearStumps < 8f ? 0.6f : 1.6f)) QueueDead(0.1f);
            }
            else holdSince = 0f;
            if (liveTime > 25f) QueueDead(0.1f);
        }

        void StepBall(float dt)
        {
            int steps = Mathf.Max(1, Mathf.CeilToInt(dt / BallPhysics.Dt));
            float h = dt / steps;
            for (int i = 0; i < steps; i++)
            {
                var prev = Ball.Pos;
                var r = BallPhysics.Step(ref Ball, Env, h);
                if (r.Bounced)
                {
                    if (!bouncedSinceHit && hitBat) Raise(new GameEvent { Type = EvType.Bounce, P = r.BouncePos, F = r.ImpactSpeed });
                    bouncedSinceHit = true;
                }
                // Direct hits / stumps on the way.
                for (int end = 0; end < 2; end++)
                {
                    if (BallPhysics.CrossesZ(prev, Ball.Pos, Geo.StumpsZ(end), out var at) && BallPhysics.HitsStumps(at, end) && Mathf.Abs(Ball.Vel.z) > 3f)
                    {
                        // Throws, and straight drives the bowler gets a fingertip to at the non-striker's end.
                        if (throwInFlight || (hitBat && end == Inn.BowlingEnd && rng.Chance(0.35f)))
                        {
                            BreakStumps(end, at);
                            Ball.Vel *= 0.3f;
                            bool direct = throwInFlight && throwDirect;
                            if (direct) Raise(GameEvent.Make(EvType.DirectHit, end));
                            RunOutCheck(end, throwInFlight ? lastThrower : BowlerActor, direct || throwInFlight);
                            throwInFlight = false;
                        }
                    }
                }
                // Boundary.
                if (Geo.BeyondRope(Ball.Pos) >= 0f && !ballDeadQueued)
                {
                    Boundary();
                    return;
                }
                if (ballDeadQueued) return;
            }
            // A throw that got past everyone (or died) is just a loose ball again: the backups go for it.
            if (throwInFlight && (Ball.Rolling || Ball.Bounces >= 2 || Ball.Speed < 5f))
            {
                throwInFlight = false;
                PlanFielding();
            }
            // Throw arriving at the receiver.
            if (throwInFlight && throwTarget != null)
            {
                var hands = throwTarget.Pos + Vector3.up * 1.0f;
                if (Vector3.Distance(Ball.Pos, hands) < 1.6f)
                {
                    throwInFlight = false;
                    GiveBall(throwTarget, Ball.Pos);
                    // Break the stumps if someone is short of his ground.
                    int end = throwEnd;
                    if (end >= 0 && Vector3.Distance(throwTarget.Pos, Geo.Stumps(end)) < 2.5f && RunnerAtRisk(end) != null)
                    {
                        BreakStumps(end, Geo.Stumps(end) + Vector3.up * 0.5f);
                        RunOutCheck(end, throwTarget, false);
                    }
                }
            }
        }

        void FollowHolder()
        {
            Ball.Pos = heldBy.Pos + Vector3.up * 1.1f + heldBy.Forward * 0.3f;
            Ball.Vel = Vector3.zero;
            Ball.Stopped = false;
        }

        public void GiveBall(Actor a, Vector3 at)
        {
            if (heldBy != null) heldBy.HasBall = false;
            heldBy = a;
            BallHolder = a;
            a.HasBall = true;
            Ball.Pos = at;
            Ball.Vel = Vector3.zero;
            Ball.Spin = Vector3.zero;
            Ball.Rolling = false;
            Ball.Stopped = false;
            collector = a;
            collectedAt = liveTime;
            outcome.End = new Vector3(at.x, 0f, at.z);
        }

        void DropBall(Vector3 vel)
        {
            if (heldBy != null) heldBy.HasBall = false;
            heldBy = null;
            BallHolder = null;
            Ball.Vel = vel;
            Ball.Stopped = false;
            Ball.Rolling = false;
            bouncedSinceHit = true;
        }

        void Boundary()
        {
            bool six = hitBat && !bouncedSinceHit && !throwInFlight && lastThrower == null;
            outcome.End = new Vector3(Ball.Pos.x, 0f, Ball.Pos.z);
            if (six) { outcome.Six = true; outcome.RunsBat = 6; }
            else
            {
                outcome.Four = true;
                outcome.RunsBat = 4 + (lastThrower != null ? runsCompleted + (Runners[0].Running ? (runCrossed ? 1 : 0) : 0) : 0);
                if (lastThrower != null) Say("Overthrows! And they've run away to the boundary!");
            }
            if (!hitBat) outcome.RunsBat = 0;
            Ball.Vel *= 0.2f;
            foreach (var r in Runners) r.Running = false;
            QueueDead(1.0f);
        }

        // ------------------------------------------------------------------ fielders

        void UpdateFielders(float dt)
        {
            for (int i = FirstFielder; i < FirstFielder + FielderCount; i++)
            {
                var a = Actors[i];
                if (!a.Visible) continue;
                var p = plans[i];
                if (a == heldBy) { UpdateHolder(a, dt); continue; }
                bool manual = ManualFielding && a == Controlled && liveTime - manualMoveAt < 0.6f;
                if (manual)
                {
                    a.Vel = Vector3.MoveTowards(a.Vel, manualMove * a.MaxSpeed, a.Accel * dt);
                    a.Pos += a.Vel * dt;
                    if (a.Vel.sqrMagnitude > 0.3f) a.Face(a.Pos + a.Vel, dt, 720f);
                    a.SetPose(a.Speed > 0.4f ? Pose.Run : Pose.Ready);
                    TryField(a);
                    continue;
                }
                if (liveTime < p.Reaction) { a.Face(Ball.Pos, dt); continue; }
                switch (p.Job)
                {
                    case Job.Chase:
                    case Job.Catch:
                        Chase(a, p, dt);
                        TryField(a);
                        break;
                    case Job.Back:
                    case Job.CoverStumps:
                        a.MoveTo(p.Target, dt, p.Job == Job.CoverStumps ? 0.9f : 0.8f, 0.3f);
                        if (a.Speed < 0.3f) { a.Face(Ball.Pos, dt); a.SetPose(a.Kind == ActorKind.Keeper ? Pose.KeeperCrouch : Pose.Ready); }
                        else a.SetPose(Pose.Run);
                        TryField(a);
                        break;
                    default:
                        // Everyone else drifts towards the ball a little and watches.
                        var toward = a.Home + (Ball.Pos - a.Home).normalized * Mathf.Min(6f, liveTime * 2f);
                        a.MoveTo(toward, dt, 0.35f, 0.5f);
                        a.Face(Ball.Pos, dt);
                        a.SetPose(a.Speed > 0.5f ? Pose.Walk : Pose.Ready);
                        break;
                }
                a.Look = Ball.Pos;
            }
            // Re-plan if the ball's path has changed a lot (deflections) or every second.
            if (liveTime - planTime > 1f && heldBy == null && !throwInFlight) PlanFielding();
        }

        void Chase(Actor a, FielderPlan p, float dt)
        {
            // Go to the planned point; once close, go straight for the ball.
            var target = p.Target;
            float distBall = Vector3.Distance(new Vector3(a.Pos.x, 0, a.Pos.z), new Vector3(Ball.Pos.x, 0, Ball.Pos.z));
            if (distBall < 3f || Ball.Stopped || Ball.Rolling && Ball.Speed < 4f) target = Ball.Pos;
            target.y = 0f;
            bool nearRope = Geo.BeyondRope(target, 6f) > 0f;
            a.MoveTo(target, dt, 1f, 0.2f);
            if (a.Pose == Pose.Dive || a.Pose == Pose.Slide || a.Pose == Pose.GetUp)
            {
                if (a.PoseTime > 1.1f) a.SetPose(Pose.GetUp);
                if (a.Pose == Pose.GetUp && a.PoseTime > 0.9f) a.SetPose(Pose.Run);
                else { a.Vel *= 0.9f; return; }
            }
            // Dive or slide in the last moments.
            float tLeft = p.At - liveTime;
            if (p.Dive && tLeft < 0.35f && distBall < 2.6f && distBall > 0.8f)
            {
                a.SetPose(Pose.Dive);
                a.Face(Ball.Pos);
                a.Vel = (new Vector3(Ball.Pos.x, 0, Ball.Pos.z) - new Vector3(a.Pos.x, 0, a.Pos.z)).normalized * 5f;
            }
            else if (nearRope && distBall < 3.5f && a.Speed > 5f && Ball.Rolling) a.SetPose(Pose.Slide);
            else a.SetPose(a.Speed > 0.5f ? Pose.Run : Pose.Ready);
            if (p.Job == Job.Catch && ManualFielding && a == Controlled) CatchPromptAt = p.At;
        }

        /// <summary>Takes a catch, stops the ball or misfields when it reaches the fielder's hands.</summary>
        void TryField(Actor a)
        {
            if (heldBy != null || throwInFlight && a != throwTarget) return;
            bool diving = a.Pose == Pose.Dive;
            var flat = new Vector3(Ball.Pos.x - a.Pos.x, 0f, Ball.Pos.z - a.Pos.z);
            float horiz = flat.magnitude;
            float h = Ball.Pos.y;
            float reach = diving ? 1.7f : a.Kind == ActorKind.Keeper ? 1.1f : 0.95f;
            // Catch: the ball comes within arm's reach of his body (up to a jump above his head) before it bounces.
            bool airCatch = hitBat && !bouncedSinceHit && h > 0.12f && h < (diving ? 1.3f : 2.8f);
            if (airCatch && horiz < reach + 0.35f)
            {
                AttemptCatch(a, horiz > reach);
                return;
            }
            // Ground fielding: anything at knee height or below within reach (a diving stop reaches further).
            if (h < 1.3f && horiz < reach)
            {
                float speed = Ball.Speed;
                float fumble = Mathf.Clamp01((speed - 16f) * 0.02f) * (1f - a.Skill * 0.6f) + (diving ? 0.1f : 0.015f);
                if (rng.Chance(fumble))
                {
                    DropBall(Ball.Vel * 0.3f + Vector3.up * 1.0f - flat.normalized * 1.5f);
                    Raise(GameEvent.Make(EvType.Fielded, a.Index, 1));
                    PlanFielding();
                    return;
                }
                GiveBall(a, Ball.Pos);
                a.SetPose(diving || a.Pose == Pose.Slide ? Pose.GetUp : Pose.Pickup);
                Raise(GameEvent.Make(EvType.Fielded, a.Index));
                CatchPromptAt = -1f;
            }
        }

        void AttemptCatch(Actor a, bool stretching)
        {
            if (caught) return;
            float v = Ball.Speed;
            float h = Ball.Pos.y;
            bool keeper = a.Kind == ActorKind.Keeper;
            float chance = keeper ? 0.95f : Mathf.Lerp(0.86f, 0.97f, a.Skill);
            chance -= Mathf.Max(0f, v - 18f) * 0.009f;
            if (h < 0.4f) chance -= 0.12f;
            if (h > 2.2f) chance -= 0.08f;
            if (a.Pose == Pose.Dive || stretching) chance -= 0.22f;
            if (State.Setup.Time == TimeOfDay.Night && Ball.Vel.y < -12f) chance -= 0.04f;
            if (HumanBats) chance *= State.Setup.Difficulty == Difficulty.Easy ? 0.85f : State.Setup.Difficulty == Difficulty.Hard ? 1.02f : 0.95f;
            if (ManualFielding && a == Controlled)
            {
                // Manual catch: the press must be close to the moment the ball arrives.
                float window = 0.14f * DifficultyWindow;
                bool timed = Mathf.Abs(catchPressAt - liveTime) < window;
                chance = timed ? Mathf.Max(chance, 0.8f) + 0.1f : 0.15f;
            }
            a.SetPose(a.Pose == Pose.Dive ? Pose.Dive : Pose.Catch);
            a.Look = Ball.Pos;
            CatchPromptAt = -1f;
            if (rng.Chance(chance))
            {
                caught = true;
                GiveBall(a, Ball.Pos);
                if (!wicketDecided)
                {
                    bool thinEdge = lastShot.Contact == Contact.Edge && lastShot.Edge == EdgeKind.Outside && lastShot.Direction > 145f;
                    if (thinEdge && !Umpiring.UmpireHearsEdge(true, 1f, rng))
                    {
                        // Caught behind, but the umpire didn't hear it: not out, the fielders may review.
                        AppealNotOut(isLbw: false);
                    }
                    else if (noBallCalled)
                    {
                        Say("Caught! But it's a no-ball.");
                    }
                    else
                    {
                        wicketDecided = true;
                        Wicket(Dismissal.Caught, true, a.Player);
                        // The batters' completed runs don't count after a catch.
                        runsCompleted = 0;
                        foreach (var r in Runners) r.Running = false;
                    }
                }
                Raise(GameEvent.Make(EvType.Catch, a.Index));
                QueueDead(1.2f);
            }
            else
            {
                Raise(GameEvent.Make(EvType.Drop, a.Index, text: "Dropped!"));
                Say(Commentary.Drop(FieldingTeam.Players[a.Player].Surname(), rng));
                DropBall(Ball.Vel * 0.25f + new Vector3(rng.Range(-2f, 2f), 2f, rng.Range(-2f, 2f)));
                if (a.Pose != Pose.Dive) a.SetPose(Pose.GetUp);
                PlanFielding();
            }
        }

        void UpdateHolder(Actor a, float dt)
        {
            a.Vel = Vector3.MoveTowards(a.Vel, Vector3.zero, 12f * dt);
            a.Pos += a.Vel * dt;
            if (ballDeadQueued) return;
            // Pick up / get up, then throw (or run it in if close to the stumps).
            if ((a.Pose == Pose.Pickup || a.Pose == Pose.GetUp || a.Pose == Pose.Catch || a.Pose == Pose.Dive) && liveTime - collectedAt < 0.35f) return;
            bool anyRunning = Runners[0].Running || Runners[1].Running;
            int end = BestEndToThrow(a, out float margin);
            var stumps = Geo.Stumps(end);
            float dist = Vector3.Distance(a.Pos, stumps);
            if (dist < 3.5f)
            {
                // Next to the stumps: break them if someone is short.
                if (RunnerAtRisk(end) != null) { BreakStumps(end, stumps + Vector3.up * 0.5f); RunOutCheck(end, a, false); }
                return;
            }
            bool manual = ManualFielding && a == Controlled;
            if (manual)
            {
                if (!manualThrowRequested && liveTime - collectedAt < 2.5f) return;
                if (manualThrowRequested) { end = manualThrowEnd; }
            }
            else if (!anyRunning && a.Kind == ActorKind.Keeper && dist < 25f) return; // keeper holds it
            else if (!anyRunning && liveTime - collectedAt < 0.6f) return;
            Throw(a, end, manual ? manualThrowDirect : ShouldGoForDirectHit(a, end, margin));
        }

        /// <summary>The end where a run out is most likely (the batter furthest from making his ground).</summary>
        int BestEndToThrow(Actor thrower, out float margin)
        {
            margin = float.MaxValue;
            int bestEnd = Inn.StrikerEnd; // default: to the keeper
            for (int end = 0; end < 2; end++)
            {
                var r = RunnerAtRisk(end);
                if (r == null) continue;
                float tBat = TimeToGround(r, end);
                float tThrow = Vector3.Distance(thrower.Pos, Geo.Stumps(end)) / ThrowSpeed(thrower) + 0.45f;
                float m = tBat - tThrow;
                if (m > -0.6f && (margin == float.MaxValue || m > margin)) { margin = m; bestEnd = end; }
            }
            if (margin == float.MaxValue)
            {
                // No chance: return it to the nearer of keeper and bowler, keeper preferred.
                float dk = Vector3.Distance(thrower.Pos, Geo.Stumps(Inn.StrikerEnd));
                float db = Vector3.Distance(thrower.Pos, Geo.Stumps(Inn.BowlingEnd));
                bestEnd = db < dk * 0.6f ? Inn.BowlingEnd : Inn.StrikerEnd;
            }
            return bestEnd;
        }

        float ThrowSpeed(Actor a) => Mathf.Lerp(23f, 31f, a.Skill);

        bool ShouldGoForDirectHit(Actor a, int end, float margin)
        {
            if (margin == float.MaxValue) return false;
            var receiver = end == Inn.StrikerEnd ? KeeperActor : BowlerActor;
            bool receiverThere = receiver != null && Vector3.Distance(receiver.Pos, Geo.Stumps(end)) < 2.5f;
            float dist = Vector3.Distance(a.Pos, Geo.Stumps(end));
            return dist < 30f && (!receiverThere || margin > -0.2f && margin < 0.5f);
        }

        void Throw(Actor a, int end, bool direct)
        {
            var receiver = end == Inn.StrikerEnd ? KeeperActor : BowlerActor;
            if (receiver == a) receiver = NearestFielders(Geo.Stumps(end), 2).Find(x => x != a);
            var stumps = Geo.Stumps(end);
            Vector3 target = direct || receiver == null ? stumps + Vector3.up * 0.4f : receiver.Pos + Vector3.up * 1.0f;
            float speed = ThrowSpeed(a);
            var from = a.Pos + Vector3.up * 1.8f;
            var flat = target - from;
            float h = flat.y;
            flat.y = 0f;
            float d = flat.magnitude;
            // Low trajectory that reaches the target (vacuum solution, nudged up for drag).
            float g = Env.Gravity;
            float v2 = speed * speed;
            float disc = v2 * v2 - g * (g * d * d + 2f * h * v2);
            float ang = disc > 0f ? Mathf.Atan((v2 - Mathf.Sqrt(disc)) / (g * d)) : 40f * Mathf.Deg2Rad;
            ang *= 1.08f;
            ang += d * 0.0012f;
            // Accuracy: direct hits scatter more with distance and less skill.
            float yawErr = rng.Gauss() * (direct ? Mathf.Lerp(2.2f, 0.9f, a.Skill) * (0.4f + d / 30f) : 1.2f) * Mathf.Deg2Rad;
            var dir = flat / Mathf.Max(0.01f, d);
            dir = Quaternion.AngleAxis(yawErr * Mathf.Rad2Deg, Vector3.up) * dir;
            if (heldBy != null) heldBy.HasBall = false;
            heldBy = null;
            BallHolder = null;
            Ball.Pos = from;
            Ball.Vel = (dir * Mathf.Cos(ang) + Vector3.up * Mathf.Sin(ang)) * speed;
            Ball.Spin = Vector3.zero;
            Ball.Rolling = Ball.Stopped = false;
            Ball.SwingCoef = 0f;
            Ball.Bounces = 0;
            bouncedSinceHit = true;
            throwInFlight = true;
            throwTarget = receiver;
            throwEnd = end;
            throwDirect = direct;
            lastThrower = a;
            a.SetPose(Pose.Throw);
            a.Face(target);
            a.Aim = Mathf.Atan2(dir.x, dir.z) * Mathf.Rad2Deg;
            manualThrowRequested = false;
            Raise(GameEvent.Make(EvType.Throw, a.Index, end, direct ? 1f : 0f));
            if (receiver != null)
            {
                plans[receiver.Index].Job = Job.CoverStumps;
                plans[receiver.Index].Target = stumps + (frame.Origin - stumps).normalized * -0.4f;
            }
            // Someone backs up the throw.
            var backup = NearestFielders(stumps, 4).Find(x => x != a && x != receiver);
            if (backup != null)
            {
                plans[backup.Index].Job = Job.Back;
                plans[backup.Index].Target = stumps + (stumps - a.Pos).normalized * 12f;
            }
        }

        void MoveFieldersIdle(float dt)
        {
            for (int i = FirstFielder; i < FirstFielder + FielderCount; i++)
            {
                var a = Actors[i];
                if (!a.Visible || a.Pose == Pose.Celebrate || a.Pose == Pose.Appeal) continue;
                if (a.Pose == Pose.Dive && a.PoseTime > 1f) a.SetPose(Pose.GetUp);
                a.Vel = Vector3.MoveTowards(a.Vel, Vector3.zero, 10f * dt);
                a.Pos += a.Vel * dt;
                if (a.Speed < 0.3f && a.Pose == Pose.Run) a.SetPose(Pose.Idle);
            }
        }

        // ------------------------------------------------------------------ running between the wickets

        void UpdateRunners(float dt)
        {
            var inn = Inn;
            for (int k = 0; k < 2; k++)
            {
                var r = Runners[k];
                var a = r.A;
                // The striker can't run until he has finished his shot.
                if (k == 0 && (a.Pose == Pose.Shot && a.PoseTime < 0.5f)) { if (r.Running) a.Pos += a.Vel * dt; continue; }
                if (!r.Running)
                {
                    if (a.Pose == Pose.Run || a.Pose == Pose.Walk) a.SetPose(Pose.Idle);
                    a.Vel = Vector3.MoveTowards(a.Vel, Vector3.zero, 9f * dt);
                    a.Pos += a.Vel * dt;
                    if (r.Sliding && a.Pose == Pose.BatSlide && a.PoseTime > 0.9f) { r.Sliding = false; a.SetPose(Pose.Idle); }
                    continue;
                }
                float crease = Geo.PoppingZ(r.ToEnd);
                float inward = Geo.Inward(r.ToEnd);
                // Run through the crease (no braking before it).
                var target = new Vector3(r.Lane, 0f, crease - inward * 3f);
                a.MoveTo(target, dt, r.Sliding ? 0.7f : 1f, 0.3f);
                if (!r.Sliding) a.SetPose(Pose.Run, 1);
                if (Grounded(r, r.ToEnd))
                {
                    // Made his ground.
                    bool crossedRun = r.ToEnd != r.AtEnd;
                    r.AtEnd = r.ToEnd;
                    r.Running = false;
                    if (k == 0 || k == 1) { }
                    if (crossedRun && !Runners[1 - k].Running && Runners[1 - k].AtEnd != r.AtEnd && runCrossed)
                    {
                        runsCompleted++;
                        runCrossed = false;
                        Raise(GameEvent.Make(EvType.Runs, runsCompleted, 1));
                    }
                }
            }
            // Crossing: both batters running in opposite directions past each other.
            if (Runners[0].Running && Runners[1].Running && Runners[0].ToEnd != Runners[0].AtEnd)
            {
                float z0 = Runners[0].A.Pos.z, z1 = Runners[1].A.Pos.z;
                float dir0 = Geo.Inward(Runners[0].AtEnd);
                if ((z0 - z1) * dir0 > 0f) runCrossed = true;
            }
        }

        bool Grounded(Runner r, int end)
        {
            float reach = r.Sliding ? 1.1f : 0.35f; // bat stretched out in front
            float behind = (r.A.Pos.z - Geo.PoppingZ(end)) * -Geo.Inward(end) + reach;
            return behind >= 0f;
        }

        float TimeToGround(Runner r, int end)
        {
            float dist = Mathf.Abs(r.A.Pos.z - Geo.PoppingZ(end)) - 0.35f;
            float v = Mathf.Max(0.5f, Vector3.Dot(r.A.Vel, new Vector3(0, 0, Mathf.Sign(Geo.PoppingZ(end) - r.A.Pos.z))));
            return dist <= 0f ? 0f : dist / Mathf.Lerp(v, r.A.MaxSpeed, 0.5f);
        }

        /// <summary>The batter whose ground this end is and who is out of it right now (or null).</summary>
        Runner RunnerAtRisk(int end)
        {
            Runner best = null;
            float bestD = float.MaxValue;
            foreach (var r in Runners)
            {
                bool heading = r.Running && r.ToEnd == end;
                bool leaving = r.Running && r.AtEnd == end && r.ToEnd != end;
                if (!heading && !leaving) continue;
                float d = Mathf.Abs(r.A.Pos.z - Geo.PoppingZ(end));
                if (d < bestD) { bestD = d; best = r; }
            }
            if (best == null) return null;
            return Grounded(best, end) ? null : best;
        }

        void RunOutCheck(int end, Actor fielder, bool direct)
        {
            if (wicketDecided) return;
            var r = RunnerAtRisk(end);
            if (r == null) return;
            wicketDecided = true;
            bool striker = r.A == Striker;
            // Who is the out batter by player id (striker/non-striker roles as at the start of this ball).
            Wicket(Dismissal.RunOut, striker, fielder != null ? fielder.Player : -1);
            Say(direct ? "Direct hit! He's well short — run out!" : "The bails are off and he's short of his ground — run out!");
            foreach (var x in Runners) x.Running = false;
            QueueDead(1.2f);
        }

        /// <summary>Hook for the offline match test (logs why runs are called); unused in the game.</summary>
        public static System.Action<string> Trace;

        public void CallRun()
        {
            if (Phase != Phase.BallLive || ballDeadQueued || caught) return;
            Trace?.Invoke($"call run at {liveTime:0.00}s, est. return {EstimatedReturnTime():0.00}s, held {heldBy != null}, throw {throwInFlight}, boundary {BoundaryLikely()}");
            humanCallAt = liveTime;
            if (Runners[0].Running || Runners[1].Running) return;
            if (Runners[0].A.Pose == Pose.BatSlide && Runners[0].A.PoseTime < 0.5f) return;
            for (int k = 0; k < 2; k++)
            {
                var r = Runners[k];
                r.ToEnd = 1 - r.AtEnd;
                r.Running = true;
                r.Sliding = false;
            }
            runCrossed = false;
        }

        public void CallBack()
        {
            Trace?.Invoke($"send back at {liveTime:0.00}s");
            if (Phase != Phase.BallLive) return;
            humanCallAt = liveTime;
            foreach (var r in Runners)
            {
                if (!r.Running || r.ToEnd == r.AtEnd) continue;
                r.ToEnd = r.AtEnd; // turn round
            }
            runCrossed = false;
        }

        public void SlideBat()
        {
            if (Phase != Phase.BallLive) return;
            humanCallAt = liveTime;
            foreach (var r in Runners)
            {
                if (!r.Running || r.Sliding) continue;
                float d = Mathf.Abs(r.A.Pos.z - Geo.PoppingZ(r.ToEnd));
                if (d < 3f)
                {
                    r.Sliding = true;
                    r.A.SetPose(Pose.BatSlide);
                }
            }
        }

        int RunsCompleted() => runsCompleted;

        /// <summary>How long the next run would take both batters (from where they are, with the call and the turn).</summary>
        public float RunTimeEstimate()
        {
            float t = 0f;
            foreach (var r in Runners)
            {
                int to = r.Running ? r.ToEnd : 1 - r.AtEnd;
                var target = new Vector3(r.Lane, 0f, Geo.PoppingZ(to) + Geo.Inward(to) * 0.35f);
                float turn = r.A.Speed < 1f && Mathf.Abs(r.A.Pos.z - Geo.PoppingZ(r.AtEnd)) > 1f ? 0.45f : 0.2f;
                t = Mathf.Max(t, r.A.TimeTo(target) + turn);
            }
            return t;
        }

        /// <summary>Seconds for runner k to make his ground at the end he's running to (-1 when not running).</summary>
        public float RunnerTimeToGround(int k)
        {
            var r = Runners[k];
            if (!r.Running) return -1f;
            return TimeToGround(r, r.ToEnd);
        }

        /// <summary>How far through the current run runner k is (0..1).</summary>
        public float RunnerProgress(int k)
        {
            var r = Runners[k];
            if (!r.Running || r.ToEnd == r.AtEnd) return 0f;
            float from = Geo.PoppingZ(r.AtEnd), to = Geo.PoppingZ(r.ToEnd);
            return Mathf.Clamp01((r.A.Pos.z - from) / (to - from));
        }

        // AI access
        public bool AnyRunning => Runners[0].Running || Runners[1].Running;
        public bool BallHeld => heldBy != null;
        public Actor Holder => heldBy;
        public bool BallCaught => caught;
        public float EstimatedReturnTime()
        {
            // Time until the stumps can be broken at either end: the first fielder to the ball collects it, then
            // either runs it to the stumps (close in) or throws it to whoever is there.
            float collect = 0f;
            Actor who = heldBy;
            Vector3 at = heldBy != null ? heldBy.Pos : Ball.Pos;
            // A throw on its way in: the stumps can go down as soon as it arrives.
            if (throwInFlight && throwTarget != null)
                return Vector3.Distance(Ball.Pos, throwTarget.Pos) / Mathf.Max(8f, Ball.Speed) + 0.35f;
            if (who == null)
            {
                float best = float.MaxValue;
                for (int i = FirstFielder; i < FirstFielder + FielderCount; i++)
                {
                    var p = plans[i];
                    if (p == null || (p.Job != Job.Chase && p.Job != Job.Catch)) continue;
                    float t = Mathf.Max(0f, p.At - liveTime);
                    if (t < best) { best = t; who = Actors[i]; at = p.Target; }
                }
                if (who == null)
                {
                    // Nobody planned yet: assume the nearest fielder goes for it.
                    var near = NearestFielders(Ball.Pos, 1);
                    if (near.Count == 0) return 6f;
                    who = near[0];
                    best = 0.3f + who.TimeTo(Ball.Pos);
                }
                collect = best + 0.35f;
            }
            float d = Mathf.Min(Vector3.Distance(at, Geo.Stumps(0)), Vector3.Distance(at, Geo.Stumps(1)));
            // Close to the stumps he just runs it in (or underarms it); otherwise pick up, steady, throw, and the
            // keeper or bowler gathers and breaks the wicket.
            if (d < 8f) return collect + 0.25f + d / 6f;
            return collect + 0.6f + d / ThrowSpeed(who) + 0.35f;
        }
        public bool BoundaryLikely()
        {
            if (heldBy != null || path.Count == 0) return false;
            foreach (var p in plans) if (p != null && (p.Job == Job.Chase || p.Job == Job.Catch) && Geo.BeyondRope(p.Target, 6f) < 0f) return false;
            return Geo.BeyondRope(path[path.Count - 1], 0.5f) >= 0f;
        }
        public bool IsAirCatchChance()
        {
            if (!hitBat || bouncedSinceHit) return false;
            foreach (var p in plans) if (p != null && p.Job == Job.Catch) return true;
            return false;
        }

        // ------------------------------------------------------------------ manual fielding

        void ManualFieldCommand(Command c)
        {
            if (!ManualFielding || Phase != Phase.BallLive) return;
            switch (c.Type)
            {
                case CmdType.FieldMove:
                    manualMove = Vector3.ClampMagnitude(new Vector3(c.A, 0f, c.B), 1f);
                    if (manualMove.sqrMagnitude > 0.01f) manualMoveAt = liveTime;
                    break;
                case CmdType.FieldSwitch:
                    {
                        // Next nearest fielder to the ball.
                        var near = NearestFielders(Ball.Pos, 4);
                        int idx = Controlled == null ? -1 : near.IndexOf(Controlled);
                        Controlled = near[(idx + 1) % near.Count];
                        break;
                    }
                case CmdType.FieldCatch:
                    catchPressAt = liveTime;
                    break;
                case CmdType.FieldThrow:
                    if (heldBy == Controlled)
                    {
                        manualThrowRequested = true;
                        manualThrowEnd = c.I == 0 ? Inn.StrikerEnd : Inn.BowlingEnd;
                        manualThrowDirect = c.C > 0.5f;
                    }
                    break;
            }
        }
    }
}
