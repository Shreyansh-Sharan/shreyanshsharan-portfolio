// Offline sanity sim: runs the game's own ball physics (Assets/Cricket/Scripts/Sim) outside Unity and prints
// deliveries and shots so the constants can be checked against real cricket numbers.
// Build and run: python3 Tools/PhysicsSim/run.py
using System;
using System.Collections.Generic;
using Cricket.Sim;
using UnityEngine;

static class Program
{
    static void Main()
    {
        Console.WriteLine("Constants: pitch {0} m, ball {1} kg, radius {2} m, Cd {3}, drag k {4:0.00000} 1/m",
            Geo.PitchLength, Geo.BallMass, Geo.BallRadius, BallPhysics.Cd, BallPhysics.DragK(Env.Make(PitchType.Flat, TimeOfDay.Day, Vector3.zero)));
        Console.WriteLine("Pitch restitution: green {0}, flat {1}, dusty {2}",
            Surfaces.Pitch(PitchType.Green).Restitution, Surfaces.Pitch(PitchType.Flat).Restitution, Surfaces.Pitch(PitchType.Dusty).Restitution);
        Console.WriteLine();
        Console.WriteLine("=== Deliveries (bowled from end 0 to a right-hander at end 1; x>0 is ... see 'off' column) ===");
        Bowl("Fast seam-up, good length, flat", PitchType.Flat, TimeOfDay.Day, DeliveryType.SeamUp, BowlStyle.Fast, 145f, 6.5f, 0.05f);
        Bowl("Fast bouncer, green", PitchType.Green, TimeOfDay.Day, DeliveryType.Bouncer, BowlStyle.Fast, 148f, 10.5f, 0f);
        Bowl("Fast yorker, flat", PitchType.Flat, TimeOfDay.Day, DeliveryType.Yorker, BowlStyle.Fast, 146f, 1.3f, 0f);
        Bowl("Medium outswinger, green, under lights", PitchType.Green, TimeOfDay.Night, DeliveryType.Outswing, BowlStyle.Medium, 128f, 5.0f, 0.1f);
        Bowl("Medium inswinger, flat, day", PitchType.Flat, TimeOfDay.Day, DeliveryType.Inswing, BowlStyle.Medium, 126f, 5.5f, 0.05f);
        Bowl("Slower ball, flat", PitchType.Flat, TimeOfDay.Day, DeliveryType.SlowerBall, BowlStyle.Fast, 145f, 6f, 0f);
        Bowl("Off-break, dusty", PitchType.Dusty, TimeOfDay.Day, DeliveryType.OffBreak, BowlStyle.OffSpin, 86f, 4.6f, 0.1f);
        Bowl("Off-break, flat", PitchType.Flat, TimeOfDay.Day, DeliveryType.OffBreak, BowlStyle.OffSpin, 86f, 4.6f, 0.1f);
        Bowl("Leg-break, dusty", PitchType.Dusty, TimeOfDay.Day, DeliveryType.LegBreak, BowlStyle.LegSpin, 82f, 4.8f, 0.1f);
        Bowl("Googly, dusty", PitchType.Dusty, TimeOfDay.Day, DeliveryType.Googly, BowlStyle.LegSpin, 80f, 4.6f, 0.1f);
        Bowl("Arm ball, flat", PitchType.Flat, TimeOfDay.Day, DeliveryType.ArmBall, BowlStyle.OffSpin, 90f, 5f, 0.1f);

        Console.WriteLine();
        Console.WriteLine("=== Shots off the bat (hit from the popping crease at end 1 straight down the ground, no wind) ===");
        Hit("Perfect drive along the ground", 32f, 3f, 0f);
        Hit("Firm push", 14f, 1f, 0f);
        Hit("Defensive block", 4f, -8f, 0f);
        Hit("Lofted drive, middled", 37f, 30f, 30f);
        Hit("Lofted drive, mistimed", 26f, 32f, 20f);
        Hit("Slog, top-edged skier", 24f, 70f, 10f);
        Hit("Pull, middled", 35f, 18f, 25f);
        Hit("Lofted drive into a 6 m/s headwind", 37f, 30f, 30f, new Vector3(0, 0, 6f));
        Hit("Lofted drive with a 6 m/s tailwind", 37f, 30f, 30f, new Vector3(0, 0, -6f));
    }

