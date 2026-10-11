using Arena.Core;
using Arena.Fx;
using Arena.Map;
using Arena.UI;
using Unity.Netcode;
using Unity.Netcode.Components;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>
    /// First-person controller for the local player. Movement is owner-authoritative (NetworkTransform in
    /// Owner mode) so it feels instant even over Relay. Powers: double jump, dash, overshield, pulse scan.
    /// Weapons: 1 to 5 or the mouse wheel to switch, hold right mouse to aim down sights; the sniper's scope
    /// toggles through two zoom levels with right mouse (or the wheel while scoped).
    /// </summary>
    [RequireComponent(typeof(CharacterController))]
    public class PlayerController : NetworkBehaviour
    {
        public static PlayerController Local { get; private set; }

        [Header("Rig")]
        public Transform Head;
        public Transform GunModel;

        [Header("Movement")]
        public float MoveSpeed = 6.8f;
        public float GroundAccel = 70f;
        public float AirAccel = 18f;
        public float Gravity = 24f;
        public float JumpSpeed = 7.6f;
        public float DashSpeed = 26f;
        public float DashTime = 0.16f;
        public float MouseSensitivity = 2.0f;

        public const float DashCooldown = 4f;
        public const float ScanCooldown = 14f;
        public const float ScanDuration = 4f;
        public const float HasteMultiplier = 1.45f;
        public const float BaseFov = 78f;

        public Camera Camera { get; private set; }
        public float DashReadyAt { get; private set; }
        public float ScanReadyAt { get; private set; }
        public float ScanUntil { get; private set; }
        /// <summary>0 = hip; 1 = aiming down sights (or the first scope level); 2 = the second scope level.</summary>
        public int ZoomLevel { get; private set; }
        public bool Zoomed => ZoomLevel > 0;
        /// <summary>Looking through the sniper scope (the HUD draws the scope overlay).</summary>
        public bool Scoped => Zoomed && weapon != null && weapon.Spec.Scope;
        public bool Moving { get; private set; }
        public bool Dashing => Time.time < dashUntil;

        CharacterController cc;
        Combatant me;
        Weapon weapon;
        NetworkTransform netTransform;
        Vector3 velocity;
        float yaw, pitch, recoil, recoilYaw, adsBlend, triggerQueuedUntil;
        WeaponKind lastKind;
        static readonly Vector3 HipPosition = new Vector3(0.24f, -0.22f, 0.5f), AdsPosition = new Vector3(0f, -0.15f, 0.42f);
        int jumpsLeft;
        float dashUntil;
        Vector3 dashDir;

        void Awake()
        {
            cc = GetComponent<CharacterController>();
            me = GetComponent<Combatant>();
            weapon = GetComponent<Weapon>();
            netTransform = GetComponent<NetworkTransform>();
        }

        public override void OnNetworkSpawn()
        {
            if (!IsOwner) return;
            Local = this;

            var camGo = new GameObject("Player Camera");
            camGo.SetActive(false);
            camGo.transform.SetParent(Head, false);
            Camera = camGo.AddComponent<Camera>();
            Camera.fieldOfView = BaseFov;
            Camera.nearClipPlane = 0.05f;
            Camera.farClipPlane = 400f;
            camGo.AddComponent<AudioListener>();
            camGo.tag = "MainCamera";
            PostFx.Attach(Camera);
            camGo.SetActive(true);

            // View model: the gun hangs in front of the camera.
            if (GunModel)
            {
                GunModel.SetParent(camGo.transform, false);
                GunModel.localPosition = HipPosition;
                GunModel.localRotation = Quaternion.identity;
                if (weapon && weapon.Muzzle) weapon.Muzzle.SetParent(GunModel, true);
            }

            var boot = ArenaBootstrap.Instance;
            if (boot && boot.MenuCamera) boot.MenuCamera.gameObject.SetActive(false);

            MapRuntime.Changed += OnMapChanged;
            TeleportToSpawn();
        }

        // A joining client may spawn before the host's map choice arrives; move over once it does.
        void OnMapChanged(MapDefinition map) => TeleportToSpawn();

        void TeleportToSpawn()
        {
            var spawn = SpawnPicker.Pick(me);
            var toCenter = MapRuntime.Current.Center - spawn;
            toCenter.y = 0;
            Teleport(spawn, toCenter.sqrMagnitude > 0.01f ? Quaternion.LookRotation(toCenter).eulerAngles.y : 0f);
        }

        public override void OnNetworkDespawn()
        {
            if (!IsOwner) return;
            MapRuntime.Changed -= OnMapChanged;
            if (Local == this) Local = null;
            if (Camera) Destroy(Camera.gameObject);
            var boot = ArenaBootstrap.Instance;
            if (boot && boot.MenuCamera) boot.MenuCamera.gameObject.SetActive(true);
            Cursor.lockState = CursorLockMode.None;
            Cursor.visible = true;
        }

        public void Teleport(Vector3 position, float newYaw)
        {
            yaw = newYaw;
            pitch = 0;
            velocity = Vector3.zero;
            bool wasEnabled = cc.enabled;
            cc.enabled = false;
            transform.SetPositionAndRotation(position, Quaternion.Euler(0, yaw, 0));
            if (netTransform && netTransform.IsSpawned && netTransform.CanCommitToTransform)
                netTransform.Teleport(position, transform.rotation, transform.localScale);
            cc.enabled = wasEnabled || me.Alive.Value;
        }

        public static bool InputCaptured => Cursor.lockState == CursorLockMode.Locked && !ArenaHud.MenuOpen;

        void Update()
        {
            if (!IsOwner || !IsSpawned) return;

            bool matchOver = MatchManager.Instance != null && MatchManager.Instance.Ended.Value;
            bool alive = me.Alive.Value;

            // Click to capture the mouse (browsers require a click for pointer lock).
            if (!InputCaptured && Input.GetMouseButtonDown(0) && !ArenaHud.MenuOpen && !ArenaHud.PointerOverUi)
            {
                Cursor.lockState = CursorLockMode.Locked;
                Cursor.visible = false;
            }

            bool control = InputCaptured && alive && !matchOver;

            if (InputCaptured)
            {
                // Sensitivity follows the field of view, so zoomed aim moves the same distance on screen.
                float sens = MouseSensitivity * (Camera ? Camera.fieldOfView / BaseFov : 1f) * (Zoomed ? 0.9f : 1f);
                yaw += Input.GetAxisRaw("Mouse X") * sens;
                pitch -= Input.GetAxisRaw("Mouse Y") * sens;
            }
            // Recoil recovers slowly while the trigger is held (so the spray pattern shows) and quickly after.
            float recover = Time.time - weapon.LastShotTime < 0.15f ? 2.5f : 12f;
            recoil = Mathf.MoveTowards(recoil, 0, Time.deltaTime * recover);
            recoilYaw = Mathf.MoveTowards(recoilYaw, 0, Time.deltaTime * recover * 0.6f);
            pitch = Mathf.Clamp(pitch, -88f, 88f);
            transform.rotation = Quaternion.Euler(0, yaw, 0);
            Head.localRotation = Quaternion.Euler(pitch - recoil, recoilYaw, 0);

            if (!alive)
            {
                cc.enabled = false;
                ZoomLevel = 0;
                UpdateView();
                // While waiting to respawn, 2 to 5 pick the primary for the next life.
                if (InputCaptured)
                    for (int i = 1; i < WeaponSpec.All.Length; i++)
                        if (Input.GetKeyDown(KeyCode.Alpha1 + i) || Input.GetKeyDown(KeyCode.Keypad1 + i))
                        {
                            weapon.ChooseLoadout((WeaponKind)i);
                            var spec = WeaponSpec.Get(i);
                            ArenaHud.Toast($"NEXT SPAWN: {spec.Name.ToUpperInvariant()}", spec.Tint);
                        }
                return;
            }
            if (!cc.enabled) cc.enabled = true;

            Move(control);

            if (control)
            {
                if (Input.GetKeyDown(KeyCode.E) && me.OvershieldReadyAt.Value <= me.Now) me.OvershieldRpc();
                if (Input.GetKeyDown(KeyCode.F) && Time.time >= ScanReadyAt)
                {
                    ScanUntil = Time.time + ScanDuration;
                    ScanReadyAt = Time.time + ScanCooldown;
                    Sfx.Play2D(Sfx.Scan, 0.7f);
                }
                if (Input.GetKeyDown(KeyCode.R)) weapon.StartReload();

                for (int i = 0; i < WeaponSpec.All.Length; i++)
                    if (Input.GetKeyDown(KeyCode.Alpha1 + i) || Input.GetKeyDown(KeyCode.Keypad1 + i)) SelectSlot((WeaponKind)i);
                float wheel = Input.mouseScrollDelta.y;
                if (Mathf.Abs(wheel) > 0.01f)
                {
                    // The wheel switches weapons, except through a scope, where it steps the zoom.
                    if (Scoped) ZoomLevel = Mathf.Clamp(ZoomLevel + (wheel > 0 ? 1 : -1), 1, weapon.Spec.ZoomFov.Length);
                    else weapon.Cycle(wheel > 0 ? -1 : 1);
                }
                UpdateZoom();
                Fire();
            }
            else
            {
                ZoomLevel = 0;
            }

            UpdateView();
            if (transform.position.y < -20f) TeleportToSpawn();
        }

        void SelectSlot(WeaponKind kind)
        {
            if (weapon.Equip(kind)) return;
            var spec = WeaponSpec.Get(kind);
            ArenaHud.Toast($"NO {spec.Short} YET: GRAB ONE FROM A WEAPON CRATE", spec.Tint);
        }

        void UpdateZoom()
        {
            var spec = weapon.Spec;
            if (weapon.Kind != lastKind)
            {
                lastKind = weapon.Kind;
                ZoomLevel = 0;
            }
            if (weapon.Reloading || weapon.Drawing)
            {
                ZoomLevel = 0;
                return;
            }
            if (spec.Scope)
            {
                // Each right click steps in a level, then back out to the hip.
                if (Input.GetMouseButtonDown(1))
                {
                    ZoomLevel = (ZoomLevel + 1) % (spec.ZoomFov.Length + 1);
                    Sfx.Play2D(Sfx.ScopeIn, 0.5f, ZoomLevel == 0 ? 0.8f : 1f + 0.15f * ZoomLevel);
                }
            }
            else ZoomLevel = Input.GetMouseButton(1) ? 1 : 0;
        }

        void Fire()
        {
            var spec = weapon.Spec;
            // Semi-automatic weapons fire once per click; a click a moment early still counts.
            if (Input.GetMouseButtonDown(0)) triggerQueuedUntil = Time.time + 0.12f;
            bool wants = spec.Automatic ? Input.GetMouseButton(0) : Time.time < triggerQueuedUntil;
            if (!wants) return;
            var kick = weapon.TryFireLocal(Camera.transform, Moving, Zoomed, Scoped);
            if (!kick.HasValue) return;
            triggerQueuedUntil = 0;
            float scale = Zoomed ? 0.75f : 1f;
            recoil += kick.Value.x * scale;
            recoilYaw += kick.Value.y * scale;
        }

        /// <summary>Field of view and the view model: hip or sights, kick, reload dip, draw, hidden behind the scope.</summary>
        void UpdateView()
        {
            var spec = weapon.Spec;
            if (Camera)
            {
                float target = Zoomed ? spec.ZoomFov[Mathf.Clamp(ZoomLevel - 1, 0, spec.ZoomFov.Length - 1)] : BaseFov;
                Camera.fieldOfView = Mathf.Lerp(Camera.fieldOfView, target, Time.deltaTime * (spec.Scope ? 30f : 16f));
            }
            if (!GunModel) return;
            GunModel.gameObject.SetActive(!Scoped);
            adsBlend = Mathf.MoveTowards(adsBlend, Zoomed && !spec.Scope ? 1f : 0f, Time.deltaTime * 8f);
            var pos = Vector3.Lerp(HipPosition, AdsPosition, adsBlend);
            float kick = Mathf.Clamp01(1f - (Time.time - weapon.LastShotTime) / 0.12f);
            pos.z -= 0.025f * spec.RecoilKick * kick;
            pos.y -= 0.3f * (1f - weapon.DrawProgress);
            GunModel.localPosition = pos;
            float tilt = weapon.Reloading ? Mathf.Sin(weapon.ReloadProgress * Mathf.PI) * 32f : 0f;
            GunModel.localRotation = Quaternion.Euler(-3f * spec.RecoilKick * kick + tilt, 0f, tilt * 0.4f);
        }

        void Move(bool control)
        {
            Vector3 input = Vector3.zero;
            if (control)
            {
                if (Input.GetKey(KeyCode.W) || Input.GetKey(KeyCode.UpArrow)) input.z += 1;
                if (Input.GetKey(KeyCode.S) || Input.GetKey(KeyCode.DownArrow)) input.z -= 1;
                if (Input.GetKey(KeyCode.D) || Input.GetKey(KeyCode.RightArrow)) input.x += 1;
                if (Input.GetKey(KeyCode.A) || Input.GetKey(KeyCode.LeftArrow)) input.x -= 1;
            }
            input = Vector3.ClampMagnitude(input, 1f);

            float speed = MoveSpeed * (me.HasHaste ? HasteMultiplier : 1f) * weapon.Spec.MoveSpeed * (Zoomed ? (Scoped ? 0.55f : 0.72f) : 1f);
            Vector3 wish = transform.TransformDirection(input) * speed;
            bool grounded = cc.isGrounded;
            if (grounded)
            {
                jumpsLeft = 2;
                if (velocity.y < 0) velocity.y = -2f;
            }

            Vector3 horizontal = new Vector3(velocity.x, 0, velocity.z);
            horizontal = Vector3.MoveTowards(horizontal, wish, (grounded ? GroundAccel : AirAccel) * Time.deltaTime);
            velocity.x = horizontal.x;
            velocity.z = horizontal.z;
            Moving = horizontal.sqrMagnitude > 1f;

            if (control && Input.GetKeyDown(KeyCode.Space) && jumpsLeft > 0)
            {
                bool second = !grounded || jumpsLeft == 1;
                velocity.y = JumpSpeed * (second ? 0.92f : 1f);
                jumpsLeft = second ? 0 : 1;
                if (second)
                {
                    FxLibrary.ShieldPulse(transform, me.Color, 0.6f);
                    Sfx.Play2D(Sfx.Jump, 0.6f, 1.3f);
                }
                else Sfx.Play2D(Sfx.Jump, 0.35f);
            }

            bool dashKey = Input.GetKeyDown(KeyCode.Q) || Input.GetKeyDown(KeyCode.LeftShift);
            if (control && dashKey && Time.time >= DashReadyAt)
            {
                dashDir = input.sqrMagnitude > 0.01f ? transform.TransformDirection(input).normalized : transform.forward;
                dashUntil = Time.time + DashTime;
                DashReadyAt = Time.time + DashCooldown;
                Sfx.Play2D(Sfx.Dash, 0.7f);
            }

            velocity.y -= Gravity * Time.deltaTime;
            Vector3 step = velocity;
            if (Time.time < dashUntil)
            {
                step = dashDir * DashSpeed;
                step.y = 0;
            }
            cc.Move(step * Time.deltaTime);
        }
    }
}
