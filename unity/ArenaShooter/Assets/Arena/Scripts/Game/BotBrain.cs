using Arena.Core;
using Arena.Map;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.AI;

namespace Arena.Game
{
    /// <summary>
    /// Server-side AI opponent: roams between points of interest, engages anyone it can see, strafes
    /// while shooting, grabs health when hurt and pops its overshield under pressure.
    /// </summary>
    [RequireComponent(typeof(NavMeshAgent))]
    public class BotBrain : NetworkBehaviour
    {
        public static readonly string[] Names =
        {
            "NullPointer", "LegacyBI", "DataSilo", "SchemaDrift", "Deadlock",
            "RaceCondition", "Hotfix", "MergeConflict", "Timeout", "CronJob",
        };

        struct Skill
        {
            public float Reaction, AimError, AimSettle, ViewRange, Speed;
        }

        static readonly Skill[] Skills =
        {
            new Skill { Reaction = 0.65f, AimError = 7.5f, AimSettle = 0.35f, ViewRange = 40f, Speed = 4.8f },
            new Skill { Reaction = 0.38f, AimError = 4.2f, AimSettle = 0.55f, ViewRange = 55f, Speed = 5.6f },
            new Skill { Reaction = 0.2f, AimError = 2.2f, AimSettle = 0.75f, ViewRange = 70f, Speed = 6.2f },
        };

        NavMeshAgent agent;
        Combatant me;
        Weapon weapon;
        Skill skill;
        Combatant target;
        float seenSince, lastSeen, nextThink, nextStrafe, engagedFor;
        Vector3 lastSeenPos;
        bool hasLastSeen;

        void Awake()
        {
            agent = GetComponent<NavMeshAgent>();
            me = GetComponent<Combatant>();
            weapon = GetComponent<Weapon>();
            agent.enabled = false;
        }

        public override void OnNetworkSpawn()
        {
            if (!IsServer)
            {
                enabled = false;
                return;
            }
            skill = Skills[Mathf.Clamp(LaunchOptions.Current.Difficulty, 0, Skills.Length - 1)];
            agent.enabled = true;
            agent.speed = skill.Speed;
            agent.angularSpeed = 720f;
            agent.acceleration = 40f;
            agent.updateRotation = false;
            agent.autoBraking = false;
            agent.Warp(transform.position);
        }

        public void ServerRespawn(Vector3 point)
        {
            target = null;
            hasLastSeen = false;
            weapon.ResetAmmo();
            if (agent.enabled) agent.Warp(point);
            else transform.position = point;
        }

        void Update()
        {
            if (!IsServer || !agent.enabled) return;
            bool matchOver = MatchManager.Instance != null && MatchManager.Instance.Ended.Value;
            if (!me.Alive.Value || matchOver)
            {
                if (agent.isOnNavMesh) agent.isStopped = true;
                return;
            }
            if (agent.isOnNavMesh) agent.isStopped = false;

            if (Time.time >= nextThink)
            {
                nextThink = Time.time + 0.15f;
                Think();
            }

            // Face the target when fighting, otherwise the way we're walking.
            Vector3 look = target != null ? target.transform.position - transform.position : agent.velocity;
            look.y = 0;
            if (look.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(look), 540f * Time.deltaTime);

            if (target != null && Time.time - seenSince >= skill.Reaction)
            {
                engagedFor += Time.deltaTime;
                var eye = me.AimPoint;
                var aimAt = target.transform.position + Vector3.up * (Random.value < 0.15f ? 1.6f : 1.15f);
                float settle = Mathf.Lerp(1.6f, skill.AimSettle, Mathf.Clamp01(engagedFor / 1.5f));
                weapon.ServerFire(eye, (aimAt - eye).normalized, skill.AimError * settle);
            }
        }

        void Think()
        {
            var seen = FindTarget();
            if (seen != null)
            {
                if (seen != target)
                {
                    seenSince = Time.time;
                    engagedFor = 0;
                }
                target = seen;
                lastSeen = Time.time;
                lastSeenPos = seen.transform.position;
                hasLastSeen = true;
            }
            else if (target != null && Time.time - lastSeen > 0.4f)
            {
                target = null;
            }

            if (me.Health.Value < 50 && Random.value < 0.25f) me.ServerTryOvershield();

            if (target != null)
            {
                if (Time.time >= nextStrafe) Strafe();
                return;
            }

            if (hasLastSeen && Time.time - lastSeen < 4f)
            {
                MoveTo(lastSeenPos);
                if (Vector3.Distance(transform.position, lastSeenPos) < 2f) hasLastSeen = false;
                return;
            }

            if (!agent.hasPath || agent.remainingDistance < 1.5f) MoveTo(PickRoamGoal());
        }

        void Strafe()
        {
            nextStrafe = Time.time + Random.Range(0.6f, 1.3f);
            var toTarget = target.transform.position - transform.position;
            float distance = toTarget.magnitude;
            var side = Vector3.Cross(Vector3.up, toTarget.normalized) * (Random.value < 0.5f ? -1f : 1f) * Random.Range(2.5f, 5f);
            var range = distance > 22f ? toTarget.normalized * 4f : distance < 9f ? -toTarget.normalized * 3f : Vector3.zero;
            MoveTo(transform.position + side + range);
        }

        Vector3 PickRoamGoal()
        {
            // Hurt bots head for the nearest active health pack.
            if (me.Health.Value < 45)
            {
                Pickup best = null;
                float bestDistance = float.MaxValue;
                foreach (var p in Pickup.All)
                {
                    if (!p.Active.Value || p.Kind.Value != (byte)DunesLayout.PickupKind.Health) continue;
                    float d = Vector3.Distance(p.transform.position, transform.position);
                    if (d < bestDistance) { bestDistance = d; best = p; }
                }
                if (best != null) return best.transform.position;
            }
            var points = DunesLayout.Waypoints;
            return points[Random.Range(0, points.Length)] + new Vector3(Random.Range(-3f, 3f), 0, Random.Range(-3f, 3f));
        }

        void MoveTo(Vector3 point)
        {
            if (!agent.isOnNavMesh) return;
            if (NavMesh.SamplePosition(point, out var hit, 4f, NavMesh.AllAreas)) agent.SetDestination(hit.position);
        }

        Combatant FindTarget()
        {
            Combatant best = null;
            float bestScore = float.MaxValue;
            var eye = me.AimPoint;
            foreach (var c in Combatant.All)
            {
                if (c == me || !c.Alive.Value) continue;
                var aim = c.transform.position + Vector3.up * 1.3f;
                float d = Vector3.Distance(eye, aim);
                if (d > skill.ViewRange) continue;

                // Field of view: wide, but not eyes in the back of the head (unless it's our current target).
                var dir = (aim - eye).normalized;
                if (c != target && Vector3.Dot(transform.forward, dir) < -0.2f && d > 6f) continue;
                if (!CanSee(eye, aim, c)) continue;

                float score = d * (c == target ? 0.6f : 1f);
                if (score < bestScore) { bestScore = score; best = c; }
            }
            return best;
        }

        bool CanSee(Vector3 from, Vector3 to, Combatant other)
        {
            var dir = to - from;
            if (!Physics.Raycast(from, dir.normalized, out var hit, dir.magnitude, ~0, QueryTriggerInteraction.Ignore)) return true;
            if (hit.collider.transform.IsChildOf(transform)) return true;
            return hit.collider.GetComponentInParent<Combatant>() == other;
        }
    }
}
