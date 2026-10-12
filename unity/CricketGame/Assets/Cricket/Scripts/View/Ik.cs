using UnityEngine;

namespace Cricket.View
{
    /// <summary>
    /// Bone posing in world space that doesn't depend on how a rig's bones are oriented locally: segments are aimed
    /// with FromTo rotations of their own bone vector, so it works on the Quaternius skeleton and on the fallback
    /// mannequin alike.
    /// </summary>
    public static class Ik
    {
        /// <summary>Rotates `bone` so the vector to `child` points along `dir` (blended by weight).</summary>
        public static void Aim(Transform bone, Transform child, Vector3 dir, float weight = 1f)
        {
            if (!bone || !child || weight <= 0f || dir.sqrMagnitude < 1e-8f) return;
            var cur = child.position - bone.position;
            if (cur.sqrMagnitude < 1e-8f) return;
            var q = Quaternion.FromToRotation(cur, dir);
            if (weight < 1f) q = Quaternion.Slerp(Quaternion.identity, q, weight);
            bone.rotation = q * bone.rotation;
        }

        /// <summary>Classic two-bone IK: places `end` at target, bending `mid` towards the pole.</summary>
        public static void TwoBone(Transform root, Transform mid, Transform end, Vector3 target, Vector3 pole, float weight = 1f)
        {
            if (!root || !mid || !end || weight <= 0f) return;
            var a = root.position;
            float la = Vector3.Distance(a, mid.position);
            float lb = Vector3.Distance(mid.position, end.position);
            if (weight < 1f) target = Vector3.Lerp(end.position, target, weight);
            var toT = target - a;
            float d = Mathf.Clamp(toT.magnitude, Mathf.Abs(la - lb) + 1e-3f, la + lb - 1e-3f);
            var dir = toT.normalized;
            float cosA = Mathf.Clamp((la * la + d * d - lb * lb) / (2f * la * d), -1f, 1f);
            float sinA = Mathf.Sqrt(1f - cosA * cosA);
            var poleDir = Vector3.ProjectOnPlane(pole - a, dir);
            if (poleDir.sqrMagnitude < 1e-6f) poleDir = Vector3.ProjectOnPlane(Vector3.up, dir);
            poleDir.Normalize();
            var elbow = a + dir * (la * cosA) + poleDir * (la * sinA);
            Aim(root, mid, elbow - a);
            Aim(mid, end, (a + dir * d) - mid.position);
        }

        /// <summary>Rotates a bone so its "forward" (captured at rest, relative to the character) faces `dir`.</summary>
        public static void Face(Transform bone, Vector3 localForward, Vector3 dir, float weight = 1f)
        {
            if (!bone || weight <= 0f) return;
            var cur = bone.rotation * localForward;
            var q = Quaternion.FromToRotation(cur, dir);
            bone.rotation = Quaternion.Slerp(Quaternion.identity, q, weight) * bone.rotation;
        }

        /// <summary>Rotates a bone about a world axis.</summary>
        public static void Turn(Transform bone, Vector3 axis, float degrees)
        {
            if (!bone || Mathf.Abs(degrees) < 0.01f) return;
            bone.rotation = Quaternion.AngleAxis(degrees, axis) * bone.rotation;
        }

        public static float Smooth(float t) => t * t * (3f - 2f * t);

        /// <summary>Piecewise interpolation through keyframe values at times (clamped, smoothstepped).</summary>
        public static Vector3 Keys(float t, float[] times, Vector3[] values)
        {
            if (t <= times[0]) return values[0];
            for (int i = 1; i < times.Length; i++)
            {
                if (t <= times[i])
                {
                    float u = Smooth((t - times[i - 1]) / Mathf.Max(1e-4f, times[i] - times[i - 1]));
                    return Vector3.LerpUnclamped(values[i - 1], values[i], u);
                }
            }
            return values[values.Length - 1];
        }
    }
}
