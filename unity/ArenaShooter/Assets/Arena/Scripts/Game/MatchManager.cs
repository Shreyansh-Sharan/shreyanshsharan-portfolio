using System.Collections.Generic;
using Arena.Core;
using Arena.Fx;
using Arena.Map;
using Unity.Collections;
using Unity.Netcode;
using UnityEngine;

namespace Arena.Game
{
    /// <summary>Free-for-all deathmatch: first to the kill limit or highest score when time runs out.</summary>
    public class MatchManager : NetworkBehaviour
    {
        public static MatchManager Instance { get; private set; }

        public const int KillLimit = 20;
        public const float MatchSeconds = 480f;
        public const float IntermissionSeconds = 12f;

        public readonly NetworkVariable<double> EndsAt = new NetworkVariable<double>(0);
        public readonly NetworkVariable<double> RestartAt = new NetworkVariable<double>(0);
        public readonly NetworkVariable<bool> Ended = new NetworkVariable<bool>(false);
        public readonly NetworkVariable<FixedString32Bytes> Winner = new NetworkVariable<FixedString32Bytes>();

        public struct KillEvent
        {
            public string Killer, Victim;
            public Color KillerColor, VictimColor;
            public bool Headshot;
            public float Time;
        }

        public readonly List<KillEvent> Feed = new List<KillEvent>();

        double Now => NetworkManager.ServerTime.Time;
        public float SecondsLeft => Mathf.Max(0f, (float)((Ended.Value ? RestartAt.Value : EndsAt.Value) - Now));

        public override void OnNetworkSpawn()
        {
            Instance = this;
            Ended.OnValueChanged += OnEndedChanged;
            if (!IsServer) return;

            EndsAt.Value = Now + MatchSeconds;
            SpawnPickups();
            SpawnBots(LaunchOptions.Current.Bots);
        }

        public override void OnNetworkDespawn()
        {
            Ended.OnValueChanged -= OnEndedChanged;
            if (Instance == this) Instance = null;
        }

        void OnEndedChanged(bool previous, bool current)
        {
            Sfx.Play2D(current ? Sfx.MatchEnd : Sfx.Spawn, 0.8f);
        }

        void SpawnPickups()
        {
            var prefab = ArenaBootstrap.Instance.PickupPrefab;
            foreach (var (position, kind) in DunesLayout.Pickups)
            {
                var go = Instantiate(prefab, position + Vector3.up * 0.9f, Quaternion.identity);
                go.GetComponent<NetworkObject>().Spawn(true);
                go.GetComponent<Pickup>().Kind.Value = (byte)kind;
            }
        }

        void SpawnBots(int count)
        {
            var prefab = ArenaBootstrap.Instance.BotPrefab;
            var names = new List<string>(BotBrain.Names);
            for (int i = 0; i < count; i++)
            {
                var point = SpawnPicker.Pick(null);
                var go = Instantiate(prefab, point, Quaternion.Euler(0, Random.Range(0f, 360f), 0));
                go.GetComponent<NetworkObject>().Spawn(true);
                var c = go.GetComponent<Combatant>();
                int pick = Random.Range(0, names.Count);
                c.DisplayName.Value = new FixedString32Bytes(names[pick]);
                names.RemoveAt(pick);
                c.ColorIndex.Value = (byte)((i + 3) % Combatant.Palette.Length);
            }
        }

        void Update()
        {
            if (!IsServer || !IsSpawned) return;
            if (!Ended.Value)
            {
                var leader = Leader();
                if (Now >= EndsAt.Value || (leader != null && leader.Kills.Value >= KillLimit))
                {
                    Ended.Value = true;
                    Winner.Value = leader != null ? leader.DisplayName.Value : new FixedString32Bytes("Nobody");
                    RestartAt.Value = Now + IntermissionSeconds;
                }
            }
            else if (Now >= RestartAt.Value)
            {
                foreach (var c in Combatant.All)
                {
                    c.Kills.Value = 0;
                    c.Deaths.Value = 0;
                    c.ServerRespawn();
                }
                EndsAt.Value = Now + MatchSeconds;
                Ended.Value = false;
            }
        }

        public static Combatant Leader()
        {
            Combatant best = null;
            foreach (var c in Combatant.All)
                if (best == null || c.Kills.Value > best.Kills.Value || (c.Kills.Value == best.Kills.Value && c.Deaths.Value < best.Deaths.Value))
                    best = c;
            return best;
        }

        public void ServerOnKill(Combatant killer, Combatant victim, bool headshot)
        {
            KillFeedRpc(
                killer != null ? killer.NetworkObjectId : ulong.MaxValue,
                victim.NetworkObjectId,
                headshot);
        }

        [Rpc(SendTo.Everyone)]
        void KillFeedRpc(ulong killerId, ulong victimId, bool headshot)
        {
            var spawned = NetworkManager.SpawnManager.SpawnedObjects;
            Combatant killer = null, victim = null;
            if (spawned.TryGetValue(killerId, out var k)) killer = k.GetComponent<Combatant>();
            if (spawned.TryGetValue(victimId, out var v)) victim = v.GetComponent<Combatant>();
            if (victim == null) return;

            Feed.Add(new KillEvent
            {
                Killer = killer != null && killer != victim ? killer.Name : "",
                Victim = victim.Name,
                KillerColor = killer != null ? killer.Color : Color.white,
                VictimColor = victim.Color,
                Headshot = headshot,
                Time = Time.time,
            });
            if (Feed.Count > 6) Feed.RemoveAt(0);
        }
    }
}
