using System.Collections.Generic;
using Cricket.Core;
using Cricket.Fx;
using Cricket.Game;
using Cricket.Sim;
using UnityEngine;

namespace Cricket.View
{
    /// <summary>
    /// Shows the match: one pooled character per person on the field, dressed in team kit, the ball with a faint
    /// trail, both sets of stumps with flying (LED) bails, the bowling marker and the batting aim arrow, ball tracking
    /// for reviews, plus crowd reactions and sounds for events. Reads the live state, a network mirror of it, or a
    /// replay, all through the same Actor data.
    /// </summary>
    public class MatchView : MonoBehaviour
    {
        public static MatchView Instance { get; private set; }

        [Header("Set by the editor")]
        public GameObject CricketerPrefab;
        public Material BallMaterial;
        public Material LineMaterial;
        public Material StumpMaterial;
        public Material BailMaterial;
        public Stadium Stadium;

        readonly Cricketer[] people = new Cricketer[MatchDirector.ActorCount];
        readonly string[] dressed = new string[MatchDirector.ActorCount];
        Transform ball;
        TrailRenderer trail;
        StumpSet[] stumps = new StumpSet[2];
        LineRenderer marker, aim, hawk, hawkProjection, controlRing;
        Transform pitchSpot;
        public Vector3 BallPosition => ball ? ball.position : Vector3.zero;
        public bool Built { get; private set; }

        void Awake() { Instance = this; }

        void Start()
        {
            var root = new GameObject("Field").transform;
            for (int i = 0; i < people.Length; i++)
            {
                if (!CricketerPrefab) break;
                var go = Instantiate(CricketerPrefab, root);
                go.name = i == 0 ? "Striker" : i == 1 ? "NonStriker" : i >= MatchDirector.UmpireBowlerEnd ? "Umpire" : $"Fielder{i - 1}";
                go.SetActive(false);
                people[i] = go.GetComponent<Cricketer>();
            }
            var b = GameObject.CreatePrimitive(PrimitiveType.Sphere);
            b.name = "Ball";
            Destroy(b.GetComponent<Collider>());
            b.transform.localScale = Vector3.one * (Geo.BallRadius * 2f);
            b.GetComponent<Renderer>().sharedMaterial = BallMaterial;
            ball = b.transform;
            trail = b.AddComponent<TrailRenderer>();
            trail.time = 0.12f;
            trail.startWidth = 0.05f;
            trail.endWidth = 0f;
            trail.sharedMaterial = LineMaterial;
            trail.startColor = new Color(1f, 1f, 1f, 0.5f);
            trail.endColor = new Color(1f, 1f, 1f, 0f);
            trail.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            b.SetActive(false);
            for (int end = 0; end < 2; end++) stumps[end] = new StumpSet(end, StumpMaterial, BailMaterial, root);
            // Ground for the bails to land on.
            var floor = new GameObject("BailFloor").AddComponent<BoxCollider>();
            floor.size = new Vector3(40f, 1f, 40f);
            floor.center = new Vector3(0f, -0.5f, 0f);
            floor.transform.SetParent(root, false);

            marker = Line("Marker", new Color(1f, 0.85f, 0.2f, 0.95f), 0.05f, 33, true);
            aim = Line("Aim", new Color(0.3f, 0.9f, 1f, 0.85f), 0.08f, 2, false);
            hawk = Line("Tracking", new Color(0.95f, 0.25f, 0.2f, 0.95f), Geo.BallRadius * 2f, 2, false);
            hawkProjection = Line("Projection", new Color(0.25f, 0.6f, 1f, 0.95f), Geo.BallRadius * 2f, 2, false);
            controlRing = Line("Controlled", new Color(0.4f, 1f, 0.5f, 0.9f), 0.06f, 25, true);
            var spot = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
            Destroy(spot.GetComponent<Collider>());
            spot.GetComponent<Renderer>().sharedMaterial = LineMaterial;
            spot.transform.localScale = new Vector3(0.12f, 0.002f, 0.12f);
            pitchSpot = spot.transform;
            spot.SetActive(false);

            var d = MatchDirector.Instance;
            if (d != null) d.OnEvent += OnEvent;
            Built = true;
        }

        void OnDestroy()
        {
            var d = MatchDirector.Instance;
            if (d != null) d.OnEvent -= OnEvent;
        }

        LineRenderer Line(string name, Color c, float width, int points, bool loop)
        {
            var go = new GameObject(name);
            go.transform.SetParent(transform, false);
            var lr = go.AddComponent<LineRenderer>();
            lr.sharedMaterial = LineMaterial;
            lr.startColor = lr.endColor = c;
            lr.startWidth = lr.endWidth = width;
            lr.positionCount = points;
            lr.loop = loop;
            lr.useWorldSpace = true;
            lr.numCapVertices = 2;
            lr.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            lr.receiveShadows = false;
            lr.enabled = false;
            return lr;
        }

