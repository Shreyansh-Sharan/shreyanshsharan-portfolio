// The house material library: painted lap siding, brick, painted trim, shingles, snow, glass, interior wallpaper,
// floors and ceilings. Paint colours are capped below pure white so sunlit trim never clips, every exterior
// surface has a normal map, and interior surfaces take a reduced share of the sky light (`indoorAmbient`) so rooms
// are lit by their lamps and the sun through the windows instead of a flat uniform glow.
import * as THREE from 'three'
import { beadboardSurface, brickSurface, shingleSurface, sidingSurface, smallTiles, trimSurface, type Surface } from './surfaces'

const cache = new Map<string, THREE.Material>()
export function cached<T extends THREE.Material>(key: string, make: () => T): T {
  let m = cache.get(key) as T | undefined
  if (!m) cache.set(key, (m = make()))
  return m
}

/** Shared uniform: how much sky light reaches indoor surfaces (set per mood). */
export const indoorAmbient = { value: 0.45 }

/** Make a standard material an indoor one (scaled ambient / environment light). */
export function indoor<T extends THREE.MeshStandardMaterial>(m: T): T {
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uIndoor = indoorAmbient
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uIndoor;')
      .replace(
        '#include <aomap_fragment>',
        // Sky and ground bounce reach a room only dimly, and as a neutral warm grey rather than blue and grass green.
        `float indoorL = dot(reflectedLight.indirectDiffuse, vec3(0.299, 0.587, 0.114));
        reflectedLight.indirectDiffuse = indoorL * vec3(1.0, 0.93, 0.84) * uIndoor;
        reflectedLight.indirectSpecular *= uIndoor;
        #include <aomap_fragment>`,
      )
  }
  m.customProgramCacheKey = () => 'indoor'
  return m
}

/** Paint: a theme colour with its albedo capped (real white paint reflects ~80%). */
export function paint(hex: string, cap = 0.78) {
  const c = new THREE.Color(hex)
  const m = Math.max(c.r, c.g, c.b)
  if (m > cap) c.multiplyScalar(cap / m)
  return c
}

const v2 = (s: number) => new THREE.Vector2(s, s)

function surfaceMat(key: string, s: Surface, colour: THREE.Color, rough: number, normal: number, extra: THREE.MeshStandardMaterialParameters = {}) {
  return cached(key, () => new THREE.MeshStandardMaterial({ map: s.map, normalMap: s.normalMap, normalScale: v2(normal), color: colour, roughness: rough, metalness: 0, ...extra }))
}

export const M = {
  siding: (hex: string) => surfaceMat(`siding-${hex}`, sidingSurface(), paint(hex, 0.8), 0.68, 1.0),
  brick: (hex = '#ffffff') => surfaceMat(`brick-${hex}`, brickSurface(), paint(hex, 1), 0.88, 1.1),
  trim: (hex: string) => surfaceMat(`trim-${hex}`, trimSurface(), paint(hex, 0.74), 0.5, 0.35),
  /** Darker painted accents (shutters, doors). */
  accent: (hex: string) => surfaceMat(`accent-${hex}`, trimSurface(), paint(hex, 0.7), 0.45, 0.35),
  shingles: (hex: string) => surfaceMat(`shingles-${hex}`, shingleSurface(), paint(hex, 0.62), 0.82, 1.4),
  beadboard: (hex: string) => surfaceMat(`bead-${hex}`, beadboardSurface(), paint(hex, 0.74), 0.6, 0.6),
  concrete: (hex = '#b9b4ab') => cached(`concrete-${hex}`, () => new THREE.MeshStandardMaterial({ color: paint(hex, 0.6), roughness: 0.92 })),
  metal: (hex: string) => cached(`metal-${hex}`, () => new THREE.MeshStandardMaterial({ color: paint(hex, 0.75), roughness: 0.35, metalness: 0.6 })),
  /** Window glass: reflective, a little see-through, glowing warm when the lights are on. */
  glass: (glow: number) =>
    cached(`glass-${glow}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: glow > 0.5 ? '#ffd9a0' : '#2c3f52', roughness: 0.04, metalness: 0.1, transparent: true, opacity: glow > 0.5 ? 0.82 : 0.5, envMapIntensity: 1.6, emissive: '#ffbf6b', emissiveIntensity: glow, depthWrite: false })
      m.userData.noShadow = true
      return m
    }),
  /** Snow lying on roofs and ledges. */
  snow: () => cached('roof-snow', () => new THREE.MeshStandardMaterial({ color: paint('#f2f6fb', 0.82), roughness: 0.95 })),
  /** Interior surfaces. */
  paper: (hex: string, map: THREE.Texture) => cached(`paper-${hex}`, () => indoor(new THREE.MeshStandardMaterial({ map, color: paint(hex, 0.85), roughness: 0.9 }))),
  /** Ceilings: cream paint with a faint brush texture and a touch of bounce light so rooms read airy. */
  ceiling: () => cached('ceiling', () => indoor(new THREE.MeshStandardMaterial({ map: trimSurface().map, color: paint('#f7f2ea', 0.82), roughness: 0.92, emissive: '#fff4e4', emissiveIntensity: 0.07 }))),
  skirting: () => cached('skirting', () => indoor(new THREE.MeshStandardMaterial({ color: paint('#f4efe6', 0.72), roughness: 0.55 }))),
  indoorTrim: (hex: string) => cached(`itrim-${hex}`, () => indoor(new THREE.MeshStandardMaterial({ color: paint(hex, 0.74), roughness: 0.55 }))),
  floor: (map: THREE.Texture, tint = '#ffffff', rough = 0.55) => cached(`floor-${map.uuid}-${tint}`, () => indoor(new THREE.MeshStandardMaterial({ map, color: paint(tint, 0.9), roughness: rough }))),
  carpet: (hex: string) => cached(`carpet-${hex}`, () => indoor(new THREE.MeshStandardMaterial({ map: trimSurface().map, color: paint(hex, 0.7), roughness: 1 }))),
  tiles: () => cached('bath-tiles', () => indoor(new THREE.MeshStandardMaterial({ map: smallTiles(), color: paint('#ffffff', 0.85), roughness: 0.3 }))),
  /** Lamp shades and bulbs: emissive, never shadowed. */
  bulb: (hex: string, k: number) =>
    cached(`bulb-${hex}-${k}`, () => {
      const m = new THREE.MeshStandardMaterial({ color: '#fff6e0', emissive: hex, emissiveIntensity: k, roughness: 0.4 })
      m.userData.noShadow = true
      return m
    }),
}

/** Indoor copies of a model's materials (furniture and valuables), cached per source material. */
export function indoorModel(obj: THREE.Object3D) {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh) return
    const swap = (src: THREE.Material) => {
      const s = src as THREE.MeshStandardMaterial
      if (!s.isMeshStandardMaterial || s.transparent) return src
      return cached(`in-${s.uuid}`, () => indoor(s.clone()))
    }
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material)
  })
  return obj
}
