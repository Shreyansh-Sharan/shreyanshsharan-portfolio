using System;
using System.Collections.Generic;
using Cricket.Game;
using Cricket.Sim;
using UnityEngine;
using Pose = Cricket.Game.Pose;

namespace Cricket.View
{
    /// <summary>
    /// One character on the field. A legacy Animation plays the base clip for the pose (Quaternius idle, walk, jog,
    /// sprint, crouch, pick-up, throw, slide, celebrations...), then a procedural layer in LateUpdate poses the parts
    /// cricket needs: the batting stance and every stroke (bat path keyed per shot, hands IK'd to the handle, front-foot
    /// stride, head on the ball), the bowler's gather, windmill arm and delivery stride, the keeper's gloves, catches,
    /// dives and the umpire's signals. Props (bat, pads, gloves, helmet, cap) are simple meshes built here and attached
    /// to bones, so one shared character mesh serves all 30 people with only material colours changing.
    /// </summary>
    public class Cricketer : MonoBehaviour
    {
        [Header("Set by the editor setup")]
        public Animation Anim;
        public AnimationClip[] Clips = new AnimationClip[0];
        public string[] ClipKeys = new string[0];
        public SkinnedMeshRenderer[] Bodies = new SkinnedMeshRenderer[0];
        public int SkinSlot = 0, ShirtSlot = 1, TrousersSlot = 2, ShoesSlot = 3;
        public Material SkinLight, SkinDark;
        public Material Plain;      // white-ish lit material for pads, kit parts (tinted per renderer)
        public Material Wood;       // bat
        public Mesh BatMesh;

        // Bones
        Transform pelvis, spine1, spine2, spine3, neck, head, clavL, clavR, upL, upR, loL, loR, handL, handR, thighL, thighR, calfL, calfR, footL, footR, ballL, ballR, fingerL, fingerR;
        Transform model;
        Vector3 headFwd, chestFwd, pelvisFwd;   // bone-local "forward" captured at rest
        Transform bat, helmet, cap, padL, padR, gloveL, gloveR, kGloveL, kGloveR, ballInHand;
        readonly Dictionary<string, string> clipNames = new Dictionary<string, string>();
        string playing = "";
        MaterialPropertyBlock mpb;
        Actor actor;
        bool hasClips;
        float procTime;
        Renderer[] propRenderers = new Renderer[0];

        public Transform Bat => bat;
        public Transform HandR => handR;
        public Transform HandL => handL;
        public Transform Head => head;
        public bool IsSetUp { get; private set; }

        static readonly int ColorId = Shader.PropertyToID("_Color");

        void Awake()
        {
            model = Anim ? Anim.transform : transform;
            pelvis = Find("pelvis"); spine1 = Find("spine_01"); spine2 = Find("spine_02"); spine3 = Find("spine_03");
            neck = Find("neck_01"); head = Find("Head");
            clavL = Find("clavicle_l"); clavR = Find("clavicle_r");
            upL = Find("upperarm_l"); upR = Find("upperarm_r"); loL = Find("lowerarm_l"); loR = Find("lowerarm_r");
            handL = Find("hand_l"); handR = Find("hand_r");
            thighL = Find("thigh_l"); thighR = Find("thigh_r"); calfL = Find("calf_l"); calfR = Find("calf_r");
            footL = Find("foot_l"); footR = Find("foot_r"); ballL = Find("ball_l"); ballR = Find("ball_r");
            fingerL = Find("middle_01_l"); fingerR = Find("middle_01_r");
            var fwd = transform.forward;
            if (head) headFwd = Quaternion.Inverse(head.rotation) * fwd;
            if (spine3) chestFwd = Quaternion.Inverse(spine3.rotation) * fwd;
            if (pelvis) pelvisFwd = Quaternion.Inverse(pelvis.rotation) * fwd;

            if (Anim)
            {
                Anim.playAutomatically = false;
                Anim.cullingType = AnimationCullingType.AlwaysAnimate;
                for (int i = 0; i < Clips.Length && i < ClipKeys.Length; i++)
                {
                    var c = Clips[i];
                    if (!c || !c.legacy) continue;
                    if (!Anim.GetClip(ClipKeys[i])) Anim.AddClip(c, ClipKeys[i]);
                    clipNames[ClipKeys[i]] = ClipKeys[i];
                    var st = Anim[ClipKeys[i]];
                    bool loop = ClipKeys[i] is "idle" or "walk" or "jog" or "sprint" or "crouch" or "slide" or "fold" or "dance" or "talk" or "no" or "jumploop";
                    st.wrapMode = loop ? WrapMode.Loop : WrapMode.ClampForever;
                }
                hasClips = clipNames.ContainsKey("idle");
            }
            mpb = new MaterialPropertyBlock();
            BuildProps();
        }

        Transform Find(string name)
        {
            foreach (var t in GetComponentsInChildren<Transform>(true)) if (t.name == name) return t;
            return null;
        }

        // ------------------------------------------------------------------ props

        Transform Prop(string name, PrimitiveType type, Transform parent, Vector3 worldPos, Quaternion worldRot, Vector3 scale, Material mat)
        {
            var go = GameObject.CreatePrimitive(type);
            go.name = name;
            Destroy(go.GetComponent<Collider>());
            go.transform.SetPositionAndRotation(worldPos, worldRot);
            go.transform.localScale = scale;
            go.transform.SetParent(parent ? parent : transform, true);
            var r = go.GetComponent<MeshRenderer>();
            r.sharedMaterial = mat;
            r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            return go.transform;
        }

