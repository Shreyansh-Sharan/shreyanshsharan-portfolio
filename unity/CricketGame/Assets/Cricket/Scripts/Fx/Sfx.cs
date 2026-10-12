using UnityEngine;

namespace Cricket.Fx
{
    /// <summary>
    /// Every sound is synthesised at load (nothing ships): willow on leather, edges, the ball on the pitch, pads,
    /// stumps, catches, the hum of the crowd and its roar, applause and the "ooh" of a play-and-miss.
    /// </summary>
    public static class Sfx
    {
        const int Rate = 22050;
        static uint seed = 777;

        static float Noise()
        {
            seed = seed * 1664525u + 1013904223u;
            return (seed >> 9) / 4194304f - 1f;
        }

        public static readonly AudioClip BatHit = Make("bat", 0.22f, t =>
            (Noise() * Mathf.Exp(-t * 180f) * 0.9f
             + Mathf.Sin(2 * Mathf.PI * 1350f * t) * Mathf.Exp(-t * 42f) * 0.7f
             + Mathf.Sin(2 * Mathf.PI * 620f * t) * Mathf.Exp(-t * 30f) * 0.5f
             + Mathf.Sin(2 * Mathf.PI * 2700f * t) * Mathf.Exp(-t * 70f) * 0.25f));
        public static readonly AudioClip Edge = Make("edge", 0.12f, t =>
            Noise() * Mathf.Exp(-t * 260f) * 0.6f + Mathf.Sin(2 * Mathf.PI * 2300f * t) * Mathf.Exp(-t * 90f) * 0.5f);
        public static readonly AudioClip Bounce = Make("bounce", 0.12f, t =>
            Mathf.Sin(2 * Mathf.PI * Mathf.Lerp(180f, 90f, t * 8f) * t) * Mathf.Exp(-t * 45f) * 0.8f + Noise() * Mathf.Exp(-t * 120f) * 0.35f);
        public static readonly AudioClip Pad = Make("pad", 0.16f, t =>
            Mathf.Sin(2 * Mathf.PI * 140f * t) * Mathf.Exp(-t * 30f) * 0.7f + Noise() * Mathf.Exp(-t * 60f) * 0.4f);
        public static readonly AudioClip Stumps = Make("stumps", 0.45f, t =>
        {
            float a = 0f;
            for (int k = 0; k < 4; k++)
            {
                float t0 = k * 0.07f;
                if (t > t0) a += (Noise() * 0.5f + Mathf.Sin(2 * Mathf.PI * (900f + k * 230f) * (t - t0))) * Mathf.Exp(-(t - t0) * 35f) * (1f - k * 0.2f);
            }
            return a * 0.6f;
        });
        public static readonly AudioClip Catch = Make("catch", 0.1f, t => Noise() * Mathf.Exp(-t * 120f) * 0.8f + Mathf.Sin(2 * Mathf.PI * 300f * t) * Mathf.Exp(-t * 60f) * 0.4f);
        public static readonly AudioClip Whoosh = Make("whoosh", 0.35f, t => Noise() * Mathf.Sin(Mathf.PI * t / 0.35f) * 0.35f);
        public static readonly AudioClip Click = Make("click", 0.05f, t => Mathf.Sin(2 * Mathf.PI * 1800f * t) * Mathf.Exp(-t * 90f) * 0.5f);

        // Crowd: a looping murmur, a roar and applause made from shaped noise.
        static float lp;
        public static readonly AudioClip CrowdLoop = Make("crowd", 4f, t =>
        {
            lp += (Noise() - lp) * 0.08f;
            float swell = 0.75f + 0.25f * Mathf.Sin(t * 1.3f) * Mathf.Sin(t * 0.47f + 1f);
            return lp * 2.2f * swell;
        }, loopFade: true);
        static float lp2;
        public static readonly AudioClip Roar = Make("roar", 3.2f, t =>
        {
            lp2 += (Noise() - lp2) * 0.22f;
            float env = Mathf.Clamp01(t / 0.25f) * Mathf.Exp(-Mathf.Max(0f, t - 0.6f) * 1.1f);
            return lp2 * 2.4f * env;
        });
        public static readonly AudioClip Clapping = Make("applause", 3.5f, t =>
        {
            // Many claps: bursts of noise at random moments.
            float s = 0f;
            float k = Mathf.Repeat(t * 37f + Mathf.Sin(t * 13f) * 3f, 1f);
            s += Noise() * Mathf.Exp(-k * 25f) * 0.5f;
            float k2 = Mathf.Repeat(t * 53f + 0.3f, 1f);
            s += Noise() * Mathf.Exp(-k2 * 30f) * 0.4f;
            return s * Mathf.Clamp01(t / 0.2f) * Mathf.Clamp01((3.5f - t) / 1.2f);
        });
        public static readonly AudioClip Ooh = Make("ooh", 1.3f, t =>
        {
            float f = Mathf.Lerp(200f, 260f, Mathf.Sin(Mathf.Clamp01(t / 1.3f) * Mathf.PI));
            float v = Mathf.Sin(2 * Mathf.PI * f * t) * 0.3f + Mathf.Sin(2 * Mathf.PI * f * 2.01f * t) * 0.15f + Noise() * 0.25f;
            return v * Mathf.Sin(Mathf.Clamp01(t / 1.3f) * Mathf.PI) * 0.6f;
        });

