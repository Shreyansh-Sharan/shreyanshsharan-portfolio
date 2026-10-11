using System;
using UnityEngine;
using UnityEngine.Rendering;

namespace Arena.Map
{
    /// <summary>
    /// Owns the map roots in the scene (all maps are built side by side, far apart) and switches between
    /// them: only the active map's root is enabled, and its fog, ambient light, sky and sun are applied.
    /// </summary>
    public class MapRuntime : MonoBehaviour
    {
        public static MapRuntime Instance { get; private set; }
        public static int Index { get; private set; } = -1;
        public static MapDefinition Current => Maps.Get(Index);
        public static event Action<MapDefinition> Changed;

        [Tooltip("One root per map, in Maps.All order.")]
        public GameObject[] Roots;
        public Light Sun;
        public Material Skybox;

        Material sky;

        void Awake()
        {
            Instance = this;
            Index = -1;
            if (Skybox)
            {
                sky = new Material(Skybox);
                RenderSettings.skybox = sky;
            }
        }

        void OnDestroy()
        {
            if (Instance == this) Instance = null;
            if (sky) Destroy(sky);
        }

        /// <summary>Activates a map by index. Safe to call repeatedly; only real changes raise <see cref="Changed"/>.</summary>
        public static void Activate(int index)
        {
            index = Mathf.Clamp(index, 0, Maps.All.Length - 1);
            bool changed = index != Index;
            Index = index;
            if (Instance) Instance.Apply(Maps.Get(index));
            if (changed) Changed?.Invoke(Maps.Get(index));
        }

        void Apply(MapDefinition map)
        {
            for (int i = 0; i < Roots.Length; i++)
                if (Roots[i]) Roots[i].SetActive(i == Index);

            ApplyLook(map.Look, Sun, sky);
        }

        /// <summary>Applies fog, ambient light, sky and sun settings (also used by the editor when generating).</summary>
        public static void ApplyLook(MapLook look, Light sun, Material sky)
        {
            RenderSettings.fog = true;
            RenderSettings.fogMode = FogMode.Linear;
            RenderSettings.fogColor = look.FogColor;
            RenderSettings.fogStartDistance = look.FogStart;
            RenderSettings.fogEndDistance = look.FogEnd;
            RenderSettings.ambientMode = AmbientMode.Trilight;
            RenderSettings.ambientSkyColor = look.AmbientSky;
            RenderSettings.ambientEquatorColor = look.AmbientEquator;
            RenderSettings.ambientGroundColor = look.AmbientGround;

            if (sky)
            {
                sky.SetColor("_SkyTint", look.SkyTint);
                sky.SetColor("_GroundColor", look.SkyGround);
                sky.SetFloat("_Exposure", look.SkyExposure);
                sky.SetFloat("_AtmosphereThickness", look.Atmosphere);
                sky.SetFloat("_SunSize", look.SunSize);
            }
            if (sun)
            {
                sun.color = look.SunColor;
                sun.intensity = look.SunIntensity;
                sun.shadowStrength = look.ShadowStrength;
                sun.transform.rotation = Quaternion.Euler(look.SunEuler);
            }
            DynamicGI.UpdateEnvironment();
        }
    }
}