        void BuildProps()
        {
            var fwd = transform.forward;
            var up = Vector3.up;
            var mat = Plain;
            var props = new List<Renderer>();
            // Pads: along the shin, in front of it.
            if (calfL && footL)
            {
                padL = Pad(calfL, footL, fwd, mat);
                padR = Pad(calfR, footR, fwd, mat);
                props.Add(padL.GetComponent<Renderer>()); props.Add(padR.GetComponent<Renderer>());
            }
            if (head)
            {
                var hp = head.position + up * 0.09f + fwd * 0.01f;
                helmet = new GameObject("Helmet").transform;
                helmet.SetParent(head, false);
                helmet.position = hp;
                helmet.rotation = Quaternion.LookRotation(fwd, up);
                var shell = Prop("Shell", PrimitiveType.Sphere, helmet, hp + up * 0.02f, helmet.rotation, new Vector3(0.25f, 0.23f, 0.27f), mat);
                var peak = Prop("Peak", PrimitiveType.Cube, helmet, hp + fwd * 0.13f + up * 0.06f, helmet.rotation * Quaternion.Euler(-12f, 0, 0), new Vector3(0.2f, 0.015f, 0.08f), mat);
                var grille = Prop("Grille", PrimitiveType.Cube, helmet, hp + fwd * 0.15f - up * 0.04f, helmet.rotation, new Vector3(0.17f, 0.12f, 0.012f), mat);
                props.Add(shell.GetComponent<Renderer>()); props.Add(peak.GetComponent<Renderer>()); props.Add(grille.GetComponent<Renderer>());
                cap = new GameObject("Cap").transform;
                cap.SetParent(head, false);
                cap.position = hp;
                cap.rotation = helmet.rotation;
                var dome = Prop("Dome", PrimitiveType.Sphere, cap, hp + up * 0.035f, cap.rotation, new Vector3(0.21f, 0.13f, 0.23f), mat);
                var brim = Prop("Brim", PrimitiveType.Cube, cap, hp + fwd * 0.12f + up * 0.03f, cap.rotation * Quaternion.Euler(-8f, 0, 0), new Vector3(0.17f, 0.012f, 0.1f), mat);
                props.Add(dome.GetComponent<Renderer>()); props.Add(brim.GetComponent<Renderer>());
            }
            if (handL && handR)
            {
                gloveL = Prop("GloveL", PrimitiveType.Cube, handL, handL.position + (FingerDir(handL, fingerL) * 0.06f), Quaternion.LookRotation(FingerDir(handL, fingerL), up), new Vector3(0.09f, 0.06f, 0.13f), mat);
                gloveR = Prop("GloveR", PrimitiveType.Cube, handR, handR.position + (FingerDir(handR, fingerR) * 0.06f), Quaternion.LookRotation(FingerDir(handR, fingerR), up), new Vector3(0.09f, 0.06f, 0.13f), mat);
                kGloveL = Prop("KeeperGloveL", PrimitiveType.Cube, handL, handL.position + (FingerDir(handL, fingerL) * 0.07f), Quaternion.LookRotation(FingerDir(handL, fingerL), up), new Vector3(0.13f, 0.07f, 0.17f), mat);
                kGloveR = Prop("KeeperGloveR", PrimitiveType.Cube, handR, handR.position + (FingerDir(handR, fingerR) * 0.07f), Quaternion.LookRotation(FingerDir(handR, fingerR), up), new Vector3(0.13f, 0.07f, 0.17f), mat);
                props.Add(gloveL.GetComponent<Renderer>()); props.Add(gloveR.GetComponent<Renderer>());
                props.Add(kGloveL.GetComponent<Renderer>()); props.Add(kGloveR.GetComponent<Renderer>());
                ballInHand = Prop("HeldBall", PrimitiveType.Sphere, handR, handR.position + FingerDir(handR, fingerR) * 0.07f, Quaternion.identity, Vector3.one * 0.072f, mat);
                props.Add(ballInHand.GetComponent<Renderer>());
            }
            // The bat: origin at the grip, +Y down the blade to the toe, +Z out of the face.
            var batGo = new GameObject("Bat");
            batGo.transform.SetParent(transform, false);
            var mf = batGo.AddComponent<MeshFilter>();
            mf.sharedMesh = BatMesh ? BatMesh : MeshKit.Bat();
            var br = batGo.AddComponent<MeshRenderer>();
            br.sharedMaterial = Wood ? Wood : mat;
            br.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
            bat = batGo.transform;
            propRenderers = props.ToArray();
        }

        static Vector3 FingerDir(Transform hand, Transform finger)
        {
            if (!finger) return hand.up;
            var d = finger.position - hand.position;
            return d.sqrMagnitude > 1e-6f ? d.normalized : hand.up;
        }

        Transform Pad(Transform calf, Transform foot, Vector3 fwd, Material mat)
        {
            var shin = foot.position - calf.position;
            float len = shin.magnitude;
            var mid = calf.position + shin * 0.48f + fwd * 0.06f;
            var rot = Quaternion.LookRotation(fwd, -shin.normalized);
            return Prop("Pad", PrimitiveType.Cube, calf, mid, rot, new Vector3(0.15f, len * 1.08f, 0.09f), mat);
        }

