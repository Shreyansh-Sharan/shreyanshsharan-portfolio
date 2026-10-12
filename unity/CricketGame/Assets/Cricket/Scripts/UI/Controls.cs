using Cricket.Game;
using Cricket.Sim;
using Cricket.View;
using UnityEngine;

namespace Cricket.UI
{
    /// <summary>
    /// Turns input into Commands for the local player, depending on the phase: aiming and playing shots, footwork,
    /// calling runs; picking deliveries, placing the marker and timing the release; setting the field; manual
    /// fielding; reviews; camera and menus.
    /// </summary>
    public class Controls : MonoBehaviour
    {
        float aimSentAt, markerSentAt, moveSentAt;
        float lastAim = 999f;
        public static int SelectedFielder = -1;

        MatchDirector D => MatchDirector.Instance;

        void Send(Command c)
        {
            c.Side = (byte)D.LocalSide;
            D.Submit(c);
        }

        void Update()
        {
            var d = D;
            if (d == null || d.State.Current == null || Hud.MenuOpen || Core.AdService.Showing) return;

            if (CricketInput.Down(Act.Camera))
            {
                if (d.LocalBowls) Settings.BowlingCam = 1 - Settings.BowlingCam;
                else Settings.BattingCam = 1 - Settings.BattingCam;
            }

            switch (d.Phase)
            {
                case Phase.ChooseBowler:
                    if (d.LocalBowls)
                    {
                        var list = d.EligibleBowlers();
                        for (int i = 0; i < Mathf.Min(9, list.Count); i++)
                            if (Input.GetKeyDown(KeyCode.Alpha1 + i)) Send(Command.Make(CmdType.PickBowler, 0, list[i]));
                    }
                    break;
                case Phase.PreDelivery:
                    if (d.LocalBowls) Bowling(d);
                    if (d.LocalBats) PreBat(d);
                    break;
                case Phase.RunUp:
                    if (d.LocalBowls && (CricketInput.Down(Act.Confirm)))
                    {
                        float meter = d.IsAuthority ? d.MeterValue : d.ClientMeterPress();
                        Send(Command.Make(CmdType.Release, 0, 0, meter));
                    }
                    if (d.LocalBowls) MoveMarker(d, false);
                    if (d.LocalBats) { Aim(d); if (CricketInput.Down(Act.Charge)) Send(Command.Make(CmdType.Charge, 0)); Batting(d); }
                    break;
                case Phase.BallInFlight:
                    if (d.LocalBats) { Aim(d); Batting(d); }
                    break;
                case Phase.BallLive:
                    if (d.LocalBats) Running();
                    if (d.LocalBowls && d.ManualFielding) Fielding(d);
                    break;
                case Phase.Dead:
                    if (CricketInput.Down(Act.Review) && d.CanReview(d.LocalSide)) Send(Command.Make(CmdType.Review, 0));
                    break;
                case Phase.Replay:
                    if (CricketInput.Down(Act.Confirm) || Input.GetKeyDown(KeyCode.Escape)) Send(Command.Make(CmdType.SkipReplay, 0));
                    break;
                case Phase.InningsBreak:
                    if (Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.JoystickButton0)) Hud.ContinueFromBreak();
                    break;
            }
        }

        // ---- batting

        void PreBat(MatchDirector d)
        {
            Aim(d);
            if (CricketInput.Down(Act.GuardOff)) Send(Command.Make(CmdType.Guard, 0, 0, 0.15f));
            if (CricketInput.Down(Act.GuardLeg)) Send(Command.Make(CmdType.Guard, 0, 0, -0.15f));
            if (CricketInput.Down(Act.Charge)) Send(Command.Make(CmdType.Charge, 0));
        }