        void LateUpdate()
        {
            var d = MatchDirector.Instance;
            if (d == null || !Built) return;
            var rec = ReplayRecorder.Instance;
            bool replay = rec != null && rec.Playing;
            var source = replay ? rec.Display : d.Actors;
            bool showField = d.Phase != Phase.Loading && d.Phase != Phase.Menu && d.Phase != Phase.Toss;
            for (int i = 0; i < people.Length; i++)
            {
                var p = people[i];
                if (!p) continue;
                var a = source[i];
                bool visible = showField && a.Visible;
                if (p.gameObject.activeSelf != visible) p.gameObject.SetActive(visible);
                if (!visible) continue;
                Dress(i, p, a, d);
                p.Apply(a);
            }

            // Ball
            var ballPos = replay ? rec.BallPos : d.Ball.Pos;
            bool ballVisible = showField && (replay ? rec.BallVisible : d.BallVisible) && !(d.BallHolder != null && !replay);
            if (ball.gameObject.activeSelf != ballVisible)
            {
                ball.gameObject.SetActive(ballVisible);
                trail.Clear();
            }
            if (ballVisible)
            {
                if ((ball.position - ballPos).sqrMagnitude > 25f) trail.Clear();
                ball.position = ballPos;
                var spin = d.Ball.Spin;
                if (spin.sqrMagnitude > 0.01f) ball.rotation = Quaternion.AngleAxis(spin.magnitude * Mathf.Rad2Deg * Time.deltaTime, spin.normalized) * ball.rotation;
                trail.emitting = d.Phase == Phase.BallInFlight || d.Phase == Phase.BallLive || replay;
            }

            UpdateMarkers(d);
            UpdateTracking(d);
        }

        void Dress(int i, Cricketer p, Actor a, MatchDirector d)
        {
            var teams = d.State.Setup.Teams;
            string key = $"{a.Team}/{a.Player}/{a.Kind}";
            if (dressed[i] == key && p.IsSetUp) return;
            dressed[i] = key;
            if (a.Team < 0 || teams == null || a.Team >= teams.Length || teams[a.Team] == null)
            {
                // Umpires: pale blue shirt, dark trousers, white hat.
                p.Dress(new Color(0.78f, 0.86f, 0.95f), new Color(0.15f, 0.16f, 0.2f), Color.white, i % 2, 0.1f, false, false, true);
                return;
            }
            var team = teams[a.Team];
            var player = a.Player >= 0 && a.Player < team.Players.Count ? team.Players[a.Player] : null;
            int tone = player != null ? player.SkinTone : 0;
            float tint = Mathf.Abs(TeamStore.Hash(player != null ? player.Name : "x") % 100) / 100f * 0.5f;
            bool batter = a.Kind == ActorKind.Striker || a.Kind == ActorKind.NonStriker;
            bool keeper = a.Kind == ActorKind.Keeper;
            p.Dress(team.PrimaryColor, team.TrousersColor, team.SecondaryColor, tone, tint, batter, keeper, false);
        }

        void UpdateMarkers(MatchDirector d)
        {
            // Bowling marker for the local bowler.
            bool showMarker = d.LocalBowls && (d.Phase == Phase.PreDelivery || d.Phase == Phase.RunUp && !d.BallReleased);
            marker.enabled = showMarker;
            if (showMarker)
            {
                var c = d.Marker + Vector3.up * 0.02f;
                float pulse = 0.22f + Mathf.Sin(Time.time * 6f) * 0.03f;
                for (int k = 0; k < marker.positionCount; k++)
                {
                    float t = k / (float)marker.positionCount * Mathf.PI * 2f;
                    marker.SetPosition(k, c + new Vector3(Mathf.Cos(t), 0f, Mathf.Sin(t)) * pulse);
                }
            }
            // Aim arrow for the local batter.
            bool showAim = d.LocalBats && (d.Phase == Phase.PreDelivery || d.Phase == Phase.RunUp || d.Phase == Phase.BallInFlight);
            aim.enabled = showAim && Settings.ShowAim;
            if (aim.enabled)
            {
                var from = d.Frame.Origin + d.Frame.Fwd * (Geo.CreaseDepth + 0.5f) + Vector3.up * 0.03f;
                aim.SetPosition(0, from);
                aim.SetPosition(1, from + d.Frame.Direction(d.AimAngle) * 7f);
            }
            // Manually controlled fielder.
            var ctrl = d.Controlled;
            controlRing.enabled = d.ManualFielding && ctrl != null && d.Phase == Phase.BallLive;
            if (controlRing.enabled)
            {
                for (int k = 0; k < controlRing.positionCount; k++)
                {
                    float t = k / (float)controlRing.positionCount * Mathf.PI * 2f;
                    controlRing.SetPosition(k, ctrl.Pos + new Vector3(Mathf.Cos(t), 0.03f, Mathf.Sin(t)) * 0.7f);
                }
            }
        }