        /// <summary>Kit colours, skin and which props show for this person's role.</summary>
        public void Dress(Color shirt, Color trousers, Color accent, int skinTone, float skinTint, bool batterKit, bool keeperKit, bool umpire)
        {
            foreach (var r in Bodies)
            {
                if (!r) continue;
                var mats = r.sharedMaterials;
                if (SkinSlot < mats.Length && SkinLight && SkinDark) { mats[SkinSlot] = skinTone == 0 ? SkinLight : SkinDark; r.sharedMaterials = mats; }
                SetSlot(r, ShirtSlot, shirt);
                SetSlot(r, TrousersSlot, trousers);
                SetSlot(r, ShoesSlot, umpire ? new Color(0.1f, 0.1f, 0.1f) : new Color(0.96f, 0.96f, 0.96f));
                SetSlot(r, SkinSlot, Color.Lerp(Color.white, new Color(0.78f, 0.66f, 0.58f), skinTint));
            }
            Color white = new Color(0.95f, 0.95f, 0.93f);
            Tint(padL, keeperKit ? white : white);
            Tint(padR, white);
            if (helmet) foreach (var r in helmet.GetComponentsInChildren<Renderer>()) Tint(r.transform, r.name == "Grille" ? new Color(0.25f, 0.25f, 0.27f) : accent);
            if (cap) foreach (var r in cap.GetComponentsInChildren<Renderer>()) Tint(r.transform, umpire ? new Color(0.93f, 0.93f, 0.9f) : shirt * 0.85f);
            Tint(gloveL, white); Tint(gloveR, white);
            Tint(kGloveL, accent); Tint(kGloveR, accent);
            Tint(ballInHand, new Color(0.95f, 0.95f, 0.92f));

            if (padL) padL.gameObject.SetActive(batterKit || keeperKit);
            if (padR) padR.gameObject.SetActive(batterKit || keeperKit);
            if (helmet) helmet.gameObject.SetActive(batterKit);
            if (cap) cap.gameObject.SetActive(!batterKit);
            if (gloveL) gloveL.gameObject.SetActive(batterKit);
            if (gloveR) gloveR.gameObject.SetActive(batterKit);
            if (kGloveL) kGloveL.gameObject.SetActive(keeperKit);
            if (kGloveR) kGloveR.gameObject.SetActive(keeperKit);
            if (bat) bat.gameObject.SetActive(batterKit);
            IsSetUp = true;
        }

        void SetSlot(Renderer r, int slot, Color c)
        {
            if (slot < 0 || slot >= r.sharedMaterials.Length) return;
            mpb.Clear();
            mpb.SetColor(ColorId, c);
            r.SetPropertyBlock(mpb, slot);
        }

        void Tint(Transform t, Color c)
        {
            if (!t) return;
            var r = t.GetComponent<Renderer>();
            if (!r) return;
            mpb.Clear();
            mpb.SetColor(ColorId, c);
            r.SetPropertyBlock(mpb);
        }

        public void ShowBat(bool on) { if (bat && bat.gameObject.activeSelf != on) bat.gameObject.SetActive(on); }

        // ------------------------------------------------------------------ base clip

        void Play(string key, float fade = 0.18f, float speed = 1f, bool restart = false)
        {
            if (!hasClips) return;
            if (!clipNames.ContainsKey(key)) key = "idle";
            var st = Anim[key];
            if (st != null) st.speed = speed;
            if (playing == key && !restart) return;
            playing = key;
            if (restart && st != null) st.time = 0f;
            Anim.CrossFade(key, fade);
        }

        /// <summary>Called every frame with the person's state (live, from the network or from a replay).</summary>
        public void Apply(Actor a)
        {
            actor = a;
            var target = new Vector3(a.Pos.x, 0f, a.Pos.z);
            transform.SetPositionAndRotation(target, Quaternion.Euler(0f, a.Yaw, 0f));
            if (ballInHand) ballInHand.gameObject.SetActive(a.HasBall && a.Pose != Pose.Throw || a.HasBall && a.PoseTime < 0.35f);
            float speed = a.Speed;
            switch (a.Pose)
            {
                case Pose.Idle:
                case Pose.Walk:
                case Pose.Run:
                case Pose.FollowThrough:
                case Pose.Ready:
                case Pose.Catch:
                    Locomote(speed, a.Pose == Pose.Ready);
                    break;
                case Pose.RunUp:
                    Locomote(Mathf.Max(speed, 2.5f), false);
                    break;
                case Pose.Deliver:
                    Play(Deliveries.IsSpinStyle((BowlStyle)a.Variant) ? "jog" : "sprint", 0.12f, 0.8f);
                    break;
                case Pose.Stance:
                case Pose.Shot:
                case Pose.Leave:
                    Play("idle", 0.2f);
                    break;
                case Pose.KeeperCrouch:
                case Pose.KeeperTake:
                    if (speed > 1.5f) Locomote(speed, false); else Play("crouch", 0.2f);
                    break;
                case Pose.Dive:
                    Play("jumploop", 0.08f);
                    break;
                case Pose.Slide:
                case Pose.BatSlide:
                    Play("slide", 0.1f);
                    break;
                case Pose.Pickup:
                    Play("pickup", 0.1f, 1.6f, true);
                    break;
                case Pose.Throw:
                    Play("throw", 0.08f, 1.25f, true);
                    break;
                case Pose.GetUp:
                    Play("getup", 0.15f, 1.3f, true);
                    break;
                case Pose.Celebrate:
                    Play(a.Kind == ActorKind.Striker || a.Kind == ActorKind.NonStriker ? "yes" : (a.Index % 2 == 0 ? "dance" : "yes"), 0.2f);
                    break;
                case Pose.Appeal:
                    Play("yes", 0.15f);
                    break;
                case Pose.Dejected:
                    Play("no", 0.3f);
                    break;
                case Pose.UmpireIdle:
                    Play("fold", 0.3f);
                    break;
                case Pose.UmpireSignal:
                    Play("idle", 0.2f);
                    break;
                case Pose.HitByBall:
                    Play("hit", 0.08f, 1f, true);
                    break;
                default:
                    Play("idle");
                    break;
            }
        }

