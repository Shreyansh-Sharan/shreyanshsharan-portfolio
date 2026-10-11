using Arena.Fx;
using Unity.Netcode;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>
    /// Hitscan pulse rifle. Players detect hits locally (instant feedback) and the server applies damage;
    /// bots fire on the server. Overdrive doubles damage; headshots double it again.
    /// </summary>
    public class Weapon : NetworkBehaviour
    {
        public Transform Muzzle;
        public int Damage = 18;
        public float FireInterval = 0.1f;
        public int MagazineSize = 30;
        public float ReloadTime = 1.4f;
        public float Range = 160f;
        public float BaseSpread = 0.35f;
        public float MoveSpread = 1.4f;
        public float BloomPerShot = 0.32f;
        public float MaxBloom = 2.6f;
        public float RecoilKick = 0.9f;

        public int Ammo { get; private set; }
        public bool Reloading => reloadEnd > 0;
        public float ReloadProgress => Reloading ? 1f - Mathf.Clamp01((reloadEnd - Time.time) / ReloadTime) : 1f;
        public float CurrentSpread { get; private set; }

        Combatant me;
        float nextFire, reloadEnd, bloom, lastServerShot;
        static readonly RaycastHit[] Hits = new RaycastHit[24];

        void Awake()
        {
            me = GetComponent<Combatant>();
            Ammo = MagazineSize;
        }

        void Update()
        {
            bloom = Mathf.MoveTowards(bloom, 0, Time.deltaTime * 4f);
            if (Reloading && Time.time >= reloadEnd)
            {
                reloadEnd = 0;
                Ammo = MagazineSize;
            }
            if (!me.Alive.Value)
            {
                reloadEnd = 0;
                Ammo = MagazineSize;
            }
        }

        public void StartReload()
        {
            if (Reloading || Ammo >= MagazineSize) return;
            reloadEnd = Time.time + ReloadTime;
            if (IsOwner && !me.IsBot) Sfx.Play2D(Sfx.Reload, 0.6f);
        }

        Vector3 Scatter(Vector3 forward, Transform basis, float degrees)
        {
            var offset = UnityEngine.Random.insideUnitCircle * Mathf.Tan(degrees * Mathf.Deg2Rad);
            return (forward + basis.right * offset.x + basis.up * offset.y).normalized;
        }

        /// <summary>Owner-side shot from the camera. Returns true when a round was fired.</summary>
        public bool TryFireLocal(Transform view, bool moving)
        {
            if (Time.time < nextFire || Reloading || !me.Alive.Value) return false;
            if (Ammo <= 0)
            {
                StartReload();
                return false;
            }
            nextFire = Time.time + FireInterval;
            Ammo--;

            CurrentSpread = BaseSpread + bloom + (moving ? MoveSpread : 0f);
            bloom = Mathf.Min(MaxBloom, bloom + BloomPerShot);
            var dir = Scatter(view.forward, view, CurrentSpread);

            Vector3 end = view.position + dir * Range;
            ulong targetId = ulong.MaxValue;
            bool headshot = false;
            if (Trace(view.position, dir, out var hit, out var target))
            {
                end = hit.point;
                if (target != null)
                {
                    targetId = target.NetworkObjectId;
                    headshot = hit.point.y > target.transform.position.y + 1.42f;
                }
                else FxLibrary.Impact(hit.point, hit.normal);
            }

            var from = Muzzle ? Muzzle.position : view.position;
            FxLibrary.Tracer(from, end, me.Color);
            FxLibrary.MuzzleFlash(from, me.Color);
            Sfx.Play2D(Sfx.Shot, 0.45f, UnityEngine.Random.Range(0.95f, 1.05f));
            ShootRpc(from, end, targetId, headshot);

            if (Ammo == 0) StartReload();
            return true;
        }

        /// <summary>Server-side shot for bots.</summary>
        public bool ServerFire(Vector3 origin, Vector3 aimDir, float errorDegrees)
        {
            if (!IsServer || Time.time < nextFire || Reloading || !me.Alive.Value) return false;
            if (Ammo <= 0)
            {
                StartReload();
                return false;
            }
            nextFire = Time.time + FireInterval * 1.15f;
            Ammo--;

            var basis = Quaternion.LookRotation(aimDir);
            var offset = UnityEngine.Random.insideUnitCircle * Mathf.Tan(errorDegrees * Mathf.Deg2Rad);
            var dir = (aimDir + basis * Vector3.right * offset.x + basis * Vector3.up * offset.y).normalized;

            Vector3 end = origin + dir * Range;
            bool impact = false;
            if (Trace(origin, dir, out var hit, out var target))
            {
                end = hit.point;
                if (target != null)
                {
                    bool headshot = hit.point.y > target.transform.position.y + 1.42f;
                    target.ServerDamage(DamageFor(headshot), me, headshot);
                }
                else impact = true;
            }
            TracerRpc(Muzzle ? Muzzle.position : origin, end, impact);
            if (Ammo == 0) StartReload();
            return true;
        }

        int DamageFor(bool headshot) => Mathf.RoundToInt(Damage * (headshot ? 2f : 1f) * (me.HasOverdrive ? 2f : 1f));

        /// <summary>Nearest hit along the ray that isn't this combatant.</summary>
        bool Trace(Vector3 origin, Vector3 dir, out RaycastHit best, out Combatant target)
        {
            best = default;
            target = null;
            int count = Physics.RaycastNonAlloc(origin, dir, Hits, Range, ~0, QueryTriggerInteraction.Ignore);
            float bestDistance = float.MaxValue;
            for (int i = 0; i < count; i++)
            {
                var h = Hits[i];
                if (h.collider.transform.IsChildOf(transform)) continue;
                if (h.distance < bestDistance)
                {
                    bestDistance = h.distance;
                    best = h;
                }
            }
            if (bestDistance == float.MaxValue) return false;
            target = best.collider.GetComponentInParent<Combatant>();
            return true;
        }

        [Rpc(SendTo.Server)]
        void ShootRpc(Vector3 from, Vector3 to, ulong targetId, bool headshot)
        {
            // Light sanity checks: rate limit and range. Good enough for a portfolio game among friends.
            if (Time.time - lastServerShot < FireInterval * 0.6f || !me.Alive.Value) return;
            lastServerShot = Time.time;

            if (targetId != ulong.MaxValue
                && NetworkManager.SpawnManager.SpawnedObjects.TryGetValue(targetId, out var obj)
                && obj.TryGetComponent<Combatant>(out var target)
                && target != me
                && Vector3.Distance(from, target.transform.position) < Range + 5f)
            {
                target.ServerDamage(DamageFor(headshot), me, headshot);
            }
            TracerRpc(from, to, targetId == ulong.MaxValue);
        }

        [Rpc(SendTo.Everyone)]
        void TracerRpc(Vector3 from, Vector3 to, bool impact)
        {
            if (IsOwner && !me.IsBot) return; // the shooter already drew it
            FxLibrary.Tracer(from, to, me.Color);
            FxLibrary.MuzzleFlash(from, me.Color);
            if (impact) FxLibrary.Impact(to, (from - to).normalized);
            Sfx.PlayAt(Sfx.Shot, from, 0.55f, UnityEngine.Random.Range(0.9f, 1.05f));
        }

        public void ResetAmmo()
        {
            Ammo = MagazineSize;
            reloadEnd = 0;
        }
    }
}
