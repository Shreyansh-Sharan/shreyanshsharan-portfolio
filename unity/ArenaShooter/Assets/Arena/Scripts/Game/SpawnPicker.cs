using Arena.Map;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>Picks the active map's spawn point furthest from living opponents, with a little randomness.</summary>
    public static class SpawnPicker
    {
        public static Vector3 Pick(Combatant self)
        {
            var map = MapRuntime.Current;
            var points = map.SpawnPoints;
            Vector3 best = map.ToWorld(points[Random.Range(0, points.Length)]);
            float bestScore = float.MinValue;
            foreach (var local in points)
            {
                var p = map.ToWorld(local);
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