        void Locomote(float speed, bool ready)
        {
            if (speed < 0.35f) { Play("idle"); return; }
            if (speed < 2.2f) { Play("walk", 0.2f, Mathf.Clamp(speed / 1.5f, 0.6f, 1.5f)); return; }
            if (speed < 5f) { Play("jog", 0.2f, Mathf.Clamp(speed / 3.6f, 0.7f, 1.4f)); return; }
            Play("sprint", 0.2f, Mathf.Clamp(speed / 7f, 0.75f, 1.35f));
        }

        // ------------------------------------------------------------------ procedural layer

        void LateUpdate()
        {
            if (actor == null || !pelvis) return;
            var a = actor;
            if (!hasClips) ProceduralGait(a);
            switch (a.Pose)
            {
                case Pose.Stance: Batting(a, false); break;
                case Pose.Shot: Batting(a, true); break;
                case Pose.Leave: Batting(a, true); break;
                case Pose.RunUp:
                case Pose.Deliver:
                case Pose.FollowThrough:
                    if (a.Kind == ActorKind.Bowler) Bowling(a);
                    break;
                case Pose.KeeperCrouch:
                case Pose.KeeperTake:
                    Keeping(a);
                    break;
                case Pose.Catch:
                case Pose.Ready:
                    Catching(a);
                    break;
                case Pose.Dive:
                    Diving(a);
                    break;
                case Pose.Appeal:
                    ArmsUp(0.9f);
                    break;
                case Pose.UmpireSignal:
                    UmpireSignalPose((UmpireSignal)a.Variant, a.PoseTime);
                    break;
                case Pose.Celebrate:
                    if (a.Kind == ActorKind.Striker || a.Kind == ActorKind.NonStriker) RaiseBat();
                    break;
            }
            // Batters carry the bat everywhere else.
            if (bat && bat.gameObject.activeSelf && a.Pose != Pose.Stance && a.Pose != Pose.Shot && a.Pose != Pose.Leave && a.Pose != Pose.Celebrate) CarryBat(a);
        }

        Vector3 Fwd => transform.forward;
        Vector3 Right => transform.right;
        Vector3 Root => transform.position;

        /// <summary>Simple run cycle for the fallback mannequin (no clips).</summary>
        void ProceduralGait(Actor a)
        {
            float speed = a.Speed;
            procTime += Time.deltaTime * Mathf.Lerp(3f, 11f, Mathf.Clamp01(speed / 8f));
            float amp = Mathf.Clamp01(speed / 7f) * 40f;
            float s = Mathf.Sin(procTime);
            var down = -Vector3.up;
            Ik.Aim(thighL, calfL, Quaternion.AngleAxis(amp * s, Right) * down);
            Ik.Aim(thighR, calfR, Quaternion.AngleAxis(-amp * s, Right) * down);
            Ik.Aim(calfL, footL, Quaternion.AngleAxis(amp * Mathf.Max(0f, s) - amp * 0.6f, Right) * down);
            Ik.Aim(calfR, footR, Quaternion.AngleAxis(-amp * Mathf.Min(0f, s) - amp * 0.6f, Right) * down);
            Ik.Aim(upL, loL, Quaternion.AngleAxis(-amp * s * 0.8f, Right) * down + Right * -0.15f);
            Ik.Aim(upR, loR, Quaternion.AngleAxis(amp * s * 0.8f, Right) * down + Right * 0.15f);
        }

        // ---- batting

        struct BatKey { public Vector3 Hands, Tip; }

