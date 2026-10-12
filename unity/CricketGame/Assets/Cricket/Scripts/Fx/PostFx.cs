using UnityEngine;
using UnityEngine.Rendering.PostProcessing;

namespace Cricket.Fx
{
    /// <summary>
    /// Post Processing Stack v2: a broadcast grade (ACES, a touch of bloom for the floodlights, light vignette) and a
    /// background blur behind full-screen menus. Switched off entirely in Low graphics mode.
    /// </summary>
    public class PostFx : MonoBehaviour
    {
        public static PostFx Instance { get; private set; }
        public static bool WantsBlur;

        public PostProcessResources Resources;
        public PostProcessLayer Layer;
        public PostProcessVolume BlurVolume;

        void Awake()
        {
            Instance = this;
            if (Layer && Resources) Configure(Layer, Resources);
            Apply();
        }

        public static void Configure(PostProcessLayer layer, PostProcessResources resources)
        {
            layer.Init(resources);
            layer.volumeTrigger = layer.transform;
            layer.volumeLayer = ~0;
            layer.antialiasingMode = PostProcessLayer.Antialiasing.FastApproximateAntialiasing;
            layer.fastApproximateAntialiasing.fastMode = true;
            layer.fastApproximateAntialiasing.keepAlpha = false;
            layer.stopNaNPropagation = true;
        }

        public void Apply()
        {
            if (Layer) Layer.enabled = !Settings.LowGraphics;
            QualitySettings.shadows = Settings.LowGraphics ? ShadowQuality.Disable : ShadowQuality.HardOnly;
            QualitySettings.shadowDistance = 140f;
            QualitySettings.shadowCascades = 2;
            QualitySettings.antiAliasing = 0;
        }

        void Update()
        {
            if (BlurVolume) BlurVolume.weight = Mathf.MoveTowards(BlurVolume.weight, WantsBlur ? 1f : 0f, Time.unscaledDeltaTime * 3f);
        }
    }
}