        void Aim(MatchDirector d)
        {
            float aim = lastAim == 999f ? 0f : lastAim;
            var stick = CricketInput.LeftStick;
            var cam = CameraRig.Instance;
            if (stick.sqrMagnitude > 0.2f && cam)
            {
                // Stick direction relative to the camera, projected onto the field.
                var right = cam.transform.right; right.y = 0f; right.Normalize();
                var fwd = cam.transform.forward; fwd.y = 0f; fwd.Normalize();
                var world = d.Frame.Origin + (right * stick.x + fwd * stick.y) * 10f;
                aim = d.Frame.AngleOf(world);
            }
            else if (cam && !CricketInput.TouchUsed && cam.GroundPoint(Input.mousePosition, out var p))
            {
                aim = d.Frame.AngleOf(p);
            }
            if (Mathf.Abs(Mathf.DeltaAngle(aim, lastAim)) > 1.5f && Time.unscaledTime > aimSentAt)
            {
                lastAim = aim;
                aimSentAt = Time.unscaledTime + 0.05f;
                d.AimAngle = aim;
                Send(Command.Make(CmdType.Aim, 0, 0, aim));
            }
        }

        void Batting(MatchDirector d)
        {
            if (d.ShotPending) return;
            ShotType? type = null;
            if (CricketInput.Down(Act.Shot)) type = ShotType.Auto;
            else if (CricketInput.Down(Act.Defend)) type = ShotType.Defend;
            else if (CricketInput.Down(Act.Leave)) type = ShotType.Leave;
            else if (CricketInput.Down(Act.Drive)) type = ShotType.Drive;
            else if (CricketInput.Down(Act.Cut)) type = ShotType.Cut;
            else if (CricketInput.Down(Act.Pull)) type = ShotType.Pull;
            else if (CricketInput.Down(Act.Sweep)) type = ShotType.Sweep;
            else if (CricketInput.Down(Act.Flick)) type = ShotType.Flick;
            if (type == null) return;
            var feet = CricketInput.Held(Act.Front) ? Footwork.Front : CricketInput.Held(Act.Back) ? Footwork.Back : Footwork.Auto;
            bool loft = CricketInput.Held(Act.Loft) || Input.GetKeyDown(KeyCode.JoystickButton3);
            var input = new ShotInput { Type = type.Value, Feet = feet, Loft = loft, Aim = d.AimAngle, Played = true };
            float timing = d.TimingErrorNow(input);
            int packed = (int)type.Value | ((int)feet << 4) | (loft ? 0x80 : 0);
            Send(Command.Make(CmdType.Shot, 0, packed, d.AimAngle, timing));
            Hud.ShowTiming(timing, d.DifficultyWindow);
        }

        void Running()
        {
            if (CricketInput.Down(Act.Run)) Send(Command.Make(CmdType.Run, 0));
            if (CricketInput.Down(Act.SendBack)) Send(Command.Make(CmdType.Back, 0));
            if (CricketInput.Down(Act.Slide)) Send(Command.Make(CmdType.Slide, 0));
        }

        // ---- bowling