        /// <summary>Ball tracking for a review: the delivery path drawn in red, the projection on from the pad in blue.</summary>
        void UpdateTracking(MatchDirector d)
        {
            var r = d.Review;
            bool on = d.Phase == Phase.Review && r.Active && r.Lbw && r.Path != null && r.Path.Length > 1;
            hawk.enabled = hawkProjection.enabled = on;
            pitchSpot.gameObject.SetActive(on && !r.Track.FullToss);
            if (!on) return;
            float reveal = Mathf.Clamp01(r.Time / 3.5f);
            int impact = Mathf.Clamp(r.ImpactIndex, 1, r.Path.Length - 1);
            int shown = Mathf.Max(2, Mathf.RoundToInt(impact * Mathf.Clamp01(reveal * 1.6f)));
            hawk.positionCount = shown;
            for (int k = 0; k < shown; k++) hawk.SetPosition(k, r.Path[k]);
            int proj = r.Path.Length - impact;
            float pr = Mathf.Clamp01((r.Time - 2.2f) / 2f);
            int shownProj = Mathf.Max(2, Mathf.RoundToInt(proj * pr));
            hawkProjection.enabled = pr > 0f && proj > 1;
            if (hawkProjection.enabled)
            {
                hawkProjection.positionCount = shownProj;
                for (int k = 0; k < shownProj; k++) hawkProjection.SetPosition(k, r.Path[Mathf.Min(r.Path.Length - 1, impact + k)]);
            }
            pitchSpot.position = r.Track.Pitched + Vector3.up * 0.01f;
        }

        void OnEvent(GameEvent e)
        {
            var d = MatchDirector.Instance;
            switch (e.Type)
            {
                case EvType.PhaseChange:
                    if ((Phase)e.I == Phase.PreDelivery) { stumps[0].Reset(); stumps[1].Reset(); }
                    break;
                case EvType.StumpsBroken:
                    stumps[Mathf.Clamp(e.I, 0, 1)].Break(e.P, d != null ? d.Ball.Vel : Vector3.zero, d != null && d.State.Setup.Time != TimeOfDay.Day);
                    Sfx.PlayAt(Sfx.Stumps, e.P, 1f);
                    break;
                case EvType.Four:
                    Stadium?.Cheer(0.7f);
                    Sfx.Crowd(0.8f);
                    break;
                case EvType.Six:
                    Stadium?.Cheer(1f);
                    Sfx.Crowd(1f);
                    break;
                case EvType.Wicket:
                    Stadium?.Cheer(0.9f);
                    Sfx.Crowd(0.9f);
                    break;
                case EvType.Milestone:
                    Stadium?.Cheer(0.8f);
                    Sfx.Applause(1f);
                    break;
                case EvType.BatHit:
                case EvType.Edge:
                    Sfx.PlayAt(e.Type == EvType.Edge ? Sfx.Edge : Sfx.BatHit, e.P, Mathf.Lerp(0.6f, 1f, e.F), Mathf.Lerp(0.95f, 1.08f, e.F));
                    break;
                case EvType.Bounce:
                    Sfx.PlayAt(Sfx.Bounce, e.P, Mathf.Clamp01(e.F / 30f));
                    break;
                case EvType.PadHit:
                    Sfx.PlayAt(Sfx.Pad, e.P, 0.9f);
                    break;
                case EvType.Appeal:
                    Sfx.Crowd(0.5f);
                    break;
                case EvType.Catch:
                case EvType.Fielded:
                    if (e.J == 0 && d != null) Sfx.PlayAt(Sfx.Catch, d.Ball.Pos, 0.7f);
                    break;
                case EvType.Release:
                    if (d != null) Sfx.PlayAt(Sfx.Whoosh, d.Ball.Pos, 0.3f);
                    break;
            }
        }

        /// <summary>One set of stumps with two bails that fly off (and light up under lights) when hit.</summary>
        class StumpSet
        {
            readonly Transform[] stumpT = new Transform[3];
            readonly Transform[] bails = new Transform[2];
            readonly Vector3[] bailHome = new Vector3[2];
            readonly Rigidbody[] bodies = new Rigidbody[2];
            readonly Renderer[] bailRenderers = new Renderer[2];
            readonly MaterialPropertyBlock mpb = new MaterialPropertyBlock();
            readonly int end;
            float flashUntil;

