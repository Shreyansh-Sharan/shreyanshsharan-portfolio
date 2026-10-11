using UnityEngine;

namespace Arena.Map
{
    /// <summary>
    /// Makes a TextMesh glow: an HDR copy of the font material (so bloom picks it up) with a faint
    /// neon flicker. TextMesh vertex colours are clamped to 1, hence the material tint.
    /// </summary>
    [RequireComponent(typeof(TextMesh))]
    public class NeonText : MonoBehaviour
    {
        public Color Color = Color.white;
        public float Intensity = 1.7f;
        public float Flicker = 0.12f;

        Material material;
        float seed;

        void Start()
        {
            var text = GetComponent<TextMesh>();
            var r = GetComponent<MeshRenderer>();
            if (!text || !r || !text.font) return;
            material = new Material(text.font.material) { name = "Neon text" };
            text.color = Color.white;
            r.sharedMaterial = material;
            seed = Random.value * 10f;
            Apply(1f);
        }

        void Update()
        {
            if (!material) return;
            float n = Mathf.PerlinNoise(Time.time * 2.5f + seed, seed);
            Apply(1f - Flicker * n * n);
        }

        void Apply(float k) => material.color = Color * Intensity * k;

        void OnDestroy()
        {
            if (material) Destroy(material);
        }
    }
}
