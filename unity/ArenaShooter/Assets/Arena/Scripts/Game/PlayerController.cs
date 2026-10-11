using Arena.Core;
using Arena.Fx;
using Arena.UI;
using Unity.Netcode;
using Unity.Netcode.Components;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>
    /// First-person controller for the local player. Movement is owner-authoritative (NetworkTransform in
    /// Owner mode) so it feels instant even over Relay. Powers: double jump, dash, overshield, pulse scan.
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

        public Camera Camera { get; private set; }
        public float DashReadyAt { get; private set; }
        public float ScanReadyAt { get; private set; }
        public float ScanUntil { get; private set; }
        public bool Zoomed { get; private set; }
        public bool Moving { get; private set; }

        CharacterController cc;
        Combatant me;
        Weapon weapon;
        NetworkTransform netTransform;
        Vector3 velocity;
        float yaw, pitch, recoil;
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
            camGo.transform.SetParent(Head, false);
            Camera = camGo.AddComponent<Camera>();
            Camera.fieldOfView = 78f;
            Camera.nearClipPlane = 0.05f;
            Camera.farClipPlane = 400f;
            camGo.AddComponent<AudioListener>();
            camGo.tag = "MainCamera";

            // View model: the gun hangs in front of the camera.
            if (GunModel)
            {
                GunModel.SetParent(camGo.transform, false);
                GunModel.localPosition = new Vector3(0.24f, -0.22f, 0.5f);
                GunModel.localRotation = Quaternion.identity;
                if (weapon && weapon.Muzzle) weapon.Muzzle.SetParent(GunModel, true);
            }

            var boot = ArenaBootstrap.Instance;
            if (boot && boot.MenuCamera) boot.MenuCamera.gameObject.SetActive(false);

            var spawn = SpawnPicker.Pick(me);
            var toCenter = new Vector3(-spawn.x, 0, -spawn.z);
            Teleport(spawn, toCenter.sqrMagnitude > 0.01f ? Quaternion.LookRotation(toCenter).eulerAngles.y : 0f);
        }

        public override void OnNetworkDespawn()
        {
            if (!IsOwner) return;
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
                yaw += Input.GetAxisRaw("Mouse X") * MouseSensitivity * (Zoomed ? 0.55f : 1f);
                pitch -= Input.GetAxisRaw("Mouse Y") * MouseSensitivity * (Zoomed ? 0.55f : 1f);
            }
            recoil = Mathf.MoveTowards(recoil, 0, Time.deltaTime * 10f);
            pitch = Mathf.Clamp(pitch, -88f, 88f);
            transform.rotation = Quaternion.Euler(0, yaw, 0);
            Head.localRotation = Quaternion.Euler(pitch - recoil, 0, 0);

            if (!alive)
            {
                cc.enabled = false;
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

                Zoomed = Input.GetMouseButton(1);
                if (Input.GetMouseButton(0) && weapon.TryFireLocal(Camera.transform, Moving))
                    recoil += weapon.RecoilKick;
            }
            else
            {
                Zoomed = false;
            }

            if (Camera)
                Camera.fieldOfView = Mathf.Lerp(Camera.fieldOfView, Zoomed ? 50f : 78f, Time.deltaTime * 14f);

            if (transform.position.y < -20f) Teleport(SpawnPicker.Pick(me), yaw);
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

            float speed = MoveSpeed * (me.HasHaste ? HasteMultiplier : 1f) * (Zoomed ? 0.6f : 1f);
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
