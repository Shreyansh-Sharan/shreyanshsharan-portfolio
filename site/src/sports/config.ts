// SPORTS COMPLEX tuning: every number the hub, the circuit, the stadium and the rally hall use. Distances are metres,
// times seconds, speeds metres per second unless noted.
export const CONFIG = {
  /* ---------- Hub: walking around ---------- */
  walk_speed: 4.4,
  run_speed: 8.6,
  accel: 12, // how fast the avatar reaches its target speed (1/s)
  turn_rate: 12, // avatar yaw follow rate (1/s)
  jump_speed: 7.2,
  gravity: 22,
  player_radius: 0.45,
  mouse_sens: 0.0032,
  cam_dist: 6.2,
  cam_min_pitch: -0.12,
  cam_max_pitch: 1.05,
  interact_radius: 3.4, // stand this close to a glowing pad for "Press E"
  hub_bounds: 230, // hard limit from the plaza (the circuit barriers usually stop you first)

  /* ---------- Layout (plaza at the origin, north = -z) ---------- */
  plaza_radius: 17,
  spawn: [0, 26] as [number, number],
  stadium_pad: [0, -58] as [number, number],
  hall_pad: [58, 0] as [number, number],
  f1_pad: [-55, -8] as [number, number],
  hall_door_inside: [0, 12] as [number, number], // where you appear inside the hall (hall-local)
  // Pitch: a half pitch with the goal at the north end.
  pitch_center_z: -94,
  pitch_half_w: 24,
  pitch_half_l: 30,
  goal_line_z: -120,
  goal_width: 7.32, // mouth, post to post
  goal_height: 2.44,
  penalty_dist: 11,
  hall_center: [86, 0] as [number, number],
  hall_size: [40, 12, 32] as [number, number, number],
  garage_center: [-76, 0] as [number, number],

  /* ---------- F1 circuit ---------- */
  track_half_width: 7,
  track_runoff: 6.5, // grass between the road edge and the barrier
  track_sample: 2, // metres between centreline samples
  car_length: 5.2,
  car_max_speed: 84, // ~300 km/h
  car_accel: 21,
  car_brake: 34,
  car_drag: 0.0016, // quadratic drag factor
  car_roll: 1.2, // rolling resistance (m/s²)
  car_reverse_speed: 9,
  car_steer: 0.42, // max wheel angle (rad) at low speed
  car_steer_fast: 0.12, // max wheel angle at top speed
  car_steer_rate: 3.2, // how fast the wheel turns (rad/s)
  car_wheelbase: 3.2,
  car_grip: 30, // max lateral acceleration on tarmac (m/s²)
  car_grip_grass: 10,
  car_slip: 7, // lateral velocity damping on tarmac (1/s)
  car_slip_grass: 2.5,
  grass_max_speed: 30,
  grass_drag: 1.6, // extra slowdown on grass (1/s)
  barrier_speed_keep: 0.55, // fraction of speed kept after hitting a barrier
  chase_dist: 10,
  chase_height: 3.4,
  role_banner_time: 4.5,

  /* ---------- Stadium: penalties ---------- */
  kicks_per_round: 5,
  ball_radius: 0.13, // a touch over real size so it reads on screen
  power_fill_time: 1.0, // seconds from empty to full while holding
  power_sweet: [0.5, 0.86] as [number, number], // power above the top end balloons the shot over the bar
  shot_speed_min: 13,
  shot_speed_max: 31,
  shot_over_bar: 7, // extra metres of height per unit of power above the sweet spot
  shot_spread: 0.22, // random aim error (m) at the goal
  shot_curve_max: 1.4, // sideways bend (m) at mid-flight
  keeper_read: [0.32, 0.5, 0.68], // chance the keeper reads the shot, by difficulty
  keeper_react: [0.34, 0.25, 0.17], // reaction time before the dive
  keeper_dive_time: 0.42,
  keeper_reach_x: 3.3, // how far a full dive reaches sideways from the centre
  keeper_reach_y: 2.45,
  keeper_save_radius: 0.62, // around the keeper's arms and body
  result_time: 1.9,

  /* ---------- Rally hall ---------- */
  rally_target: 7, // first to 7 points
  rally_streak_bonus: 6, // returns in one rally that unlock a bonus skill
  rally_win_bonus: 2, // skills unlocked for winning a match
  rally_opp_speed: [3.2, 4.2, 5.2], // badminton opponent lateral speed by difficulty (table tennis scales it down)
  rally_opp_error: [0.14, 0.08, 0.04], // chance the opponent fluffs a return
  rally_smash_error: 0.35, // extra chance the opponent misses a perfect-timed shot
  badminton: {
    half_court: 6.7, // net to baseline
    half_width: 3.05,
    hit_x: 4.3, // depth of the hitting spot from the net
    hit_y: 1.5,
    reach: 1.05, // lateral reach with the racket
    window: 0.2, // +/- seconds around the ideal hit
    move_speed: 5.4,
    lateral: 2.5, // max lateral offset of a shot
    flight: [1.25, 1.75] as [number, number], // incoming flight time range (shortened as rallies get longer)
    apex: [3.4, 6.2] as [number, number],
  },
  tabletennis: {
    half_court: 1.37, // net to table end
    half_width: 0.7625,
    table_y: 0.76,
    hit_x: 1.85,
    hit_y: 1.0,
    reach: 0.55,
    window: 0.14,
    move_speed: 2.6,
    lateral: 0.62,
    flight: [0.62, 0.95] as [number, number],
    apex: [0.22, 0.42] as [number, number],
  },
}

export type Venue = 'f1' | 'stadium' | 'hall'
export type Sport = 'badminton' | 'tabletennis'
