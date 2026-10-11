using UnityEngine;

namespace Arena.Fx
{
    /// <summary>Synthesised sound effects, so the build ships no audio files.</summary>
    public static class Sfx
    {
        const int Rate = 22050;
        static uint seed = 12345; // declared before the clips: static initialisers run in order

        public static readonly AudioClip Shot = Make("shot", 0.2f, t =>
            Noise() * Mathf.Exp(-t * 28f) * 0.8f + Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(190f, 55f, t * 5f) * t) * Mathf.Exp(-t * 18f));
        public static readonly AudioClip Hit = Make("hit", 0.07f, t => Mathf.Sin(2 * Mathf.PI * 1900f * t) * Mathf.Exp(-t * 55f));
        public static readonly AudioClip Kill = Make("kill", 0.32f, t =>
            (t < 0.12f ? Mathf.Sin(2 * Mathf.PI * 880f * t) : Mathf.Sin(2 * Mathf.PI * 1320f * t)) * Mathf.Exp(-(t % 0.12f) * 12f) * 0.8f);
        public static readonly AudioClip Hurt = Make("hurt", 0.16f, t => (Mathf.Sin(2 * Mathf.PI * 110f * t) + Noise() * 0.4f) * Mathf.Exp(-t * 22f));
        public static readonly AudioClip Death = Make("death", 0.6f, t =>
            (Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(420f, 70f, t / 0.6f) * t) * 0.7f + Noise() * 0.3f) * Mathf.Exp(-t * 5f));
        public static readonly AudioClip Pickup = Make("pickup", 0.32f, t =>
            Mathf.Sin(2 * Mathf.PI * (t < 0.1f ? 660f : t < 0.2f ? 880f : 1320f) * t) * Mathf.Exp(-(t % 0.1f) * 10f) * 0.7f);
        public static readonly AudioClip Dash = Make("dash", 0.28f, t => Noise() * Mathf.Sin(Mathf.PI * t / 0.28f) * 0.6f);
        public static readonly AudioClip Jump = Make("jump", 0.12f, t => Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(280f, 520f, t / 0.12f) * t) * Mathf.Exp(-t * 18f));
        public static readonly AudioClip Shield = Make("shield", 0.5f, t =>
            Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(300f, 900f, t / 0.5f) * t) * (0.6f + 0.4f * Mathf.Sin(t * 90f)) * Mathf.Exp(-t * 4f) * 0.7f);
        public static readonly AudioClip Scan = Make("scan", 0.9f, t =>
            Mathf.Sin(2 * Mathf.PI * 1250f * t) * Mathf.Exp(-(t % 0.3f) * 14f) * Mathf.Exp(-t * 2.2f));
        public static readonly AudioClip Reload = Make("reload", 0.35f, t =>
            (t < 0.04f || (t > 0.25f && t < 0.29f) ? Noise() : 0f) * 0.8f);
        public static readonly AudioClip Spawn = Make("spawn", 0.6f, t =>
            (Mathf.Sin(2 * Mathf.PI * 440f * t) + Mathf.Sin(2 * Mathf.PI * 660f * t) * 0.6f) * Mathf.Sin(Mathf.PI * t / 0.6f) * 0.45f);
        public static readonly AudioClip MatchEnd = Make("end", 1f, t =>
            Mathf.Sin(2 * Mathf.PI * (t < 0.25f ? 523f : t < 0.5f ? 659f : 784f) * t) * Mathf.Exp(-(t % 0.25f) * 5f) * 0.7f);

        static float Noise()
        {
            seed = seed * 1664525u + 1013904223u;
            return (seed >> 9) / 4194304f - 1f;
        }

        static AudioClip Make(string name, float seconds, System.Func<float, float> wave)
        {
            int n = Mathf.CeilToInt(seconds * Rate);
            var data = new float[n];
            for (int i = 0; i < n; i++)
            {
                float t = i / (float)Rate;
                float fade = Mathf.Clamp01((n - i) / (Rate * 0.01f));
                data[i] = Mathf.Clamp(wave(t) * fade, -1f, 1f) * 0.8f;
            }
            try
            {
                var clip = AudioClip.Create(name, n, 1, Rate, false);
                clip.SetData(data, 0);
                return clip;
            }
            catch
            {
                return null; // Audio is optional; never break gameplay over it.
            }
        }

        static AudioSource[] sources;
        static int next;

        static AudioSource NextSource()
        {
            if (sources == null)
            {
                var go = new GameObject("Sfx");
                Object.DontDestroyOnLoad(go);
                sources = new AudioSource[16];
                for (int i = 0; i < sources.Length; i++)
                {
                    sources[i] = go.AddComponent<AudioSource>();
                    sources[i].playOnAwake = false;
                }
            }
            next = (next + 1) % sources.Length;
            return sources[next];
        }

        public static void Play2D(AudioClip clip, float volume = 1f, float pitch = 1f)
        {
            if (clip == null) return;
            var s = NextSource();
            s.spatialBlend = 0f;
            s.pitch = pitch;
            s.PlayOneShot(clip, volume);
        }

        public static void PlayAt(AudioClip clip, Vector3 position, float volume = 1f, float pitch = 1f)
        {
            if (clip == null) return;
            var listener = Camera.main;
            if (listener == null)
            {
                Play2D(clip, volume * 0.5f, pitch);
                return;
            }
            // Cheap distance attenuation without per-sound 3D sources.
            float d = Vector3.Distance(listener.transform.position, position);
            float v = volume * Mathf.Clamp01(1f - d / 70f);
            if (v > 0.02f) Play2D(clip, v, pitch);
        }
    }
}