        /// <summary>
        /// Bat path in the batter's frame: x towards the bowler (b), y up, z towards the off side (the way he faces).
        /// Keys: stance, top of the backlift, contact, follow-through. Directions rotate with the aim.
        /// </summary>
        void ShotKeys(ShotType shot, Footwork feet, float aimDeg, bool hold, out BatKey[] keys, out float[] times, float lead)
        {
            var st = new BatKey { Hands = new Vector3(0.02f, 0.92f, 0.3f), Tip = new Vector3(0.1f, 0.06f, 0.44f) };
            var lift = new BatKey { Hands = new Vector3(-0.22f, 1.3f, 0.22f), Tip = new Vector3(-0.55f, 1.85f, 0.06f) };
            float ar = aimDeg * Mathf.Deg2Rad;
            // Aim direction in (b, z) plane: 0 = straight back past the bowler, +90 off side, -90 leg side.
            var aim = new Vector3(Mathf.Cos(ar), 0f, Mathf.Sin(ar));
            BatKey contact, follow;
            switch (shot)
            {
                case ShotType.Defend:
                    contact = new BatKey { Hands = new Vector3(0.42f, 0.86f, 0.3f), Tip = new Vector3(0.52f, 0.08f, 0.33f) };
                    follow = contact;
                    lift = new BatKey { Hands = new Vector3(-0.05f, 1.1f, 0.26f), Tip = new Vector3(-0.2f, 1.3f, 0.2f) };
                    break;
                case ShotType.Leave:
                    contact = new BatKey { Hands = new Vector3(-0.08f, 1.55f, 0.22f), Tip = new Vector3(-0.3f, 2.1f, 0.1f) };
                    follow = contact;
                    break;
                case ShotType.Cut:
                    lift = new BatKey { Hands = new Vector3(-0.1f, 1.45f, 0.3f), Tip = new Vector3(-0.2f, 1.95f, 0.55f) };
                    contact = new BatKey { Hands = new Vector3(0.12f, 1.0f, 0.42f), Tip = new Vector3(0.12f, 0.82f, 1.18f) };
                    follow = new BatKey { Hands = new Vector3(-0.05f, 1.15f, 0.3f), Tip = new Vector3(-0.65f, 1.45f, 0.45f) };
                    break;
                case ShotType.Pull:
                    lift = new BatKey { Hands = new Vector3(-0.15f, 1.45f, 0.25f), Tip = new Vector3(-0.3f, 2.0f, 0.4f) };
                    contact = new BatKey { Hands = new Vector3(0.22f, 1.15f, 0.25f), Tip = new Vector3(0.85f, 1.2f, 0.1f) };
                    follow = new BatKey { Hands = new Vector3(0.0f, 1.25f, -0.2f), Tip = new Vector3(-0.45f, 1.45f, -0.55f) };
                    break;
                case ShotType.Sweep:
                    lift = new BatKey { Hands = new Vector3(0.1f, 1.0f, 0.3f), Tip = new Vector3(0.0f, 1.4f, 0.6f) };
                    contact = new BatKey { Hands = new Vector3(0.55f, 0.48f, 0.28f), Tip = new Vector3(0.95f, 0.15f, -0.25f) };
                    follow = new BatKey { Hands = new Vector3(0.25f, 0.55f, -0.15f), Tip = new Vector3(-0.2f, 0.7f, -0.75f) };
                    break;
                case ShotType.Flick:
                    contact = new BatKey { Hands = new Vector3(0.45f, 0.82f, 0.22f), Tip = new Vector3(0.62f, 0.1f, 0.05f) };
                    follow = new BatKey { Hands = new Vector3(0.3f, 1.05f, -0.15f), Tip = new Vector3(0.1f, 1.3f, -0.8f) };
                    break;
                default: // drive
                    contact = new BatKey { Hands = new Vector3(0.62f, 0.78f, 0.36f), Tip = new Vector3(0.82f, 0.05f, 0.4f) };
                    follow = new BatKey { Hands = new Vector3(0.55f, 1.55f, 0.12f), Tip = new Vector3(0.25f, 1.85f, -0.5f) };
                    if (feet == Footwork.Back) { contact.Hands.x -= 0.4f; contact.Tip.x -= 0.4f; }
                    break;
            }
            // Rotate contact and follow-through about the vertical so the face points along the aim.
            if (shot == ShotType.Drive || shot == ShotType.Defend || shot == ShotType.Flick)
            {
                float yaw = shot == ShotType.Flick ? Mathf.Min(0f, aimDeg + 30f) : aimDeg * 0.55f;
                var q = Quaternion.AngleAxis(-yaw, Vector3.up);
                contact.Tip = contact.Hands + q * (contact.Tip - contact.Hands);
                follow.Hands = q * follow.Hands;
                follow.Tip = q * follow.Tip;
            }
            if (hold) follow = contact;
            keys = new[] { st, lift, contact, follow };
            times = new[] { 0f, lead * 0.5f, lead, lead + 0.32f };
        }

