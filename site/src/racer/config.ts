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
  combat_tracks: 3,
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

  // Deathmatch (online or solo): wreck the most cars before time runs out; Combat Points scoring
  deathmatch_minutes: 3,
  deathmatch_minutes_options: [2, 3, 5],
  deathmatch_pickup_respawn: 4, // s
  race_laps_options: [1, 2, 3, 4, 5],

  // Multiplayer
  max_players: 8, // humans + AI on the grid
  net_snapshot_hz: 20, // host -> clients
  net_input_hz: 30, // client -> host (actions are sent immediately)
  net_finish_grace: 30, // s the race keeps going after the first human finishes
} as const

export type Config = typeof CONFIG

export const kmh = (v: number) => v / 3.6 // km/h -> m/s
export const toKmh = (v: number) => v * 3.6
