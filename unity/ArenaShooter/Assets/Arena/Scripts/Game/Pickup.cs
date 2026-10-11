using System.Collections.Generic;
using Arena.Fx;
using Arena.Map;
using Arena.UI;
using Unity.Netcode;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>Power-up pad: health, shield cell, overdrive (double damage) or haste. Server decides pickups.</summary>
    public class Pickup : NetworkBehaviour
    {
        public static readonly List<Pickup> All = new List<Pickup>();

        [Tooltip("One visual per kind, in PickupKind order.")]
        public GameObject[] Visuals;
        public Transform Spinner;
        public Renderer Pad;

        public readonly NetworkVariable<byte> Kind = new NetworkVariable<byte>(0);
        public readonly NetworkVariable<bool> Active = new NetworkVariable<bool>(true);

        double respawnAt;

        public PickupKind PickupKind => (PickupKind)Kind.Value;

        public static string Label(PickupKind kind) => kind switch
        {
            PickupKind.Health => "+50 HEALTH",
            PickupKind.Shield => "+50 SHIELD",
            PickupKind.Overdrive => "OVERDRIVE: DOUBLE DAMAGE",
            _ => "HASTE: SPEED BOOST",
        };

        public static Color Tint(PickupKind kind) => kind switch
        {
            PickupKind.Health => new Color(0.3f, 1f, 0.45f),
            PickupKind.Shield => new Color(0.25f, 0.85f, 1f),
            PickupKind.Overdrive => new Color(1f, 0.55f, 0.1f),
            _ => new Color(0.85f, 0.4f, 1f),
        };

        public override void OnNetworkSpawn()
        {
            All.Add(this);
            Kind.OnValueChanged += OnKindChanged;
            Active.OnValueChanged += OnActiveChanged;
            Refresh();
        }

        public override void OnNetworkDespawn()
        {
            All.Remove(this);
            Kind.OnValueChanged -= OnKindChanged;
            Active.OnValueChanged -= OnActiveChanged;
        }

        void OnKindChanged(byte previous, byte current) => Refresh();
        void OnActiveChanged(bool previous, bool current) => Refresh();

        void Refresh()
        {
            for (int i = 0; i < Visuals.Length; i++)
                if (Visuals[i]) Visuals[i].SetActive(Active.Value && i == Kind.Value);
            if (Pad)
            {
                var block = new MaterialPropertyBlock();
                var tint = Tint(PickupKind) * (Active.Value ? 1f : 0.25f);
                block.SetColor("_EmissionColor", tint * 1.6f);
                block.SetColor("_Color", tint);
                Pad.SetPropertyBlock(block);
            }
        }

        void Update()
        {
            if (Spinner)
            {
                Spinner.Rotate(0, 90f * Time.deltaTime, 0, Space.World);
                Spinner.localPosition = new Vector3(0, 0.25f + Mathf.Sin(Time.time * 2.4f) * 0.15f, 0);
            }
            if (!IsServer || !IsSpawned) return;

            double now = NetworkManager.ServerTime.Time;
            if (!Active.Value)
            {
                if (now >= respawnAt) Active.Value = true;
                return;
            }

            foreach (var c in Combatant.All)
            {
                if (!c.Alive.Value) continue;
                var d = c.transform.position - transform.position;
                if (Mathf.Abs(d.y) > 2.2f || new Vector2(d.x, d.z).sqrMagnitude > 1.6f * 1.6f) continue;
                if (TryApply(c, now)) break;
            }
        }

        bool TryApply(Combatant c, double now)
        {
            switch (PickupKind)
            {
                case PickupKind.Health:
                    if (c.Health.Value >= Combatant.MaxHealth) return false;
                    c.ServerHeal(50);
                    break;
                case PickupKind.Shield:
                    if (c.Shield.Value >= Combatant.MaxShield) return false;
                    c.ServerAddShield(50);
                    break;
                case PickupKind.Overdrive:
                    c.OverdriveUntil.Value = now + 10;
                    break;
                case PickupKind.Haste:
                    c.HasteUntil.Value = now + 8;
                    break;
            }
            Active.Value = false;
            respawnAt = now + (PickupKind == PickupKind.Health ? 15 : 25);
            CollectedRpc(c.NetworkObjectId);
            return true;
        }

        [Rpc(SendTo.Everyone)]
        void CollectedRpc(ulong collectorId)
        {
            Sfx.PlayAt(Sfx.Pickup, transform.position, 0.8f);
            FxLibrary.Impact(transform.position + Vector3.up * 0.5f, Vector3.up, Tint(PickupKind), 2.5f);
            if (Combatant.Local != null && Combatant.Local.NetworkObjectId == collectorId)
                ArenaHud.Toast(Label(PickupKind), Tint(PickupKind));
        }
    }
}