        void Batting(Actor a, bool swinging)
        {
            bool right = !a.LeftHanded;
            float s = right ? -1f : 1f;                  // towards the bowler in local x
            var b = Right * s;                           // world: towards the bowler
            var off = Fwd;                               // world: towards the off side (he faces it)
            var up = Vector3.up;
            Vector3 L(Vector3 v) => Root + b * v.x + up * v.y + off * v.z;

            ShotType shot = ShotType.Drive;
            Footwork feet = Footwork.Auto;
            float lead = 0.2f;
            if (swinging)
            {
                shot = a.Pose == Pose.Leave ? ShotType.Leave : (ShotType)(a.Variant & 0xF);
                feet = (Footwork)((a.Variant >> 4) & 0x7);
                if (shot == ShotType.Auto) shot = ShotType.Drive;
                lead = shot == ShotType.Leave ? 0.15f : Shots.Get(shot).Lead;
            }

            // Crouch and feet.
            float t = a.PoseTime;
            float crouch = 0.06f;
            float stride = 0f, back = 0f;
            if (swinging && shot != ShotType.Leave)
            {
                float w = Mathf.Clamp01(t / (lead * 0.9f));
                if (feet == Footwork.Front || shot == ShotType.Sweep || shot == ShotType.Drive && feet != Footwork.Back) stride = Ik.Smooth(w) * (shot == ShotType.Sweep ? 0.65f : 0.55f);
                if (feet == Footwork.Back || shot == ShotType.Cut || shot == ShotType.Pull) back = Ik.Smooth(w) * 0.22f;
                if (shot == ShotType.Sweep) crouch = Mathf.Lerp(0.06f, 0.42f, Ik.Smooth(w));
            }
            pelvis.position += -up * crouch + b * (stride * 0.45f - back * 0.5f);
            var frontFoot = right ? footL : footR;
            var backFoot = right ? footR : footL;
            var frontThigh = right ? thighL : thighR; var frontCalf = right ? calfL : calfR;
            var backThigh = right ? thighR : thighL; var backCalf = right ? calfR : calfL;
            var frontTarget = L(new Vector3(0.28f + stride, 0.08f, -0.02f));
            var backTarget = L(new Vector3(-0.22f - back, 0.08f, back * 0.35f));
            if (shot == ShotType.Sweep && swinging) backTarget = L(new Vector3(-0.25f, 0.12f + 0f, -0.1f) ) - up * 0.0f;
            Ik.TwoBone(frontThigh, frontCalf, frontFoot, frontTarget, frontThigh.position + off * 0.8f + b * 0.3f);
            Ik.TwoBone(backThigh, backCalf, backFoot, backTarget + (shot == ShotType.Sweep && swinging ? up * -0.02f : Vector3.zero), backThigh.position + off * 0.8f + (shot == ShotType.Sweep && swinging ? -up * 0.6f : Vector3.zero));

            // Upper body turns towards the shot after contact; head stays over the ball, eyes to the bowler.
            if (swinging && t > lead * 0.8f && shot != ShotType.Leave && shot != ShotType.Defend)
            {
                float turn = Mathf.Clamp01((t - lead * 0.8f) / 0.25f) * Mathf.Clamp(-a.Aim * 0.35f, -45f, 45f) * -s;
                Ik.Turn(spine2, up, turn * 0.5f);
                Ik.Turn(spine3, up, turn * 0.5f);
            }
            if (head)
            {
                var look = a.Look.sqrMagnitude > 0.01f && swinging ? a.Look : Root + b * 18f + up * 1.2f;
                Ik.Face(head, headFwd, (look - head.position).normalized, 0.85f);
            }

            // Bat and hands.
            ShotKeys(shot, feet, a.Aim * (right ? 1f : 1f), shot == ShotType.Defend || shot == ShotType.Leave, out var keys, out var times, lead);
            var handsV = new Vector3[keys.Length];
            var tipV = new Vector3[keys.Length];
            for (int i = 0; i < keys.Length; i++) { handsV[i] = keys[i].Hands; tipV[i] = keys[i].Tip; }
            Vector3 handsL, tipL;
            if (!swinging)
            {
                // Tap the bat in the stance.
                float tap = Mathf.Max(0f, Mathf.Sin(Time.time * 3.1f)) * 0.05f;
                handsL = keys[0].Hands + new Vector3(0, tap, 0);
                tipL = keys[0].Tip + new Vector3(0, tap * 2f, 0);
                // Backlift begins as the bowler releases.
                if (a.Variant == 1) { handsL = Vector3.Lerp(handsL, keys[1].Hands, 0.4f); tipL = Vector3.Lerp(tipL, keys[1].Tip, 0.4f); }
            }
            else
            {
                handsL = Ik.Keys(t, times, handsV);
                tipL = Ik.Keys(t, times, tipV);
            }
            var hands = L(handsL);
            var tip = L(tipL);
            // Pull the sweet spot onto the real contact point around the moment of contact.
            if (swinging && a.Look.sqrMagnitude > 0.01f && shot != ShotType.Leave)
            {
                float w = Mathf.Exp(-Mathf.Pow((t - lead) / 0.09f, 2f));
                var sweet = Vector3.Lerp(hands, tip, 0.72f);
                var corr = Vector3.ClampMagnitude(a.Look - sweet, 0.45f) * w;
                hands += corr * 0.7f;
                tip += corr;
            }
            PlaceBat(hands, tip, swinging && shot != ShotType.Defend ? Vector3.Cross(tip - hands, up).normalized * -s : off);
            HandsOnBat(right);
        }

        void PlaceBat(Vector3 grip, Vector3 tip, Vector3 face)
        {
            if (!bat) return;
            var along = tip - grip;
            if (along.sqrMagnitude < 1e-4f) along = -Vector3.up;
            along.Normalize();
            var f = Vector3.ProjectOnPlane(face.sqrMagnitude > 1e-4f ? face : Fwd, along);
            if (f.sqrMagnitude < 1e-4f) f = Vector3.ProjectOnPlane(Fwd, along);
            bat.SetPositionAndRotation(grip, Quaternion.LookRotation(f.normalized, along));
        }

        void HandsOnBat(bool right)
        {
            if (!bat) return;
            var along = bat.up;
            var top = bat.position;
            var low = bat.position + along * 0.1f;
            var topHand = right ? handL : handR;
            var lowHand = right ? handR : handL;
            var topUp = right ? upL : upR; var topLo = right ? loL : loR;
            var lowUp = right ? upR : upL; var lowLo = right ? loR : loL;
            var down = -Vector3.up;
            Ik.TwoBone(topUp, topLo, topHand, top, topUp.position + down * 0.6f - Fwd * 0.4f);
            Ik.TwoBone(lowUp, lowLo, lowHand, low, lowUp.position + down * 0.6f + Fwd * 0.2f);
        }

