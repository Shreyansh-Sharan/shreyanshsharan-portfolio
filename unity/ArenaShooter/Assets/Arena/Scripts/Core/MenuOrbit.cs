using UnityEngine;

namespace Arena.Core
{
    /// <summary>Slow fly-around of the map behind the menu.</summary>
    public class MenuOrbit : MonoBehaviour
    {
        public float Radius = 62f;
        public float Height = 38f;
        public float Speed = 4f;

        void LateUpdate()
        {
            float a = Time.time * Speed * Mathf.Deg2Rad;
            transform.position = new Vector3(Mathf.Sin(a) * Radius, Height, Mathf.Cos(a) * Radius);
            transform.LookAt(new Vector3(0, 0, -2));
        }
    }
}
