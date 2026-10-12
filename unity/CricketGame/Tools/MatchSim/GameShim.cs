// More stand-ins (on top of Tools/PhysicsSim/UnityShim.cs) so the game logic in Assets/Cricket/Scripts/Game can
// run headless under plain .NET for the offline match test. Only what that code touches is here.
using System;
using System.Collections.Generic;

namespace UnityEngine
{
    public class Object { public string name; }
    public class Component : Object { }
    public class Behaviour : Component { public bool enabled = true; }
    public class MonoBehaviour : Behaviour { }

    public static class Time
    {
        public static float deltaTime = 1f / 60f;
        public static float unscaledDeltaTime = 1f / 60f;
        public static float time;
        public static float unscaledTime;
        public static float timeScale = 1f;
        public static float realtimeSinceStartup;
        public static int frameCount;
    }

    public static class Debug
    {
        public static void Log(object o) { }
        public static void LogWarning(object o) => Console.WriteLine("WARN " + o);
        public static void LogException(Exception e) => Console.WriteLine("EXC " + e);
    }

    public static class AudioListener { public static float volume = 1f; public static bool pause; }

    public static class PlayerPrefs
    {
        static readonly Dictionary<string, object> d = new Dictionary<string, object>();
        public static int GetInt(string k, int def) => d.TryGetValue(k, out var v) ? (int)v : def;
        public static void SetInt(string k, int v) => d[k] = v;
        public static float GetFloat(string k, float def) => d.TryGetValue(k, out var v) ? (float)v : def;
        public static void SetFloat(string k, float v) => d[k] = v;
        public static string GetString(string k, string def) => d.TryGetValue(k, out var v) ? (string)v : def;
        public static void SetString(string k, string v) => d[k] = v;
        public static void Save() { }
    }

    public static class JsonUtility
    {
        public static string ToJson(object o) => "{}";
        public static T FromJson<T>(string s) => default;
    }

    public struct Color
    {
        public float r, g, b, a;
        public Color(float r, float g, float b, float a = 1f) { this.r = r; this.g = g; this.b = b; this.a = a; }
        public static Color white => new Color(1, 1, 1);
        public static Color gray => new Color(0.5f, 0.5f, 0.5f);
    }

    public static class ColorUtility
    {
        public static bool TryParseHtmlString(string s, out Color c) { c = Color.white; return true; }
    }

    public struct Quaternion
    {
        public float x, y, z, w;
        public Quaternion(float x, float y, float z, float w) { this.x = x; this.y = y; this.z = z; this.w = w; }
        public static Quaternion identity => new Quaternion(0, 0, 0, 1);
        public static Quaternion AngleAxis(float deg, Vector3 axis)
        {
            axis = axis.normalized;
            float h = deg * Mathf.Deg2Rad * 0.5f, s = Mathf.Sin(h);
            return new Quaternion(axis.x * s, axis.y * s, axis.z * s, Mathf.Cos(h));
        }
        public static Quaternion Euler(float x, float y, float z) =>
            AngleAxis(y, Vector3.up) * AngleAxis(x, Vector3.right) * AngleAxis(z, Vector3.forward);
        public static Quaternion operator *(Quaternion a, Quaternion b) => new Quaternion(
            a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
            a.w * b.y + a.y * b.w + a.z * b.x - a.x * b.z,
            a.w * b.z + a.z * b.w + a.x * b.y - a.y * b.x,
            a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z);
        public static Vector3 operator *(Quaternion q, Vector3 v)
        {
            var u = new Vector3(q.x, q.y, q.z);
            var t = Vector3.Cross(u, v) * 2f;
            return v + t * q.w + Vector3.Cross(u, t);
        }
    }

    [AttributeUsage(AttributeTargets.Field)] public class RangeAttribute : Attribute { public RangeAttribute(float a, float b) { } }
    [AttributeUsage(AttributeTargets.Field)] public class HeaderAttribute : Attribute { public HeaderAttribute(string s) { } }
    [AttributeUsage(AttributeTargets.Field)] public class TooltipAttribute : Attribute { public TooltipAttribute(string s) { } }

    public static class Vector3Ext { }
}

namespace Cricket.Net
{
    // The online relay isn't part of the offline test.
    public class NetMatch
    {
        public static NetMatch Instance;
        public void Send(Cricket.Game.Command c) { }
    }
}
