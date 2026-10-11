using Arena.Game;
using Arena.UI;
using UnityEngine;
using UnityEngine.Rendering.PostProcessing;

namespace Arena.Fx
{
    /// <summary>
    /// Post-processing (Post Processing Stack v2). A global volume carries bloom, ACES grading and a
    /// vignette; a second volume holds a depth-of-field blur that fades in whenever a full-screen UI is
    /// up (menu, pause, death, match end, title card); a third adds motion blur while dashing.
    /// </summary>
    public class PostFx : MonoBehaviour
    {
        public static PostFx Instance { get; private set; }

        public PostProcessResources Resources;
        public PostProcessVolume BlurVolume;
        public PostProcessVolume DashVolume;
        [Tooltip("Seconds to fade the background blur in or out.")]
        public float BlurFade = 0.35f;

        void Awake()
        {
            Instance = this;
            if (BlurVolume) BlurVolume.weight = 1f;
            if (DashVolume) DashVolume.weight = 0f;
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
        }

        /// <summary>Adds a post-process layer to a camera. Call while its GameObject is inactive.</summary>
        public static void Attach(Camera camera)
        {
            if (!Instance || !Instance.Resources || !camera || camera.GetComponent<PostProcessLayer>()) return;
            var layer = camera.gameObject.AddComponent<PostProcessLayer>();
            Configure(layer, Instance.Resources);
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

        void Update()
        {
            float step = Time.unscaledDeltaTime / Mathf.Max(0.01f, BlurFade);
            if (BlurVolume)
                BlurVolume.weight = Mathf.MoveTowards(BlurVolume.weight, ArenaHud.WantsBlur ? 1f : 0f, step);
            if (DashVolume)
            {
                var pc = PlayerController.Local;
                bool dashing = pc != null && pc.Dashing;
                DashVolume.weight = Mathf.MoveTowards(DashVolume.weight, dashing ? 1f : 0f, Time.unscaledDeltaTime * (dashing ? 12f : 4f));
            }
        }
    }
}
