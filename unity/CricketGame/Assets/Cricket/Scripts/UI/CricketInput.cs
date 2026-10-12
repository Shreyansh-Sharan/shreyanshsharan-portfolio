using System.Collections.Generic;
using UnityEngine;

namespace Cricket.UI
{
    public enum Act
    {
        Shot, Loft, Defend, Leave, Front, Back, Charge, GuardOff, GuardLeg,
        Drive, Cut, Pull, Sweep, Flick,
        Run, SendBack, Slide,
        Confirm, PrevDelivery, NextDelivery, WicketSide, Field,
        Review, Camera, Pause, Scorecard, Help,
        FieldSwitch, Catch, ThrowKeeper, ThrowBowler, DirectHit,
    }

    /// <summary>
    /// Keyboard + mouse, gamepad (old Input Manager: PadLX/PadLY sticks and joystick buttons in the browser's standard
    /// layout, A=0 B=1 X=2 Y=3 LB=4 RB=5 LT=6 RT=7 Back=8 Start=9 LS=10 RS=11 d-pad 12-15) and on-screen touch buttons.
    /// </summary>
    public static class CricketInput
    {
        static readonly HashSet<Act> virtualDown = new HashSet<Act>();
        static readonly HashSet<Act> virtualHeld = new HashSet<Act>();
        static int virtualFrame = -1;
        public static bool TouchUsed;
        public static Vector2 VirtualStick;

        static bool Pad(int b) => Input.GetKey(KeyCode.JoystickButton0 + b);
        static bool PadDown(int b) => Input.GetKeyDown(KeyCode.JoystickButton0 + b);

        static float Axis(string name)
        {
            try { return Input.GetAxisRaw(name); } catch { return 0f; }
        }

        public static Vector2 LeftStick
        {
            get
            {
                var v = new Vector2(Axis("PadLX"), Axis("PadLY"));
                if (Pad(14)) v.x -= 1f;
                if (Pad(15)) v.x += 1f;
                if (Pad(12)) v.y += 1f;
                if (Pad(13)) v.y -= 1f;
                v += VirtualStick;
                return Vector2.ClampMagnitude(v, 1f);
            }
        }

        public static Vector2 RightStick => new Vector2(Axis("PadRX"), Axis("PadRY"));

        /// <summary>WASD/arrows as a stick (manual fielding movement).</summary>
        public static Vector2 KeysStick
        {
            get
            {
                var v = Vector2.zero;
                if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) v.y += 1;
                if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) v.y -= 1;
                if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) v.x += 1;
                if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) v.x -= 1;
                return Vector2.ClampMagnitude(v + LeftStick, 1f);
            }
        }

        public static bool AnyPad => Mathf.Abs(Axis("PadLX")) > 0.3f || Mathf.Abs(Axis("PadLY")) > 0.3f || Pad(0) || Pad(1) || Pad(2) || Pad(3);

        /// <summary>Presses from the on-screen buttons (valid for the next frame).</summary>
        public static void Virtual(Act a, bool held = false)
        {
            if (virtualFrame != Time.frameCount) { virtualDown.Clear(); virtualFrame = Time.frameCount; }
            virtualDown.Add(a);
            if (held) virtualHeld.Add(a);
        }

        public static void VirtualRelease(Act a) => virtualHeld.Remove(a);

        static bool VDown(Act a) => virtualFrame >= Time.frameCount - 1 && virtualDown.Contains(a);

        public static bool Down(Act a)
        {
            if (VDown(a)) { virtualDown.Remove(a); return true; }
            switch (a)
            {
                case Act.Shot: return Input.GetMouseButtonDown(0) && !Hud.PointerOverUi || PadDown(0) || PadDown(3);
                case Act.Defend: return Input.GetMouseButtonDown(1) || PadDown(2);
                case Act.Leave: return Input.GetKeyDown(KeyCode.Space) || PadDown(1);
                case Act.Charge: return Input.GetKeyDown(KeyCode.Q) || PadDown(11);
                case Act.GuardOff: return Input.GetKeyDown(KeyCode.D);
                case Act.GuardLeg: return Input.GetKeyDown(KeyCode.A);
                case Act.Drive: return Input.GetKeyDown(KeyCode.Alpha1);
                case Act.Cut: return Input.GetKeyDown(KeyCode.Alpha2);
                case Act.Pull: return Input.GetKeyDown(KeyCode.Alpha3);
                case Act.Sweep: return Input.GetKeyDown(KeyCode.Alpha4) || Input.GetKeyDown(KeyCode.E);
                case Act.Flick: return Input.GetKeyDown(KeyCode.Alpha5);
                case Act.Run: return Input.GetKeyDown(KeyCode.R) || PadDown(5);
                case Act.SendBack: return Input.GetKeyDown(KeyCode.F) || PadDown(7);
                case Act.Slide: return Input.GetKeyDown(KeyCode.Space) || PadDown(0);
                case Act.Confirm: return Input.GetKeyDown(KeyCode.Space) || Input.GetKeyDown(KeyCode.Return) || Input.GetMouseButtonDown(0) && !Hud.PointerOverUi || PadDown(0);
                case Act.PrevDelivery: return Input.GetKeyDown(KeyCode.Q) || Input.mouseScrollDelta.y > 0.5f || PadDown(4);
                case Act.NextDelivery: return Input.GetKeyDown(KeyCode.E) || Input.mouseScrollDelta.y < -0.5f || PadDown(5);
                case Act.WicketSide: return Input.GetKeyDown(KeyCode.V) || PadDown(3);
                case Act.Field: return Input.GetKeyDown(KeyCode.F) || PadDown(8);
                case Act.Review: return Input.GetKeyDown(KeyCode.R) || PadDown(3);
                case Act.Camera: return Input.GetKeyDown(KeyCode.C) || PadDown(10);
                case Act.Pause: return Input.GetKeyDown(KeyCode.Escape) || Input.GetKeyDown(KeyCode.P) || PadDown(9);
                case Act.Help: return Input.GetKeyDown(KeyCode.H);
                case Act.FieldSwitch: return Input.GetKeyDown(KeyCode.Tab) || PadDown(4);
                case Act.Catch: return Input.GetKeyDown(KeyCode.Space) || PadDown(0);
                case Act.ThrowKeeper: return Input.GetMouseButtonDown(0) && !Hud.PointerOverUi || Input.GetKeyDown(KeyCode.K) || PadDown(5);
                case Act.ThrowBowler: return Input.GetMouseButtonDown(1) || Input.GetKeyDown(KeyCode.B) || PadDown(7);
                default: return false;
            }
        }

        public static bool Held(Act a)
        {
            if (virtualHeld.Contains(a)) return true;
            switch (a)
            {
                case Act.Loft: return Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift) || Pad(3);
                case Act.Front: return Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow) || Pad(4);
                case Act.Back: return Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow) || Pad(6);
                case Act.Scorecard: return Input.GetKey(KeyCode.Tab) && !Hud.ManualFieldingActive || Pad(8);
                case Act.DirectHit: return Input.GetKey(KeyCode.LeftShift) || Pad(3);
                default: return false;
            }
        }
    }
}
