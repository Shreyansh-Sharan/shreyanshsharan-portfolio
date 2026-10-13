// Characters: the Quaternius bodies dressed per hero with vertex-painted outfits (cardigan, polo, hoodie, blazer,
// suspenders), hairstyles parented to the Head bone, procedural accessories (cap, glasses, suspenders), bone-scaled
// cartoon proportions, held weapons on the right hand, library clips driven by the sim's animation state, and the
// first-person arms: the same skinned body filtered down to its arm triangles, hung under the camera.
import * as THREE from 'three'
import { findClip, instance, type LawnAssets } from '../engine/assets'
import { HEROES, type Hero, type HeroId } from '../engine/heroes'
import type { ToolKind } from '../engine/gear'
import { label } from './textures'

interface Outfit {
  skin: string
  hair: string
  top: string
  sleeves: string
  cuffs: string
  bottom: string
  shins: string
  shoes: string
  hairStyle: string
  beard?: boolean
  cap?: boolean
  glasses?: boolean
  suspenders?: boolean
  female: boolean
  /** Head scale, body scale. */
  head: number
  scale: number
  hunch: number
}

export const OUTFITS: Record<HeroId, Outfit> = {
  nana: { skin: '#f1c7a7', hair: '#ece6e2', top: '#c05fa6', sleeves: '#c05fa6', cuffs: '#f8e3a1', bottom: '#5b3a6b', shins: '#e9d9c8', shoes: '#6b4a3a', hairStyle: 'Hair_Buns', glasses: true, female: true, head: 1.42, scale: 0.94, hunch: 0.08 },
  dad: { skin: '#e9b48d', hair: '#5a3a22', top: '#2f6fdd', sleeves: '#2f6fdd', cuffs: '#e9b48d', bottom: '#d9c69a', shins: '#e9b48d', shoes: '#ffffff', hairStyle: 'Hair_Buzzed', cap: true, female: false, head: 1.32, scale: 1.02, hunch: 0 },
  kid: { skin: '#f3cfb3', hair: '#3b2a1a', top: '#f0b429', sleeves: '#f0b429', cuffs: '#2e9c6a', bottom: '#3c5fa8', shins: '#3c5fa8', shoes: '#e0533d', hairStyle: 'Hair_SimpleParted', female: false, head: 1.65, scale: 0.68, hunch: 0 },
  hoa: { skin: '#d9a98f', hair: '#1e1a22', top: '#8c2f5a', sleeves: '#8c2f5a', cuffs: '#f2e6d8', bottom: '#2a2430', shins: '#d9a98f', shoes: '#1e1a22', hairStyle: 'Hair_Long', female: true, head: 1.32, scale: 1.0, hunch: 0 },
  gramps: { skin: '#e6b795', hair: '#cfcfcf', top: '#d8c9a3', sleeves: '#d8c9a3', cuffs: '#e6b795', bottom: '#6b4f2a', shins: '#6b4f2a', shoes: '#2a2422', hairStyle: 'Hair_Buzzed', beard: true, suspenders: true, female: false, head: 1.36, scale: 0.98, hunch: 0.22 },
  dog: { skin: '#c98a4b', hair: '#7a4e24', top: '#c98a4b', sleeves: '#c98a4b', cuffs: '#c98a4b', bottom: '#c98a4b', shins: '#c98a4b', shoes: '#c98a4b', hairStyle: '', female: false, head: 1, scale: 1, hunch: 0 },
}

const ARM = /clavicle|upperarm|lowerarm|hand|index|middle|pinky|ring|thumb/
const HAND = /hand|index|middle|pinky|ring|thumb/
const LEG = /thigh/
const SHIN = /calf/
const FOOT = /foot|ball/
const HEAD = /Head|neck/