        void Bowling(MatchDirector d)
        {
            var types = Deliveries.For(d.FieldingTeam.Players[d.Inn.Bowler].Bowl);
            int idx = System.Array.IndexOf(types, d.SelectedDelivery);
            if (idx < 0) idx = 0;
            if (CricketInput.Down(Act.PrevDelivery)) PickDelivery(d, types[(idx + types.Length - 1) % types.Length]);
            if (CricketInput.Down(Act.NextDelivery)) PickDelivery(d, types[(idx + 1) % types.Length]);
            for (int i = 0; i < types.Length; i++) if (Input.GetKeyDown(KeyCode.Alpha1 + i)) PickDelivery(d, types[i]);
            if (CricketInput.Down(Act.WicketSide)) Send(Command.Make(CmdType.WicketSide, 0));
            if (CricketInput.Down(Act.Field)) { Hud.FieldEditor = !Hud.FieldEditor; CameraRig.Instance.FieldEditor = Hud.FieldEditor; SelectedFielder = -1; }
            if (Hud.FieldEditor) { FieldEditing(d); return; }
            MoveMarker(d, true);
            bool click = Input.GetMouseButtonDown(0) && !Hud.PointerOverUi && !CricketInput.TouchUsed;
            if (Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.Return) || Input.GetKeyDown(KeyCode.JoystickButton0) || click && Input.GetKey(KeyCode.LeftControl) == false && Hud.MarkerConfirmByClick)
                Send(Command.Make(CmdType.StartRunUp, 0));
        }

        void PickDelivery(MatchDirector d, DeliveryType t)
        {
            Send(Command.Make(CmdType.PickDelivery, 0, (int)t));
            if (!d.IsAuthority) d.SelectedDelivery = t;
        }

        void MoveMarker(MatchDirector d, bool mouse)
        {
            var stick = CricketInput.LeftStick;
            Vector3 target = d.Marker;
            bool moved = false;
            if (stick.sqrMagnitude > 0.05f)
            {
                float dt = Time.unscaledDeltaTime;
                var f = d.Frame;
                // Up on the stick = fuller (towards the batter), right = towards the batter's off side as seen on screen.
                var cam = CameraRig.Instance.transform;
                var right = cam.right; right.y = 0; right.Normalize();
                var fwd = cam.forward; fwd.y = 0; fwd.Normalize();
                target += (right * stick.x * 1.2f + fwd * stick.y * 4f) * dt;
                moved = true;
            }
            else if (mouse && !CricketInput.TouchUsed && !Hud.PointerOverUi && CameraRig.Instance.GroundPoint(Input.mousePosition, out var p))
            {
                var f = d.Frame;
                float len = f.OffsetFwd(p), off = f.OffsetOff(p);
                if (len > -1.5f && len < 16f && Mathf.Abs(off) < 3f) { target = p; moved = true; }
            }
            if (moved && Time.unscaledTime > markerSentAt && (target - d.Marker).sqrMagnitude > 0.0004f)
            {
                markerSentAt = Time.unscaledTime + 0.04f;
                if (!d.IsAuthority) d.Marker = target;
                Send(Command.Make(CmdType.SetTarget, 0, 0, target.x, target.z));
            }
        }

        void FieldEditing(MatchDirector d)
        {
            for (int i = 0; i < 5; i++) if (Input.GetKeyDown(KeyCode.Alpha1 + i)) Send(Command.Make(CmdType.FieldPreset, 0, i));
            if (!Input.GetMouseButtonDown(0) || Hud.PointerOverUi) return;
            if (!CameraRig.Instance.GroundPoint(Input.mousePosition, out var p)) return;
            if (SelectedFielder < 0)
            {
                // Pick the nearest fielder (not the bowler or keeper).
                float best = 4f;
                for (int i = 0; i < 9; i++)
                {
                    var a = d.FielderAtIndex(i);
                    if (a == null) continue;
                    float dist = Vector3.Distance(new Vector3(a.Pos.x, 0, a.Pos.z), p);
                    if (dist < best) { best = dist; SelectedFielder = i; }
                }
            }
            else
            {
                Send(Command.Make(CmdType.MoveFielder, 0, SelectedFielder, p.x, p.z));
                SelectedFielder = -1;
            }
        }

        // ---- manual fielding

        void Fielding(MatchDirector d)
        {
            var stick = CricketInput.KeysStick;
            var cam = CameraRig.Instance.transform;
            var right = cam.right; right.y = 0; right.Normalize();
            var fwd = cam.forward; fwd.y = 0; fwd.Normalize();
            var move = right * stick.x + fwd * stick.y;
            if (Time.unscaledTime > moveSentAt && (move.sqrMagnitude > 0.01f))
            {
                moveSentAt = Time.unscaledTime + 0.05f;
                Send(Command.Make(CmdType.FieldMove, 0, 0, move.x, move.z));
            }
            if (CricketInput.Down(Act.FieldSwitch)) Send(Command.Make(CmdType.FieldSwitch, 0));
            if (CricketInput.Down(Act.Catch)) Send(Command.Make(CmdType.FieldCatch, 0));
            bool direct = CricketInput.Held(Act.DirectHit);
            if (CricketInput.Down(Act.ThrowKeeper)) Send(Command.Make(CmdType.FieldThrow, 0, 0, 0f, 0f, direct ? 1f : 0f));
            if (CricketInput.Down(Act.ThrowBowler)) Send(Command.Make(CmdType.FieldThrow, 0, 1, 0f, 0f, direct ? 1f : 0f));
        }
    }
}
