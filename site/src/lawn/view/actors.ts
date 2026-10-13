// Characters: one original skinned model per hero (the dog and the garden robot carry their own baked clips), the
// shared clip set driven by the sim's animation state, an optional cosmetic dye that recolours the hero's main
// garment in the shader, held weapons on the right hand, and the first-person arms: the hero's own skinned body
// filtered down to its forearm and hand triangles, hung under the camera.
import * as THREE from 'three'
import { findClip, instance, type LawnAssets } from '../engine/assets'
import { HEROES, type Hero, type HeroId } from '../engine/heroes'
import type { ToolKind } from '../engine/gear'
import { label } from './textures'

/** Which garment the cosmetic colour dyes: its hue (0..1), hue tolerance, saturation floor and value range. */
interface Dye {
  hue: number
  tol: number
  sat: number
  vMin: number
  vMax: number
  /** Typical brightness of the garment, so the dyed colour keeps its folds. */
  luma: number
}

interface HeroLook {
  model: string
  dye: Dye | null
  /** Extra forward lean added on top of the clips (the grandpa's stoop). */
  hunch: number
}

export const LOOKS: Record<HeroId, HeroLook> = {
  nana: { model: 'hero-nana', dye: { hue: 0.975, tol: 0.045, sat: 0.3, vMin: 0.35, vMax: 1, luma: 0.55 }, hunch: 0.06 },
  dad: { model: 'hero-dad', dye: { hue: 0.565, tol: 0.06, sat: 0.22, vMin: 0.2, vMax: 1, luma: 0.62 }, hunch: 0 },
  kid: { model: 'hero-kid', dye: { hue: 0.4, tol: 0.08, sat: 0.25, vMin: 0.15, vMax: 1, luma: 0.38 }, hunch: 0 },
  hoa: { model: 'hero-hoa', dye: { hue: 0.985, tol: 0.05, sat: 0.4, vMin: 0.05, vMax: 0.55, luma: 0.14 }, hunch: 0 },
  gramps: { model: 'hero-gramps', dye: { hue: 0.065, tol: 0.05, sat: 0.3, vMin: 0.1, vMax: 0.52, luma: 0.27 }, hunch: 0.12 },
  dog: { model: 'dog', dye: null, hunch: 0 },
}

