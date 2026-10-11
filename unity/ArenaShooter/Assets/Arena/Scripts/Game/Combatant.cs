using System.Collections.Generic;
using Arena.Core;
using Arena.Fx;
using Arena.UI;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>Health, shield, score and buffs shared by players and bots. The server owns all of it.</summary>
    public class Combatant : NetworkBehaviour
    {
        public static readonly List<Combatant> All = new List<Combatant>();
        public static Combatant Local { get; private set; }

        public const int MaxHealth = 100;
        public const int MaxShield = 100;
        public const float RespawnSeconds = 3f;
        public const float OvershieldCooldown = 16f;

        public static readonly Color[] Palette =
        {
            new Color(0.13f, 0.83f, 0.93f), new Color(0.98f, 0.45f, 0.09f), new Color(0.66f, 0.33f, 0.97f),
            new Color(0.29f, 0.87f, 0.5f), new Color(0.96f, 0.25f, 0.37f), new Color(0.98f, 0.8f, 0.15f),
            new Color(0.38f, 0.65f, 0.98f), new Color(0.93f, 0.28f, 0.6f),
        };

        [Tooltip("Bots are driven by BotBrain on the server; players by PlayerController on their owner.")]
        public bool IsBot;
        public Transform Eye;
        public Renderer[] BodyRenderers;
        public Renderer[] GunRenderers;
        public Collider HitCollider;

        public readonly NetworkVariable<int> Health = new NetworkVariable<int>(MaxHealth);
        public readonly NetworkVariable<int> Shield = new NetworkVariable<int>(0);
        public readonly NetworkVariable<int> Kills = new NetworkVariable<int>(0);
        public readonly NetworkVariable<int> Deaths = new NetworkVariable<int>(0);
        public readonly NetworkVariable<bool> Alive = new NetworkVariable<bool>(true);
        public readonly NetworkVariable<FixedString32Bytes> DisplayName = new NetworkVariable<FixedString32Bytes>();
        public readonly NetworkVariable<FixedString32Bytes> LastKiller = new NetworkVariable<FixedString32Bytes>();
        public readonly NetworkVariable<byte> ColorIndex = new NetworkVariable<byte>(0);
        public readonly NetworkVariable<double> OverdriveUntil = new NetworkVariable<double>(0);
        public readonly NetworkVariable<double> HasteUntil = new NetworkVariable<double>(0);
        public readonly NetworkVariable<double> OvershieldReadyAt = new NetworkVariable<double>(0);
        public readonly NetworkVariable<double> RespawnAt = new NetworkVariable<double>(0);

        MaterialPropertyBlock block;

        public string Name => DisplayName.Value.ToString();
        public Color Color => Palette[ColorIndex.Value % Palette.Length];
        public double Now => NetworkManager != null ? NetworkManager.ServerTime.Time : 0;
        public bool HasOverdrive => OverdriveUntil.Value > Now;
        public bool HasHaste => HasteUntil.Value > Now;
        public Vector3 AimPoint => Eye ? Eye.position : transform.position + Vector3.up * 1.5f;

        public override void OnNetworkSpawn()
        {
            All.Add(this);
            ColorIndex.OnValueChanged += OnColorChanged;
            Alive.OnValueChanged += OnAliveChanged;
            ApplyColor();
            RefreshVisibility();

            if (IsServer && !IsBot)
            {
                ColorIndex.Value = (byte)(OwnerClientId % (ulong)Palette.Length);
                DisplayName.Value = new FixedString32Bytes($"Player {OwnerClientId + 1}");
            }
            if (IsOwner && !IsBot)
            {
                Local = this;
                SetNameRpc(new FixedString32Bytes(LaunchOptions.Sanitize(LaunchOptions.Current.Name)));
            }
        }

        public override void OnNetworkDespawn()
        {
            All.Remove(this);
            ColorIndex.OnValueChanged -= OnColorChanged;
            Alive.OnValueChanged -= OnAliveChanged;
            if (Local == this) Local = null;
        }

        void OnColorChanged(byte previous, byte current) => ApplyColor();

        void OnAliveChanged(bool previous, bool current)
        {
            RefreshVisibility();
            if (!current)
            {
                FxLibrary.DeathBurst(transform.position + Vector3.up, Color);
                Sfx.PlayAt(Sfx.Death, transform.position, 0.9f);
            }
            else if (IsOwner && !IsBot)
            {
                Sfx.Play2D(Sfx.Spawn, 0.6f);
            }
        }

        void ApplyColor()
        {
            block ??= new MaterialPropertyBlock();
            foreach (var r in BodyRenderers)
            {
                if (!r) continue;
                r.GetPropertyBlock(block);
                block.SetColor("_Color", Color);
                r.SetPropertyBlock(block);
            }
        }

        /// <summary>Owners never see their own body (first person); the dead are hidden and can't be hit.</summary>
        public void RefreshVisibility()
        {
            bool alive = Alive.Value;
            bool showBody = alive && !(IsOwner && !IsBot);
            foreach (var r in BodyRenderers) if (r) r.enabled = showBody;
            foreach (var r in GunRenderers) if (r) r.enabled = alive;
            if (HitCollider) HitCollider.enabled = alive;
        }

        [Rpc(SendTo.Server)]
        void SetNameRpc(FixedString32Bytes name)
        {
            DisplayName.Value = new FixedString32Bytes(LaunchOptions.Sanitize(name.ToString()));
        }

        // ---------------- Server-side rules ----------------

        public void ServerDamage(int amount, Combatant attacker, bool headshot)
        {
            if (!IsServer || !Alive.Value || amount <= 0) return;
            if (MatchManager.Instance != null && MatchManager.Instance.Ended.Value) return;

            int absorbed = Mathf.Min(Shield.Value, amount);
            Shield.Value -= absorbed;
            Health.Value = Mathf.Max(0, Health.Value - (amount - absorbed));
            bool killed = Health.Value == 0;

            if (attacker != null && attacker != this) attacker.HitConfirmRpc(headshot, killed);
            DamagedRpc(attacker != null ? attacker.transform.position : transform.position);

            if (killed) ServerDie(attacker, headshot);
        }

        void ServerDie(Combatant killer, bool headshot)
        {
            Alive.Value = false;
            Deaths.Value++;
            LastKiller.Value = killer != null && killer != this ? killer.DisplayName.Value : new FixedString32Bytes("the desert");
            if (killer != null && killer != this) killer.Kills.Value++;
            RespawnAt.Value = Now + RespawnSeconds;
            if (MatchManager.Instance != null) MatchManager.Instance.ServerOnKill(killer, this, headshot);
        }

        void Update()
        {
            if (!IsServer || !IsSpawned || Alive.Value) return;
            bool matchRunning = MatchManager.Instance == null || !MatchManager.Instance.Ended.Value;
            if (matchRunning && Now >= RespawnAt.Value) ServerRespawn();
        }

        public void ServerRespawn()
        {
            var point = SpawnPicker.Pick(this);
            Health.Value = MaxHealth;
            Shield.Value = 0;
            OverdriveUntil.Value = 0;
            HasteUntil.Value = 0;
            var toCenter = new Vector3(-point.x, 0, -point.z);
            float yaw = toCenter.sqrMagnitude > 0.01f ? Quaternion.LookRotation(toCenter).eulerAngles.y : 0f;
            if (IsBot) GetComponent<BotBrain>().ServerRespawn(point);
            else TeleportRpc(point, yaw);
            Alive.Value = true;
        }

        public void ServerHeal(int amount) => Health.Value = Mathf.Min(MaxHealth, Health.Value + amount);
        public void ServerAddShield(int amount) => Shield.Value = Mathf.Min(MaxShield, Shield.Value + amount);

        public bool ServerTryOvershield()
        {
            if (!IsServer || !Alive.Value || Now < OvershieldReadyAt.Value) return false;
            ServerAddShield(50);
            OvershieldReadyAt.Value = Now + OvershieldCooldown;
            AbilityFxRpc();
            return true;
        }

        [Rpc(SendTo.Server)]
        public void OvershieldRpc() => ServerTryOvershield();

        // ---------------- Client feedback ----------------

        [Rpc(SendTo.Owner)]
        void TeleportRpc(Vector3 position, float yaw)
        {
            var controller = GetComponent<PlayerController>();
            if (controller) controller.Teleport(position, yaw);
        }

        [Rpc(SendTo.Owner)]
        void HitConfirmRpc(bool headshot, bool killed)
        {
            if (IsBot) return;
            ArenaHud.ShowHit(headshot, killed);
            Sfx.Play2D(killed ? Sfx.Kill : Sfx.Hit, killed ? 0.8f : 0.5f, headshot ? 1.35f : 1f);
        }

        [Rpc(SendTo.Owner)]
        void DamagedRpc(Vector3 from)
        {
            if (IsBot) return;
            ArenaHud.ShowDamage(from);
            Sfx.Play2D(Sfx.Hurt, 0.6f);
        }

        [Rpc(SendTo.Everyone)]
        void AbilityFxRpc()
        {
            FxLibrary.ShieldPulse(transform, Color);
            Sfx.PlayAt(Sfx.Shield, transform.position, 0.8f);
        }
    }
}