/** Paint an outfit into the vertex colours of a skinned body. */
function paintOutfit(mesh: THREE.SkinnedMesh, o: Outfit, teamTint: string) {
  const geo = mesh.geometry
  const pos = geo.attributes.position as THREE.BufferAttribute
  const idx = geo.attributes.skinIndex as THREE.BufferAttribute
  const wgt = geo.attributes.skinWeight as THREE.BufferAttribute
  const names = mesh.skeleton.bones.map((b) => b.name)
  const n = pos.count
  const col = new Float32Array(n * 3)
  const box = new THREE.Box3().setFromBufferAttribute(pos)
  const h = box.max.y - box.min.y
  const c = new THREE.Color()
  const team = new THREE.Color(teamTint)
  for (let i = 0; i < n; i++) {
    // Dominant joint.
    let best = 0
    let bw = -1
    for (let k = 0; k < 4; k++) {
      const w = wgt.getComponent(i, k)
      if (w > bw) {
        bw = w
        best = idx.getComponent(i, k)
      }
    }
    const bone = names[best] ?? ''
    const yn = (pos.getY(i) - box.min.y) / h
    let hex = o.top
    if (HAND.test(bone)) hex = o.skin
    else if (ARM.test(bone)) hex = /lowerarm/.test(bone) ? o.cuffs : o.sleeves
    else if (HEAD.test(bone)) hex = yn > 0.86 ? o.skin : o.top
    else if (LEG.test(bone)) hex = o.bottom
    else if (SHIN.test(bone)) hex = o.shins
    else if (FOOT.test(bone)) hex = o.shoes
    else if (/pelvis/.test(bone)) hex = yn < 0.5 ? o.bottom : o.top
    else if (/spine_03|clavicle/.test(bone)) hex = o.top
    c.set(hex)
    // Collar / hem stripe in the team colour so sides read at a glance.
    if (/spine_03|neck/.test(bone) && yn > 0.8 && yn < 0.83) c.copy(team)
    if (/pelvis|spine_01/.test(bone) && yn > 0.5 && yn < 0.525) c.copy(team)
    col[i * 3] = c.r
    col[i * 3 + 1] = c.g
    col[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3))
}

/** Keep only the arm triangles of a skinned body (first-person view). */
function armGeometry(mesh: THREE.SkinnedMesh) {
  const geo = mesh.geometry
  const idx = geo.attributes.skinIndex as THREE.BufferAttribute
  const wgt = geo.attributes.skinWeight as THREE.BufferAttribute
  const names = mesh.skeleton.bones.map((b) => b.name)
  const isArm = (v: number) => {
    let best = 0
    let bw = -1
    for (let k = 0; k < 4; k++) {
      const w = wgt.getComponent(v, k)
      if (w > bw) {
        bw = w
        best = idx.getComponent(v, k)
      }
    }
    return /lowerarm|hand|index|middle|pinky|ring|thumb/.test(names[best] ?? '')
  }
  const index = geo.index!
  const keep: number[] = []
  for (let t = 0; t < index.count; t += 3) {
    const a = index.getX(t)
    const b = index.getX(t + 1)
    const c = index.getX(t + 2)
    if (isArm(a) && isArm(b) && isArm(c)) keep.push(a, b, c)
  }
  const out = geo.clone()
  out.setIndex(keep)
  return out
}

function heroHair(assets: LawnAssets, name: string, colour: string) {
  const pack = assets.models.get('hair')
  if (!pack || !name) return null
  let found: THREE.Mesh | null = null
  pack.traverse((o) => {
    if (!found && o.name === name && (o as THREE.Mesh).isMesh) found = o as THREE.Mesh
  })
  if (!found) return null
  const m = (found as THREE.Mesh).clone()
  m.material = new THREE.MeshStandardMaterial({ color: colour, roughness: 0.75, metalness: 0 })
  m.castShadow = true
  return m
}

