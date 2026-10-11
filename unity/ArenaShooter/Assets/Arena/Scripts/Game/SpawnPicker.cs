using Arena.Map;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>Picks the spawn point furthest from living opponents, with a little randomness.</summary>
    public static class SpawnPicker
    {
        public static Vector3 Pick(Combatant self)
        {
            var points = DunesLayout.SpawnPoints;
            Vector3 best = points[Random.Range(0, points.Length)];
            float bestScore = float.MinValue;
            foreach (var p in points)
            {
                float nearest = 200f;
                foreach (var c in Combatant.All)
                {
                    if (c == self || !c.Alive.Value) continue;
                    nearest = Mathf.Min(nearest, Vector3.Distance(c.transform.position, p));
                }
                float score = nearest + Random.Range(0f, 12f);
                if (score > bestScore)
                {
                    bestScore = score;
                    best = p;
                }
            }
            return best + new Vector3(Random.Range(-1f, 1f), 0, Random.Range(-1f, 1f));
        }
    }
}
