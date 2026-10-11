// VOLT RIOT tuning. Every number from the design doc's tuning table lives here; tweak freely.
export const CONFIG = {
  max_health: 10, // segments
  respawn_delay: 3.0, // s after wreck
  respawn_invuln: 2.0, // s
  powerup_slots: 3,
  pickup_respawn: 10, // s (4 s in arena)
  shunt_speed: 55, // m/s, homing
  shunt_turn_rate: 120, // deg/s
  shunt_lifetime: 8, // s
  shunt_damage: 4, // segments
  shunt_stun: 1.5, // s
  shunt_bolts_to_destroy: 2,
  barge_radius: 12, // m
  barge_damage: 2, // segments
  barge_push_force: 3, // m lateral
  bolt_speed: 90, // m/s
  bolt_count: 3,
  bolt_damage: 1, // segment
  mine_damage: 4, // segments
  mine_forward_range: 25, // m
  mine_lifetime: 30, // s
  mine_stun: 1.0, // s
  shock_domes: 3, // ahead of 1st place
  shock_dome_radius: 4, // m
  shock_lifetime: 6, // s
  shock_damage: 4, // segments
  nitro_duration: 3.0, // s
  nitro_accel_mult: 1.8, // x
  nitro_topspeed_mult: 1.25, // x
  reverse_nitro_speed: 30, // km/h, momentary
  reverse_nitro_hold: 0.4, // s
  shield_duration: 5.0, // s, ends on first hit
  repair_amount: 6, // segments
  rail_charge: 0.4, // s of charge before the beam fires
  rail_range: 240, // m forward
  rail_back_range: 70, // m backward
  rail_width: 1.7, // m either side of the beam that counts as a hit
  rail_damage: 3, // segments, to every car on the line
  rail_beam_fade: 0.35, // s
  flak_pellets: 8,
  flak_spread_deg: 26, // whole cone
  flak_speed: 100, // m/s
  flak_lifetime: 0.38, // s (about 40 m of reach)
  flak_damage: 1, // segment per pellet
  flak_max_hits: 3, // pellets that can land on one car per volley
  flak_airburst_distance: 9, // m behind
  flak_airburst_time: 0.3, // s fuse
  flak_airburst_radius: 7, // m
  flak_airburst_damage: 2, // segments
  oil_radius: 4.2, // m
  oil_lifetime: 15, // s
  oil_forward_range: 30, // m
  oil_damage: 1, // segment
  oil_stun: 1.3, // s spin-out
  oil_rehit: 2.5, // s before the same slick can spin the same car again
  oil_spins: 4, // cars a slick can spin before it's used up
  oil_arm_time: 1.0, // s before the dropper's own slick catches them
  ram_duration: 4.0, // s of armoured overdrive (forward)
  ram_brace_duration: 2.5, // s of armour without the speed (backward)
  ram_accel_mult: 1.35, // x
  ram_topspeed_mult: 1.12, // x
  ram_mass_mult: 4, // x heavier in car-car collisions
  ram_armor_mult: 0.5, // x incoming damage
  ram_hit_speed: 25, // km/h closing speed that counts as a ram while armoured
  ram_hit_damage: 3, // segments
  ram_hit_stun: 0.9, // s
  wall_hit_damage_threshold: 120, // km/h
  ram_damage_threshold: 60, // km/h relative
  drift_grip_mult: 0.4, // x
  drift_exit_boost: 0.5, // s
  launch_boost: 1.0, // s
  classD_topspeed: 160, // km/h
  classC_topspeed: 200, // km/h
  classB_topspeed: 240, // km/h
  classA_topspeed: 280, // km/h
  ai_rubberband_gap: 8, // s
  ai_rubberband_mult: 0.07, // x
  race_laps: 3,
  race_cars: 8, // 20 in the full game
  fan_level_cap: 25,

  // Combat Points mode
  combat_laps: 2,
  combat_tracks: 4, // the series visits every circuit once, starting from the chosen one
  combat_track_time_limit: 240, // s
  combat_pickup_respawn: 5, // s
  combat_wreck: 100,
  combat_wreck_leader_bonus: 50,
  combat_hit: 10,
  combat_multi_wreck: 75,
  combat_chain_window: 5, // s
  combat_chain_step: 0.5, // +x per chained wreck
  combat_chain_max: 3, // x
  combat_wrecked_penalty: -50,
  combat_finish: [100, 50, 25],

  // Fan Points
  fans_finish: [500, 350, 250],
  fans_hit: 25,
  fans_wreck: 100,
  fans_hit_leader: 25,
  fans_drift_per_s: 10,
  fans_near_miss: 5,
  fans_perfect_launch: 50,
  fans_fan_run: 200,
  fans_target: 300,
  fan_target_goal: 1800, // fans needed for the Fan Target light on this event
  fan_run_duration: 15, // s

  // Feel
  track_width: 18, // m
  car_radius: 1.25, // m, for car-car collisions
  shunt_warning: 1.0, // s of incoming warning
  lock_cone_deg: 32,
  lock_range: 320, // m
  pickup_radius: 2.6, // m
  launch_window: 0.35, // s around GO for a perfect launch
  bay_stack_max: 3, // same-type pickups stack up to this many in one slot
  bolt_hold_delay: 0.25, // s holding fire before the remaining bolts auto-fire
  bolt_hold_interval: 0.1, // s between auto-fired bolts
  bolt_steer_kick: 0.2, // s
  bolt_lifetime: 1.6, // s
  shunt_home_distance: 15, // m: closer than this the Shunt steers straight at its target
  shunt_weakened_damage: 2, // segments after 1 Bolt
  mine_trigger_radius: 2.2, // m
  mine_blast_radius: 3.2, // m
  mine_arm_time: 0.8, // s before the firer's own mine can hit them
  shock_warning: 1.0, // s between the lightning strike and the dome going live
  shock_spacing: 60, // m between domes
  shock_first_offset: 90, // m ahead of the leader
  shield_rare_weight: 0.35, // x spawn weight for Shield in Combat Points
  finale_hazard_mult: 2, // x Shock and Mine weight on the last Combat Points track
  ai_skill: [0.4, 0.6, 0.8], // Easy / Normal / Hard
  ai_combat_skill: 0.6,
  ai_max_topspeed_over_player: 0.1, // AI never exceeds the player's top speed by more than 10 %
  ai_shunt_range: 60, // m ahead
  ai_mine_range: 15, // m behind
  ai_avoid_range: 40, // m
  near_miss_distance: 2.6, // m between car edges, at speed, without contact
  near_miss_speed: 8, // m/s relative
  stuck_reset: 3.5, // s nearly stationary before an automatic reset
  wreck_cam_time: 3.0, // s the camera pulls back after a wreck
  smoke_below: 0.5, // health fraction
  fire_below: 0.2, // health fraction
  fan_level_base: 250, // fans for level L = base * (L-1)^2

  // Deathmatch (online or solo): wrecks and damage dealt score before time runs out
  deathmatch_minutes: 3,
  deathmatch_minutes_options: [2, 3, 5],
  deathmatch_pickup_respawn: 4, // s
  dm_points_wreck: 100,
  dm_points_per_damage: 10, // per health segment dealt to rivals (a full car's worth = one wreck)
  dm_points_wrecked: -50, // per own wreck, however it happened
  race_laps_options: [1, 2, 3, 4, 5],

  // Dust Bowl: the circular deathmatch arena
  bowl_radius: 94, // m, rim wall (cars can't pass it)
  bowl_floor_radius: 78, // m of flat floor; banked slope from here out to the rim
  bowl_bank_height: 4.5, // m at the rim wall
  bowl_rim_height: 3.5, // m of wall above the bank
  bowl_bank_pull: 0.75, // x gravity down the bank slope
  bowl_spawn_radius: 64, // m
  bowl_pickup_rings: [18, 44, 66], // m
  bowl_pickups_per_ring: 6,
  bowl_dust_rate: 26, // dust puffs per second per car at top speed
  ai_arena_pickup_range: 70, // m: bots detour for a pickup this close while the bay has room
  ai_arena_unstuck: 1.0, // s reversing out after getting stuck on the rim or an obstacle
  ai_arena_stuck_time: 0.7, // s nearly stationary before reversing out

  // Circuits with hills and jumps (visual: the physics stays flat)
  jump_gravity: 24, // m/s² pulling an airborne car back down to the road

  // Multiplayer
  max_players: 8, // humans + AI on the grid
  net_snapshot_hz: 20, // host -> clients
  net_input_hz: 30, // client -> host (actions are sent immediately)
  net_finish_grace: 30, // s the race keeps going after the first human finishes
} as const

export type Config = typeof CONFIG

export const kmh = (v: number) => v / 3.6 // km/h -> m/s
export const toKmh = (v: number) => v * 3.6