        void CarryBat(Actor a)
        {
            // Bat in the bottom hand, blade trailing (running) or tucked under the arm.
            if (!handR || !bat) return;
            var hand = a.LeftHanded ? handL : handR;
            var grip = hand.position;
            if (a.Pose == Pose.BatSlide)
            {
                // Slide the bat in: arm out in front, blade along the ground.
                var arm = a.LeftHanded ? upL : upR;
                var lo = a.LeftHanded ? loL : loR;
                var target = Root + Fwd * 1.0f + Vector3.up * 0.35f;
                Ik.TwoBone(arm, lo, hand, target, arm.position - Vector3.up);
                grip = hand.position;
                PlaceBat(grip, grip + Fwd * 0.85f - Vector3.up * 0.3f, Vector3.up);
                return;
            }
            PlaceBat(grip, grip - Fwd * 0.4f - Vector3.up * 0.75f, Right);
        }

        void RaiseBat()
        {
            if (!bat) return;
            var hand = actor.LeftHanded ? handL : handR;
            var arm = actor.LeftHanded ? upL : upR;
            var lo = actor.LeftHanded ? loL : loR;
            Ik.TwoBone(arm, lo, hand, arm.position + Vector3.up * 0.55f + Fwd * 0.1f, arm.position + Fwd);
            PlaceBat(hand.position, hand.position + Vector3.up * 0.85f, Fwd);
        }

        // ---- bowling

        void Bowling(Actor a)
        {
            var style = (BowlStyle)a.Variant;
            bool spin = Deliveries.IsSpinStyle(style);
            bool leftArm = a.LeftHanded;
            var up = Vector3.up;
            var fwd = Fwd;
            var side = leftArm ? -Right : Right;   // bowling-arm side
            var armUp = leftArm ? upL : upR; var armLo = leftArm ? loL : loR; var armHand = leftArm ? handL : handR;
            var offUp = leftArm ? upR : upL; var offLo = leftArm ? loR : loL; var offHand = leftArm ? handR : handL;
            float stride = spin ? 0.5f : 0.6f;
            float t;
            if (a.Pose == Pose.Deliver) t = a.PoseTime;            // 0 .. stride (release)
            else if (a.Pose == Pose.FollowThrough) t = stride + a.PoseTime;
            else
            {
                // Run-up: ball held at the chest, arms pumping lightly (clip does the legs).
                Ik.TwoBone(armUp, armLo, armHand, armUp.position + fwd * 0.3f - up * 0.25f - side * 0.12f, armUp.position - up + side * 0.2f);
                return;
            }
            float rel = stride; // release time
            // Bowling arm angle phi: 0 down by the side, 90 forward, 180 straight up, 270 behind.
            float phi;
            if (t < rel - 0.28f) phi = Mathf.Lerp(20f, 250f, t / Mathf.Max(0.01f, rel - 0.28f)); // swing back as he gathers
            else if (t < rel) phi = Mathf.Lerp(250f, 165f, (t - (rel - 0.28f)) / 0.28f);        // over the top
            else phi = Mathf.Lerp(165f, spin ? 40f : -30f, Mathf.Clamp01((t - rel) / (spin ? 0.3f : 0.25f))); // follow through across the body
            float pr = phi * Mathf.Deg2Rad;
            var armDir = (fwd * Mathf.Sin(pr) - up * Mathf.Cos(pr)).normalized;
            if (t > rel) armDir = Vector3.Lerp(armDir, (armDir - side * 0.6f).normalized, Mathf.Clamp01((t - rel) / 0.25f));
            float armLen = Vector3.Distance(armUp.position, armLo.position) + Vector3.Distance(armLo.position, armHand.position);
            Ik.TwoBone(armUp, armLo, armHand, armUp.position + armDir * armLen * 0.97f, armUp.position - fwd + side * 0.3f);
            // Front arm reaches up at the batter, then pulls down.
            float pull = Mathf.Clamp01((t - (rel - 0.15f)) / 0.2f);
            var frontTarget = Vector3.Lerp(offUp.position + up * 0.55f + fwd * 0.35f, offUp.position - up * 0.45f - side * 0.25f, pull);
            Ik.TwoBone(offUp, offLo, offHand, frontTarget, offUp.position - fwd + up * 0.2f);
            // Gather (leap), lean back, then drive through.
            float leap = spin ? 0f : Mathf.Sin(Mathf.Clamp01(t / (rel * 0.75f)) * Mathf.PI) * 0.18f;
            pelvis.position += up * leap;
            float lean = t < rel ? Mathf.Lerp(0f, spin ? -6f : -14f, t / rel) : Mathf.Lerp(spin ? -6f : -14f, spin ? 20f : 35f, Mathf.Clamp01((t - rel) / 0.3f));
            Ik.Turn(spine2, Right, lean * 0.5f);
            Ik.Turn(spine3, Right, lean * 0.5f);
            // Front leg braces at the crease in the delivery stride.
            if (t > rel - 0.18f && t < rel + 0.25f)
            {
                var frontThigh = leftArm ? thighR : thighL;
                var frontCalf = leftArm ? calfR : calfL;
                var frontFoot = leftArm ? footR : footL;
                Ik.TwoBone(frontThigh, frontCalf, frontFoot, Root + fwd * 0.85f - side * 0.12f + up * 0.08f, frontThigh.position + fwd);
            }
            if (head) Ik.Face(head, headFwd, fwd, 0.6f);
        }

        // ---- fielding