            public StumpSet(int end, Material stump, Material bail, Transform parent)
            {
                this.end = end;
                var root = new GameObject($"Stumps{end}").transform;
                root.SetParent(parent, false);
                root.position = Geo.Stumps(end);
                for (int i = 0; i < 3; i++)
                {
                    var s = GameObject.CreatePrimitive(PrimitiveType.Cylinder);
                    Object.Destroy(s.GetComponent<Collider>());
                    s.name = "Stump";
                    s.transform.SetParent(root, false);
                    s.transform.localScale = new Vector3(Geo.StumpRadius * 2f, Geo.StumpHeight * 0.5f, Geo.StumpRadius * 2f);
                    s.transform.localPosition = new Vector3((i - 1) * (Geo.StumpsHalfWidth - Geo.StumpRadius), Geo.StumpHeight * 0.5f, 0f);
                    s.GetComponent<Renderer>().sharedMaterial = stump;
                    stumpT[i] = s.transform;
                }
                for (int i = 0; i < 2; i++)
                {
                    var b = GameObject.CreatePrimitive(PrimitiveType.Capsule);
                    b.name = "Bail";
                    Object.Destroy(b.GetComponent<Collider>());
                    b.transform.SetParent(root, false);
                    b.transform.localScale = new Vector3(0.016f, 0.056f, 0.016f);
                    b.transform.localRotation = Quaternion.Euler(0, 0, 90f);
                    bailHome[i] = new Vector3((i == 0 ? -1 : 1) * Geo.StumpsHalfWidth * 0.5f, Geo.StumpHeight + 0.006f, 0f);
                    b.transform.localPosition = bailHome[i];
                    bailRenderers[i] = b.GetComponent<Renderer>();
                    bailRenderers[i].sharedMaterial = bail;
                    var col = b.AddComponent<BoxCollider>();
                    col.size = new Vector3(1f, 2f, 1f);
                    var rb = b.AddComponent<Rigidbody>();
                    rb.mass = 0.025f;
                    rb.isKinematic = true;
                    rb.interpolation = RigidbodyInterpolation.Interpolate;
                    bodies[i] = rb;
                    bails[i] = b.transform;
                }
            }

            public void Break(Vector3 at, Vector3 ballVel, bool led)
            {
                var push = new Vector3(ballVel.x, 0f, ballVel.z);
                if (push.sqrMagnitude < 1f) push = new Vector3(0f, 0f, -Geo.Inward(end)) * 6f;
                for (int i = 0; i < 2; i++)
                {
                    var rb = bodies[i];
                    if (!rb.isKinematic) continue;
                    rb.isKinematic = false;
                    rb.linearVelocity = push * Random.Range(0.25f, 0.45f) + Vector3.up * Random.Range(2.5f, 4.5f) + Random.insideUnitSphere * 0.8f;
                    rb.angularVelocity = Random.insideUnitSphere * 25f;
                }
                // Knock the stump(s) the ball hit back.
                for (int i = 0; i < 3; i++)
                {
                    float dx = Mathf.Abs(stumpT[i].position.x - at.x);
                    if (dx > 0.08f) continue;
                    var axis = Vector3.Cross(Vector3.up, push.normalized);
                    stumpT[i].localRotation = Quaternion.AngleAxis(Random.Range(12f, 30f), axis);
                    stumpT[i].localPosition += push.normalized * 0.12f;
                }
                if (led)
                {
                    flashUntil = Time.time + 3f;
                    mpb.SetColor("_Color", new Color(1f, 0.15f, 0.1f));
                    mpb.SetColor("_EmissionColor", new Color(1f, 0.1f, 0.05f) * 3f);
                    foreach (var r in bailRenderers) r.SetPropertyBlock(mpb);
                }
            }

            public void Reset()
            {
                for (int i = 0; i < 3; i++)
                {
                    stumpT[i].localRotation = Quaternion.identity;
                    stumpT[i].localPosition = new Vector3((i - 1) * (Geo.StumpsHalfWidth - Geo.StumpRadius), Geo.StumpHeight * 0.5f, 0f);
                }
                for (int i = 0; i < 2; i++)
                {
                    bodies[i].isKinematic = true;
                    bails[i].localPosition = bailHome[i];
                    bails[i].localRotation = Quaternion.Euler(0, 0, 90f);
                    bailRenderers[i].SetPropertyBlock(null);
                }
            }
        }
    }
}