    static void Bowl(string label, PitchType pitch, TimeOfDay time, DeliveryType type, BowlStyle style, float kmh, float lengthFromStumps, float lineOff)
    {
        var env = Env.Make(pitch, time, Vector3.zero);
        var rng = new Rng(7);
        int bowlEnd = 0, batEnd = 1;
        var frame = BatFrame.For(batEnd, true);
        var target = frame.Local(lineOff, lengthFromStumps);
        var plan = new DeliveryPlan { Type = type, Style = style, Target = target, SpeedKmh = kmh * Deliveries.Get(type).SpeedFactor };
        var s = DeliverySolver.Release(plan, bowlEnd, frame.Off, 2f, 0.8f, env, rng, out var aimed);
        var release = s.Pos;
        var launch = s.Vel;
        // March to the batter's stumps.
        var path = new List<Vector3>();
        Vector3 atCrease = default, atStumps = default, bounce = default;
        float tCrease = 0, tStumps = 0, vBefore = 0, vAfter = 0, vCrease = 0;
        bool gotCrease = false, gotStumps = false;
        Vector3 preBounceDir = default, postBounceDir = default;
        float creaseZ = Geo.PoppingZ(batEnd), stumpsZ = Geo.StumpsZ(batEnd);
        var prev = s.Pos;
        for (int i = 0; i < 4000 && !gotStumps; i++)
        {
            var vb = s.Vel;
            var r = BallPhysics.Step(ref s, env, BallPhysics.Dt);
            if (r.Bounced && s.Bounces == 1)
            {
                bounce = r.BouncePos; vBefore = vb.magnitude; vAfter = s.Vel.magnitude;
                preBounceDir = new Vector3(vb.x, 0, vb.z).normalized; postBounceDir = new Vector3(s.Vel.x, 0, s.Vel.z).normalized;
            }
            if (!gotCrease && BallPhysics.CrossesZ(prev, s.Pos, creaseZ, out var c)) { gotCrease = true; atCrease = c; tCrease = s.Time; vCrease = s.Vel.magnitude; }
            if (!gotStumps && BallPhysics.CrossesZ(prev, s.Pos, stumpsZ, out var st)) { gotStumps = true; atStumps = st; tStumps = s.Time; }
            if (i % 50 == 0) path.Add(s.Pos);
            prev = s.Pos;
        }
        float turnDeg = Vector3.Cross(preBounceDir, postBounceDir).y * Mathf.Rad2Deg; // + is a turn to the right of travel
        // Swing: sideways movement between release and landing compared with the straight line from release to the landing point's direction at release.
        var straight = new Vector3(launch.x, 0, launch.z).normalized;
        var land = bounce - release; land.y = 0;
        float swing = Vector3.Cross(straight, land.normalized).y * land.magnitude; // signed sideways offset at landing (m)
        Console.WriteLine($"-- {label}: {kmh * Deliveries.Get(type).SpeedFactor:0} km/h release, spin {s.Spin.magnitude / (2 * Math.PI):0} rev/s");
        Console.WriteLine($"   release {release}  aimed {aimed}  pitched {bounce}  ({frame.OffsetFwd(bounce):0.00} m from the batter's stumps, off {frame.OffsetOff(bounce):+0.00;-0.00})");
        Console.WriteLine($"   speed at bounce {vBefore * 3.6f:0} -> {vAfter * 3.6f:0} km/h, at the popping crease {vCrease * 3.6f:0} km/h after {tCrease:0.000} s; swing in the air {swing:+0.00;-0.00} m; deviation off the pitch {turnDeg:+0.0;-0.0} deg");
        Console.WriteLine($"   at the popping crease: height {atCrease.y:0.00} m, off {frame.OffsetOff(atCrease):+0.00;-0.00} m;  at the stumps: height {atStumps.y:0.00} m, off {frame.OffsetOff(atStumps):+0.00;-0.00} m  -> {(BallPhysics.HitsStumps(atStumps, batEnd) ? "HITTING" : "missing")}");
        Console.Write("   path (every 0.1 s, z/y): ");
        foreach (var p in path) Console.Write($"{p.z:0.0}/{p.y:0.00} ");
        Console.WriteLine();
    }

    static void Hit(string label, float speed, float elevationDeg, float backspinRevs, Vector3 wind = default)
    {
        var env = Env.Make(PitchType.Flat, TimeOfDay.Day, wind);
        var dir = new Vector3(0, 0, -1); // from end 1 towards end 0, straight
        float el = elevationDeg * Mathf.Deg2Rad;
        var s = new BallState
        {
            Pos = new Vector3(0, 0.5f, Geo.PoppingZ(1)),
            Vel = (dir * Mathf.Cos(el) + Vector3.up * Mathf.Sin(el)) * speed,
            Spin = -new Vector3(dir.z, 0, -dir.x) * (backspinRevs * 2 * Mathf.PI), // back spin
        };
        var start = s.Pos;
        float carry = -1, maxH = 0, tBoundary = -1, vBoundary = 0;
        var path = new List<string>();
        float t = 0;
        while (t < 12f && !s.Stopped)
        {
            var r = BallPhysics.Advance(ref s, env, 0.02f);
            t += 0.02f;
            maxH = Mathf.Max(maxH, s.Pos.y);
            if (r.Bounced && carry < 0) carry = Dist(start, r.BouncePos);
            if (tBoundary < 0 && Geo.BeyondRope(s.Pos) >= 0f) { tBoundary = t; vBoundary = s.Vel.magnitude; break; }
            if (Math.Abs(t / 0.5f - Math.Round(t / 0.5f)) < 0.011f) path.Add($"{t:0.0}s:{Dist(start, s.Pos):0}m/{s.Pos.y:0.0}");
        }
        string fate = tBoundary >= 0 ? (carry < 0 ? $"SIX (carried the rope at {Dist(start, s.Pos):0} m)" : $"FOUR after {tBoundary:0.0} s, still {vBoundary:0.0} m/s") : $"stopped at {Dist(start, s.Pos):0} m after {t:0.0} s";
        Console.WriteLine($"-- {label}: {speed:0} m/s ({speed * 3.6f:0} km/h) at {elevationDeg:0} deg, back spin {backspinRevs:0} rev/s{(wind.magnitude > 0 ? $", wind {wind.z:+0;-0} m/s along the hit" : "")}");
        Console.WriteLine($"   carry {(carry < 0 ? "beyond the rope" : carry.ToString("0.0") + " m")}, apex {maxH:0.0} m -> {fate}");
        Console.WriteLine("   " + string.Join("  ", path));
    }

    static float Dist(Vector3 a, Vector3 b) { a.y = 0; b.y = 0; return (a - b).magnitude; }
}
