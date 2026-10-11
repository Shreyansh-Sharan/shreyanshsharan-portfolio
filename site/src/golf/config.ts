// BOGEY BRAWL tuning. Every number from the design doc's tuning table lives here (`src` = from the real game's
// documented settings, the rest are clone choices). Tweak freely.
export const CONFIG = {
  players_max: 8, // src
  inventory_slots: 3, // src
  holes_per_match: 9,
  hole_time_par3: 120, // s
  hole_time_par4: 180, // s
  hole_time_par5: 240, // s
  overtime: 15, // s
  overtime_timeout_penalty: -50, // points
  swing_charge_time: 1.5, // s
  swing_cooldown: 0.5, // s
  swing_power_setting: 100, // % of 50–200 (src range)
  max_ball_speed: 45, // m/s at 100 % power
  loft_min: 10, // deg
  loft_max: 60, // deg
  run_speed: 7, // m/s
  boost_speed_mult: 1.4, // x
  melee_range: 2, // m
  melee_stun: 1.5, // s
  melee_boost: 3, // s
  dive_duration: 0.6, // s
  dive_speed: 14, // m/s
  dive_iframes: 0.4, // s
  creep_speed: 1.2, // m/s
  jump_height: 1.5, // m
  checkpoint_radius: 3, // m
  respawn_delay: 2, // s
  respawn_penalty_strokes: 1,
  briefcase_respawn: 20, // s
  knockback_multiplier: 100, // % of 50–150 (src range)
  rocket_speed: 25, // m/s
  rocket_turn_rate: 180, // deg/s
  rocket_stun: 2.5, // s
  rocket_knockback: 8, // m
  pistol_range: 50, // m
  pistol_stun: 1.5, // s
  elephant_range: 8, // m
  elephant_stun: 3, // s
  elephant_knockback: 15, // m
  elephant_self_knockback: 10, // m
  landmine_charges: 3, // src
  landmine_trigger_radius: 1.2, // m
  landmine_stun: 2, // s
  landmine_disarm_time: 1.5, // s
  laser_delay: 3, // s
  laser_radius: 8, // m
  laser_stun: 4, // s
  airhorn_range: 15, // m
  airhorn_overshoot_mult: 2.0, // x
  cart_speed: 16, // m/s
  cart_seats: 8, // src
  cart_ram_stun: 2.5, // s
  coffee_duration: 10, // s, src
  coffee_speed_mult: 1.4, // x
  springboots_distance: 40, // m
  shield_duration: 6, // s, src 5–7
  protection_levels: 3, // src
  protection_duration: [2, 3, 4], // s per level
  protection_window: 15, // s
  rocket_driver_power: 200, // % of normal, src
  freeze_radius: 6, // m
  freeze_duration: 3, // s
  wind_max: 6, // m/s, snow biome
  friction_fairway: 1.0, // m/s²
  friction_rough: 2.5, // m/s²
  friction_sand: 6.0, // m/s²
  friction_ice: 0.2, // m/s²
  wall_restitution: 0.7,
  points_first: 100,
  points_second: 70,
  points_third: 50,
  points_fourth: 35,
  points_fifth_plus: 20,
  points_under_par: 30,
  points_at_par: 10,
  points_hole_in_one: 50,
  points_knockout: 10,
  points_domination: 25,
  points_domination_count: 3, // different rivals in one hole
  points_water_knock: 15,
  points_shield_block: 5,

  // Clone feel values (not in the doc's table).
  friction_green: 0.9, // m/s²
  putt_max_speed: 14, // m/s: on the green the swing becomes a putt (loft 0) so short putts are controllable
  swing_reach: 2.6, // m: stand this close to your ball to swing at it
  cup_radius: 0.3, // m (cartoon-sized)
  cup_capture_speed: 6, // m/s: faster than this and the ball lips out
  ball_radius: 0.12, // m
  gravity: 9.81,
  air_drag: 0.0045, // per metre (quadratic)
  bounce: { fairway: 0.35, rough: 0.22, sand: 0.05, green: 0.3, ice: 0.45 } as Record<string, number>,
  rest_speed: 0.18, // m/s: below this a rolling ball stops (if the slope can't keep it moving)
  player_radius: 0.45, // m
  jump_gravity: 22, // m/s²
  stun_knockback_time: 0.35, // s over which knockback distance is applied
  rocket_lifetime: 7, // s
  rocket_lock_range: 80, // m
  shield_block_radius: 1.4, // m: bubble radius
  briefcases_per_hole: 8,
  item_weights: {
    rocket: 14, pistol: 12, landmine: 12, airhorn: 10, coffee: 10, springboots: 10, cart: 8, elephant: 8, shield: 8, freeze: 4, driver: 2, laser: 2,
  } as Record<string, number>,
  enabled_items: ['rocket', 'pistol', 'shield'] as string[], // this pass ships 3; the rest are stubbed
  ai_skill: [0.35, 0.55, 0.75], // Easy / Normal / Hard
  ai_shot_samples: 16,
  ai_sim_seconds: 10,
  ai_melee_grace: 6, // s after tee-off before bots start clubbing people (everyone starts on the same tee)
  ai_briefcase_detour: 15, // m
  ai_rocket_range: 40, // m
  ai_pistol_range: 20, // m
  results_time: 5, // s before the next hole
} as const

export const deg = (d: number) => (d * Math.PI) / 180