        static AudioClip Make(string name, float seconds, System.Func<float, float> wave, bool loopFade = false)
        {
            int n = Mathf.CeilToInt(seconds * Rate);
            var data = new float[n];
            for (int i = 0; i < n; i++)
            {
                float t = i / (float)Rate;
                float fade = loopFade ? 1f : Mathf.Clamp01((n - i) / (Rate * 0.01f));
                data[i] = Mathf.Clamp(wave(t) * fade, -1f, 1f) * 0.8f;
            }
            if (loopFade)
            {
                // Crossfade the ends so the loop is seamless.
                int f = Rate / 4;
                for (int i = 0; i < f; i++)
                {
                    float w = i / (float)f;
                    data[i] = data[i] * w + data[n - f + i] * (1f - w);
                }
                System.Array.Resize(ref data, n - f);
                n = data.Length;
            }
            try
            {
                var clip = AudioClip.Create(name, n, 1, Rate, false);
                clip.SetData(data, 0);
                return clip;
            }
            catch
            {
                return null; // audio is optional
            }
        }

        static AudioSource[] sources;
        static AudioSource ambience, roar;
        static int next;
        static float crowdLevel = 0.35f;

        static void Init()
        {
            if (sources != null) return;
            var go = new GameObject("Sfx");
            Object.DontDestroyOnLoad(go);
            sources = new AudioSource[12];
            for (int i = 0; i < sources.Length; i++)
            {
                sources[i] = go.AddComponent<AudioSource>();
                sources[i].playOnAwake = false;
            }
            ambience = go.AddComponent<AudioSource>();
            ambience.clip = CrowdLoop;
            ambience.loop = true;
            ambience.volume = 0f;
            roar = go.AddComponent<AudioSource>();
            roar.playOnAwake = false;
            go.AddComponent<SfxDriver>();
        }

        public static void Play2D(AudioClip clip, float volume = 1f, float pitch = 1f)
        {
            if (clip == null) return;
            Init();
            next = (next + 1) % sources.Length;
            var s = sources[next];
            s.pitch = pitch;
            s.PlayOneShot(clip, volume);
        }

        public static void PlayAt(AudioClip clip, Vector3 position, float volume = 1f, float pitch = 1f)
        {
            if (clip == null) return;
            var cam = Camera.main;
            float v = volume;
            if (cam != null)
            {
                // Broadcast feel: the stump mic picks up the middle, so distance only softens things a little.
                float d = Vector3.Distance(position, Vector3.zero);
                v *= Mathf.Clamp(1f - d / 140f, 0.3f, 1f);
            }
            Play2D(clip, v, pitch);
        }

        /// <summary>Turns the crowd on (match running) with a base level.</summary>
        public static void Ambience(bool on, float level = 0.35f)
        {
            Init();
            crowdLevel = level;
            if (ambience.clip == null) return;
            if (on && !ambience.isPlaying) ambience.Play();
            if (!on) ambience.Stop();
        }

        /// <summary>The crowd erupts.</summary>
        public static void Crowd(float amount)
        {
            Init();
            if (Roar == null) return;
            roar.pitch = Random.Range(0.9f, 1.05f);
            roar.PlayOneShot(Roar, Mathf.Clamp01(amount));
            if (amount > 0.85f) Play2D(Clapping, amount * 0.6f);
        }

        public static void Applause(float amount) => Play2D(Clapping, amount);
        public static void OohCrowd(float amount) => Play2D(Ooh, amount);

        class SfxDriver : MonoBehaviour
        {
            void Update()
            {
                if (ambience == null) return;
                ambience.volume = Mathf.MoveTowards(ambience.volume, ambience.isPlaying ? crowdLevel : 0f, Time.unscaledDeltaTime * 0.3f);
            }
        }
    }
}