        void Keeping(Actor a)
        {
            var up = Vector3.up;
            var target = a.Look.sqrMagnitude > 0.01f ? a.Look : Root + Fwd * 0.5f + up * 0.6f;
            if (a.Pose == Pose.KeeperCrouch && a.Look.sqrMagnitude > 0.01f)
            {
                // Gloves together in front, rising to meet the ball.
                float d = Vector3.Distance(a.Look, Root);
                if (d > 4f) target = Root + Fwd * 0.45f + up * 0.45f;
            }
            target = Root + Vector3.ClampMagnitude(target - Root, 1.4f);
            BothHandsTo(target, 0.12f);
            if (head) Ik.Face(head, headFwd, (target - head.position).normalized, 0.6f);
        }

        void Catching(Actor a)
        {
            if (a.Pose == Pose.Ready)
            {
                // Hands out ready, a slight crouch.
                pelvis.position -= Vector3.up * 0.08f;
                BothHandsTo(Root + Fwd * 0.4f + Vector3.up * 0.75f, 0.15f, 0.6f);
                return;
            }
            var target = a.Look.sqrMagnitude > 0.01f ? a.Look : Root + Fwd * 0.5f + Vector3.up * 1.2f;
            target = Root + Vector3.up * 1.0f + Vector3.ClampMagnitude(target - (Root + Vector3.up * 1.0f), 0.85f);
            BothHandsTo(target, 0.1f);
            if (head) Ik.Face(head, headFwd, (target - head.position).normalized, 0.7f);
        }

        void Diving(Actor a)
        {
            // Lay out sideways towards the ball.
            var toBall = a.Look - Root;
            float sideSign = Vector3.Dot(toBall, Right) >= 0f ? 1f : -1f;
            float t = Mathf.Clamp01(a.PoseTime / 0.3f);
            float roll = Ik.Smooth(t) * 80f * -sideSign;
            model.localRotation = Quaternion.Euler(0f, 0f, roll);
            model.localPosition = new Vector3(sideSign * 0.5f * t, Mathf.Sin(t * Mathf.PI) * 0.35f - 0.55f * t, 0f);
            var reach = a.Look.sqrMagnitude > 0.01f ? a.Look : Root + Right * sideSign * 2f + Vector3.up * 0.4f;
            BothHandsTo(reach, 0.1f);
        }

        void LateUpdateResetModel()
        {
            if (actor != null && actor.Pose != Pose.Dive && model && model != transform)
            {
                model.localRotation = Quaternion.identity;
                model.localPosition = Vector3.zero;
            }
        }

        void BothHandsTo(Vector3 target, float apart, float weight = 1f)
        {
            var r = Right * apart * 0.5f;
            Ik.TwoBone(upL, loL, handL, target - r, upL.position - Vector3.up * 0.6f - Right * 0.4f, weight);
            Ik.TwoBone(upR, loR, handR, target + r, upR.position - Vector3.up * 0.6f + Right * 0.4f, weight);
        }

        void ArmsUp(float weight)
        {
            BothHandsTo(Root + Vector3.up * 2.25f + Fwd * 0.25f, 0.45f, weight);
        }

        // ---- umpire

        void UmpireSignalPose(UmpireSignal s, float t)
        {
            var up = Vector3.up;
            float w = Mathf.Clamp01(t / 0.3f);
            switch (s)
            {
                case UmpireSignal.Out:
                    Ik.TwoBone(upR, loR, handR, upR.position + up * 0.62f + Fwd * 0.08f, upR.position + Fwd, w);
                    break;
                case UmpireSignal.Six:
                    BothHandsTo(Root + up * 2.3f, 0.55f, w);
                    break;
                case UmpireSignal.Four:
                    {
                        float wave = Mathf.Sin(t * 7f);
                        var target = Root + up * 1.25f + Fwd * 0.55f + Right * wave * 0.45f;
                        Ik.TwoBone(upR, loR, handR, target, upR.position - up, w);
                        break;
                    }
                case UmpireSignal.Wide:
                    Ik.TwoBone(upR, loR, handR, upR.position + Right * 0.62f, upR.position - up, w);
                    Ik.TwoBone(upL, loL, handL, upL.position - Right * 0.62f, upL.position - up, w);
                    break;
                case UmpireSignal.NoBall:
                case UmpireSignal.FreeHit:
                    Ik.TwoBone(upR, loR, handR, upR.position + Right * 0.62f, upR.position - up, w);
                    if (s == UmpireSignal.FreeHit) Ik.TwoBone(upL, loL, handL, upL.position + up * 0.4f + Right * 0.3f + Fwd * 0.2f, upL.position - up, w);
                    break;
                case UmpireSignal.Bye:
                    Ik.TwoBone(upR, loR, handR, upR.position + up * 0.6f, upR.position + Fwd, w);
                    break;
                case UmpireSignal.LegBye:
                    Ik.TwoBone(thighL, calfL, footL, footL.position + up * 0.35f + Fwd * 0.2f, thighL.position + Fwd, w);
                    Ik.TwoBone(upR, loR, handR, (calfL.position + thighL.position) * 0.5f + Fwd * 0.1f, upR.position - up, w);
                    break;
                case UmpireSignal.ReviewTv:
                    {
                        // Draw a TV screen in the air.
                        var c = Root + up * 1.45f + Fwd * 0.5f;
                        BothHandsTo(c + up * Mathf.Sin(t * 3f) * 0.12f, 0.6f, w);
                        break;
                    }
            }
        }

        void OnDisable() { actor = null; }

        /// <summary>Ensures the dive offsets are cleared once the dive ends.</summary>
        void Update() => LateUpdateResetModel();
    }
}
