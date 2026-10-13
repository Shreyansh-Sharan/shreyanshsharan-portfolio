// The island's ground: the terrain's vertex colours (each district's palette) carry the hue, and six tiling detail
// textures (lush grass, dry grass, dirt, rock, sand, paving) are splat-blended over them by per-vertex surface weights
// (see terrain.ts: height, slope, district masks, roads and footpaths). Grass is sampled at two scales mixed by a
// procedural macro noise, so it never reads as a repeating tile from the air, and the blended detail also bumps the
// normal. Far away the detail fades into the plain palette.
import * as THREE from 'three'
import { ROAD_HALF, RSEGS, TRAIL_HALF, TSEGS } from './terrain'

const tex = (name: string) => `${import.meta.env.BASE_URL}world/textures/ground-${name}.webp`

/** Luminance of each texture's mean colour (linear): detail is texture luminance relative to it. */
const MEAN = { grass: 0.1728, dry: 0.2283, dirt: 0.1337, rock: 0.2149, sand: 0.5424, cobble: 0.2018 }

let shared: THREE.MeshStandardMaterial | null = null

export function groundMaterial() {
  if (shared) return shared
  const loader = new THREE.TextureLoader()
  const load = (name: string) => {
    const t = loader.load(tex(name))
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.colorSpace = THREE.SRGBColorSpace
    t.anisotropy = 4
    return t
  }
  const uniforms = {
    tGrass: { value: load('grass') },
    tDry: { value: load('drygrass') },
    tDirt: { value: load('dirt') },
    tRock: { value: load('rock') },
    tSand: { value: load('sand') },
    tCobble: { value: load('cobble') },
  }
  // Footpath segments, tested per pixel (their few-metre width is finer than the terrain's vertices).
  const segs = TSEGS.map((s) => new THREE.Vector4(s.ax, s.az, s.bx, s.bz))
  const roads = RSEGS.map((s) => new THREE.Vector4(s.ax, s.az, s.bx, s.bz))
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.93, metalness: 0 })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms, { uTrails: { value: segs }, uRoads: { value: roads } })
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
attribute vec4 surfA;
attribute float surfB;
attribute float surfR;
varying vec4 vSurfA;
varying float vSurfB;
varying float vRoad;
varying vec3 vGPos;
varying vec3 vGNrm;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
vSurfA = surfA;
vSurfB = surfB;
vRoad = surfR;
vGPos = position;
vGNrm = normal;`,
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D tGrass, tDry, tDirt, tRock, tSand, tCobble;
uniform vec4 uTrails[${TSEGS.length}];
float gTrail(vec2 p) {
  float best = 1e9;
  for (int i = 0; i < ${TSEGS.length}; i++) {
    vec2 a = uTrails[i].xy, b = uTrails[i].zw, ab = b - a;
    float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
    best = min(best, length(p - a - ab * t));
  }
  return abs(best + sin(p.x * 0.05) * sin(p.y * 0.043) * 1.4);
}
uniform vec4 uRoads[${RSEGS.length}];
varying vec4 vSurfA;
varying float vSurfB;
varying float vRoad;
varying vec3 vGPos;
varying vec3 vGNrm;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float gLum(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }
float gDetailL;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
{
  vec2 uv = vGPos.xz;
  float macro = gNoise(uv * 0.012) * 0.6 + gNoise(uv * 0.045) * 0.4;
  // Grass at two scales and offsets, mixed by the macro noise (no visible tiling).
  vec3 g1 = texture2D(tGrass, uv * 0.16).rgb;
  vec3 g2 = texture2D(tGrass, uv * 0.047 + vec2(0.37, 0.71)).rgb;
  vec3 grass = mix(g1, g2, smoothstep(0.35, 0.65, macro));
  vec3 dry = texture2D(tDry, uv * 0.17).rgb;
  vec3 dirt = texture2D(tDirt, uv * 0.2).rgb;
  // Rock is projected on whichever vertical plane faces the slope best.
  vec3 an = abs(normalize(vGNrm));
  vec3 rock = mix(texture2D(tRock, vGPos.zy * 0.11).rgb, texture2D(tRock, vGPos.xy * 0.11).rgb, step(an.x, an.z));
  rock = mix(rock, texture2D(tRock, uv * 0.11).rgb, smoothstep(0.75, 0.95, an.y));
  vec3 sand = texture2D(tSand, uv * 0.23).rgb;
  vec3 cob = texture2D(tCobble, uv * 0.3).rgb;
  float wd = vSurfA.x, wr = vSurfA.y, ws = vSurfA.z, wp = vSurfA.w;
  // Footpaths: packed earth with a ragged edge.
  float trail = smoothstep(${(TRAIL_HALF + 0.9).toFixed(2)}, ${(TRAIL_HALF - 0.5).toFixed(2)}, gTrail(uv) + (gNoise(uv * 0.9) - 0.5) * 0.8);
  if (trail > 0.0) {
    float keep = 1.0 - trail;
    wr *= keep; ws *= keep; wp *= keep;
    wd = max(wd * keep, trail);
  }
  float wg = max(0.0, 1.0 - wd - wr - ws - wp);
  float tot = max(1e-3, wg + wd + wr + ws + wp);
  vec3 tint = diffuseColor.rgb;
  // Grass and dry grass keep the district's hue (texture adds detail); dirt, rock and sand bring more of their own.
  vec3 gC = tint * mix(1.0, gLum(grass) / ${MEAN.grass.toFixed(4)}, 0.5);
  vec3 dC = mix(tint * gLum(dry) / ${MEAN.dry.toFixed(4)}, dry * 0.9, 0.55);
  vec3 grassMix = mix(gC, dC, vSurfB);
  vec3 dirtC = mix(tint * gLum(dirt) / ${MEAN.dirt.toFixed(4)}, dirt * 1.05, 0.85);
  vec3 rockC = mix(tint * gLum(rock) / ${MEAN.rock.toFixed(4)}, rock * 1.1, 0.45);
  vec3 sandC = tint * mix(1.0, gLum(sand) / ${MEAN.sand.toFixed(4)}, 0.6);
  vec3 cobC = mix(tint * gLum(cob) / ${MEAN.cobble.toFixed(4)}, cob, 0.35);
  vec3 detailed = (grassMix * wg + dirtC * wd + rockC * wr + sandC * ws + cobC * wp) / tot;
  gDetailL = (gLum(mix(grass, dry, vSurfB)) * wg + gLum(dirt) * wd + gLum(rock) * wr * 1.6 + gLum(sand) * ws + gLum(cob) * wp * 1.4) / tot;
  // Fade the fine detail with distance; keep the macro variation everywhere.
  float far = smoothstep(260.0, 520.0, length(vViewPosition));
  diffuseColor.rgb = mix(detailed, tint, far) * (0.9 + 0.2 * macro);
  gDetailL *= 1.0 - far;
  // Roads: tarmac with fine grit, a dashed centre line and a pale kerb, tested per pixel near a road.
  if (vRoad > 0.0) {
    float rd = 1e9, along = 0.0;
    for (int i = 0; i < ${RSEGS.length}; i++) {
      vec2 a = uRoads[i].xy, ab = uRoads[i].zw - a;
      float l = length(ab);
      float t = clamp(dot(uv - a, ab) / (l * l), 0.0, 1.0);
      float d = length(uv - a - ab * t);
      if (d < rd) { rd = d; along = t * l; }
    }
    float aa = max(fwidth(rd), 0.05);
    float tar = 1.0 - smoothstep(${ROAD_HALF.toFixed(2)} - aa, ${ROAD_HALF.toFixed(2)} + aa, rd);
    float kerb = (1.0 - smoothstep(${(ROAD_HALF + 1.0).toFixed(2)} - aa, ${(ROAD_HALF + 1.0).toFixed(2)} + aa, rd)) * (1.0 - tar);
    vec3 grit = texture2D(tSand, uv * 0.5).rgb;
    vec3 tarC = vec3(0.029, 0.031, 0.039) * (0.75 + 0.5 * gLum(grit) / ${MEAN.sand.toFixed(4)}) * (0.9 + 0.2 * macro);
    float dash = (1.0 - smoothstep(0.18, 0.18 + aa, rd)) * step(mod(along, 8.0), 4.0) * (1.0 - far);
    tarC = mix(tarC, vec3(0.78, 0.55, 0.10), dash * 0.85);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.33, 0.30, 0.25), kerb * 0.75);
    diffuseColor.rgb = mix(diffuseColor.rgb, tarC, tar);
    gDetailL = mix(gDetailL, gLum(grit) * 0.4, tar);
  }
}`,
      )
      .replace(
        '#include <normal_fragment_begin>',
        `#include <normal_fragment_begin>
{
  // Bump from the blended detail (the derivative trick three.js uses for bump maps).
  vec3 dpx = dFdx(-vViewPosition), dpy = dFdy(-vViewPosition);
  // Only up close: further out a texel (or a path's edge) spans less than a pixel and the slope would flip the normal.
  float bumpK = 1.6 * (1.0 - smoothstep(40.0, 140.0, length(vViewPosition)));
  float hx = dFdx(gDetailL) * bumpK, hy = dFdy(gDetailL) * bumpK;
  vec3 r1 = cross(dpy, normal), r2 = cross(normal, dpx);
  float det = dot(dpx, r1);
  vec3 grad = sign(det) * (hx * r1 + hy * r2);
  vec3 bumped = normalize(abs(det) * normal - grad);
  normal = dot(bumped, normal) > 0.4 ? bumped : normal;
}`,
      )
  }
  mat.customProgramCacheKey = () => 'island-ground-v3'
  shared = mat
  return mat
}