/** The held weapon / tool model for a hero (with per-weapon offsets on the right hand). */
function weaponFor(assets: LawnAssets, hero: Hero, tool: ToolKind | null): THREE.Object3D {
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

function accessories(o: Outfit, head: THREE.Object3D, teamTint: string) {
  if (o.cap) {
    const cap = new THREE.Group()
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.115, 18, 12, 0, Math.PI * 2, 0, Math.PI / 2), new THREE.MeshStandardMaterial({ color: teamTint, roughness: 0.8 }))
    dome.scale.set(1.05, 0.85, 1.05)
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.014, 0.13), new THREE.MeshStandardMaterial({ color: teamTint, roughness: 0.8 }))
    brim.position.set(0, 0.005, 0.15)
    cap.add(dome, brim)
    cap.position.set(0, 0.2, 0.01)
    cap.scale.setScalar(1.15)
    head.add(cap)
  }
  if (o.glasses) {
    const mat = new THREE.MeshStandardMaterial({ color: '#2a1f3d', roughness: 0.4 })
    const l = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 6, 16), mat)
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.028, 0.005, 6, 16), mat)
    const gy = o.female ? 0.13 : 0.06
    l.position.set(-0.035, gy, 0.1)
    r.position.set(0.035, gy, 0.1)
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.005, 0.005), mat)
    bridge.position.set(0, gy, 0.1)
    head.add(l, r, bridge)
  }
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
  private tool: ToolKind | null = null
  private tag: THREE.Sprite
  private tagCanvas: HTMLCanvasElement
  private tagTex: THREE.CanvasTexture
  private tagHp = -1
  private ring: THREE.Mesh
  private outfit: Outfit
  private quad: boolean
  private lastAnim = -1
  private hitTimer = 0
  private deadTimer = 0
  private bodyMesh: THREE.SkinnedMesh | null = null
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
    this.outfit = OUTFITS[meta.hero]
    this.quad = meta.hero === 'dog' || meta.robot
    const team = teamColour(meta.team)
    const modelName = meta.robot ? 'robot' : meta.hero === 'dog' ? 'dog' : this.outfit.female ? 'char-f' : 'char-m'
    let model = instance(assets, modelName)
    if (!model) model = standInBody(this.hero, meta.robot)
    this.model = model
    this.group.add(model)
    const clips = meta.robot ? assets.clips.get('robot') : meta.hero === 'dog' ? assets.clips.get('dog') : assets.charClips
    if (clips?.length) {
      this.mixer = new THREE.AnimationMixer(model)
      for (const c of clips) this.actions.set(c.name, this.mixer.clipAction(c))
    }
    model.traverse((o) => {
      if (o.name === 'hand_r') this.hand = o
      if (o.name === 'Head') this.head = o
      if (o.name === 'spine_02') this.spine = o
      // The body is the biggest skinned mesh (the eyes are a separate, tiny one).
      const m = o as THREE.SkinnedMesh
      if (m.isSkinnedMesh && (!this.bodyMesh || m.geometry.attributes.position.count > this.bodyMesh.geometry.attributes.position.count)) this.bodyMesh = m
    })
    if (!this.quad && this.bodyMesh) this.dress(team)
    if (!this.quad) this.setTool(null)
    // Cartoon proportions: a bigger head, the kid shrunk.
    if (!this.quad) {
      if (this.head) this.head.scale.setScalar(this.outfit.head)
      model.scale.multiplyScalar(this.outfit.scale)
    }
    if (meta.hero === 'dog' && !meta.robot) {
      const coat = new THREE.MeshStandardMaterial({ color: meta.colour === this.hero.colors[0] ? '#c98a4b' : meta.colour, roughness: 0.9, metalness: 0 })
      model.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh) m.material = coat
      })
    }
    if (meta.robot) {
      model.traverse((o) => {
        const m = o as THREE.Mesh
        if (m.isMesh && (m.material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
          m.material = (m.material as THREE.MeshStandardMaterial).clone()
          ;(m.material as THREE.MeshStandardMaterial).emissive = new THREE.Color('#ff3b3b')
          ;(m.material as THREE.MeshStandardMaterial).emissiveIntensity = 0.25
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

  private dress(team: string) {
    const mesh = this.bodyMesh!
    mesh.geometry = mesh.geometry.clone()
    paintOutfit(mesh, this.outfit, this.meta.colour === this.hero.colors[0] ? team : this.meta.colour)
    const mat = (mesh.material as THREE.MeshStandardMaterial).clone()
    mat.vertexColors = true
    mat.map = null
    mat.color.set('#ffffff')
    mat.roughness = 0.85
    mat.metalness = 0
    mesh.material = mat
    // Eyes keep their texture.
    if (this.head) {
      const hair = heroHair(this.assets, this.outfit.hairStyle, this.outfit.hair)
      if (hair) {
        if (this.outfit.female && !/Female/.test(this.outfit.hairStyle)) hair.position.y += 0.06
        this.head.add(hair)
      }
      if (this.outfit.beard) {
        const beard = heroHair(this.assets, 'Hair_Beard', this.outfit.hair)
        if (beard) this.head.add(beard)
      }
      const brows = heroHair(this.assets, this.outfit.female ? 'Eyebrows_Female' : 'Eyebrows_Regular', this.outfit.hair)
      if (brows) this.head.add(brows)
      accessories(this.outfit, this.head, team)
    }
    if (this.outfit.suspenders && this.spine) {
      const mat2 = new THREE.MeshStandardMaterial({ color: '#7a1f1f', roughness: 0.8 })
      for (const s of [-1, 1]) {
        const strap = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.42, 0.012), mat2)
        strap.position.set(0.07 * s, 0.1, 0.13)
        this.spine.add(strap)
      }
    }
  }

  setTool(tool: ToolKind | null) {
    if (this.quad) return
    if (this.weapon && this.tool === tool && this.weapon.parent) return
    if (this.weapon) this.weapon.parent?.remove(this.weapon)
    this.tool = tool
    this.weapon = weaponFor(this.assets, this.hero, tool)
    const parent = this.hand ?? this.model
    parent.add(this.weapon)
    counterScale(this.weapon, parent)
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

  /** Per-frame update from the snapshot row. */
  update(dt: number, row: { x: number; y: number; z: number; yaw: number; pitch: number; hp: number; maxHp: number; anim: number; moving: boolean; alive: boolean; blocking: boolean; stunned: boolean; onLadder: boolean; riding: boolean; tool: ToolKind | null }, meId: boolean, hideTags = false) {
    this.x = row.x
    this.y = row.y
    this.z = row.z
    this.yaw = row.yaw
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
    if (this.spine && this.outfit.hunch) this.spine.rotation.x = this.outfit.hunch
    this.mixer?.update(dt)
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

export class FirstPerson {
  readonly group = new THREE.Group()
  private inner = new THREE.Group()
  private rig: THREE.Object3D | null = null
  private mixer: THREE.AnimationMixer | null = null
  private upperR: THREE.Object3D | null = null
  private lowerR: THREE.Object3D | null = null
  private upperL: THREE.Object3D | null = null
  private lowerL: THREE.Object3D | null = null
  private hand: THREE.Object3D | null = null
  private head: THREE.Object3D | null = null
  private weapon: THREE.Object3D | null = null
  private tool: ToolKind | null = null
  private assets: LawnAssets
  private hero: Hero
  private swing = { t: -1, heavy: false, up: 0.14, down: 0.3 }
  private bob = 0
  private block = 0
  private throwT = -1
  private hitStop = 0
  private draw = 0
  private tmpV = new THREE.Vector3()
  private tmpQ = new THREE.Quaternion()
  private axisY = new THREE.Vector3(0, 1, 0)
  private axisZ = new THREE.Vector3(0, 0, 1)

  constructor(assets: LawnAssets, heroId: HeroId, colour: string, team: number) {
    this.assets = assets
    this.hero = HEROES[heroId]
    const o = OUTFITS[heroId]
    const modelName = o.female ? 'char-f' : 'char-m'
    const model = heroId === 'dog' ? null : instance(assets, modelName)
    if (model) {
      let body: THREE.SkinnedMesh | null = null
      model.traverse((m) => {
        const s = m as THREE.SkinnedMesh
        if (s.isSkinnedMesh && (!body || s.geometry.attributes.position.count > body.geometry.attributes.position.count)) body = s
      })
      if (body) {
        const b = body as THREE.SkinnedMesh
        b.geometry = b.geometry.clone()
        paintOutfit(b, o, colour === this.hero.colors[0] ? teamColour(team) : colour)
        b.geometry = armGeometry(b)
        const mat = (b.material as THREE.MeshStandardMaterial).clone()
        mat.vertexColors = true
        mat.map = null
        mat.color.set('#ffffff')
        b.material = mat
        b.frustumCulled = false
        b.castShadow = false
        model.traverse((m) => {
          const s = m as THREE.Mesh
          if (s.isMesh && s !== b) s.visible = false
        })
      }
      model.traverse((m) => {
        if (m.name === 'upperarm_r') this.upperR = m
        if (m.name === 'lowerarm_r') this.lowerR = m
        if (m.name === 'upperarm_l') this.upperL = m
        if (m.name === 'lowerarm_l') this.lowerL = m
        if (m.name === 'hand_r') this.hand = m
        if (m.name === 'Head') this.head = m
      })
      this.rig = model
      const clips = assets.charClips
      if (clips.length) {
        this.mixer = new THREE.AnimationMixer(model)
        // Both arms forward (the push loop) is the base: the weapon sits in view, the swing is layered on top.
        const base = findClip(clips, 'Push_Loop') ?? findClip(clips, 'Idle_Loop')
        if (base) {
          const a = this.mixer.clipAction(base)
          a.play()
          a.timeScale = 0.35
        }
      }
      // The camera looks down -Z; the model faces +Z, so turn it round and hang it under the camera.
      this.inner.add(model)
      this.inner.rotation.y = Math.PI
      this.inner.position.set(0, -1.6, 0.1)
      this.inner.scale.setScalar(0.8)
      this.group.add(this.inner)
      this.setTool(null)
    }
  }

  setTool(tool: ToolKind | null) {
    if (!this.rig) return
    if (this.weapon && this.tool === tool && this.weapon.parent) return
    if (this.weapon) this.weapon.parent?.remove(this.weapon)
    this.tool = tool
    this.weapon = weaponFor(this.assets, this.hero, tool)
    const parent = this.hand ?? this.rig
    parent.add(this.weapon)
    counterScale(this.weapon, parent)
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

  private rotate(bone: THREE.Object3D | null, axis: THREE.Vector3, angle: number) {
    if (!bone || !angle) return
    bone.quaternion.multiply(this.tmpQ.setFromAxisAngle(axis, angle))
  }

  update(dt: number, moving: boolean, sprinting: boolean, blocking: boolean, drawing: number) {
    if (!this.rig) return
    this.hitStop = Math.max(0, this.hitStop - dt)
    const live = this.hitStop > 0 ? dt * 0.15 : dt
    this.mixer?.update(live)
    this.bob += live * (sprinting ? 11 : 7) * (moving ? 1 : 0.3)
    this.block += ((blocking ? 1 : 0) - this.block) * Math.min(1, 12 * live)
    this.draw += (drawing - this.draw) * Math.min(1, 10 * live)
    // Swing curve: wind-up back and up, a fast strike down and across, then recovery.
    let swingA = 0
    let swingB = 0
    if (this.swing.t >= 0) {
      this.swing.t += live
      const s = this.swing
      const k = s.heavy ? 1.4 : 1
      if (s.t < s.up) {
        const u = s.t / s.up
        swingA = -0.9 * u * k
        swingB = 0.5 * u * k
      } else if (s.t < s.up + 0.12) {
        const u = (s.t - s.up) / 0.12
        swingA = (-0.9 + 2.0 * u) * k
        swingB = (0.5 - 1.1 * u) * k
      } else if (s.t < s.up + s.down) {
        const u = (s.t - s.up - 0.12) / Math.max(0.05, s.down - 0.12)
        swingA = 1.1 * (1 - u) * k
        swingB = -0.6 * (1 - u) * k
      } else this.swing.t = -1
    }
    let throwA = 0
    if (this.throwT >= 0) {
      this.throwT += live
      const t = this.throwT
      throwA = t < 0.12 ? -t / 0.12 : t < 0.3 ? -1 + ((t - 0.12) / 0.18) * 1.8 : t < 0.6 ? 0.8 * (1 - (t - 0.3) / 0.3) : 0
      if (t > 0.6) this.throwT = -1
    }
    // Layer the gestures on the animated pose (the mixer already set this frame's rotations).
    this.rotate(this.upperR, this.axisZ, swingA * 0.8 + throwA * -0.9 - this.draw * 0.5)
    this.rotate(this.upperR, this.axisY, swingB * 0.9)
    this.rotate(this.lowerR, this.axisZ, swingA * 0.5 + throwA * -0.5 + this.block * -0.6)
    this.rotate(this.upperL, this.axisZ, this.block * 0.7 + this.draw * 0.3)
    this.rotate(this.lowerL, this.axisZ, this.block * 0.5)
    // Pin the right hand into view (the pose moves it a little; the rest of the body follows).
    if (this.hand) {
      this.inner.updateMatrixWorld(true)
      this.hand.getWorldPosition(this.tmpV)
      this.group.worldToLocal(this.tmpV)
      this.inner.position.x += 0.24 - this.tmpV.x
      this.inner.position.y += -0.26 - this.tmpV.y
      this.inner.position.z += -0.5 - this.tmpV.z
    }
    void this.head
    const bobY = Math.sin(this.bob) * (moving ? 0.02 : 0.006)
    const bobX = Math.cos(this.bob * 0.5) * (moving ? 0.012 : 0.003)
    this.group.position.set(bobX, bobY - this.block * 0.05, this.hitStop > 0 ? 0.03 : 0)
    this.group.rotation.z = Math.sin(this.bob * 0.5) * 0.01 * (moving ? 1 : 0)
  }

  dispose() {
    this.mixer?.stopAllAction()
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
