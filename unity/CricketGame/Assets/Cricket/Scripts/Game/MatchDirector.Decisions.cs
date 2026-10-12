using System.Collections.Generic;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>Appeals, the on-field umpire's LBW and caught-behind calls, and the decision review system.</summary>
    public partial class MatchDirector
    {
        enum AppealKind { None, Lbw, CaughtBehind }

        AppealKind appeal;
        bool appealGivenOut;
        bool appealEdgeTruth;
        LbwTrack lbwTrack;
        bool reviewWindowOpen, reviewDone;
        int reviewSide;
        float reviewDeadline;
        readonly List<Vector3> deliveryTrail = new List<Vector3>();

        /// <summary>Called every frame while the delivery is in the air, to draw the ball-tracking path later.</summary>
        public void RecordTrail()
        {
            if (Phase == Phase.BallInFlight && !hitBat && !padImpact) deliveryTrail.Add(Ball.Pos);
        }

        void LateUpdate()
        {
            if (!IsAuthority) return;
            if (Phase == Phase.BallInFlight) RecordTrail();
            if (Phase == Phase.PreDelivery && PhaseTime < 0.05f) { deliveryTrail.Clear(); appeal = AppealKind.None; reviewWindowOpen = reviewDone = false; }
        }

        void ConsiderLbw(Vector3 impact, Vector3 vin, bool shotOffered)
        {
            // Project the ball on from the pad as if the batter weren't there.
            var s = Ball;
            s.Pos = impact;
            s.Vel = vin;
            s.SwingCoef = 0f;
            var prev = s.Pos;
            Vector3 atStumps = impact;
            var projected = new List<Vector3> { impact };
            for (int i = 0; i < 800; i++)
            {
                BallPhysics.Step(ref s, Env, BallPhysics.Dt);
                if (i % 6 == 0) projected.Add(s.Pos);
                float a = frame.OffsetFwd(prev), b = frame.OffsetFwd(s.Pos);
                if (a >= 0f && b < 0f) { atStumps = Vector3.Lerp(prev, s.Pos, a / Mathf.Max(1e-5f, a - b)); projected.Add(atStumps); break; }
                prev = s.Pos;
            }
            lbwTrack = Umpiring.Track(frame, pitchedBeforeBatter, pitchedBeforeBatter ? pitchedAt : impact, impact, atStumps, shotOffered);
            projectedPath = projected;

            // Do the fielders think it's worth an appeal?
            float su = Mathf.Abs(frame.OffsetOff(atStumps));
            bool looksClose = lbwTrack.Pitching != Zone.OutsideLeg && su < 0.45f && atStumps.y < 1.1f;
            if (!looksClose) return;
            appeal = AppealKind.Lbw;
            Raise(GameEvent.Make(EvType.Appeal, 0, text: "Howzat!"));
            BowlerActor.SetPose(Pose.Appeal);
            if (KeeperActor != null) KeeperActor.SetPose(Pose.Appeal);
            bool given = Umpiring.UmpireGivesLbw(lbwTrack, frame, rng, 0.85f);
            appealGivenOut = given;
            if (given && !noBallCalled)
            {
                wicketDecided = true;
                Wicket(Dismissal.Lbw, true, -1);
                QueueDead(1.4f);
            }
            else
            {
                Raise(GameEvent.Make(EvType.NotOut, text: "Not out"));
                QueueDead(1.6f);
            }
        }

        List<Vector3> projectedPath = new List<Vector3>();

        void AppealNotOut(bool isLbw)
        {
            appeal = isLbw ? AppealKind.Lbw : AppealKind.CaughtBehind;
            appealGivenOut = false;
            appealEdgeTruth = true;
            Raise(GameEvent.Make(EvType.Appeal, 1, text: "Howzat!"));
            Raise(GameEvent.Make(EvType.NotOut, text: "Not out — the umpire didn't hear an edge"));
            caught = true; // the ball is dead in the keeper's gloves either way
        }

        /// <summary>Before committing a decision, gives the wronged side the chance to review. Returns true while waiting.</summary>
        bool OfferReview()
        {
            if (reviewDone || appeal == AppealKind.None) return false;
            // Caught (given out) off an edge to the keeper or slips can also be reviewed by the batter.
            int side = appealGivenOut ? BattingSide : FieldingSide;
            if (ReviewsLeft(side) <= 0 && !(SideHuman[side] && side == LocalSide && !Online)) { reviewDone = true; return false; }
            if (!reviewWindowOpen)
            {
                reviewWindowOpen = true;
                reviewSide = side;
                reviewDeadline = PhaseTime + (SideHuman[side] ? 12f : 1.2f);
                if (!SideHuman[side])
                {
                    // The CPU reviews when it believes the umpire got it wrong (it's right most of the time).
                    bool truthOut = appeal == AppealKind.Lbw ? lbwTrack.OutIfCallsGo(appealGivenOut) : appealEdgeTruth;
                    bool wrong = truthOut != appealGivenOut;
                    float sense = State.Setup.Difficulty == Difficulty.Hard ? 0.85f : State.Setup.Difficulty == Difficulty.Easy ? 0.6f : 0.75f;
                    bool review = rng.Chance(wrong ? sense : 1f - sense) && ReviewsLeft(side) > 0;
                    if (review) { reviewWindowOpen = false; StartReview(side); return true; }
                    reviewWindowOpen = false;
                    reviewDone = true;
                    return false;
                }
                Raise(GameEvent.Make(EvType.Message, side, text: appealGivenOut ? "Review the decision? (R)" : "Not out. Review? (R)"));
            }
            if (PhaseTime >= reviewDeadline)
            {
                reviewWindowOpen = false;
                reviewDone = true;
                return false;
            }
            return true;
        }

        void RequestReview(int side)
        {
            if (!reviewWindowOpen || side != reviewSide || ReviewsLeft(side) <= 0) return;
            reviewWindowOpen = false;
            StartReview(side);
        }

        void StartReview(int side)
        {
            Review = new ReviewInfo
            {
                Active = true,
                Lbw = appeal == AppealKind.Lbw,
                ReviewingTeam = side == BattingSide ? Inn.BattingTeam : 1 - Inn.BattingTeam,
                OriginalOut = appealGivenOut,
                Track = lbwTrack,
                Edge = appealEdgeTruth,
            };
            var pts = new List<Vector3>(deliveryTrail);
            Review.ImpactIndex = pts.Count;
            pts.AddRange(projectedPath);
            Review.Path = pts.ToArray();
            if (Review.Lbw) Review.Outcome = Umpiring.ReviewLbw(lbwTrack, appealGivenOut);
            else Review.Outcome = appealEdgeTruth == appealGivenOut ? ReviewOutcome.Stands : ReviewOutcome.Overturned;
            Review.FinalOut = Review.Outcome == ReviewOutcome.Overturned ? !appealGivenOut : appealGivenOut;
            Raise(GameEvent.Make(EvType.ReviewStart, side, Review.Lbw ? 1 : 0));
            Say($"{(side == BattingSide ? BattingTeam.Name : FieldingTeam.Name)} have gone upstairs. Let's see what the technology says.");
            SetPhase(Phase.Review);
            Signal = UmpireSignal.ReviewTv;
        }

        public float ReviewDuration => Review.Lbw ? 7.5f : 5f;

        void UpdateReview(float dt)
        {
            Review.Time = PhaseTime;
            if (PhaseTime < ReviewDuration) return;
            // Apply the verdict.
            int side = Review.ReviewingTeam == Inn.BattingTeam ? BattingSide : FieldingSide;
            if (Review.Outcome == ReviewOutcome.Stands)
            {
                if (side == BattingSide) Inn.BatReviews--; else Inn.BowlReviews--;
            }
            if (Review.FinalOut && !outcome.Wicket)
            {
                wicketDecided = true;
                Wicket(Review.Lbw ? Dismissal.Lbw : Dismissal.Caught, true, Review.Lbw ? -1 : KeeperActor != null ? KeeperActor.Player : -1);
                outcome.RunsBat = 0;
                runsCompleted = 0;
            }
            else if (!Review.FinalOut && outcome.Wicket)
            {
                outcome.Wicket = false;
                outcome.How = Dismissal.None;
                wicketDecided = false;
            }
            string verdict = Review.Outcome == ReviewOutcome.Overturned ? "Decision overturned" : Review.Outcome == ReviewOutcome.UmpiresCall ? "Umpire's call — the decision stands" : "The decision stands";
            Raise(GameEvent.Make(EvType.ReviewResult, (int)Review.Outcome, Review.FinalOut ? 1 : 0, text: verdict));
            ShowBanner(Review.FinalOut ? "OUT" : "NOT OUT", 2.2f);
            Say(verdict + (Review.Outcome == ReviewOutcome.UmpiresCall ? ", and the review is retained." : "."));
            Review.Active = false;
            reviewDone = true;
            SetPhase(Phase.Dead);
            ChooseSignal();
        }
    }
}
