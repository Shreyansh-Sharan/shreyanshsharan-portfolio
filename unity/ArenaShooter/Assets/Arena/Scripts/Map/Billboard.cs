using UnityEngine;

namespace Arena.Map
{
    /// <summary>Keeps a world-space label facing the active camera.</summary>
    public class Billboard : MonoBehaviour
    {
        void LateUpdate()
        {
            var cam = Camera.main;
            if (cam) transform.rotation = Quaternion.LookRotation(transform.position - cam.transform.position);
        }
    }
}
