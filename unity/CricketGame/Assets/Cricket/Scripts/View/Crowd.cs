using System.Collections.Generic;
using UnityEngine;

namespace Cricket.View
{
    /// <summary>
    /// The crowd: thousands of tiny two-box spectators drawn with GPU instancing (a few draw calls per colour, no
    /// GameObjects). They stand and bob when something big happens.
    /// </summary>
    public class Crowd : MonoBehaviour
    {
        class Batch
        {
            public Material Mat;
            public Mesh Mesh;
            public readonly List<Matrix4x4[]> Chunks = new List<Matrix4x4[]>();
            public readonly List<int> Index = new List<int>(); // seat index for each instance, in chunk order
        }

        readonly List<Batch> batches = new List<Batch>();
        Matrix4x4[] seats = new Matrix4x4[0];
        float[] phase = new float[0];
        float excitement;
        bool animating;
        readonly List<Material> owned = new List<Material>();

        static readonly Color[] Shirts =
        {
            new Color(0.85f, 0.15f, 0.15f), new Color(0.15f, 0.35f, 0.85f), new Color(0.95f, 0.8f, 0.1f), new Color(0.9f, 0.9f, 0.9f),
            new Color(0.1f, 0.55f, 0.3f), new Color(0.95f, 0.45f, 0.1f), new Color(0.55f, 0.2f, 0.65f), new Color(0.15f, 0.15f, 0.18f),
        };
        static readonly Color[] Skins = { new Color(0.93f, 0.76f, 0.62f), new Color(0.72f, 0.52f, 0.38f), new Color(0.45f, 0.3f, 0.2f) };

        public int Count { get; private set; }

        public void Build(List<Matrix4x4> seatList, Material template, float fill)
        {
            if (!template) return;
            var torso = MeshKit.CrowdTorso();
            var headMesh = MeshKit.CrowdHead();
            var rng = new System.Random(4242);
            var occupied = new List<Matrix4x4>();
            foreach (var m in seatList) if (rng.NextDouble() < fill) occupied.Add(m);
            seats = occupied.ToArray();
            Count = seats.Length;
            phase = new float[seats.Length];
            for (int i = 0; i < phase.Length; i++) phase[i] = (float)rng.NextDouble() * 6.28f;

            var torsoBatches = new Batch[Shirts.Length];
            for (int i = 0; i < Shirts.Length; i++) torsoBatches[i] = NewBatch(template, Shirts[i], torso);
            var headBatches = new Batch[Skins.Length];
            for (int i = 0; i < Skins.Length; i++) headBatches[i] = NewBatch(template, Skins[i], headMesh);
            var torsoLists = new List<int>[Shirts.Length];
            var headLists = new List<int>[Skins.Length];
            for (int i = 0; i < torsoLists.Length; i++) torsoLists[i] = new List<int>();
            for (int i = 0; i < headLists.Length; i++) headLists[i] = new List<int>();
            for (int i = 0; i < seats.Length; i++)
            {
                torsoLists[rng.Next(Shirts.Length)].Add(i);
                headLists[rng.Next(Skins.Length)].Add(i);
            }
            for (int i = 0; i < Shirts.Length; i++) Fill(torsoBatches[i], torsoLists[i]);
            for (int i = 0; i < Skins.Length; i++) Fill(headBatches[i], headLists[i]);
        }

        Batch NewBatch(Material template, Color c, Mesh mesh)
        {
            var m = new Material(template) { color = c, enableInstancing = true };
            owned.Add(m);
            var b = new Batch { Mat = m, Mesh = mesh };
            batches.Add(b);
            return b;
        }

        void Fill(Batch b, List<int> idx)
        {
            for (int start = 0; start < idx.Count; start += 1023)
            {
                int n = Mathf.Min(1023, idx.Count - start);
                var arr = new Matrix4x4[n];
                for (int k = 0; k < n; k++)
                {
                    arr[k] = seats[idx[start + k]];
                    b.Index.Add(idx[start + k]);
                }
                b.Chunks.Add(arr);
            }
        }

        public void Cheer(float amount)
        {
            excitement = Mathf.Max(excitement, Mathf.Clamp01(amount));
        }

        public void SetNight(bool night)
        {
            foreach (var b in batches) b.Mat.SetFloat("_Glossiness", night ? 0.2f : 0.05f);
        }

        void LateUpdate()
        {
            if (excitement > 0.01f || animating)
            {
                excitement = Mathf.MoveTowards(excitement, 0f, Time.deltaTime * 0.25f);
                animating = excitement > 0.01f;
                float time = Time.time * 9f;
                foreach (var b in batches)
                {
                    int i = 0;
                    foreach (var chunk in b.Chunks)
                    {
                        for (int k = 0; k < chunk.Length; k++, i++)
                        {
                            int s = b.Index[i];
                            var m = seats[s];
                            float bob = animating ? Mathf.Max(0f, Mathf.Sin(time + phase[s])) * 0.3f * excitement + excitement * 0.25f : 0f;
                            m.m13 += bob;
                            chunk[k] = m;
                        }
                    }
                }
            }
            foreach (var b in batches)
                foreach (var chunk in b.Chunks)
                    Graphics.DrawMeshInstanced(b.Mesh, 0, b.Mat, chunk, chunk.Length, null, UnityEngine.Rendering.ShadowCastingMode.Off, false, 0, null);
        }

        void OnDestroy()
        {
            foreach (var m in owned) if (m) Destroy(m);
        }
    }
}
