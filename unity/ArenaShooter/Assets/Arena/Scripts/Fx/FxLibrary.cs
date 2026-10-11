using System.Collections.Generic;
using UnityEngine;

namespace Arena.Fx
{
    /// <summary>Lightweight pooled visual effects: tracers, muzzle flashes, impacts, death bursts and pulses.</summary>
    public class FxLibrary : MonoBehaviour
    {
        public static FxLibrary Instance { get; private set; }

        [Tooltip("An unlit transparent material that respects vertex/tint colour (e.g. Sprites/Default).")]
        public Material GlowMaterial;

        enum Kind { Tracer, Flash, Spark, Shard, Pulse }

        class Effect
        {
            public Kind Kind;
            public GameObject Go;
            public Renderer Renderer;
            public LineRenderer Line;
            public float Start, Duration, Size;
            public Color Color;
            public Vector3 Velocity;
            public Transform Follow;
        }

        readonly List<Effect> active = new List<Effect>();
        readonly Dictionary<Kind, Stack<Effect>> pool = new Dictionary<Kind, Stack<Effect>>();
        MaterialPropertyBlock block;

        void Awake()
        {
            Instance = this;
            block = new MaterialPropertyBlock();
        }

        public static void Tracer(Vector3 from, Vector3 to, Color color)
        {
            if (!Instance) return;
            var e = Instance.Get(Kind.Tracer, 0.09f, color);
            e.Line.SetPosition(0, from);
            e.Line.SetPosition(1, to);
        }

        public static void MuzzleFlash(Vector3 at, Color color)
        {
            if (!Instance) return;
            var e = Instance.Get(Kind.Flash, 0.05f, Color.Lerp(color, Color.white, 0.6f));
            e.Go.transform.position = at;
            e.Size = 0.22f;
        }

        public static void Impact(Vector3 at, Vector3 normal, Color? color = null, float scale = 1f)
        {
            if (!Instance) return;
            var e = Instance.Get(Kind.Spark, 0.22f, color ?? new Color(1f, 0.85f, 0.55f));
            e.Go.transform.position = at + normal * 0.03f;
            e.Size = 0.16f * scale;
        }

        public static void DeathBurst(Vector3 at, Color color)
        {
            if (!Instance) return;
            for (int i = 0; i < 14; i++)
            {
                var e = Instance.Get(Kind.Shard, Random.Range(0.8f, 1.3f), color);
                e.Go.transform.position = at + Random.insideUnitSphere * 0.3f;
                e.Go.transform.rotation = Random.rotation;
                e.Velocity = Random.insideUnitSphere * 5f + Vector3.up * 4f;
                e.Size = Random.Range(0.1f, 0.22f);
            }
        }

        public static void ShieldPulse(Transform around, Color color, float scale = 1f)
        {
            if (!Instance) return;
            var e = Instance.Get(Kind.Pulse, 0.5f, color);
            e.Follow = around;
            e.Size = 1.7f * scale;
        }

        Effect Get(Kind kind, float duration, Color color)
        {
            if (!pool.TryGetValue(kind, out var stack)) pool[kind] = stack = new Stack<Effect>();
            var e = stack.Count > 0 ? stack.Pop() : Create(kind);
            e.Go.SetActive(true);
            e.Start = Time.time;
            e.Duration = duration;
            e.Color = color;
            e.Follow = null;
            e.Velocity = Vector3.zero;
            active.Add(e);
            return e;
        }

        Effect Create(Kind kind)
        {
            var e = new Effect { Kind = kind };
            if (kind == Kind.Tracer)
            {
                e.Go = new GameObject("Tracer");
                e.Line = e.Go.AddComponent<LineRenderer>();
                e.Line.positionCount = 2;
                e.Line.useWorldSpace = true;
                e.Line.sharedMaterial = GlowMaterial;
                e.Line.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                e.Line.receiveShadows = false;
                e.Line.numCapVertices = 2;
                e.Renderer = e.Line;
            }
            else
            {
                e.Go = GameObject.CreatePrimitive(kind == Kind.Shard ? PrimitiveType.Cube : PrimitiveType.Sphere);
                e.Go.name = kind.ToString();
                Destroy(e.Go.GetComponent<Collider>());
                e.Renderer = e.Go.GetComponent<Renderer>();
                e.Renderer.sharedMaterial = GlowMaterial;
                e.Renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off;
                e.Renderer.receiveShadows = false;
            }
            e.Go.transform.SetParent(transform, false);
            return e;
        }

        void Update()
        {
            float now = Time.time, dt = Time.deltaTime;
            for (int i = active.Count - 1; i >= 0; i--)
            {
                var e = active[i];
                float t = (now - e.Start) / e.Duration;
                if (t >= 1f || (e.Kind == Kind.Pulse && e.Follow == null))
                {
                    e.Go.SetActive(false);
                    pool[e.Kind].Push(e);
                    active.RemoveAt(i);
                    continue;
                }
                var c = e.Color;
                switch (e.Kind)
                {
                    case Kind.Tracer:
                        c.a = 1f - t;
                        e.Line.startColor = c;
                        e.Line.endColor = new Color(c.r, c.g, c.b, c.a * 0.3f);
                        e.Line.startWidth = 0.05f * (1f - t * 0.5f);
                        e.Line.endWidth = 0.02f;
                        continue;
                    case Kind.Flash:
                    case Kind.Spark:
                        e.Go.transform.localScale = Vector3.one * e.Size * (1f + t * 1.5f);
                        c.a = 1f - t;
                        break;
                    case Kind.Shard:
                        e.Velocity += Physics.gravity * dt;
                        e.Go.transform.position += e.Velocity * dt;
                        e.Go.transform.Rotate(300f * dt, 200f * dt, 0);
                        e.Go.transform.localScale = Vector3.one * e.Size * (1f - t);
                        break;
                    case Kind.Pulse:
                        e.Go.transform.position = e.Follow.position + Vector3.up * 1f;
                        e.Go.transform.localScale = Vector3.one * Mathf.Lerp(0.6f, e.Size, Mathf.Sqrt(t));
                        c.a = 0.45f * (1f - t);
                        break;
                }
                block.SetColor("_Color", c);
                e.Renderer.SetPropertyBlock(block);
            }
        }
    }
}