/** Recolour the garment texels toward `hex` (keeps the texture's light and folds). */
function applyDye(mat: THREE.MeshStandardMaterial, dye: Dye, hex: string) {
  const to = new THREE.Color(hex)
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDyeTo = { value: to }
    sh.uniforms.uDye = { value: new THREE.Vector4(dye.hue, dye.tol, dye.sat, dye.luma) }
    sh.uniforms.uDyeV = { value: new THREE.Vector2(dye.vMin, dye.vMax) }
    sh.fragmentShader = sh.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform vec3 uDyeTo;
uniform vec4 uDye;
uniform vec2 uDyeV;
vec3 lwHsv(vec3 c) {
  vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
  vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
  vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
  float d = q.x - min(q.w, q.y);
  return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + 1e-10)), d / (q.x + 1e-10), q.x);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
{
  vec3 lwC = pow(diffuseColor.rgb, vec3(1.0 / 2.2));
  vec3 h = lwHsv(lwC);
  float dh = abs(h.x - uDye.x);
  dh = min(dh, 1.0 - dh);
  float m = (1.0 - smoothstep(uDye.y * 0.6, uDye.y, dh)) * smoothstep(uDye.z * 0.7, uDye.z, h.y) * step(uDyeV.x, h.z) * (1.0 - smoothstep(uDyeV.y - 0.05, uDyeV.y + 0.05, h.z));
  float l = clamp(dot(lwC, vec3(0.299, 0.587, 0.114)) / max(uDye.w, 0.05), 0.35, 1.6);
  vec3 dyed = pow(clamp(uDyeTo * l, 0.0, 1.0), vec3(2.2));
  diffuseColor.rgb = mix(diffuseColor.rgb, dyed, m);
}`,
      )
  }
  mat.customProgramCacheKey = () => `dye-${hex}-${dye.hue}`
}

/** Clone a hero's body materials and dye them unless the colour is the stock one. */
function dress(model: THREE.Object3D, look: HeroLook, hero: Hero, colour: string) {
  if (!look.dye || !colour || colour.toLowerCase() === hero.colors[0].toLowerCase()) return
  model.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const mat = (m.material as THREE.MeshStandardMaterial).clone()
    applyDye(mat, look.dye!, colour)
    m.material = mat
  })
}

/** The held weapon / tool model for a hero (with per-weapon offsets on the right hand). */
function weaponFor(assets: LawnAssets, hero: Hero, tool: ToolKind | 'blower' | null): THREE.Object3D {
  // [model, grip fraction along the length (0 = held at the base), yaw twist]
  const map: Record<string, [string, number, number]> = {
    rollingpin: ['rollingpin', 0.5, 0],
    golfclub: ['golfclub', 0.05, Math.PI],
    slingshot: ['slingshot', 0.1, 0],
    clipboard: ['', 0.2, 0],
    cane: ['', 0.9, 0],
    bite: ['', 0, 0],
    bat: ['bat', 0.08, 0],
    hammer: ['sledge', 0.1, 0],
    pan: ['pan', 0.1, 0],
    rake: ['rake', 0.25, 0],
    shovel: ['shovel', 0.25, 0],
    hose: ['', 0.3, 0],
    blower: ['blower', 0.3, 0],
  }
  const kind = tool ?? hero.melee.kind
  const [name, grip, twist] = map[kind] ?? map.bat
  let obj = name ? instance(assets, name) : null
  if (!obj) obj = standInWeapon(kind)
  const wrap = new THREE.Group()
  // Models stand on y=0 with their length along +Y; slide them so the grip point sits in the palm, then turn +Y
  // to the hand's -X (forward along the forearm) with a little downward droop.
  const h = (obj.userData.height as number) || 0.8
  obj.position.set(0, -h * grip, 0)
  obj.rotation.y = twist
  wrap.add(obj)
  wrap.position.set(0.02, -0.01, 0)
  // Held upright, head up, tilted a little forward: the ready pose for a swing.
  wrap.rotation.set(Math.PI / 2 - 0.25, 0, Math.PI / 2 + 0.1)
  return wrap
}

/** Procedural stand-ins: clipboard, cane, hose nozzle. */
function standInWeapon(kind: string): THREE.Object3D {
  const g = new THREE.Group()
  if (kind === 'clipboard') {
    const board = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.32, 0.012), new THREE.MeshStandardMaterial({ color: '#8b5a2b', roughness: 0.9 }))
    const paper = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.26, 0.004), new THREE.MeshStandardMaterial({ color: '#f6f1e4', roughness: 0.95 }))
    paper.position.z = 0.009
    const clip = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.03, 0.02), new THREE.MeshStandardMaterial({ color: '#aab', metalness: 0.4, roughness: 0.4 }))
    clip.position.set(0, 0.15, 0.01)
    g.add(board, paper, clip)
    g.userData.height = 0.32
  } else if (kind === 'cane') {
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.02, 0.9, 10), new THREE.MeshStandardMaterial({ color: '#5a3a1e', roughness: 0.6 }))
    shaft.position.y = 0.45
    const handle = new THREE.Mesh(new THREE.TorusGeometry(0.07, 0.016, 8, 16, Math.PI), new THREE.MeshStandardMaterial({ color: '#3a2412', roughness: 0.6 }))
    handle.position.set(0.07, 0.9, 0)
    g.add(shaft, handle)
    g.userData.height = 0.95
  } else if (kind === 'hose') {
    const nozzle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.035, 0.22, 10), new THREE.MeshStandardMaterial({ color: '#2a7f3f', roughness: 0.6 }))
    nozzle.rotation.x = Math.PI / 2
    const hose = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.018, 8, 16, Math.PI * 1.5), new THREE.MeshStandardMaterial({ color: '#2f8f4f', roughness: 0.7 }))
    hose.position.set(-0.1, -0.1, 0)
    g.add(nozzle, hose)
    g.userData.height = 0.22
  } else {
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.8, 8), new THREE.MeshStandardMaterial({ color: '#c9a36b' }))
    m.position.y = 0.4
    g.add(m)
    g.userData.height = 0.8
  }
  return g
}

/** Walt's open umbrella, held out in front as a shield while blocking (canopy toward +Z). */
function umbrellaShield(assets: LawnAssets) {
  const u = instance(assets, 'umbrella')
  if (!u) return null
  const g = new THREE.Group()
  u.rotation.x = Math.PI / 2
  u.position.z = -0.45
  g.add(u)
  g.visible = false
  return g
}

export interface ActorMeta {
  name: string
  hero: HeroId
  team: number
  colour: string
  human: boolean
  robot: boolean
}

const TEAM_COLOURS = ['#ffd93b', '#5ee0a3']
export const teamColour = (t: number) => TEAM_COLOURS[t] ?? '#c0c0c0'

/** Third-person character. */
export class Actor {
  readonly group = new THREE.Group()
  readonly meta: ActorMeta
  readonly hero: Hero
  private assets: LawnAssets
  private model: THREE.Object3D
  private mixer: THREE.AnimationMixer | null = null
  private actions = new Map<string, THREE.AnimationAction>()
  private current: THREE.AnimationAction | null = null
  private currentName = ''
  private hand: THREE.Object3D | null = null
  private head: THREE.Object3D | null = null
  private spine: THREE.Object3D | null = null
  private weapon: THREE.Object3D | null = null
  private tool: ToolKind | 'blower' | null = null
  private tag: THREE.Sprite
  private tagCanvas: HTMLCanvasElement
  private tagTex: THREE.CanvasTexture
  private tagHp = -1
  private ring: THREE.Mesh
  private look: HeroLook
  private quad: boolean
  private lastAnim = -1
  private hitTimer = 0
  private deadTimer = 0
  private bodyMesh: THREE.SkinnedMesh | null = null
  private hunchQ = new THREE.Quaternion()
  private umbrella: THREE.Object3D | null = null
  private flashTool: 'blower' | null = null
  private flashUntil = 0
  private clock = 0
  private axisX = new THREE.Vector3(1, 0, 0)
  visible = true
  x = 0
  y = 0
  z = 0
  yaw = 0
  hp = 1
  maxHp = 1
  alive = true

  constructor(assets: LawnAssets, meta: ActorMeta, myTeam = -1) {
    this.assets = assets
    this.meta = meta
    const friendly = meta.team === myTeam && !meta.robot
    this.hero = HEROES[meta.hero]
    this.look = LOOKS[meta.hero]
    this.quad = meta.hero === 'dog' || meta.robot
    const team = teamColour(meta.team)
    const modelName = meta.robot ? 'robot' : this.look.model
    let model = instance(assets, modelName)
    if (!model) model = standInBody(this.hero, meta.robot)
    this.model = model
    this.group.add(model)
    // Every model carries its own clips (the heroes' hip motion is scaled to their own legs).
    const clips = assets.clips.get(modelName)
    if (clips?.length) {
      this.mixer = new THREE.AnimationMixer(model)
      for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c))
    }
    model.traverse((o) => {
      if (o.name === 'hand_r') this.hand = o
      if (o.name === 'Head') this.head = o
      if (o.name === 'spine_02') this.spine = o
      const m = o as THREE.SkinnedMesh
      if (m.isSkinnedMesh && (!this.bodyMesh || m.geometry.attributes.position.count > this.bodyMesh.geometry.attributes.position.count)) this.bodyMesh = m
    })
    if (!this.quad) {
      dress(model, this.look, this.hero, meta.colour)
      this.setTool(null)
      if (this.hero.umbrella) {
        this.umbrella = umbrellaShield(assets)
        if (this.umbrella) {
          this.umbrella.position.set(0, this.hero.height * 0.62, 0.55)
          this.group.add(this.umbrella)
        }
      }
    }
    if (meta.hero === 'dog' && !meta.robot && meta.colour.toLowerCase() !== this.hero.colors[0].toLowerCase()) {
      // Biscuit's bandana takes the cosmetic colour.
      dress(model, { model: 'dog', dye: { hue: 0.0, tol: 0.04, sat: 0.72, vMin: 0.35, vMax: 1, luma: 0.42 }, hunch: 0 }, this.hero, meta.colour)
    }
    if (meta.robot) {
      model.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          m.material = (m.material as THREE.MeshStandardMaterial).clone()
          ;(m.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#ff3b3b')
          ;(m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.12
        }
      })
    }
    // Name tag + health bar.
    this.tagCanvas = document.createElement('canvas')
    this.tagCanvas.width = 256
    this.tagCanvas.height = 64
    this.tagTex = new THREE.CanvasTexture(this.tagCanvas)
    this.tagTex.colorSpace = THREE.SRGBColorSpace
    this.tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.tagTex, transparent: true, depthTest: !friendly, depthWrite: false }))
    this.tag.scale.set(1.6, 0.4, 1)
    this.tag.position.y = this.hero.height + 0.45
    this.tag.renderOrder = 9
    this.group.add(this.tag)
    this.drawTag()
    // Team ring on the ground.
    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.32, 0.42, 24), new THREE.MeshBasicMaterial({ color: team, transparent: true, opacity: 0.55, depthWrite: false }))
    this.ring.rotation.x = -Math.PI / 2
    this.ring.position.y = 0.02
    this.group.add(this.ring)
    this.play('Idle_Loop', 0)
  }

  setTool(tool: ToolKind | null) {
    if (this.quad) return
    const want: ToolKind | 'blower' | null = this.flashTool && this.clock < this.flashUntil ? this.flashTool : tool
    if (this.weapon && this.tool === want && this.weapon.parent) return
    if (this.weapon) this.weapon.parent?.remove(this.weapon)
    this.tool = want
    this.weapon = weaponFor(this.assets, this.hero, want)
    const parent = this.hand ?? this.model
    parent.add(this.weapon)
    counterScale(this.weapon, parent)
  }

  /** Hold a gadget for a moment (the leaf blower during its ultimate). */
  flash(kind: 'blower', seconds: number) {
    this.flashTool = kind
    this.flashUntil = this.clock + seconds
  }

  private drawTag() {
    const g = this.tagCanvas.getContext('2d')!
    g.clearRect(0, 0, 256, 64)
    g.font = '800 28px Inter, system-ui, sans-serif'
    g.textAlign = 'center'
    g.lineWidth = 6
    g.strokeStyle = 'rgba(20,12,6,0.9)'
    g.strokeText(this.meta.name, 128, 30)
    g.fillStyle = teamColour(this.meta.team)
    g.fillText(this.meta.name, 128, 30)
    // Health bar.
    g.fillStyle = 'rgba(20,12,6,0.75)'
    g.fillRect(48, 42, 160, 14)
    const k = Math.max(0, Math.min(1, this.hp / Math.max(1, this.maxHp)))
    g.fillStyle = k > 0.5 ? '#6be36b' : k > 0.25 ? '#ffd23b' : '#ff5a4a'
    g.fillRect(50, 44, 156 * k, 10)
    this.tagTex.needsUpdate = true
  }

  /** Map the sim's animation id to a clip. */
  private clipFor(anim: number, moving: boolean) {
    if (this.meta.robot) return anim === 7 ? 'IDLE' : moving ? 'Walk' : anim === 4 || anim === 5 ? 'Walk' : 'IDLE'
    if (this.meta.hero === 'dog') return anim === 7 ? 'Idle_2' : anim === 4 || anim === 5 ? 'Jump' : anim === 2 ? 'Run' : moving ? 'Walk' : anim === 6 ? 'Eating' : 'Idle_1'
    switch (anim) {
      case 1:
        return 'Walk_Loop'
      case 2:
        return 'Sprint_Loop'
      case 3:
        return 'Jump_Loop'
      case 4:
        return 'Punch_Jab'
      case 5:
        return 'Sword_Attack'
      case 6:
        return 'Hit_Chest'
      case 7:
        return 'Death01'
      case 8:
        return 'Spell_Simple_Shoot'
      case 9:
        return 'Crouch_Fwd_Loop'
      case 10:
        return 'Push_Loop'
      case 11:
        return moving ? 'Crouch_Fwd_Loop' : 'Crouch_Idle_Loop'
      case 12:
        return 'Driving_Loop'
      default:
        return 'Idle_Loop'
    }
  }

  private play(name: string, fade = 0.12, once = false, speed = 1) {
    const clip = findClip(Array.from(this.actions.keys()).map((k) => this.actions.get(k)!.getClip()), name)
    if (!clip || !this.mixer) return
    const action = this.actions.get(clip.name)!
    if (action === this.current && !once) return
    if (this.current && this.current !== action) this.current.fadeOut(fade)
    action.reset()
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity)
    action.clampWhenFinished = once
    action.timeScale = speed
    action.fadeIn(fade).play()
    this.current = action
    this.currentName = clip.name
  }

  /** Play one clip once (the lobby's showcase: a dance or a swing); the idle resumes when it ends. */
  emote(name: string, speed = 1) {
    this.play(name, 0.2, true, speed)
  }

  /** Per-frame update from the snapshot row. */
  update(dt: number, row: { x: number; y: number; z: number; yaw: number; pitch: number; hp: number; maxHp: number; anim: number; moving: boolean; alive: boolean; blocking: boolean; stunned: boolean; onLadder: boolean; riding: boolean; tool: ToolKind | null }, meId: boolean, hideTags = false) {
    this.clock += dt
    this.x = row.x
    this.y = row.y
    this.z = row.z
    this.yaw = row.yaw
    if (this.umbrella) this.umbrella.visible = row.alive && row.blocking
    this.group.position.set(row.x, row.y, row.z)
    this.group.rotation.y = row.yaw
    this.alive = row.alive
    if (row.hp !== this.tagHp || row.maxHp !== this.maxHp) {
      this.hp = row.hp
      this.maxHp = row.maxHp
      this.tagHp = row.hp
      this.drawTag()
    }
    this.setTool(row.tool)
    // Animation state.
    const anim = row.alive ? row.anim : 7
    if (anim !== this.lastAnim) {
      this.lastAnim = anim
      const once = anim === 4 || anim === 5 || anim === 6 || anim === 7 || anim === 8
      const speed = anim === 4 ? 2.2 : anim === 5 ? 1.6 : anim === 8 ? 2 : anim === 7 ? 1.4 : anim === 2 ? 1.1 : 1
      this.play(this.clipFor(anim, row.moving), anim === 7 ? 0.05 : 0.1, once, speed)
    } else if ((anim === 0 || anim === 1 || anim === 2) && this.current && !this.current.isRunning()) this.play(this.clipFor(anim, row.moving), 0.1)
    // Finished one-shots fall back to idle so the next swing restarts cleanly.
    if (this.current && (this.currentName === 'Punch_Jab' || this.currentName === 'Sword_Attack' || this.currentName === 'Hit_Chest' || this.currentName === 'Spell_Simple_Shoot') && !this.current.isRunning() && row.alive) {
      this.lastAnim = -1
    }
    // Head looks along the pitch; the hunch for the grandpa.
    if (this.head && !this.quad) this.head.rotation.x = -row.pitch * 0.6
    this.mixer?.update(dt)
    // The grandpa's stoop, layered on the clip pose.
    if (this.spine && this.look.hunch && row.alive) this.spine.quaternion.multiply(this.hunchQ.setFromAxisAngle(this.axisX, this.look.hunch))
    this.tag.visible = row.alive && !meId && !hideTags
    this.ring.visible = row.alive && !hideTags
    if (!row.alive) this.deadTimer += dt
    else this.deadTimer = 0
    this.hitTimer = Math.max(0, this.hitTimer - dt)
  }

  /** World position of the head (for KO stars). */
  headPos(out = new THREE.Vector3()) {
    out.set(this.x, this.y + this.hero.height + 0.15, this.z)
    return out
  }

  dispose() {
    this.group.parent?.remove(this.group)
    this.mixer?.stopAllAction()
    this.tagTex.dispose()
    ;(this.tag.material as THREE.Material).dispose()
  }
}

/** A capsule-and-box stand-in when a character model is missing. */
function standInBody(hero: Hero, robot: boolean): THREE.Object3D {
  const g = new THREE.Group()
  const mat = new THREE.MeshStandardMaterial({ color: robot ? '#8fa3b8' : hero.colors[0], roughness: 0.8 })
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(hero.halfWidth * 0.9, hero.height - hero.halfWidth * 1.8, 6, 12), mat)
  body.position.y = hero.height / 2
  body.castShadow = true
  g.add(body)
  g.userData.height = hero.height
  return g
}

/* ---------- first-person arms ---------- */

/**
 * A stylised gripping hand (local frame: -z along the forearm, +y up): a rounded palm and the heel of the hand,
 * four fingers curled round a vertical grip at (0, 0, -0.1) as stacked partial rings, knuckles on the outside,
 * and the thumb wrapped over the top.
 */
function gripHand(skin: THREE.Material, side: number, fix: (m: THREE.Mesh) => THREE.Mesh) {
  const hand = new THREE.Group()
  const palm = fix(new THREE.Mesh(new THREE.CapsuleGeometry(0.034, 0.045, 8, 16), skin))
  palm.scale.set(1.0, 1.25, 0.62)
  palm.position.set(side * 0.012, -0.004, -0.055)
  hand.add(palm)
  const wrist = fix(new THREE.Mesh(new THREE.CylinderGeometry(0.036, 0.04, 0.05, 16), skin))
  wrist.rotation.x = Math.PI / 2
  wrist.position.z = -0.02
  hand.add(wrist)
  // Fingers: rings round the grip, open toward the palm side, shrinking toward the little finger.
  const radii = [0.0215, 0.022, 0.021, 0.019]
  radii.forEach((tube, i) => {
    const ring = new THREE.TorusGeometry(0.024, tube * 0.62, 8, 20)
    ring.rotateX(Math.PI / 2)
    const m = fix(new THREE.Mesh(ring, skin))
    m.position.set(side * 0.004, 0.034 - i * 0.023, -0.1)
    hand.add(m)
    // A knuckle bump on the outside of each finger.
    const k = fix(new THREE.Mesh(new THREE.SphereGeometry(tube * 0.62, 10, 8), skin))
    k.position.set(side * 0.004, 0.034 - i * 0.023, -0.126)
    k.scale.set(0.9, 0.8, 1)
    hand.add(k)
  })
  // Thumb over the top of the grip.
  const thumb = fix(new THREE.Mesh(new THREE.CapsuleGeometry(0.016, 0.04, 6, 10), skin))
  thumb.rotation.set(0, 0, side * 1.25)
  thumb.position.set(side * 0.006, 0.052, -0.088)
  hand.add(thumb)
  const base = fix(new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), skin))
  base.position.set(side * 0.03, 0.035, -0.065)
  hand.add(base)
  return hand
}

/** Skin tones for the first-person hands. */
const SKIN: Record<HeroId, string> = { nana: '#efc6a6', dad: '#e3ad86', kid: '#f0c39e', hoa: '#d49b74', gramps: '#e8bd9c', dog: '#b98a5a' }

/**
 * The first-person viewmodel: two sleeved forearms rising from the bottom corners of the screen into gripping
 * hands, built to size (no cut-off body mesh), with the held tool in the right fist. Everything is modelled at
 * real size and then shrunk toward the camera (a viewmodel at a fifth of the size, a fifth of the distance away,
 * looks identical) so it never pokes into walls. Poses are layered procedurally: idle sway, light and heavy
 * swings, block, throw, slingshot draw and ladder climbing.
 */
export class FirstPerson {
  readonly group = new THREE.Group()
  private inner = new THREE.Group()
  private arms: { sleeve: THREE.Mesh; cuff: THREE.Mesh; hand: THREE.Group; shoulder: THREE.Vector3 }[] = []
  private weapon: THREE.Object3D | null = null
  private holder = new THREE.Group()
  private tool: ToolKind | 'blower' | null = null
  private umbrella: THREE.Object3D | null = null
  private flashTool: 'blower' | null = null
  private flashUntil = 0
  private clock = 0
  private wantTool: ToolKind | null = null
  private assets: LawnAssets
  private hero: Hero
  private swing = { t: -1, heavy: false, up: 0.14, down: 0.3 }
  private bob = 0
  private block = 0
  private climb = 0
  private throwT = -1
  private hitStop = 0
  private draw = 0
  private enabled: boolean
  private tmpA = new THREE.Vector3()
  private tmpB = new THREE.Vector3()
  private tmpM = new THREE.Matrix4()
  private up = new THREE.Vector3(0, 1, 0)

  constructor(assets: LawnAssets, heroId: HeroId, colour: string, team: number) {
    void team
    this.assets = assets
    this.hero = HEROES[heroId]
    this.enabled = heroId !== 'dog'
    if (!this.enabled) return
    const skin = new THREE.MeshStandardMaterial({ color: SKIN[heroId], roughness: 0.6 })
    const sleeveMat = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.85 })
    const cuffMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(colour).multiplyScalar(0.75), roughness: 0.85 })
    const noShadow = (m: THREE.Mesh) => {
      m.castShadow = false
      m.receiveShadow = false
      m.frustumCulled = false
      return m
    }
    for (const side of [1, -1]) {
      // A tapered sleeve from beyond the screen edge to the wrist (unit height along +Y, re-aimed every frame).
      const sg = new THREE.CylinderGeometry(0.043, 0.056, 1, 16, 1, false)
      sg.translate(0, 0.5, 0)
      const sleeve = noShadow(new THREE.Mesh(sg, sleeveMat))
      const cuff = noShadow(new THREE.Mesh(new THREE.CylinderGeometry(0.049, 0.049, 0.05, 16), cuffMat))
      const hand = gripHand(skin, side, noShadow)
      this.inner.add(sleeve, cuff, hand)
      this.arms.push({ sleeve, cuff, hand, shoulder: new THREE.Vector3(side * 0.36, -0.56, -0.02) })
    }
    this.arms[0].hand.add(this.holder)
    this.holder.position.set(0, 0, -0.1)
    this.inner.scale.setScalar(0.22)
    this.group.add(this.inner)
    this.setTool(null)
    if (this.hero.umbrella) {
      this.umbrella = umbrellaShield(assets)
      if (this.umbrella) {
        this.umbrella.rotation.y = Math.PI
        this.umbrella.position.set(-0.16, -0.4, -0.25)
        this.umbrella.scale.setScalar(0.65)
        this.inner.add(this.umbrella)
      }
    }
  }

  setTool(tool: ToolKind | null) {
    if (!this.enabled) return
    this.wantTool = tool
    const want: ToolKind | 'blower' | null = this.flashTool && this.clock < this.flashUntil ? this.flashTool : tool
    if (this.weapon && this.tool === want) return
    if (this.weapon) this.holder.remove(this.weapon)
    this.tool = want
    this.weapon = weaponFor(this.assets, this.hero, want)
    // weaponFor turns a tool to a bone frame; in the fist the shaft stands up through the grip, head up and a
    // little forward.
    this.weapon.position.set(0, 0, 0)
    this.weapon.rotation.set(-0.35, 0, 0)
    const inner = this.weapon.children[0]
    if (inner) inner.rotation.set(0, inner.rotation.y, 0)
    this.weapon.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = false
        m.frustumCulled = false
      }
    })
    this.holder.add(this.weapon)
  }

  /** Hold a gadget for a moment (the leaf blower during its ultimate). */
  flash(kind: 'blower', seconds: number) {
    this.flashTool = kind
    this.flashUntil = this.clock + seconds
    this.setTool(this.wantTool)
  }

  startSwing(heavy: boolean) {
    const m = this.hero.melee
    this.swing = { t: 0, heavy, up: heavy ? m.heavyUp : m.lightUp, down: heavy ? m.heavyDown : m.lightDown }
  }

  startThrow() {
    this.throwT = 0
  }

  hit() {
    this.hitStop = 0.07
  }

  /** Aim an arm: sleeve from the shoulder to the wrist, cuff at the wrist, the fist beyond it facing `fwd`. */
  private place(i: number, wrist: THREE.Vector3, roll: number) {
    const a = this.arms[i]
    const d = this.tmpA.subVectors(wrist, a.shoulder)
    const len = d.length()
    d.normalize()
    a.sleeve.position.copy(a.shoulder)
    a.sleeve.quaternion.setFromUnitVectors(this.up, d)
    a.sleeve.scale.set(1, len, 1)
    a.cuff.position.copy(wrist).addScaledVector(d, -0.01)
    a.cuff.quaternion.copy(a.sleeve.quaternion)
    // The fist looks along the forearm (its -z down the arm), rolled about it.
    a.hand.position.copy(wrist)
    this.tmpB.copy(wrist).add(d)
    this.tmpM.lookAt(wrist, this.tmpB, this.up)
    a.hand.quaternion.setFromRotationMatrix(this.tmpM)
    a.hand.rotateZ(roll)
  }

  update(dt: number, moving: boolean, sprinting: boolean, blocking: boolean, drawing: number, climbing = false) {
    if (!this.enabled) return
    this.clock += dt
    if (this.flashTool && this.clock >= this.flashUntil) {
      this.flashTool = null
      this.setTool(this.wantTool)
    }
    if (this.umbrella) this.umbrella.visible = blocking
    this.hitStop = Math.max(0, this.hitStop - dt)
    const live = this.hitStop > 0 ? dt * 0.15 : dt
    this.bob += live * (sprinting ? 11 : 7) * (moving ? 1 : 0.3)
    this.block += ((blocking ? 1 : 0) - this.block) * Math.min(1, 12 * live)
    this.draw += (drawing - this.draw) * Math.min(1, 10 * live)
    this.climb += ((climbing ? 1 : 0) - this.climb) * Math.min(1, 8 * live)
    // Swing curve: wind-up back and up, a fast strike down and across, then recovery.
    let A = 0
    let B = 0
    if (this.swing.t >= 0) {
      this.swing.t += live
      const s = this.swing
      const k = s.heavy ? 1.35 : 1
      if (s.t < s.up) {
        const u = s.t / s.up
        A = -0.9 * u * k
        B = 0.5 * u * k
      } else if (s.t < s.up + 0.12) {
        const u = (s.t - s.up) / 0.12
        A = (-0.9 + 2.0 * u) * k
        B = (0.5 - 1.1 * u) * k
      } else if (s.t < s.up + s.down) {
        const u = (s.t - s.up - 0.12) / Math.max(0.05, s.down - 0.12)
        A = 1.1 * (1 - u) * k
        B = -0.6 * (1 - u) * k
      } else this.swing.t = -1
    }
    let T = 0
    if (this.throwT >= 0) {
      this.throwT += live
      const t = this.throwT
      T = t < 0.12 ? -t / 0.12 : t < 0.3 ? -1 + ((t - 0.12) / 0.18) * 1.8 : t < 0.6 ? 0.8 * (1 - (t - 0.3) / 0.3) : 0
      if (t > 0.6) this.throwT = -1
    }
    const sway = Math.sin(this.bob) * (moving ? 0.018 : 0.006)
    const swayX = Math.cos(this.bob * 0.5) * (moving ? 0.012 : 0.004)
    const bl = this.block
    const cl = this.climb
    const climbPhase = Math.sin(this.clock * 7)
    // Right hand: rest low right, raised and crossed for a block, carried back and over for a swing.
    const right = new THREE.Vector3(0.25 + swayX, -0.3 + sway, -0.5)
    right.x += B * 0.22 - bl * 0.15 - this.draw * 0.04
    right.y += -A * 0.11 + Math.max(0, -A) * 0.12 + bl * 0.13 + T * -0.05 + cl * (0.32 + climbPhase * 0.12)
    right.z += -Math.max(0, A) * 0.08 + T * 0.14 + cl * 0.05
    // Left hand: off the side, comes up to guard or to steady the swing, reaches for rungs on a ladder.
    const left = new THREE.Vector3(-0.27 + swayX, -0.34 + sway * 0.8, -0.46)
    left.x += bl * 0.16 + this.draw * 0.06 + Math.max(0, A) * 0.05
    left.y += bl * 0.15 + this.draw * 0.05 + cl * (0.32 - climbPhase * 0.12)
    left.z += -this.draw * 0.08 + cl * 0.05
    this.place(0, right, 0.15 + B * 0.4 - bl * 1.1)
    this.place(1, left, -0.25 + bl * 1.0)
    // The tool tilts with the swing (back on the wind-up, through on the strike) and goes flat to block.
    this.holder.rotation.set(A * 0.85 - T * 0.4, 0, B * 0.5 + bl * 1.25)
    this.holder.visible = cl < 0.5
    this.group.position.set(0, -bl * 0.01, this.hitStop > 0 ? 0.006 : 0)
    this.group.rotation.z = Math.sin(this.bob * 0.5) * 0.01 * (moving ? 1 : 0)
  }

  dispose() {
    // Materials and geometries are owned here.
    this.inner.traverse((o) => {
      const m = o as THREE.Mesh
      if (m.isMesh && this.arms.some((a) => a.sleeve === m || a.cuff === m || a.hand.children.includes(m))) {
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    })
  }
}

/** Bones carry the armature's scale; undo it so a held model keeps its world size. */
function counterScale(obj: THREE.Object3D, parent: THREE.Object3D) {
  parent.updateWorldMatrix(true, false)
  const s = new THREE.Vector3()
  parent.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), s)
  const k = (Math.abs(s.x) + Math.abs(s.y) + Math.abs(s.z)) / 3 || 1
  obj.scale.setScalar(1 / k)
}

export { label }
