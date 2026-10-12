using System;
using System.Collections.Generic;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.Game
{
    /// <summary>
    /// Runs a cricket match: toss, innings, overs, every delivery from run-up to dead ball, the fielders, the batters'
    /// running, the umpires and the reviews. Only the authority (solo game or online host) simulates; online guests
    /// receive snapshots (see Net.NetMatch) and send their inputs as Commands.
    /// Split over partial files: this one (match flow, deliveries, batting), MatchDirector.Live (ball in play,
    /// fielding, running), MatchDirector.Decisions (appeals, LBW, DRS) and the AI helpers.
    /// </summary>
    public partial class MatchDirector : MonoBehaviour
    {
        public static MatchDirector Instance { get; private set; }

        // Actor slots
        public const int StrikerSlot = 0, NonStrikerSlot = 1, FirstFielder = 2, FielderCount = 11, UmpireBowlerEnd = 13, UmpireSquareLeg = 14, ActorCount = 15;

        public MatchState State = new MatchState();
        public Phase Phase { get; private set; } = Phase.Loading;
        public float PhaseTime { get; private set; }
        public float SimTime { get; private set; }
        public readonly Actor[] Actors = new Actor[ActorCount];
        public BallState Ball;
        public bool BallVisible;
        public Actor BallHolder;
        public Env Env;
        public bool IsAuthority = true;
        public bool Online;
        public int LocalSide;            // which side this machine's player controls
        public bool[] SideHuman = { true, false };
        public event Action<GameEvent> OnEvent;

        // Per-delivery state visible to the HUD and the input layer
        public DeliveryType SelectedDelivery = DeliveryType.SeamUp;
        public Vector3 Marker;
        public bool AroundWicket;
        public float MeterValue;
        public bool MeterRunning;
        public float MeterGreen = 0.77f, MeterHalfWidth = 0.15f;
        public float Guard;              // striker's sideways shuffle (m, + off side)
        public bool Charging;
        public float AimAngle;           // human batter's aim (deg)
        public FieldPreset Preset = FieldPreset.Balanced;
        public FieldSpot[] Field = new FieldSpot[9];
        public ReviewInfo Review = new ReviewInfo();
        public string Banner = "";       // big centre text (FOUR!, OUT!...)
        public float BannerTime;
        public UmpireSignal Signal;
        public int TossCall = -1;        // 0 heads, 1 tails
        public int TossResult = -1;
        public string LastShotNote = "";
        public Timing LastTiming;
        public float LastTimingError;
        public float LastKmh;

        // Delivery internals
        Rng rng;
        DeliveryPlan plan;
        int bowlerPlayer = -1;
        Vector3 runUpStart, runUpEnd;
        float runUpDuration, releaseAt;
        bool released;
        BallState releasedBall;
        Vector3 aimedAt;
        readonly float[] crossTime = new float[4];
        readonly Vector3[] crossPos = new Vector3[4];
        readonly Vector3[] crossVel = new Vector3[4];
        float crossLate; // sideways movement after the batter has to commit, for each prediction
        ShotInput pendingShot;
        bool shotPending;
        float shotPressAt = -1f;
        bool shotResolved;
        ShotResult lastShot;
        int batterId;                    // player index of the striker this ball
        BatFrame frame;
        bool strikerRight = true;

        // Outcome being built for the current ball
        BallOutcome outcome;
        bool hitBat, touchedBody, padImpact, wideCalled, noBallCalled, beamer, ballDeadQueued, wicketDecided, pitchedBeforeBatter;
        bool bouncedSinceHit;
        float deadAt;
        Vector3 pitchedAt;

        public BatFrame Frame => frame;
        public InningsState Inn => State.Current;
        public TeamProfile BattingTeam => State.Setup.Teams[Inn.BattingTeam];
        public TeamProfile FieldingTeam => State.Setup.Teams[1 - Inn.BattingTeam];
        public int BattingSide => Inn == null ? 0 : TeamSide(Inn.BattingTeam);
        public int FieldingSide => Inn == null ? 1 : TeamSide(1 - Inn.BattingTeam);
        public bool HumanBats => Inn != null && SideHuman[BattingSide];
        public bool HumanBowls => Inn != null && SideHuman[FieldingSide];
        public bool LocalBats => Inn != null && BattingSide == LocalSide && SideHuman[LocalSide];
        public bool LocalBowls => Inn != null && FieldingSide == LocalSide && SideHuman[LocalSide];
        public Actor Striker => Actors[StrikerSlot];
        public Actor NonStriker => Actors[NonStrikerSlot];
        public Actor BowlerActor { get; private set; }
        public Actor KeeperActor { get; private set; }
        public int BowlerPlayer => bowlerPlayer;
        public DeliveryPlan Plan => plan;
        public bool ShotPending => shotPending;
        public bool BallReleased => released;
        public float ReleaseAt => releaseAt;
        public ShotResult LastShot => lastShot;
        public int TeamSide(int team) => team; // team 0 is always side 0 (host / you), team 1 side 1
        public float DifficultyWindow => State.Setup.Difficulty == Difficulty.Easy ? 1.6f : State.Setup.Difficulty == Difficulty.Hard ? 0.8f : 1.15f;

        void Awake()
        {
            Instance = this;
            for (int i = 0; i < ActorCount; i++) Actors[i] = new Actor { Index = i };
            Actors[UmpireBowlerEnd].Kind = Actors[UmpireSquareLeg].Kind = ActorKind.Umpire;
            rng = new Rng(Environment.TickCount);
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        public void Raise(GameEvent e) => OnEvent?.Invoke(e);

        void Say(string text) => Raise(GameEvent.Make(EvType.Commentary, text: text));

        void ShowBanner(string text, float seconds = 2.2f)
        {
            Banner = text;
            BannerTime = seconds;
            Raise(GameEvent.Make(EvType.Message, text: text, f: seconds));
        }

        public void SetPhase(Phase p)
        {
            Phase = p;
            PhaseTime = 0f;
            Raise(GameEvent.Make(EvType.PhaseChange, (int)p));
        }


        // ------------------------------------------------------------------ match flow

        public void StartMatch(MatchSetup setup)
        {
            setup.Teams[0].Validate();
            setup.Teams[1].Validate();
            State = new MatchState();
            State.Begin(setup);
            rng = new Rng(setup.Seed);
            Env = Env.Make(setup.Pitch, setup.Time, RandomWind(), 0f);
            TossCall = TossResult = -1;
            Review = new ReviewInfo();
            Banner = "";
            BallVisible = false;
            foreach (var a in Actors) { a.Visible = false; a.HasBall = false; }
            SetPhase(Phase.Toss);
            Raise(GameEvent.Make(EvType.Toss));
        }

        Vector3 RandomWind()
        {
            float speed = rng.Range(0f, 6f);
            float ang = rng.Range(0f, Mathf.PI * 2f);
            return new Vector3(Mathf.Sin(ang), 0f, Mathf.Cos(ang)) * speed;
        }

        void Update()
        {
            float dt = Mathf.Min(Time.deltaTime, 0.05f);
            if (BannerTime > 0f) BannerTime -= Time.unscaledDeltaTime;
            if (!IsAuthority) { ClientUpdate(dt); return; }
            if (Phase == Phase.Loading || Phase == Phase.Menu) return;
            PhaseTime += dt;
            SimTime += dt;
            foreach (var a in Actors) a.PoseTime += dt;

            switch (Phase)
            {
                case Phase.Toss: UpdateToss(); break;
                case Phase.InningsIntro: if (PhaseTime > 2.5f) BeginOver(); break;
                case Phase.ChooseBowler: UpdateChooseBowler(); break;
                case Phase.PreDelivery: UpdatePreDelivery(dt); break;
                case Phase.RunUp: UpdateRunUp(dt); break;
                case Phase.BallInFlight: UpdateBallInFlight(dt); break;
                case Phase.BallLive: UpdateBallLive(dt); break;
                case Phase.Dead: UpdateDead(dt); break;
                case Phase.Review: UpdateReview(dt); break;
                case Phase.Replay: if (PhaseTime > 8f || PhaseTime > 0.5f && (ReplayRecorder.Instance == null || !ReplayRecorder.Instance.Playing)) AfterBall(); break;
                case Phase.InningsBreak: if (PhaseTime > (HumanBats || HumanBowls ? 30f : 6f)) StartNextInnings(); break;
                case Phase.MatchEnd: break;
            }
            UpdateIdleActors(dt);
        }

        // ------------------------------------------------------------------ toss

        void UpdateToss()
        {
            // The guest (or the player in solo) calls; a CPU side calls at once.
            int caller = Online ? 1 : 0;
            if (TossCall < 0)
            {
                if (!SideHuman[caller] && PhaseTime > 1f) TossCall = rng.Range(0, 2);
                return;
            }
            if (TossResult < 0)
            {
                TossResult = rng.Range(0, 2);
                State.TossWinner = TossResult == TossCall ? caller : 1 - caller;
                Raise(GameEvent.Make(EvType.Toss, State.TossWinner, TossResult, text: $"{State.Setup.Teams[State.TossWinner].Name} won the toss"));
                PhaseTime = 0f;
            }
            if (PhaseTime < 1.5f) return;
            if (!SideHuman[TeamSide(State.TossWinner)])
            {
                // CPU captain: bowl first on a green top or under lights, otherwise bat.
                bool bowl = State.Setup.Pitch == PitchType.Green || State.Setup.Time == TimeOfDay.Night || (State.Setup.Pitch == PitchType.Flat && rng.Chance(0.5f));
                ChooseToss(!bowl);
            }
        }

        void ChooseToss(bool bat)
        {
            State.TossWinnerBats = bat;
            int battingFirst = bat ? State.TossWinner : 1 - State.TossWinner;
            Say($"{State.Setup.Teams[State.TossWinner].Name} win the toss and choose to {(bat ? "bat" : "bowl")} first.");
            if (State.Setup.Format == MatchFormat.SuperOver) State.Innings.Clear();
            BeginInnings(battingFirst, State.Setup.Format == MatchFormat.SuperOver);
        }

        void BeginInnings(int battingTeam, bool superOver)
        {
            State.StartInnings(battingTeam, superOver);
            SetupFieldersForInnings();
            Preset = FieldPreset.Balanced;
            SetPhase(Phase.InningsIntro);
            var inn = Inn;
            string intro = superOver ? $"SUPER OVER — {BattingTeam.Name} bat" : inn.Target > 0 ? $"{BattingTeam.Name} need {inn.Target} to win" : $"{BattingTeam.Name} to bat";
            ShowBanner(intro, 2.5f);
            Say(intro + ".");
        }

        void StartNextInnings()
        {
            if (State.Finished) { SetPhase(Phase.MatchEnd); return; }
            if (!State.NextInnings(out int batting, out bool superOver))
            {
                EndMatch();
                return;
            }
            BeginInnings(batting, superOver);
        }

        void EndMatch()
        {
            SetPhase(Phase.MatchEnd);
            ShowBanner(State.Result, 6f);
            Say(State.Result + ".");
            Raise(GameEvent.Make(EvType.MatchEnd, State.Winner, text: State.Result));
            foreach (var a in Actors)
            {
                if (a.Team < 0 || !a.Visible) continue;
                a.SetPose(State.Winner == a.Team ? Pose.Celebrate : Pose.Dejected);
            }
        }

        // ------------------------------------------------------------------ actors

        void SetupFieldersForInnings()
        {
            var inn = Inn;
            var fielding = FieldingTeam;
            for (int i = 0; i < FielderCount; i++)
            {
                var a = Actors[FirstFielder + i];
                a.Team = 1 - inn.BattingTeam;
                a.Player = i;
                a.Kind = i == fielding.Keeper ? ActorKind.Keeper : ActorKind.Fielder;
                a.Visible = true;
                a.HasBall = false;
                var p = fielding.Players[i];
                a.Skill = p.Field01;
                a.MaxSpeed = Mathf.Lerp(6.4f, 8.2f, p.Field01);
                a.Accel = Mathf.Lerp(7f, 10f, p.Field01);
                a.Stamina = 100f;
                a.LeftHanded = p.LeftArmBowl;
                if (a.Kind == ActorKind.Keeper) KeeperActor = a;
            }
            foreach (int s in new[] { StrikerSlot, NonStrikerSlot })
            {
                var a = Actors[s];
                a.Team = inn.BattingTeam;
                a.Visible = true;
                a.Kind = s == StrikerSlot ? ActorKind.Striker : ActorKind.NonStriker;
                a.MaxSpeed = 7f;
                a.Accel = 8f;
            }
            foreach (int s in new[] { UmpireBowlerEnd, UmpireSquareLeg })
            {
                Actors[s].Visible = true;
                Actors[s].Team = -1;
                Actors[s].SetPose(Pose.UmpireIdle);
            }
            SyncBatters();
        }

        /// <summary>Points the two batter actors at the current striker/non-striker players.</summary>
        void SyncBatters()
        {
            var inn = Inn;
            Striker.Player = inn.Striker;
            NonStriker.Player = inn.NonStriker;
            Striker.LeftHanded = BattingTeam.Players[inn.Striker].LeftHandBat;
            NonStriker.LeftHanded = BattingTeam.Players[inn.NonStriker].LeftHandBat;
        }

        public Actor FielderFor(int player)
        {
            for (int i = 0; i < FielderCount; i++) if (Actors[FirstFielder + i].Player == player) return Actors[FirstFielder + i];
            return null;
        }

        // ------------------------------------------------------------------ overs and bowler choice

        void BeginOver()
        {
            var inn = Inn;
            if (inn.Complete) { EndInnings(); return; }
            SyncBatters();
            if (inn.Bowler < 0) SetPhase(Phase.ChooseBowler);
            else StartDelivery();
        }

        /// <summary>Bowlers allowed this over: not the previous over's bowler, under the quota.</summary>
        public List<int> EligibleBowlers()
        {
            var list = new List<int>();
            var inn = Inn;
            var team = FieldingTeam;
            var rules = State.ActiveRules;
            for (int i = 0; i < team.Players.Count; i++)
            {
                if (i == team.Keeper) continue;
                if (i == inn.LastOverBowler) continue;
                var card = inn.Bowling.Find(b => b.Player == i);
                int overs = card == null ? 0 : (card.Balls + 5) / 6;
                if (overs >= rules.MaxOversPerBowler) continue;
                if (!team.Players[i].CanBowl && list.Count >= 5) continue;
                list.Add(i);
            }
            if (list.Count == 0) for (int i = 0; i < team.Players.Count; i++) if (i != team.Keeper && i != inn.LastOverBowler) list.Add(i);
            return list;
        }

        void UpdateChooseBowler()
        {
            if (HumanBowls && PhaseTime < 25f) return; // waiting for PickBowler
            PickBowler(BowlingAI.ChooseBowler(this, rng));
        }

        void PickBowler(int player)
        {
            var eligible = EligibleBowlers();
            if (!eligible.Contains(player)) player = eligible[0];
            Inn.Bowler = player;
            bowlerPlayer = player;
            var p = FieldingTeam.Players[player];
            Inn.BowlerCard(player);
            var types = Deliveries.For(p.Bowl);
            SelectedDelivery = types[0];
            AroundWicket = false;
            if (!HumanBowls) Preset = BowlingAI.ChoosePreset(this, p);
            Raise(GameEvent.Make(EvType.BowlerChange, player, text: $"{p.Name} ({StyleName(p)}) to bowl"));
            Say($"{p.Name} comes on to bowl, {StyleName(p).ToLowerInvariant()}.");
            StartDelivery();
        }

        public static string StyleName(PlayerProfile p)
        {
            string arm = p.LeftArmBowl ? "Left-arm" : "Right-arm";
            switch (p.Bowl)
            {
                case BowlStyle.Fast: return $"{arm} fast";
                case BowlStyle.Medium: return $"{arm} medium";
                case BowlStyle.OffSpin: return p.LeftArmBowl ? "Slow left-arm orthodox" : "Right-arm off-spin";
                default: return p.LeftArmBowl ? "Left-arm wrist spin" : "Right-arm leg-spin";
            }
        }

        // ------------------------------------------------------------------ delivery setup

        void StartDelivery()
        {
            var inn = Inn;
            SyncBatters();
            batterId = inn.Striker;
            var batter = BattingTeam.Players[batterId];
            strikerRight = !batter.LeftHandBat;
            frame = BatFrame.For(inn.StrikerEnd, strikerRight);
            var bowler = FieldingTeam.Players[inn.Bowler];
            bowlerPlayer = inn.Bowler;

            // Reset per-ball state.
            outcome = new BallOutcome();
            hitBat = touchedBody = padImpact = wideCalled = noBallCalled = beamer = ballDeadQueued = wicketDecided = pitchedBeforeBatter = false;
            bouncedSinceHit = false;
            shotPending = false;
            shotResolved = false;
            shotPressAt = -1f;
            aiShotQueued = false;
            released = false;
            Charging = false;
            Guard = 0f;
            lastShot = default;
            LastShotNote = "";
            Signal = UmpireSignal.None;
            Review = new ReviewInfo();
            BallVisible = false;
            BallHolder = null;
            ResetLive();
            foreach (var a in Actors) a.HasBall = false;

            // Field: the bowler and keeper are fixed; the other nine take the preset's spots.
            ApplyField();
            LayoutForDelivery();

            // Default marker: the selected delivery's length on off stump.
            var spec = Deliveries.Get(SelectedDelivery);
            Marker = frame.Local(0.12f, spec.DefaultLength);

            // Pitch wear grows through the match.
            float overs = 0f;
            foreach (var i in State.Innings) overs += i.LegalBalls / 6f;
            Env.Pitch = Surfaces.Pitch(State.Setup.Pitch, Mathf.Clamp01(overs / (State.Rules.Overs * 2f + 1f)));

            SetPhase(Phase.PreDelivery);
            if (inn.FreeHit) { ShowBanner("FREE HIT", 1.6f); Signal = UmpireSignal.FreeHit; }
        }

        public void ApplyField()
        {
            var bowler = FieldingTeam.Players[Inn.Bowler];
            bool spin = Deliveries.IsSpinStyle(bowler.Bowl);
            var spots = Fields.Preset(Preset, spin);
            var rules = State.ActiveRules;
            int maxOut = State.IsPowerplay ? rules.MaxOutsidePowerplay : rules.MaxOutside;
            if (State.InSuperOver) maxOut = 5;
            Field = Fields.Enforce(spots, maxOut);
            customField = false;
        }

        bool customField;

        /// <summary>Moves a fielder (0-8 in field order) to a world point, keeping the restrictions.</summary>
        public void MoveFielder(int index, Vector3 world)
        {
            if (index < 0 || index >= Field.Length) return;
            world.y = 0f;
            float beyond = Geo.BeyondRope(world, 3f);
            if (beyond > 0f) world -= world.normalized * beyond;
            var spot = new FieldSpot(Fields.NameOf(world, frame), frame.AngleOf(world), Vector3.Distance(world, frame.Origin));
            var copy = (FieldSpot[])Field.Clone();
            copy[index] = spot;
            var rules = State.ActiveRules;
            int maxOut = State.IsPowerplay ? rules.MaxOutsidePowerplay : rules.MaxOutside;
            int outside = 0;
            foreach (var s in copy) if (Fields.Outside(s)) outside++;
            if (outside > maxOut && Fields.Outside(spot))
            {
                ShowBanner($"Only {maxOut} fielders allowed outside the circle", 1.8f);
                return;
            }
            Field = copy;
            customField = true;
            LayoutForDelivery();
        }

        /// <summary>Places everyone for the next ball.</summary>
        void LayoutForDelivery()
        {
            var inn = Inn;
            var bowlerProfile = FieldingTeam.Players[inn.Bowler];
            bool spin = Deliveries.IsSpinStyle(bowlerProfile.Bowl);
            int bowlEnd = inn.BowlingEnd;
            float inward = Geo.Inward(bowlEnd);
            var travel = new Vector3(0, 0, inward);
            var bowlerRight = new Vector3(travel.z, 0, -travel.x);

            // Striker: side-on at the crease, bat grounded in front of middle.
            Striker.Pos = frame.Local(-0.42f + Guard, Geo.CreaseDepth - 0.1f);
            Striker.Face(Striker.Pos + frame.Off);
            Striker.Vel = Vector3.zero;
            Striker.SetPose(Pose.Stance);

            // Non-striker backs up on the side away from the bowler's arm.
            float armSide = (bowlerProfile.LeftArmBowl ? 1f : -1f) * (AroundWicket ? -1f : 1f);
            NonStriker.Pos = Geo.Stumps(bowlEnd) + travel * (Geo.CreaseDepth - 0.3f) - bowlerRight * armSide * 1.6f;
            NonStriker.Face(Geo.Stumps(inn.StrikerEnd));
            NonStriker.Vel = Vector3.zero;
            NonStriker.SetPose(Pose.Idle);

            // Keeper: back for pace, up to the stumps for spin.
            float back = spin ? 0.9f : bowlerProfile.Bowl == BowlStyle.Fast ? 17f : 12f;
            KeeperActor = FielderFor(FieldingTeam.Keeper);
            KeeperActor.Kind = ActorKind.Keeper;
            KeeperActor.Pos = frame.Origin - frame.Fwd * back + frame.Off * 0.3f;
            KeeperActor.Home = KeeperActor.Pos;
            KeeperActor.Face(Geo.Stumps(bowlEnd));
            KeeperActor.SetPose(Pose.KeeperCrouch);
            KeeperActor.Vel = Vector3.zero;

            // Bowler at the top of his run.
            BowlerActor = FielderFor(inn.Bowler);
            BowlerActor.Kind = ActorKind.Bowler;
            float runLen = spin ? 6.5f : bowlerProfile.Bowl == BowlStyle.Fast ? 20f : 14f;
            var release = DeliverySolver.ReleasePoint(bowlEnd, bowlerProfile.LeftArmBowl, AroundWicket, spin);
            runUpEnd = new Vector3(release.x, 0f, Geo.StumpsZ(bowlEnd) + inward * 0.6f) - bowlerRight * armSide * 0.25f;
            runUpStart = runUpEnd - travel * runLen + bowlerRight * armSide * (spin ? 0.6f : 1.2f);
            BowlerActor.Pos = runUpStart;
            BowlerActor.Home = runUpStart;
            BowlerActor.Face(runUpEnd);
            BowlerActor.Vel = Vector3.zero;
            BowlerActor.SetPose(Pose.Idle);
            BowlerActor.LeftHanded = bowlerProfile.LeftArmBowl;

            // Umpires.
            var ump = Actors[UmpireBowlerEnd];
            ump.Pos = Geo.Stumps(bowlEnd) - travel * 1.6f + bowlerRight * armSide * 0.5f;
            ump.Face(Geo.Stumps(inn.StrikerEnd));
            ump.Home = ump.Pos;
            var leg = Actors[UmpireSquareLeg];
            leg.Pos = frame.Polar(-90f, 21f);
            leg.Pos += frame.Fwd * (Geo.CreaseDepth);
            leg.Face(frame.Origin + frame.Fwd * Geo.CreaseDepth);
            leg.Home = leg.Pos;

            // Everyone else in the field.
            int k = 0;
            for (int i = 0; i < FielderCount; i++)
            {
                var a = Actors[FirstFielder + i];
                a.Visible = true;
                a.HasBall = false;
                if (a == BowlerActor || a == KeeperActor) continue;
                a.Kind = ActorKind.Fielder;
                var spot = Field[Mathf.Min(k, Field.Length - 1)];
                a.SpotName = spot.Name;
                a.Home = Fields.ToWorld(spot, frame);
                a.Pos = a.Home;
                a.Vel = Vector3.zero;
                a.Face(frame.Origin);
                a.SetPose(Pose.Idle);
                k++;
            }
            BowlerActor.SpotName = "Bowler";
            KeeperActor.SpotName = "Wicketkeeper";
        }

        /// <summary>Field order index of an actor (0-8), or -1 for bowler/keeper.</summary>
        public int FieldIndexOf(Actor a)
        {
            int k = 0;
            for (int i = 0; i < FielderCount; i++)
            {
                var f = Actors[FirstFielder + i];
                if (f == BowlerActor || f == KeeperActor) continue;
                if (f == a) return k;
                k++;
            }
            return -1;
        }

        public Actor FielderAtIndex(int index)
        {
            int k = 0;
            for (int i = 0; i < FielderCount; i++)
            {
                var f = Actors[FirstFielder + i];
                if (f == BowlerActor || f == KeeperActor) continue;
                if (k == index) return f;
                k++;
            }
            return null;
        }

        // ------------------------------------------------------------------ pre-delivery

        float aiReadyAt;

        void UpdatePreDelivery(float dt)
        {
            if (PhaseTime < dt * 1.5f)
            {
                aiReadyAt = 0f;
                if (!HumanBowls)
                {
                    var choice = BowlingAI.ChooseDelivery(this, rng);
                    SelectedDelivery = choice.Type;
                    Marker = choice.Target;
                    AroundWicket = choice.Around;
                    if (choice.Around) LayoutForDelivery();
                }
            }
            if (!HumanBowls)
            {
                // The CPU bowler runs in once the batter has had a moment (longer for a human batter to settle).
                float wait = HumanBats ? 1.6f : 0.9f;
                if (PhaseTime > wait) BeginRunUp();
            }
            else if (!SideHuman[BattingSide] && PhaseTime > 60f)
            {
                BeginRunUp(); // idle guard
            }
        }

        void BeginRunUp()
        {
            var bowler = FieldingTeam.Players[Inn.Bowler];
            bool spin = Deliveries.IsSpinStyle(bowler.Bowl);
            float dist = Vector3.Distance(runUpStart, runUpEnd);
            float avg = spin ? 3.2f : bowler.Bowl == BowlStyle.Fast ? 6.2f : 5.2f;
            runUpDuration = dist / avg + (spin ? 0.25f : 0.35f);
            releaseAt = runUpDuration;
            MeterValue = 0f;
            MeterRunning = HumanBowls;
            float fatigue = 1f - BowlerActor.Stamina / 100f;
            float diff = State.Setup.Difficulty == Difficulty.Easy ? 1.35f : State.Setup.Difficulty == Difficulty.Hard ? 0.75f : 1f;
            MeterHalfWidth = 0.15f * diff * Mathf.Lerp(1f, 0.65f, fatigue) * Mathf.Lerp(0.85f, 1.1f, bowler.Bowl01);
            plan = new DeliveryPlan
            {
                Type = SelectedDelivery,
                Style = bowler.Bowl,
                LeftArm = bowler.LeftArmBowl,
                AroundWicket = AroundWicket,
                Target = new Vector3(Marker.x, 0f, Marker.z),
                ReleaseError = float.NaN,
            };
            BowlerActor.SetPose(Pose.RunUp, (byte)bowler.Bowl);
            SetPhase(Phase.RunUp);
            // The CPU batter decides whether to charge a spinner.
            if (!HumanBats) Charging = BattingAI.WantsToCharge(this, rng);
        }

        // ------------------------------------------------------------------ run-up

        public float MeterDuration => 1.1f;

        void UpdateRunUp(float dt)
        {
            var bowler = FieldingTeam.Players[Inn.Bowler];
            bool spin = Deliveries.IsSpinStyle(bowler.Bowl);
            float t = PhaseTime / runUpDuration;
            // Ease in: accelerate over the first third.
            float s = t < 0.35f ? t * t / 0.35f * 0.5f / 0.5f : t;
            s = Mathf.Clamp01(Mathf.SmoothStep(0f, 1f, t * 0.6f + 0.4f * t * t));
            var prev = BowlerActor.Pos;
            BowlerActor.Pos = Vector3.Lerp(runUpStart, runUpEnd, s);
            BowlerActor.Vel = (BowlerActor.Pos - prev) / Mathf.Max(dt, 1e-4f);
            BowlerActor.Face(runUpEnd + (runUpEnd - runUpStart));
            float deliverStride = spin ? 0.5f : 0.6f;
            if (PhaseTime > runUpDuration - deliverStride && BowlerActor.Pose == Pose.RunUp) BowlerActor.SetPose(Pose.Deliver, (byte)bowler.Bowl);

            // Fielders walk in as the bowler runs up.
            foreach (var a in FieldersWalkingIn())
            {
                var dir = (frame.Origin - a.Home);
                dir.y = 0f;
                float walk = Mathf.Clamp01(PhaseTime / runUpDuration) * (a.Home - frame.Origin).magnitude > 15f ? 2.5f : 0.8f;
                a.Pos = a.Home + dir.normalized * walk * Mathf.Clamp01(PhaseTime / runUpDuration);
                a.SetPose(Pose.Ready);
            }

            // Release meter (human bowler): the needle sweeps over the last part of the run-up.
            float meterStart = runUpDuration - MeterDuration;
            if (MeterRunning && PhaseTime >= meterStart) MeterValue = Mathf.Clamp01((PhaseTime - meterStart) / MeterDuration);

            // Charging batter sets off as the bowler gathers.
            if (Charging && PhaseTime > runUpDuration - 0.45f)
            {
                var target = frame.Local(-0.3f + Guard, Geo.CreaseDepth + 1.9f);
                Striker.MoveTo(target, dt, 0.8f, 0.1f);
                Striker.Face(Striker.Pos + frame.Off);
                Striker.SetPose(Pose.Stance, 1);
            }

            if (PhaseTime >= releaseAt) Release();
        }

        IEnumerable<Actor> FieldersWalkingIn()
        {
            for (int i = 0; i < FielderCount; i++)
            {
                var a = Actors[FirstFielder + i];
                if (a == BowlerActor || a == KeeperActor || !a.Visible) continue;
                yield return a;
            }
        }

        /// <summary>Human release press: records where the meter needle was.</summary>
        void PressRelease(float meter)
        {
            if (Phase != Phase.RunUp || !MeterRunning || !float.IsNaN(plan.ReleaseError)) return;
            float m = meter;
            if (PhaseTime < runUpDuration - MeterDuration) m = 0f;
            plan.ReleaseError = (m - MeterGreen) / MeterHalfWidth;
            MeterRunning = false;
        }

        void Release()
        {
            var inn = Inn;
            var bowler = FieldingTeam.Players[inn.Bowler];
            var spec = Deliveries.Get(plan.Type);
            bool spin = spec.IsSpin;
            if (float.IsNaN(plan.ReleaseError))
            {
                if (HumanBowls) plan.ReleaseError = 1.3f; // never pressed: lost his run-up, overstepped
                else plan.ReleaseError = BowlingAI.ReleaseError(this, bowler, rng);
            }
            MeterRunning = false;
            // Overstepping: needle past the end of the zone.
            plan.NoBall = plan.ReleaseError > 1.15f;
            if (!HumanBowls && rng.Chance(0.012f)) plan.NoBall = true;

            float fatigue = 1f - BowlerActor.Stamina / 100f;
            float kmh = Deliveries.StockKmh(bowler.Bowl, bowler.Pace01) * spec.SpeedFactor * Mathf.Lerp(1f, 0.94f, fatigue);
            kmh *= 1f + rng.Gauss() * 0.012f;
            plan.SpeedKmh = kmh;
            LastKmh = kmh;
            BowlerActor.Stamina = Mathf.Max(0f, BowlerActor.Stamina - (spin ? 0.7f : bowler.Bowl == BowlStyle.Fast ? 1.8f : 1.2f));

            float ballAge = inn.LegalBalls / 6f;
            float skill = bowler.Bowl01 * Mathf.Lerp(1f, 0.85f, fatigue);
            Ball = DeliverySolver.Release(plan, inn.BowlingEnd, frame.Off, ballAge, skill, Env, rng, out aimedAt);
            releasedBall = Ball;
            BallVisible = true;
            released = true;
            SimTime = 0f;
            BowlerActor.SetPose(Pose.FollowThrough, (byte)bowler.Bowl);
            PredictForBatter();
            SetPhase(Phase.BallInFlight);
            Raise(GameEvent.Make(EvType.Release, (int)plan.Type, 0, kmh));
            if (plan.NoBall)
            {
                noBallCalled = true;
                Raise(GameEvent.Make(EvType.NoBall, text: "No ball! Overstepped."));
            }
            // CPU batter decides now (from what he can read out of the hand and the early flight).
            if (!HumanBats) BattingAI.Decide(this, rng);
            ReplayRecorder.Instance?.BeginBall();
        }

        // ------------------------------------------------------------------ prediction for timing

        public Vector3 ContactPlanePoint(Footwork feet)
        {
            float fwd = feet == Footwork.Front ? 0.62f : feet == Footwork.Charge ? 1.9f + 0.6f : 0.05f;
            return frame.Origin + frame.Fwd * (Geo.CreaseDepth + fwd);
        }

        /// <summary>Simulates the released ball to find when it reaches each contact plane (front/back/charge).</summary>
        void PredictForBatter()
        {
            var s = Ball;
            var prev = s.Pos;
            for (int i = 0; i < 4; i++) crossTime[i] = -1f;
            float planeFront = Vector3.Dot(ContactPlanePoint(Footwork.Front) - frame.Origin, frame.Fwd);
            float planeBack = Vector3.Dot(ContactPlanePoint(Footwork.Back) - frame.Origin, frame.Fwd);
            float planeCharge = Vector3.Dot(ContactPlanePoint(Footwork.Charge) - frame.Origin, frame.Fwd);
            float lineAtBounce = 0f;
            bool bounced = false;
            for (int i = 0; i < 1500; i++)
            {
                BallPhysics.Step(ref s, Env, BallPhysics.Dt);
                if (!bounced && s.Bounces > 0)
                {
                    bounced = true;
                    pitchedAt = s.FirstBounce;
                    lineAtBounce = frame.OffsetOff(s.Pos);
                }
                float dPrev = Vector3.Dot(prev - frame.Origin, frame.Fwd), dNow = Vector3.Dot(s.Pos - frame.Origin, frame.Fwd);
                Check(1, planeFront); Check(2, planeBack); Check(3, planeCharge);
                prev = s.Pos;
                if (dNow < -0.5f) break;

                void Check(int k, float plane)
                {
                    if (crossTime[k] < 0f && dPrev >= plane && dNow < plane)
                    {
                        float t = (dPrev - plane) / Mathf.Max(1e-5f, dPrev - dNow);
                        crossTime[k] = s.Time - BallPhysics.Dt * (1f - t);
                        crossPos[k] = Vector3.Lerp(prev, s.Pos, t);
                        crossVel[k] = s.Vel;
                    }
                }
            }
            pitchedBeforeBatter = bounced;
            crossTime[0] = crossTime[NaturalPlane()];
            crossPos[0] = crossPos[NaturalPlane()];
            crossVel[0] = crossVel[NaturalPlane()];
            // Late movement: how far the line changes after the ball pitches (seam/turn), relative to the straight continuation.
            crossLate = 0f;
            if (bounced)
            {
                var pre = releasedBall;
                // Straight-line extrapolation of the pre-bounce line to the contact plane vs where it actually got to.
                float expected = lineAtBounce;
                crossLate = Mathf.Abs(frame.OffsetOff(crossPos[0]) - expected) * 0.6f;
            }
        }

        int NaturalPlane() => Shots.NaturalFeet(PitchedLength(), Deliveries.Get(plan.Type).IsSpin) == Footwork.Front ? 1 : 2;

        public float PitchedLength()
        {
            if (!pitchedBeforeBatterKnown()) return -1f;
            return frame.OffsetFwd(pitchedAt);
        }

        bool pitchedBeforeBatterKnown() => pitchedBeforeBatter;

        /// <summary>When (sim time since release) the ball reaches the contact plane for this footwork.</summary>
        public float CrossTime(Footwork feet)
        {
            int k = feet == Footwork.Front ? 1 : feet == Footwork.Back ? 2 : feet == Footwork.Charge ? 3 : 0;
            if (Charging) k = 3;
            return crossTime[k];
        }

        public Vector3 CrossPoint(Footwork feet)
        {
            int k = feet == Footwork.Front ? 1 : feet == Footwork.Back ? 2 : feet == Footwork.Charge ? 3 : 0;
            if (Charging) k = 3;
            return crossPos[k];
        }

        public float BallTime => Ball.Time;

        // ------------------------------------------------------------------ batting input

        /// <summary>Registers a shot. timingError: bat arrival minus ball arrival at the contact plane (s).</summary>
        public void SetShot(ShotInput input, float pressAt)
        {
            if (shotPending || shotResolved || Phase != Phase.BallInFlight && Phase != Phase.RunUp) return;
            if (input.Feet == Footwork.Auto && Charging) input.Feet = Footwork.Charge;
            pendingShot = input;
            shotPending = true;
            shotPressAt = pressAt;
            AimAngle = input.Aim;
            var spec = Shots.Get(input.Type == ShotType.Auto ? ShotType.Drive : input.Type);
            if (input.Type == ShotType.Leave) Striker.SetPose(Pose.Leave);
            else Striker.SetPose(Pose.Shot, (byte)input.Type);
            Striker.Aim = input.Aim;
            // Footwork: step forward or back as the bat comes down.
            var feet = input.Feet == Footwork.Auto ? Shots.NaturalFeet(PitchedLength(), Deliveries.Get(plan.Type).IsSpin) : input.Feet;
            footTarget = feet == Footwork.Front ? 0.55f : feet == Footwork.Back ? -0.2f : 0f;
            Striker.Variant = (byte)((int)(input.Type == ShotType.Auto ? ShotType.Drive : input.Type) | ((int)feet << 4));
        }

        float footTarget;
        ShotInput aiShot;
        bool aiShotQueued;
        float aiShotAt;

        /// <summary>CPU batter: plays this shot when the ball's clock reaches pressAt.</summary>
        public void QueueAiShot(ShotInput input, float pressAt)
        {
            aiShot = input;
            aiShotAt = pressAt;
            aiShotQueued = true;
        }

        /// <summary>Called by the input layer: computes timing from the ball's predicted arrival for the chosen feet.</summary>
        public float TimingErrorNow(ShotInput input)
        {
            var type = input.Type == ShotType.Auto ? ShotType.Drive : input.Type;
            float lead = Shots.Get(type).Lead;
            var feet = input.Feet;
            if (feet == Footwork.Auto) feet = Shots.NaturalFeet(PitchedLength(), Deliveries.Get(plan.Type).IsSpin);
            float tCross = CrossTime(feet);
            if (tCross < 0f) tCross = CrossTime(Footwork.Auto);
            if (!released) return -0.5f; // pressed before the ball was even bowled
            return Ball.Time + lead - tCross;
        }

        // ------------------------------------------------------------------ ball in flight (delivery)

        void UpdateBallInFlight(float dt)
        {
            var inn = Inn;
            if (aiShotQueued && Ball.Time >= aiShotAt)
            {
                aiShotQueued = false;
                if (aiShot.Type == ShotType.Leave) Striker.SetPose(Pose.Leave);
                else SetShot(aiShot, Ball.Time);
            }
            // Batter footwork movement.
            if (shotPending && !shotResolved && Mathf.Abs(footTarget) > 0.01f)
            {
                var target = frame.Local(-0.42f + Guard, Geo.CreaseDepth - 0.1f + footTarget);
                if (Charging) target = frame.Local(-0.3f + Guard, Geo.CreaseDepth + 1.9f);
                Striker.Pos = Vector3.MoveTowards(Striker.Pos, target, 3.5f * dt);
            }
            else if (Charging)
            {
                Striker.MoveTo(frame.Local(-0.3f + Guard, Geo.CreaseDepth + 1.9f), dt, 0.8f, 0.1f);
                Striker.Face(Striker.Pos + frame.Off);
            }

            int steps = Mathf.Max(1, Mathf.CeilToInt(dt / BallPhysics.Dt));
            float h = dt / steps;
            for (int i = 0; i < steps && Phase == Phase.BallInFlight; i++)
            {
                var prev = Ball.Pos;
                var r = BallPhysics.Step(ref Ball, Env, h);
                if (r.Bounced && Ball.Bounces == 1) Raise(new GameEvent { Type = EvType.Bounce, P = r.BouncePos, F = r.ImpactSpeed });
                CheckDeliveryPlanes(prev, Ball.Pos);
            }
            KeeperTrackBall(dt);
            UpdateNonStrikerBackingUp(dt);
        }

        void UpdateNonStrikerBackingUp(float dt)
        {
            var inn = Inn;
            var target = Geo.Stumps(inn.BowlingEnd) + new Vector3(0, 0, Geo.Inward(inn.BowlingEnd)) * (Geo.CreaseDepth + 1.2f);
            target.x = NonStriker.Pos.x;
            NonStriker.MoveTo(target, dt, 0.35f, 0.2f);
            NonStriker.Face(Geo.Stumps(inn.StrikerEnd));
        }

        void KeeperTrackBall(float dt)
        {
            if (KeeperActor == null) return;
            // The keeper shuffles to the line of the ball and gets his gloves to it.
            float keeperFwd = frame.OffsetFwd(KeeperActor.Home);
            var s = Ball;
            float line = frame.OffsetOff(s.Pos);
            if (frame.OffsetFwd(s.Pos) > keeperFwd + 0.5f)
            {
                // Predict where it gets to the keeper.
                var p = PredictAtPlane(s, keeperFwd, 2f);
                line = frame.OffsetOff(p);
                KeeperActor.Look = p;
            }
            var home = KeeperActor.Home;
            var want = home + frame.Off * Mathf.Clamp(line - frame.OffsetOff(home), -1.2f, 1.2f);
            KeeperActor.Pos = Vector3.MoveTowards(KeeperActor.Pos, want, 3f * dt);
        }

        Vector3 PredictAtPlane(BallState s, float planeFwd, float maxTime)
        {
            var prev = s.Pos;
            for (int i = 0; i < maxTime / BallPhysics.Dt; i++)
            {
                BallPhysics.Step(ref s, Env, BallPhysics.Dt);
                float a = frame.OffsetFwd(prev), b = frame.OffsetFwd(s.Pos);
                if (a >= planeFwd && b < planeFwd) return Vector3.Lerp(prev, s.Pos, (a - planeFwd) / Mathf.Max(1e-5f, a - b));
                prev = s.Pos;
                if (s.Stopped) break;
            }
            return s.Pos;
        }

        /// <summary>Checks the ball against the batter's contact plane, the popping crease, the stumps and the keeper.</summary>
        void CheckDeliveryPlanes(Vector3 prev, Vector3 now)
        {
            float a = frame.OffsetFwd(prev), b = frame.OffsetFwd(now);

            // AI swing start (for the animation): when its press time comes.
            if (shotPending && shotPressAt < 0f) shotPressAt = Ball.Time;

            // 1) The bat: resolve when the ball reaches the plane for the chosen footwork.
            if (!shotResolved)
            {
                var feet = shotPending ? (pendingShot.Feet == Footwork.Auto ? (Charging ? Footwork.Charge : Shots.NaturalFeet(PitchedLength(), Deliveries.Get(plan.Type).IsSpin)) : pendingShot.Feet) : Footwork.Auto;
                float plane = frame.OffsetFwd(ContactPlanePoint(feet == Footwork.Auto ? (NaturalPlane() == 1 ? Footwork.Front : Footwork.Back) : feet));
                if (a >= plane && b < plane)
                {
                    var at = Vector3.Lerp(prev, now, (a - plane) / Mathf.Max(1e-5f, a - b));
                    ResolveAtBat(at);
                    if (hitBat) return;
                }
            }

            // 2) Popping crease: wides, beamers, bouncers above head height.
            float crease = Geo.CreaseDepth;
            if (a >= crease && b < crease && !hitBat)
            {
                var at = Vector3.Lerp(prev, now, (a - crease) / Mathf.Max(1e-5f, a - b));
                JudgeAtCrease(at);
            }

            // 3) The stumps.
            if (a >= 0f && b < 0f && !hitBat)
            {
                var at = Vector3.Lerp(prev, now, a / Mathf.Max(1e-5f, a - b));
                if (BallPhysics.HitsStumps(at, Inn.StrikerEnd))
                {
                    BreakStumps(Inn.StrikerEnd, at);
                    Ball.Vel *= 0.35f;
                    Ball.Vel.z *= -0.3f;
                    if (!wicketDecided)
                    {
                        wicketDecided = true;
                        Wicket(Dismissal.Bowled, true, -1);
                    }
                    QueueDead(1.2f);
                    SetPhase(Phase.BallLive);
                    return;
                }
            }

            // 4) The keeper.
            if (KeeperActor != null && !hitBat)
            {
                float k = frame.OffsetFwd(KeeperActor.Pos) + 0.3f;
                if (a >= k && b < k) KeeperGather(now);
            }
            if (b < -25f) StartLivePhase(); // got past everyone
        }

        void ResolveAtBat(Vector3 at)
        {
            shotResolved = true;
            var inn = Inn;
            var batter = BattingTeam.Players[batterId];
            float length = pitchedBeforeBatter ? frame.OffsetFwd(pitchedAt) : -1f;
            var ctx = new ContactContext
            {
                Frame = frame,
                BallPos = at,
                BallVel = Ball.Vel,
                Length = length,
                LateMovement = crossLate,
                Spin = Deliveries.Get(plan.Type).IsSpin,
                BatterSkill = batter.Bat01,
                BatterPower = Mathf.Clamp01(batter.Bat01 * 0.6f + (batter.Role == Role.Batter ? 0.3f : 0.1f)),
                Guard = Guard,
                Window = HumanBats ? DifficultyWindow : 1f,
            };
            var input = shotPending ? pendingShot : new ShotInput { Played = false };
            if (!shotPending && Striker.Pose == Pose.Stance) Striker.SetPose(Pose.Leave);
            var r = Shots.Resolve(input, ctx, rng);
            lastShot = r;
            outcome.Shot = r.Shot;
            LastShotNote = r.Note;
            LastTiming = r.Timing;
            LastTimingError = input.TimingError;
            if (r.Shot != ShotType.Leave) Striker.Variant = (byte)((int)r.Shot | ((int)r.Feet << 4));

            if (r.HitWicket)
            {
                BreakStumps(inn.StrikerEnd, Geo.Stumps(inn.StrikerEnd) + Vector3.up * 0.5f);
                wicketDecided = true;
                Wicket(Dismissal.HitWicket, true, -1);
                Say("Oh no! He's trodden on his stumps! Hit wicket.");
            }

            if (r.Contact == Contact.Middle || r.Contact == Contact.Edge)
            {
                hitBat = true;
                Ball.Pos = at;
                Ball.Vel = r.ExitVel;
                Ball.Spin = r.ExitSpin;
                Ball.SwingCoef = 0f;
                Ball.Bounces = 0;
                Ball.Pitched = false;
                Ball.Rolling = false;
                Ball.Stopped = false;
                bouncedSinceHit = false;
                Raise(new GameEvent { Type = r.Contact == Contact.Edge ? EvType.Edge : EvType.BatHit, F = r.Quality, I = (int)r.Timing, J = (int)r.Shot, P = at, Text = r.Note });
                if (r.PlayedOn)
                {
                    BreakStumps(inn.StrikerEnd, Geo.Stumps(inn.StrikerEnd) + Vector3.up * 0.3f);
                    if (!wicketDecided) { wicketDecided = true; Wicket(Dismissal.Bowled, true, -1); }
                    Say("Dragged on! The inside edge crashes into the stumps.");
                    QueueDead(1.2f);
                    SetPhase(Phase.BallLive);
                    return;
                }
                StartLivePhase();
                return;
            }

            if (r.Contact == Contact.Miss) Raise(GameEvent.Make(EvType.Beaten, text: r.Note));
            else Raise(GameEvent.Make(EvType.Leave));

            // No bat: pads or body?
            float u = frame.OffsetOff(at) - Guard;
            float legMin = -0.62f, legMax = -0.1f;
            var feetUsed = r.Feet;
            if (feetUsed == Footwork.Front) { legMin = -0.42f; legMax = 0.12f; } // front pad comes across
            if (r.Shot == ShotType.Leave || !input.Played) { legMin = -0.6f; legMax = -0.05f; }
            if (u > legMin && u < legMax && at.y < 1.55f)
            {
                touchedBody = true;
                bool pad = at.y < 0.85f;
                padImpact = pad;
                Raise(new GameEvent { Type = EvType.PadHit, P = at, I = pad ? 1 : 0 });
                // Deflect off the pad: it drops dead-ish in front of the batter.
                var vin = Ball.Vel;
                Ball.Pos = at;
                Ball.Vel = new Vector3(rng.Range(-1.5f, 1.5f), rng.Range(0f, 1.5f), 0f) + frame.Fwd * rng.Range(0.5f, 2.5f);
                Ball.Spin = Vector3.zero;
                Ball.SwingCoef = 0f;
                if (pad) Striker.SetPose(Pose.HitByBall);
                if (pad && !wicketDecided) ConsiderLbw(at, vin, input.Played && r.Shot != ShotType.Leave);
                else if (!pad) { Striker.SetPose(Pose.HitByBall); Say("Into the body. He'll feel that."); }
                StartLivePhase();
            }
        }

        void JudgeAtCrease(Vector3 at)
        {
            var inn = Inn;
            float height = at.y;
            // Full toss above the waist: no-ball (beamer).
            if (!pitchedBeforeBatter && height > 1.0f && !noBallCalled)
            {
                noBallCalled = beamer = true;
                Raise(GameEvent.Make(EvType.NoBall, text: "No ball! Above the waist."));
            }
            // Short ball: count bouncers (above the shoulder); too many is a no-ball, over the head is a wide.
            if (pitchedBeforeBatter && frame.OffsetFwd(pitchedAt) > 8f && height > 1.3f)
            {
                inn.BouncersThisOver++;
                if (inn.BouncersThisOver > State.ActiveRules.BouncersPerOver && !noBallCalled)
                {
                    noBallCalled = true;
                    Raise(GameEvent.Make(EvType.NoBall, text: "No ball! That's one bouncer too many this over."));
                }
            }
            if (!noBallCalled && !touchedBody && Umpiring.IsWide(frame, at, Guard, touchedBody))
            {
                wideCalled = true;
            }
        }

        void KeeperGather(Vector3 at)
        {
            if (KeeperActor == null || BallHolder != null) return;
            float lateral = Mathf.Abs(frame.OffsetOff(at) - frame.OffsetOff(KeeperActor.Pos));
            bool upToStumps = Vector3.Distance(KeeperActor.Home, frame.Origin) < 3f;
            float reach = upToStumps ? 1.0f : 1.7f;
            if (lateral < reach && at.y < 2.3f && rng.Chance(Mathf.Lerp(0.9f, 0.995f, KeeperActor.Skill) - lateral * 0.05f))
            {
                GiveBall(KeeperActor, at);
                KeeperActor.SetPose(Pose.KeeperTake);
                Raise(GameEvent.Make(EvType.Fielded, KeeperActor.Index));
                // Stumping: the batter is out of his ground with the keeper up to the stumps.
                if (upToStumps && !hitBat)
                {
                    if (StrikerOutOfGround() && !noBallCalled)
                    {
                        BreakStumps(Inn.StrikerEnd, Geo.Stumps(Inn.StrikerEnd) + Vector3.up * 0.6f);
                        if (!wicketDecided)
                        {
                            wicketDecided = true;
                            Wicket(Dismissal.Stumped, true, KeeperActor.Player);
                            Say("Stumped! Lightning-quick hands from the keeper.");
                        }
                        QueueDead(1.2f);
                        SetPhase(Phase.BallLive);
                        return;
                    }
                }
                QueueDead(0.9f);
                SetPhase(Phase.BallLive);
            }
            else
            {
                // Past the keeper: byes are on.
                KeeperActor.SetPose(Pose.Dive);
                StartLivePhase();
            }
        }

        bool StrikerOutOfGround()
        {
            float fwd = frame.OffsetFwd(Striker.Pos);
            if (Charging) return fwd > Geo.CreaseDepth - 0.2f;
            // A lunge that misses can overbalance him.
            bool lunged = lastShot.Feet == Footwork.Front && lastShot.Contact == Contact.Miss;
            return lunged && rng.Chance(0.3f);
        }

        void StartLivePhase()
        {
            if (Phase == Phase.BallLive) return;
            SetPhase(Phase.BallLive);
            BeginLive();
        }

        // ------------------------------------------------------------------ wickets and dead ball

        public void BreakStumps(int end, Vector3 at)
        {
            Raise(new GameEvent { Type = EvType.StumpsBroken, I = end, P = at });
        }

        void Wicket(Dismissal how, bool striker, int fielder)
        {
            outcome.Wicket = true;
            outcome.How = how;
            outcome.StrikerOut = striker;
            outcome.Fielder = fielder;
        }

        void QueueDead(float delay)
        {
            if (ballDeadQueued) return;
            ballDeadQueued = true;
            deadAt = PhaseTime + delay;
        }

        void GoDead()
        {
            outcome.Pitched = pitchedBeforeBatter ? pitchedAt : Vector3.zero;
            outcome.Kmh = LastKmh;
            outcome.Delivery = plan.Type;
            outcome.StrikerEnd = Inn.StrikerEnd;
            outcome.LeftHand = !strikerRight;
            if (outcome.End == Vector3.zero) outcome.End = Ball.Pos;
            if (noBallCalled) outcome.Extra = ExtraType.NoBall;
            else if (wideCalled && !hitBat) outcome.Extra = ExtraType.Wide;
            // Runs off the bat or extras.
            int ran = RunsCompleted();
            outcome.RunsRun = ran;
            if (!outcome.Four && !outcome.Six)
            {
                if (hitBat) outcome.RunsBat = ran;
                else if (outcome.Extra == ExtraType.Wide) outcome.ExtraRuns = ran;
                else if (outcome.Extra == ExtraType.NoBall) outcome.ExtraRuns = ran;
                else if (ran > 0) { outcome.Extra = touchedBody ? ExtraType.LegBye : ExtraType.Bye; outcome.ExtraRuns = ran; }
            }
            else if (!hitBat)
            {
                // A boundary off the pads or past the keeper: four leg-byes/byes (or wides).
                int b = outcome.Four ? 4 : 0;
                outcome.Four = false;
                if (outcome.Extra == ExtraType.Wide || outcome.Extra == ExtraType.NoBall) outcome.ExtraRuns = b;
                else { outcome.Extra = touchedBody ? ExtraType.LegBye : ExtraType.Bye; outcome.ExtraRuns = b; }
            }
            SetPhase(Phase.Dead);
            ChooseSignal();
            foreach (var a in Actors) if (a.Team >= 0 && a.Visible && a.Pose != Pose.Celebrate && a.Pose != Pose.Dejected && a.Pose != Pose.Appeal) a.Vel = Vector3.zero;
        }

        void ChooseSignal()
        {
            if (outcome.Wicket && !(Inn.FreeHit && outcome.How != Dismissal.RunOut)) Signal = UmpireSignal.Out;
            else if (outcome.Six) Signal = UmpireSignal.Six;
            else if (outcome.Four) Signal = UmpireSignal.Four;
            else if (outcome.Extra == ExtraType.Wide) Signal = UmpireSignal.Wide;
            else if (outcome.Extra == ExtraType.NoBall) Signal = UmpireSignal.NoBall;
            else if (outcome.Extra == ExtraType.Bye) Signal = UmpireSignal.Bye;
            else if (outcome.Extra == ExtraType.LegBye) Signal = UmpireSignal.LegBye;
            else Signal = UmpireSignal.None;
            if (Signal != UmpireSignal.None)
            {
                Actors[UmpireBowlerEnd].SetPose(Pose.UmpireSignal, (byte)Signal);
                Raise(GameEvent.Make(EvType.Signal, (int)Signal));
            }
        }

        bool committed;

        void UpdateDead(float dt)
        {
            if (PhaseTime < dt * 1.5f) committed = false;
            if (!committed && PhaseTime > 0.4f)
            {
                // Reviews can still change this decision; they run before we commit.
                if (OfferReview()) return;
                Commit();
            }
            float wait = outcome.Wicket || outcome.Six || outcome.Four ? 2.6f : 1.4f;
            if (committed && PhaseTime > wait) AfterBall();
        }

        void Commit()
        {
            committed = true;
            var inn = Inn;
            bool freeHit = inn.FreeHit;
            var bowlerName = FieldingTeam.Players[inn.Bowler].Surname();
            var batterName = BattingTeam.Players[batterId].Surname();
            int runsBefore = inn.Card(batterId)?.Runs ?? 0;
            State.Apply(outcome);
            var rec = inn.Log.Count > 0 ? inn.Log[inn.Log.Count - 1] : null;
            if (rec != null && rec.Wicket)
            {
                var card = inn.Card(rec.Striker == batterId && outcome.StrikerOut ? batterId : (outcome.StrikerOut ? batterId : rec.Striker));
                string text = Commentary.Wicket(this, outcome, batterName, bowlerName, rng);
                ShowBanner("OUT!", 2.4f);
                Raise(GameEvent.Make(EvType.Wicket, (int)outcome.How, outcome.StrikerOut ? batterId : -1, text: text));
                Say(text);
                Celebrate();
            }
            else if (outcome.Wicket && freeHit)
            {
                Say("He'd have been out, but it's a free hit!");
            }
            if (outcome.Six) { ShowBanner("SIX!", 2.2f); Raise(GameEvent.Make(EvType.Six)); Say(Commentary.Six(batterName, rng)); }
            else if (outcome.Four) { ShowBanner("FOUR!", 2f); Raise(GameEvent.Make(EvType.Four)); Say(Commentary.Four(batterName, lastShot, rng)); }
            else if (!outcome.Wicket)
            {
                int runs = outcome.RunsBat + outcome.ExtraRuns;
                if (outcome.Extra == ExtraType.Wide) { ShowBanner("WIDE", 1.4f); Raise(GameEvent.Make(EvType.Wide)); Say(Commentary.Wide(rng)); }
                else if (runs == 0) { Raise(GameEvent.Make(EvType.Dot)); Say(Commentary.Dot(this, lastShot, batterName, rng)); }
                else { Raise(GameEvent.Make(EvType.Runs, runs)); Say(Commentary.Runs(runs, outcome.Extra, batterName, rng)); }
            }
            int runsAfter = inn.Card(batterId)?.Runs ?? 0;
            if (runsBefore < 50 && runsAfter >= 50) { Say($"Fifty for {batterName}! Raises the bat to the dressing room."); Raise(GameEvent.Make(EvType.Milestone, 50, batterId)); }
            if (runsBefore < 100 && runsAfter >= 100) { Say($"A hundred for {batterName}! What an innings!"); Raise(GameEvent.Make(EvType.Milestone, 100, batterId)); }
            ReplayRecorder.Instance?.EndBall(outcome.Wicket && !freeHit || outcome.Six, outcome);
        }

        void Celebrate()
        {
            foreach (var a in Actors)
            {
                if (!a.Visible || a.Team < 0) continue;
                if (a.Team == 1 - Inn.BattingTeam) a.SetPose(rng.Chance(0.5f) ? Pose.Celebrate : Pose.Appeal);
            }
            Striker.SetPose(Pose.Dejected);
        }

        void AfterBall()
        {
            var inn = Inn;
            if (Phase != Phase.Replay && ReplayRecorder.Instance != null && ReplayRecorder.Instance.WantsReplay && !Online)
            {
                SetPhase(Phase.Replay);
                ReplayRecorder.Instance.Play();
                return;
            }
            if (Phase == Phase.Replay) ReplayRecorder.Instance?.Stop();
            BallVisible = false;
            if (inn.Complete) { EndInnings(); return; }
            if (inn.Bowler < 0)
            {
                Raise(GameEvent.Make(EvType.OverEnd, inn.Over));
                Say(Commentary.EndOfOver(State, rng));
                RecoverBowlers();
                SyncBatters();
                SetPhase(Phase.ChooseBowler);
                return;
            }
            StartDelivery();
        }

        void RecoverBowlers()
        {
            for (int i = 0; i < FielderCount; i++)
            {
                var a = Actors[FirstFielder + i];
                if (a.Player != Inn.LastOverBowler) a.Stamina = Mathf.Min(100f, a.Stamina + 8f);
            }
        }

        void EndInnings()
        {
            var inn = Inn;
            Raise(GameEvent.Make(EvType.InningsEnd, inn.BattingTeam, text: $"{BattingTeam.Name} {State.ScoreText(inn)} ({inn.OversText} ov)"));
            Say($"That's the end of the innings: {BattingTeam.Name} {State.ScoreText(inn)} from {inn.OversText} overs.");
            // A chase decides the match (or sends it to a super over).
            if (inn.Target > 0)
            {
                if (!State.NextInnings(out int batting, out bool superOver)) { EndMatch(); return; }
                ShowBanner("It's a tie! SUPER OVER", 3f);
                Say("Scores level! We're going to a super over!");
                pendingNext = (batting, superOver);
                hasPendingNext = true;
            }
            else hasPendingNext = false;
            SetPhase(Phase.InningsBreak);
        }

        (int, bool) pendingNext;
        bool hasPendingNext;

        void ContinueFromBreak()
        {
            if (Phase != Phase.InningsBreak) return;
            if (hasPendingNext)
            {
                hasPendingNext = false;
                BeginInnings(pendingNext.Item1, pendingNext.Item2);
                return;
            }
            var inn = Inn;
            BeginInnings(1 - inn.BattingTeam, inn.SuperOver);
        }

        // ------------------------------------------------------------------ commands

        public void Submit(Command c)
        {
            if (!IsAuthority) { Net.NetMatch.Instance?.Send(c); return; }
            bool batSide = Inn != null && c.Side == BattingSide;
            bool bowlSide = Inn != null && c.Side == FieldingSide;
            switch (c.Type)
            {
                case CmdType.TossCall:
                    if (Phase == Phase.Toss && TossCall < 0 && c.Side == (Online ? 1 : 0)) TossCall = Mathf.Clamp(c.I, 0, 1);
                    break;
                case CmdType.TossChoice:
                    if (Phase == Phase.Toss && TossResult >= 0 && TeamSide(State.TossWinner) == c.Side && State.Innings.Count == 0) ChooseToss(c.I == 0);
                    break;
                case CmdType.PickBowler:
                    if (Phase == Phase.ChooseBowler && bowlSide) PickBowler(c.I);
                    break;
                case CmdType.PickDelivery:
                    if (Phase == Phase.PreDelivery && bowlSide)
                    {
                        var types = Deliveries.For(FieldingTeam.Players[Inn.Bowler].Bowl);
                        var t = (DeliveryType)c.I;
                        if (Array.IndexOf(types, t) >= 0)
                        {
                            bool lengthDefault = Mathf.Abs(frame.OffsetFwd(Marker) - Deliveries.Get(SelectedDelivery).DefaultLength) < 0.3f;
                            SelectedDelivery = t;
                            if (lengthDefault || t == DeliveryType.Yorker || t == DeliveryType.Bouncer)
                                Marker = frame.Local(frame.OffsetOff(Marker), Deliveries.Get(t).DefaultLength);
                        }
                    }
                    break;
                case CmdType.SetTarget:
                    if ((Phase == Phase.PreDelivery || Phase == Phase.RunUp && !released) && bowlSide)
                    {
                        // Keep the marker on (or just off) the pitch, from a full toss to very short.
                        var p = new Vector3(c.A, 0f, c.B);
                        float off = Mathf.Clamp(frame.OffsetOff(p), -1.6f, 1.6f);
                        float len = Mathf.Clamp(frame.OffsetFwd(p), -0.3f, 14f);
                        Marker = frame.Local(off, len);
                        if (Phase == Phase.RunUp) plan.Target = Marker;
                    }
                    break;
                case CmdType.WicketSide:
                    if (Phase == Phase.PreDelivery && bowlSide) { AroundWicket = !AroundWicket; LayoutForDelivery(); }
                    break;
                case CmdType.FieldPreset:
                    if ((Phase == Phase.PreDelivery || Phase == Phase.ChooseBowler) && bowlSide && Inn.Bowler >= 0) { Preset = (FieldPreset)Mathf.Clamp(c.I, 0, 4); ApplyField(); LayoutForDelivery(); }
                    break;
                case CmdType.MoveFielder:
                    if (Phase == Phase.PreDelivery && bowlSide) MoveFielder(c.I, new Vector3(c.A, 0f, c.B));
                    break;
                case CmdType.StartRunUp:
                    if (Phase == Phase.PreDelivery && bowlSide) BeginRunUp();
                    break;
                case CmdType.Release:
                    // A remote guest reads the meter on his own screen and sends where the needle was.
                    if (bowlSide) PressRelease(c.Side == LocalSide || !Online ? MeterValue : c.A);
                    break;
                case CmdType.Guard:
                    if (Phase == Phase.PreDelivery && batSide)
                    {
                        Guard = Mathf.Clamp(Guard + c.A, -0.45f, 0.6f);
                        Striker.Pos = frame.Local(-0.42f + Guard, Geo.CreaseDepth - 0.1f);
                    }
                    break;
                case CmdType.Charge:
                    if ((Phase == Phase.PreDelivery || Phase == Phase.RunUp) && batSide && !released) Charging = true;
                    break;
                case CmdType.Aim:
                    if (batSide) { AimAngle = c.A; Striker.Aim = c.A; }
                    break;
                case CmdType.Shot:
                    if (batSide && (Phase == Phase.BallInFlight || Phase == Phase.RunUp))
                    {
                        var input = new ShotInput
                        {
                            Type = (ShotType)(c.I & 0xF),
                            Feet = (Footwork)((c.I >> 4) & 0x7),
                            Loft = (c.I & 0x80) != 0,
                            Aim = c.A,
                            Played = true,
                        };
                        // Remote guests time their shot against their own copy of the ball; locals are timed here.
                        input.TimingError = c.Side == LocalSide || !Online ? TimingErrorNow(input) : c.B;
                        SetShot(input, Ball.Time);
                    }
                    break;
                case CmdType.Run:
                    if (batSide) CallRun();
                    break;
                case CmdType.Back:
                    if (batSide) CallBack();
                    break;
                case CmdType.Slide:
                    if (batSide) SlideBat();
                    break;
                case CmdType.Review:
                    if (Phase == Phase.Dead || Phase == Phase.Review) RequestReview(c.Side);
                    break;
                case CmdType.Continue:
                    if (Phase == Phase.InningsBreak) ContinueFromBreak();
                    else if (Phase == Phase.Replay) AfterBall();
                    break;
                case CmdType.SkipReplay:
                    if (Phase == Phase.Replay) AfterBall();
                    break;
                case CmdType.FieldMove:
                case CmdType.FieldSwitch:
                case CmdType.FieldCatch:
                case CmdType.FieldThrow:
                    if (bowlSide) ManualFieldCommand(c);
                    break;
            }
        }

        // ------------------------------------------------------------------ idle actors

        void UpdateIdleActors(float dt)
        {
            // Umpire signals last a couple of seconds.
            var ump = Actors[UmpireBowlerEnd];
            if (ump.Pose == Pose.UmpireSignal && ump.PoseTime > 2.4f) ump.SetPose(Pose.UmpireIdle);
            if (Phase == Phase.PreDelivery)
            {
                // Batter taps the bat, fielders settle.
                if (Striker.Pose != Pose.Stance) Striker.SetPose(Pose.Stance);
            }
        }

        // ------------------------------------------------------------------ helpers for AI/HUD

        public Vector3 StumpsWorld(int end) => Geo.Stumps(end);
        public Rng Random => rng;
        public float BallSpeedKmh => Ball.Vel.magnitude * 3.6f;
        public int ReviewsLeft(int side) => Inn == null ? 0 : side == BattingSide ? Inn.BatReviews : Inn.BowlReviews;
        public bool CanReview(int side) => Phase == Phase.Dead && reviewWindowOpen && reviewSide == side && ReviewsLeft(side) > 0;
        public float ReviewCountdown => reviewWindowOpen ? Mathf.Max(0f, reviewDeadline - PhaseTime) : 0f;
        public bool RewardedReviewOffer => reviewWindowOpen && ReviewsLeft(reviewSide) == 0 && reviewSide == LocalSide && !Online;

        /// <summary>Adds one review for the given side (from a rewarded ad).</summary>
        public void GrantExtraReview(int side)
        {
            if (Inn == null) return;
            if (side == BattingSide) Inn.BatReviews++;
            else if (side == FieldingSide) Inn.BowlReviews++;
        }
    }
}
