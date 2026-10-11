using Arena.Core;
using Arena.Fx;
using Unity.Netcode;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>
    /// A combatant's arsenal: the P9 sidearm plus a primary chosen at spawn and any weapons picked up from crates
    /// (see <see cref="WeaponSpec"/>). Hitscan: players detect hits locally (instant feedback) and the server applies
    /// damage with range falloff and per-weapon headshot multipliers; bots fire on the server. Overdrive doubles damage.
    /// Ammo is per weapon with unlimited reserves: only the magazine and the reload matter.
    /// </summary>
    public class Weapon : NetworkBehaviour
    {
        public Transform Muzzle;
        [Tooltip("The emissive strip on the gun; tinted per weapon.")]
        public Renderer Glow;

        /// <summary>Shots and bot sight lines skip the Ignore Raycast layer (the invisible walls over water).</summary>
        public const int ShotMask = Physics.DefaultRaycastLayers;

        /// <summary>The weapon in hand. Written by the owner (players switch instantly), read by everyone.</summary>
        public readonly NetworkVariable<byte> Current = new NetworkVariable<byte>((byte)WeaponKind.Rifle,
            NetworkVariableReadPermission.Everyone, NetworkVariableWritePermission.Owner);
        /// <summary>Bit mask of weapons carried (1 &lt;&lt; WeaponKind). The server decides.</summary>
        public readonly NetworkVariable<byte> Owned = new NetworkVariable<byte>((byte)(Bit(WeaponKind.Pistol) | Bit(WeaponKind.Rifle)));
        /// <summary>The primary this combatant spawns with.</summary>
        public readonly NetworkVariable<byte> Primary = new NetworkVariable<byte>((byte)WeaponKind.Rifle);

        public WeaponKind Kind => (WeaponKind)Index;
        int Index => Mathf.Min(Current.Value, WeaponSpec.All.Length - 1);
        public WeaponSpec Spec => WeaponSpec.Get(Current.Value);
        public WeaponKind PrimaryKind => (WeaponKind)Primary.Value;
        public int Ammo => ammo[Index];
        public int MagazineSize => Spec.MagazineSize;
        public bool Reloading => reloadEnd > 0;
        public float ReloadProgress => Reloading ? 1f - Mathf.Clamp01((reloadEnd - Time.time) / reloadDuration) : 1f;
        public bool Drawing => Time.time < drawEnd;
        public float DrawProgress => Drawing ? 1f - Mathf.Clamp01((drawEnd - Time.time) / Spec.DrawTime) : 1f;
        /// <summary>Spread of the last shot, in degrees.</summary>
        public float CurrentSpread { get; private set; }
        /// <summary>Time of the last shot fired by this client (for view kick).</summary>
        public float LastShotTime { get; private set; } = -10f;
        public bool Owns(WeaponKind kind) => (Owned.Value & Bit(kind)) != 0;

        public static byte Bit(WeaponKind kind) => (byte)(1 << (int)kind);

        Combatant me;
        readonly int[] ammo = new int[WeaponSpec.All.Length];
        float nextFire, reloadEnd, reloadDuration = 1f, drawEnd, bloom, lastServerShot, boltAt;
        int spray;
        byte shownKind = byte.MaxValue;
        MaterialPropertyBlock block;
        static readonly RaycastHit[] Hits = new RaycastHit[24];
        static readonly Combatant[] PelletTargets = new Combatant[16];
        static readonly bool[] PelletHeads = new bool[16];
        static readonly Vector3[] PelletPoints = new Vector3[16];

        void Awake()
        {
            me = GetComponent<Combatant>();
            RefillAll();
        }

        public override void OnNetworkSpawn()
        {
            Current.OnValueChanged += OnCurrentChanged;
            Owned.OnValueChanged += OnOwnedChanged;
            me.Alive.OnValueChanged += OnAliveChanged;
            ApplyLook();
            // Players tell the server which primary they picked on the page or in the menu, and get it right away.
            if (IsOwner && !me.IsBot) LoadoutRpc((byte)LaunchOptions.Current.Primary, true);
        }

        public override void OnNetworkDespawn()
        {
            Current.OnValueChanged -= OnCurrentChanged;
            Owned.OnValueChanged -= OnOwnedChanged;
            if (me) me.Alive.OnValueChanged -= OnAliveChanged;
        }

        void OnCurrentChanged(byte previous, byte current) => ApplyLook();

        void OnOwnedChanged(byte previous, byte current)
        {
            if (!IsOwner) return;
            // Picked up something new: switch to it, the way a weapon crate should feel.
            int added = current & ~previous;
            for (int k = WeaponSpec.All.Length - 1; k > 0; k--)
                if ((added & (1 << k)) != 0)
                {
                    Equip((WeaponKind)k);
                    return;
                }
        }

        void OnAliveChanged(bool previous, bool current)
        {
            if (!current || !IsOwner) return;
            RefillAll();
            Equip(Owns(PrimaryKind) ? PrimaryKind : BestOwned());
        }

        void Update()
        {
            var spec = Spec;
            if (Time.time - LastShotTime > Mathf.Max(0.12f, spec.FireInterval * 1.5f))
            {
                bloom = Mathf.MoveTowards(bloom, 0, Time.deltaTime * spec.BloomRecovery);
                spray = 0;
            }
            if (Reloading && Time.time >= reloadEnd)
            {
                reloadEnd = 0;
                ammo[Index] = spec.MagazineSize;
            }
            if (boltAt > 0 && Time.time >= boltAt)
            {
                boltAt = 0;
                if (IsOwner && !me.IsBot) Sfx.Play2D(Sfx.Bolt, 0.45f);
            }
            if (!me.Alive.Value)
            {
                reloadEnd = 0;
                RefillAll();
            }
            if (shownKind != Current.Value) ApplyLook();
            // Lost the weapon in hand (respawned with a different loadout): fall back to the best one carried.
            if (IsOwner && IsSpawned && me.Alive.Value && !Owns(Kind)) Equip(BestOwned());
        }

        // ---------------- Switching and loadout ----------------

        /// <summary>Owner-side: draws a carried weapon. Returns false when it isn't carried.</summary>
        public bool Equip(WeaponKind kind)
        {
            if (!IsOwner || !IsSpawned || !Owns(kind)) return false;
            if ((byte)kind == Current.Value) return true;
            Current.Value = (byte)kind;
            reloadEnd = 0;
            boltAt = 0;
            bloom = 0;
            spray = 0;
            drawEnd = Time.time + WeaponSpec.Get(kind).DrawTime;
            if (!me.IsBot) Sfx.Play2D(Sfx.Draw, 0.55f);
            ApplyLook();
            return true;
        }

        /// <summary>Owner-side: the next (or previous) carried weapon, for the mouse wheel.</summary>
        public void Cycle(int direction)
        {
            int n = WeaponSpec.All.Length;
            for (int i = 1; i < n; i++)
            {
                var k = (WeaponKind)(((int)Current.Value + direction * i + n * 4) % n);
                if (Owns(k))
                {
                    Equip(k);
                    return;
                }
            }
        }

        /// <summary>The weapon to fall back to: the spawn primary, else the strongest carried, else the sidearm.</summary>
        public WeaponKind BestOwned()
        {
            if (Owns(PrimaryKind)) return PrimaryKind;
            foreach (var k in new[] { WeaponKind.Rifle, WeaponKind.Smg, WeaponKind.Shotgun, WeaponKind.Sniper })
                if (Owns(k)) return k;
            return WeaponKind.Pistol;
        }

        /// <summary>Owner-side: picks the primary for the next spawn.</summary>
        public void ChooseLoadout(WeaponKind kind)
        {
            if (kind == WeaponKind.Pistol || !IsSpawned) return;
            LoadoutRpc((byte)kind, false);
        }

        [Rpc(SendTo.Server)]
        void LoadoutRpc(byte kind, bool armNow)
        {
            if (kind == (byte)WeaponKind.Pistol || kind >= WeaponSpec.All.Length) kind = (byte)WeaponKind.Rifle;
            Primary.Value = kind;
            if (armNow && me.Alive.Value) ServerArm();
        }

        /// <summary>Server: the spawn loadout, sidearm plus primary. Picked-up weapons are lost on death.</summary>
        public void ServerArm() => Owned.Value = (byte)(Bit(WeaponKind.Pistol) | Bit(PrimaryKind));

        /// <summary>Server: adds a weapon from a crate. False when it's already carried (the crate stays).</summary>
        public bool ServerGive(WeaponKind kind)
        {
            if (!IsServer || Owns(kind)) return false;
            Owned.Value = (byte)(Owned.Value | Bit(kind));
            return true;
        }

        /// <summary>Server: sets a bot's primary and arms it.</summary>
        public void ServerSetPrimary(WeaponKind kind)
        {
            Primary.Value = (byte)kind;
            ServerArm();
        }

        void ApplyLook()
        {
            shownKind = Current.Value;
            var spec = Spec;
            var gun = Muzzle ? Muzzle.parent : null;
            if (gun) gun.localScale = spec.ModelScale;
            if (Glow)
            {
                block ??= new MaterialPropertyBlock();
                Glow.GetPropertyBlock(block);
                block.SetColor("_Color", spec.Tint);
                block.SetColor("_EmissionColor", spec.Tint * 2.2f);
                Glow.SetPropertyBlock(block);
            }
        }

        // ---------------- Firing ----------------

        public void StartReload()
        {
            var spec = Spec;
            if (Reloading || Drawing || ammo[Index] >= spec.MagazineSize) return;
            reloadDuration = spec.ReloadTime;
            reloadEnd = Time.time + reloadDuration;
            boltAt = 0;
            if (IsOwner && !me.IsBot) Sfx.Play2D(Sfx.Reload, 0.6f);
        }

        /// <summary>The cone (degrees) a shot would leave in right now.</summary>
        public float SpreadFor(bool moving, bool aiming, bool scoped)
        {
            var s = Spec;
            float spread = s.BaseSpread + bloom + (moving ? s.MoveSpread : 0f);
            if (s.Scope) spread = scoped ? spread : spread + s.HipPenalty;
            else if (aiming) spread *= s.AdsSpread;
            return spread;
        }

        static Vector3 Scatter(Vector3 forward, Vector3 right, Vector3 up, float degrees)
        {
            var offset = Random.insideUnitCircle * Mathf.Tan(degrees * Mathf.Deg2Rad);
            return (forward + right * offset.x + up * offset.y).normalized;
        }

        /// <summary>
        /// Owner-side shot from the camera. Returns the recoil to apply (up, right) in degrees, or null when nothing fired.
        /// </summary>
        public Vector2? TryFireLocal(Transform view, bool moving, bool aiming, bool scoped)
        {
            var spec = Spec;
            if (Time.time < nextFire || Reloading || Drawing || !me.Alive.Value) return null;
            if (ammo[Index] <= 0)
            {
                Sfx.Play2D(Sfx.Empty, 0.5f);
                StartReload();
                return null;
            }
            nextFire = Time.time + spec.FireInterval;
            ammo[Index]--;
            LastShotTime = Time.time;

            CurrentSpread = SpreadFor(moving, aiming, scoped);
            bloom = Mathf.Min(spec.MaxBloom, bloom + spec.BloomPerShot);
            var recoil = spec.Recoil(spray++);

            var from = Muzzle ? Muzzle.position : view.position;
            var color = Color.Lerp(me.Color, spec.Tint, 0.5f);
            int pellets = Mathf.Min(spec.Pellets, PelletTargets.Length);
            Vector3 lastEnd = view.position + view.forward * spec.Range;
            for (int i = 0; i < pellets; i++)
            {
                var dir = Scatter(view.forward, view.right, view.up, CurrentSpread);
                var end = view.position + dir * spec.Range;
                PelletTargets[i] = null;
                if (Trace(view.position, dir, spec.Range, out var hit, out var target))
                {
                    end = hit.point;
                    if (target != null)
                    {
                        PelletTargets[i] = target;
                        PelletHeads[i] = target.IsHeadshot(hit.point);
                        PelletPoints[i] = hit.point;
                    }
                    else FxLibrary.Impact(hit.point, hit.normal);
                }
                FxLibrary.Tracer(from, end, color, spec.TracerWidth);
                lastEnd = end;
            }

            // Shotguns can hit several people; the pellets count against whoever took the most.
            var victim = MostHit(pellets, out int body, out int head, out var point);
            FxLibrary.MuzzleFlash(from, me.Color, spec.FlashSize);
            Sfx.Play2D(spec.Sound, spec.Volume, Random.Range(0.95f, 1.05f));
            if (spec.Kind == WeaponKind.Sniper) boltAt = Time.time + 0.4f;
            ShootRpc(Current.Value, from, victim != null ? point : lastEnd, victim != null ? victim.NetworkObjectId : ulong.MaxValue, (byte)body, (byte)head);

            if (ammo[Index] == 0) StartReload();
            return recoil;
        }

        static Combatant MostHit(int pellets, out int body, out int head, out Vector3 point)
        {
            Combatant best = null;
            body = head = 0;
            point = Vector3.zero;
            int bestCount = 0;
            for (int i = 0; i < pellets; i++)
            {
                var t = PelletTargets[i];
                if (t == null || t == best) continue;
                int count = 0;
                for (int j = 0; j < pellets; j++) if (PelletTargets[j] == t) count++;
                if (count > bestCount)
                {
                    bestCount = count;
                    best = t;
                }
            }
            if (best == null) return null;
            for (int i = 0; i < pellets; i++)
            {
                if (PelletTargets[i] != best) continue;
                if (PelletHeads[i])
                {
                    head++;
                    point = PelletPoints[i];
                }
                else
                {
                    body++;
                    if (head == 0) point = PelletPoints[i];
                }
            }
            return best;
        }

        /// <summary>Server-side shot for bots.</summary>
        public bool ServerFire(Vector3 origin, Vector3 aimDir, float errorDegrees)
        {
            var spec = Spec;
            if (!IsServer || Time.time < nextFire || Reloading || Drawing || !me.Alive.Value) return false;
            if (ammo[Index] <= 0)
            {
                StartReload();
                return false;
            }
            nextFire = Time.time + spec.FireInterval * 1.15f;
            ammo[Index]--;
            LastShotTime = Time.time;

            var basis = Quaternion.LookRotation(aimDir);
            Vector3 right = basis * Vector3.right, up = basis * Vector3.up;
            var aimed = Scatter(aimDir, right, up, errorDegrees);
            int pellets = Mathf.Min(spec.Pellets, PelletTargets.Length);
            Vector3 lastEnd = origin + aimed * spec.Range;
            bool impact = false;
            for (int i = 0; i < pellets; i++)
            {
                var dir = pellets > 1 ? Scatter(aimed, right, up, spec.BaseSpread) : aimed;
                PelletTargets[i] = null;
                lastEnd = origin + dir * spec.Range;
                if (Trace(origin, dir, spec.Range, out var hit, out var target))
                {
                    lastEnd = hit.point;
                    if (target != null)
                    {
                        PelletTargets[i] = target;
                        PelletHeads[i] = target.IsHeadshot(hit.point);
                        PelletPoints[i] = hit.point;
                    }
                    else impact = true;
                }
            }
            var victim = MostHit(pellets, out int body, out int head, out var point);
            if (victim != null)
            {
                float distance = Vector3.Distance(origin, victim.AimPoint);
                victim.ServerDamage(DamageFor(spec, body, head, distance), me, head > 0, (byte)spec.Kind);
                lastEnd = point;
            }
            TracerRpc(Current.Value, Muzzle ? Muzzle.position : origin, lastEnd, impact && victim == null);
            if (ammo[Index] == 0) StartReload();
            return true;
        }

        int DamageFor(WeaponSpec spec, int body, int head, float distance) =>
            Mathf.RoundToInt(spec.Damage * (body + head * spec.HeadshotMultiplier) * spec.Falloff(distance) * (me.HasOverdrive ? 2f : 1f));

        /// <summary>Nearest hit along the ray that isn't this combatant.</summary>
        bool Trace(Vector3 origin, Vector3 dir, float range, out RaycastHit best, out Combatant target)
        {
            best = default;
            target = null;
            int count = Physics.RaycastNonAlloc(origin, dir, Hits, range, ShotMask, QueryTriggerInteraction.Ignore);
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
        void ShootRpc(byte kind, Vector3 from, Vector3 to, ulong targetId, byte body, byte head)
        {
            // Light sanity checks: the weapon is carried, rate limit, pellet count and range. Good enough for a
            // portfolio game among friends.
            var spec = WeaponSpec.Get(kind);
            if (kind >= WeaponSpec.All.Length || !Owns((WeaponKind)kind) || !me.Alive.Value) return;
            if (Time.time - lastServerShot < spec.FireInterval * 0.6f) return;
            lastServerShot = Time.time;

            if (targetId != ulong.MaxValue
                && NetworkManager.SpawnManager.SpawnedObjects.TryGetValue(targetId, out var obj)
                && obj.TryGetComponent<Combatant>(out var target)
                && target != me
                && Vector3.Distance(from, target.transform.position) < spec.Range + 5f)
            {
                int pellets = Mathf.Min(body + head, spec.Pellets);
                int heads = Mathf.Min(head, pellets);
                // Loose check on claimed headshots (positions differ a little between client and server).
                if (to.y <= target.transform.position.y + Combatant.HeadHeight - 0.6f) heads = 0;
                float distance = Vector3.Distance(from, target.AimPoint);
                if (pellets > 0)
                    target.ServerDamage(DamageFor(spec, pellets - heads, heads, distance), me, heads > 0, kind);
            }
            TracerRpc(kind, from, to, targetId == ulong.MaxValue);
        }

        [Rpc(SendTo.Everyone)]
        void TracerRpc(byte kind, Vector3 from, Vector3 to, bool impact)
        {
            if (IsOwner && !me.IsBot) return; // the shooter already drew it
            var spec = WeaponSpec.Get(kind);
            var color = Color.Lerp(me.Color, spec.Tint, 0.5f);
            if (spec.Pellets > 1)
            {
                // Only the main hit travels over the network; the rest of the spread is redrawn locally.
                var dir = to - from;
                float length = dir.magnitude;
                var basis = Quaternion.LookRotation(length > 0.01f ? dir : Vector3.forward);
                for (int i = 0; i < spec.Pellets; i++)
                {
                    var d = Scatter(dir / Mathf.Max(0.01f, length), basis * Vector3.right, basis * Vector3.up, spec.BaseSpread);
                    FxLibrary.Tracer(from, from + d * length, color, spec.TracerWidth);
                }
            }
            else FxLibrary.Tracer(from, to, color, spec.TracerWidth);
            FxLibrary.MuzzleFlash(from, me.Color, spec.FlashSize);
            if (impact) FxLibrary.Impact(to, (from - to).normalized);
            Sfx.PlayAt(spec.Sound, from, spec.Volume + 0.1f, Random.Range(0.9f, 1.05f));
        }

        void RefillAll()
        {
            for (int i = 0; i < ammo.Length; i++) ammo[i] = WeaponSpec.Get(i).MagazineSize;
        }

        public void ResetAmmo()
        {
            RefillAll();
            reloadEnd = 0;
            boltAt = 0;
        }
    }
}
