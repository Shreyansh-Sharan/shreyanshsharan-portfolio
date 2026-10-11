using Arena.Core;
using Arena.Map;
using Unity.Netcode;
using UnityEngine;
using UnityEngine.AI;

namespace Arena.Game
{
    /// <summary>
    /// Server-side AI opponent: roams between points of interest, engages anyone it can see, strafes
    /// while shooting, grabs health when hurt and pops its overshield under pressure. Each bot plays a
    /// weapon role and fights at that weapon's range: snipers hold long angles from perches and stand still
    /// to shoot (pulling the sidearm up close), shotguns push in and hunt, rifles and SMGs keep their distance band.
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
            public float Reaction, AimError, AimSettle, ViewRange, Speed, HeadAim;
        }

        static readonly Skill[] Skills =
        {
            new Skill { Reaction = 0.65f, AimError = 7.5f, AimSettle = 0.35f, ViewRange = 40f, Speed = 4.8f, HeadAim = 0.06f },
            new Skill { Reaction = 0.38f, AimError = 4.2f, AimSettle = 0.55f, ViewRange = 55f, Speed = 5.6f, HeadAim = 0.12f },
            new Skill { Reaction = 0.2f, AimError = 2.2f, AimSettle = 0.75f, ViewRange = 70f, Speed = 6.2f, HeadAim = 0.18f },
        };

        /// <summary>Roles handed out in turn, so a lobby always has a mix (rifles most common).</summary>
        static readonly WeaponKind[] Roles =
        {
            WeaponKind.Rifle, WeaponKind.Smg, WeaponKind.Sniper, WeaponKind.Shotgun, WeaponKind.Rifle,
            WeaponKind.Smg, WeaponKind.Rifle, WeaponKind.Shotgun, WeaponKind.Sniper, WeaponKind.Rifle,
        };
        static int nextRole;

        NavMeshAgent agent;
        Combatant me;
        Weapon weapon;
        Skill skill;
        WeaponKind role;
        Combatant target;
        float seenSince, lastSeen, nextThink, nextStrafe, engagedFor, holdUntil, holdYaw;
        Vector3 lastSeenPos, perchGoal;
        bool hasLastSeen, goingToPerch;

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
            role = Roles[nextRole++ % Roles.Length];
            weapon.ServerSetPrimary(role);
            weapon.Equip(role);
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
            goingToPerch = false;
            holdUntil = 0;
            // Now and then a bot tries a different weapon for its next life.
            if (Random.value < 0.2f) role = Roles[Random.Range(0, Roles.Length)];
            weapon.ServerSetPrimary(role);
            weapon.ResetAmmo();
            if (agent.enabled) agent.Warp(point);
            else transform.position = point;
        }

        WeaponSpec Spec => weapon.Spec;

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

            // Face the target when fighting, the held angle (slowly sweeping) when holding, else the way we're walking.
            Vector3 look;
            if (target != null) look = target.transform.position - transform.position;
            else if (Time.time < holdUntil) look = Quaternion.Euler(0f, holdYaw + Mathf.Sin(Time.time * 0.7f) * 22f, 0f) * Vector3.forward;
            else look = agent.velocity;
            look.y = 0;
            if (look.sqrMagnitude > 0.01f)
                transform.rotation = Quaternion.RotateTowards(transform.rotation, Quaternion.LookRotation(look), 540f * Time.deltaTime);

            var spec = Spec;
            float reaction = skill.Reaction + (spec.Scope ? 0.25f : 0f);
            if (target != null && Time.time - seenSince >= reaction)
            {
                engagedFor += Time.deltaTime;
                var eye = me.AimPoint;
                float distance = Vector3.Distance(eye, target.AimPoint);
                // Snipers take a moment to settle the scope; nobody wastes pellets far beyond a shotgun's reach.
                bool inReach = distance <= spec.Range * 0.95f && (spec.Pellets == 1 || distance <= spec.BotMaxRange * 3f);
                bool settled = !spec.Scope || engagedFor > 0.35f;
                if (inReach && settled)
                {
                    var aimAt = target.transform.position + Vector3.up * (Random.value < skill.HeadAim ? 1.62f : 1.0f);
                    float settle = Mathf.Lerp(1.6f, skill.AimSettle, Mathf.Clamp01(engagedFor / 1.5f));
                    float error = skill.AimError * settle * (spec.Scope ? 0.55f : 1f);
                    weapon.ServerFire(eye, (aimAt - eye).normalized, error);
                }
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
                holdUntil = 0;
                goingToPerch = false;
            }
            else if (target != null && Time.time - lastSeen > 0.4f)
            {
                target = null;
            }

            ChooseWeapon();
            agent.speed = skill.Speed * Spec.MoveSpeed;

            if (me.Health.Value < 50 && Random.value < 0.25f) me.ServerTryOvershield();

            if (target != null)
            {
                if (Time.time >= nextStrafe) Strafe();
                return;
            }

            // Shotguns chase a lost target for longer.
            float memory = role == WeaponKind.Shotgun ? 6f : 4f;
            if (hasLastSeen && Time.time - lastSeen < memory)
            {
                MoveTo(lastSeenPos);
                if (Vector3.Distance(transform.position, lastSeenPos) < 2f) hasLastSeen = false;
                return;
            }

            if (Time.time < holdUntil)
            {
                if (agent.isOnNavMesh && agent.hasPath) agent.ResetPath();
                return;
            }
            if (goingToPerch)
            {
                var flat = perchGoal - transform.position;
                flat.y = 0;
                if (flat.magnitude < 1.6f)
                {
                    goingToPerch = false;
                    holdUntil = Time.time + Random.Range(6f, 12f);
                    return;
                }
                if (!agent.hasPath || agent.remainingDistance < 0.5f) MoveTo(perchGoal);
                return;
            }

            if (!agent.hasPath || agent.remainingDistance < 1.5f) MoveTo(PickRoamGoal());
        }

        /// <summary>Snipers pull the sidearm when someone is in their face; everyone goes back to their role weapon after.</summary>
        void ChooseWeapon()
        {
            var want = role;
            if (target != null && weapon.Owns(WeaponKind.Pistol))
            {
                float d = Vector3.Distance(transform.position, target.transform.position);
                if (role == WeaponKind.Sniper && d < 9f) want = WeaponKind.Pistol;
            }
            if (!weapon.Owns(want)) want = weapon.BestOwned();
            if (weapon.Kind != want && !weapon.Reloading) weapon.Equip(want);
        }

        void Strafe()
        {
            var spec = Spec;
            var toTarget = target.transform.position - transform.position;
            toTarget.y = 0;
            float distance = toTarget.magnitude;
            var dir = distance > 0.01f ? toTarget / distance : transform.forward;
            float sign = Random.value < 0.5f ? -1f : 1f;

            if (spec.BotHolds && distance >= spec.BotMinRange)
            {
                // Hold still to shoot; just a small jiggle now and then.
                nextStrafe = Time.time + Random.Range(1.4f, 2.4f);
                MoveTo(transform.position + Vector3.Cross(Vector3.up, dir) * sign * Random.Range(0.6f, 1.4f));
                return;
            }

            nextStrafe = Time.time + Random.Range(0.6f, 1.3f);
            var side = Vector3.Cross(Vector3.up, dir) * sign * Random.Range(2.5f, 5f);
            Vector3 range = Vector3.zero;
            if (distance > spec.BotMaxRange) range = dir * Mathf.Min(distance - spec.BotMaxRange + 2f, role == WeaponKind.Shotgun ? 9f : 5f);
            else if (distance < spec.BotMinRange) range = -dir * 3f;
            // Shotguns close in rather than circling.
            if (role == WeaponKind.Shotgun && weapon.Kind == WeaponKind.Shotgun) side *= 0.5f;
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
                    if (!p.Active.Value || p.Kind.Value != (byte)PickupKind.Health) continue;
                    float d = Vector3.Distance(p.transform.position, transform.position);
                    if (d < bestDistance) { bestDistance = d; best = p; }
                }
                if (best != null) return best.transform.position;
            }

            var map = MapRuntime.Current;
            // Snipers (and some riflemen) go and hold a long angle.
            bool holds = role == WeaponKind.Sniper || (role == WeaponKind.Rifle && Random.value < 0.25f);
            if (holds && map.Perches.Length > 0)
            {
                var perch = map.Perches[Random.Range(0, map.Perches.Length)];
                perchGoal = map.ToWorld(perch.Position);
                holdYaw = perch.Yaw;
                goingToPerch = true;
                return perchGoal;
            }

            // Shotguns hunt: half the time they head straight for the nearest enemy.
            if (role == WeaponKind.Shotgun && Random.value < 0.5f)
            {
                Combatant nearest = null;
                float bestDistance = float.MaxValue;
                foreach (var c in Combatant.All)
                {
                    if (c == me || !c.Alive.Value) continue;
                    float d = Vector3.Distance(c.transform.position, transform.position);
                    if (d < bestDistance) { bestDistance = d; nearest = c; }
                }
                if (nearest != null) return nearest.transform.position;
            }

            var points = map.Waypoints;
            return map.ToWorld(points[Random.Range(0, points.Length)]) + new Vector3(Random.Range(-3f, 3f), 0, Random.Range(-3f, 3f));
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
            var spec = Spec;
            // Scoped weapons see further; shotgunners care about what's close.
            float viewRange = skill.ViewRange * (role == WeaponKind.Sniper ? 1.7f : role == WeaponKind.Shotgun ? 0.85f : 1f);
            foreach (var c in Combatant.All)
            {
                if (c == me || !c.Alive.Value) continue;
                var aim = c.transform.position + Vector3.up * 1.3f;
                float d = Vector3.Distance(eye, aim);
                if (d > viewRange) continue;

                // Field of view: wide, but not eyes in the back of the head (unless it's our current target).
                // Holding an angle narrows it: a sniper watches its lane.
                var dir = (aim - eye).normalized;
                float minDot = Time.time < holdUntil && spec.Scope ? 0.35f : -0.2f;
                if (c != target && Vector3.Dot(transform.forward, dir) < minDot && d > 6f) continue;
                if (!CanSee(eye, aim, c)) continue;

                float score = d * (c == target ? 0.6f : 1f);
                if (score < bestScore) { bestScore = score; best = c; }
            }
            return best;
        }

        bool CanSee(Vector3 from, Vector3 to, Combatant other)
        {
            var dir = to - from;
            if (!Physics.Raycast(from, dir.normalized, out var hit, dir.magnitude, Weapon.ShotMask, QueryTriggerInteraction.Ignore)) return true;
            if (hit.collider.transform.IsChildOf(transform)) return true;
            return hit.collider.GetComponentInParent<Combatant>() == other;
        }
    }
}
