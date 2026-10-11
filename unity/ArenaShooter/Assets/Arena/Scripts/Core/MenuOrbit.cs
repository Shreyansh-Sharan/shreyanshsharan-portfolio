using Arena.Map;
using UnityEngine;

namespace Arena.Core
{
    /// <summary>Slow fly-around of the active map behind the menu.</summary>
    public class MenuOrbit : MonoBehaviour
    {
        public float Height = 38f;
        public float Speed = 4f;

        void LateUpdate()
        {
            var map = MapRuntime.Current;
            float a = Time.time * Speed * Mathf.Deg2Rad, radius = map.Radius * 1.1f;
            var center = map.Center;
            transform.position = center + new Vector3(Mathf.Sin(a) * radius, Height, Mathf.Cos(a) * radius);
            transform.LookAt(center + new Vector3(0, 0, -2));
        }
    }
}
