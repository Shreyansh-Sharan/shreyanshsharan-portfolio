// The career told in the world: plaques and exhibit boards with text rendered to canvas textures (bloom-lit
// at night), the trophy hall's pedestals, the skills signpost, the arcade cabinets and the fortress diorama.
import { Suspense, useEffect, useMemo } from 'react'
import * as THREE from 'three'
import { exhibits, type Exhibit } from './exhibits'
import { useModel } from './Models'
import { circleCollider, setExtraColliders } from './colliders'
import { tiles } from '../data/content'

/* ---------- Canvas text ---------- */

function wrap(g: CanvasRenderingContext2D, text: string, maxWidth: number) {
  const lines: string[] = []
  for (const para of text.split('\n')) {
    let line = ''
    for (const word of para.split(' ')) {
      const test = line ? `${line} ${word}` : word
      if (g.measureText(test).width > maxWidth && line) {
        lines.push(line)
        line = word
      } else line = test
    }
    lines.push(line)
  }
  return lines
}

const FONT = "'Segoe UI', Roboto, Helvetica, Arial, sans-serif"

interface Panel {
  w: number
  h: number
  title: string
  subtitle?: string
  body: string
  accent: string
  footer?: string
  /** Title size relative to the panel height. */
  big?: boolean
  dark?: boolean
}

/** A readable panel: dark glass, an accent rule, bold title, muted subtitle and wrapped body text. */
function panelTexture(p: Panel) {
  const W = p.w, H = p.h
  const c = document.createElement('canvas')
  c.width = W
  c.height = H
  const g = c.getContext('2d')!
  const grd = g.createLinearGradient(0, 0, 0, H)
  grd.addColorStop(0, p.dark ? '#0d1220' : '#121a2c')
  grd.addColorStop(1, p.dark ? '#070a12' : '#0a0f1c')
  g.fillStyle = grd
  g.fillRect(0, 0, W, H)
  // Accent frame and rule.
  g.strokeStyle = p.accent
  g.lineWidth = Math.max(4, W * 0.008)
  g.strokeRect(g.lineWidth / 2, g.lineWidth / 2, W - g.lineWidth, H - g.lineWidth)
  const pad = W * 0.06
  const titleSize = Math.round(H * (p.big ? 0.14 : 0.11))
  g.fillStyle = '#f6f8fc'
  g.font = `700 ${titleSize}px ${FONT}`
  g.textBaseline = 'top'
  let y = pad * 0.8
  for (const line of wrap(g, p.title, W - pad * 2).slice(0, 2)) {
    g.fillText(line, pad, y)
    y += titleSize * 1.15
  }
  if (p.subtitle) {
    const sub = Math.round(H * 0.058)
    g.font = `500 ${sub}px ${FONT}`
    g.fillStyle = p.accent
    for (const line of wrap(g, p.subtitle, W - pad * 2).slice(0, 2)) {
      g.fillText(line, pad, y + 4)
      y += sub * 1.3
    }
  }
  y += H * 0.03
  g.fillStyle = p.accent
  g.fillRect(pad, y, W * 0.12, Math.max(3, H * 0.008))
  y += H * 0.045
  const bodySize = Math.round(H * 0.062)
  g.font = `400 ${bodySize}px ${FONT}`
  g.fillStyle = '#d7dde8'
  const footerH = p.footer ? bodySize * 1.6 : 0
  const lines = wrap(g, p.body, W - pad * 2)
  const maxLines = Math.floor((H - y - pad - footerH) / (bodySize * 1.32))
  lines.slice(0, Math.max(1, maxLines)).forEach((line, i, arr) => {
    const last = i === arr.length - 1 && lines.length > arr.length
    g.fillText(last ? `${line.replace(/[.,;:]$/, '')}…` : line, pad, y)
    y += bodySize * 1.32
  })
  if (p.footer) {
    g.font = `500 ${Math.round(bodySize * 0.85)}px ${FONT}`
    g.fillStyle = 'rgba(214, 221, 232, 0.6)'
    g.fillText(p.footer, pad, H - pad * 0.7 - bodySize * 0.85)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  t.anisotropy = 8
  t.generateMipmaps = true
  t.minFilter = THREE.LinearMipmapLinearFilter
  return t
}

function panelMaterial(p: Panel) {
  const tex = panelTexture(p)
  return new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.1 })
}

const POST = new THREE.MeshStandardMaterial({ color: '#2a2f3a', roughness: 0.6, metalness: 0.5 })
const STONE = new THREE.MeshStandardMaterial({ color: '#8d8a84', roughness: 0.9 })
const BACK = new THREE.MeshStandardMaterial({ color: '#141a28', roughness: 0.5, metalness: 0.3 })
const SIDE = new THREE.MeshStandardMaterial({ color: '#1b2233', roughness: 0.5, metalness: 0.2 })

/** A board of w x h metres whose front face shows the panel, with a dark back and edges. */
function Board({ w, h, mat, thickness = 0.12 }: { w: number; h: number; mat: THREE.Material; thickness?: number }) {
  const mats = useMemo(() => [SIDE, SIDE, SIDE, SIDE, mat, BACK], [mat])
  return (
    <mesh material={mats} castShadow>
      <boxGeometry args={[w, h, thickness]} />
    </mesh>
  )
}

/* ---------- Exhibit types ---------- */

function Plaque({ e }: { e: Exhibit }) {
  const mat = useMemo(() => panelMaterial({ w: 1024, h: 640, title: e.title, subtitle: e.subtitle, body: e.body, accent: e.accent, footer: 'E · read more', big: true }), [e])
  return (
    <group position={[e.x, e.y, e.z]} rotation={[0, e.yaw, 0]}>
      {[-2.1, 2.1].map((x) => (
        <mesh key={x} position={[x, 1.3, -0.1]} material={POST} castShadow>
          <cylinderGeometry args={[0.08, 0.1, 2.6, 10]} />
        </mesh>
      ))}
      <group position={[0, 3.2, 0]}>
        <Board w={5} h={3.1} mat={mat} />
      </group>
      <mesh position={[0, 0.06, 0.2]} material={STONE} receiveShadow>
        <boxGeometry args={[5.6, 0.12, 1.4]} />
      </mesh>
      <pointLight position={[0, 4.2, 1.6]} color={e.accent} intensity={14} distance={9} decay={2} />
    </group>
  )
}

function ExhibitBoard({ e }: { e: Exhibit }) {
  const mat = useMemo(() => panelMaterial({ w: 768, h: 512, title: e.title, subtitle: e.subtitle, body: e.body, accent: e.accent, footer: 'E · read' }), [e])
  return (
    <group position={[e.x, e.y, e.z]} rotation={[0, e.yaw, 0]}>
      <mesh position={[0, 0.9, -0.05]} material={POST} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 1.8, 8]} />
      </mesh>
      <group position={[0, 2.3, 0]} rotation={[-0.12, 0, 0]}>
        <Board w={2.7} h={1.8} mat={mat} thickness={0.08} />
      </group>
    </group>
  )
}

function Sign({ e }: { e: Exhibit }) {
  const mat = useMemo(() => panelMaterial({ w: 640, h: 160, title: e.title, body: e.body, accent: e.accent, dark: true }), [e])
  return (
    <group position={[e.x, e.y, e.z]} rotation={[0, e.yaw, 0]}>
      <group position={[1.1, 0, 0]}>
        <Board w={2.2} h={0.5} mat={mat} thickness={0.06} />
      </group>
    </group>
  )
}

function SignPost({ x, z, y, n }: { x: number; z: number; y: number; n: number }) {
  return (
    <mesh position={[x, y + (1.6 + n * 0.55) / 2 + 0.2, z]} material={POST} castShadow>
      <cylinderGeometry args={[0.1, 0.13, 1.6 + n * 0.55 + 0.6, 10]} />
    </mesh>
  )
}

function TrophyModel({ height }: { height: number }) {
  const obj = useModel('trophy', height)
  return <primitive object={obj} />
}

function Trophy({ e }: { e: Exhibit }) {
  const mat = useMemo(() => panelMaterial({ w: 512, h: 256, title: e.title, subtitle: e.subtitle, body: '', accent: e.accent, dark: true }), [e])
  const ring = useMemo(() => new THREE.MeshStandardMaterial({ color: e.accent, emissive: e.accent, emissiveIntensity: 0.35, metalness: 0.7, roughness: 0.3 }), [e.accent])
  const tall = e.tier === 'platinum' ? 1.1 : e.tier === 'gold' ? 0.95 : e.tier === 'silver' ? 0.85 : 0.75
  return (
    <group position={[e.x, e.y, e.z]} rotation={[0, e.yaw, 0]}>
      <mesh position={[0, 0.55, 0]} material={STONE} castShadow receiveShadow>
        <cylinderGeometry args={[0.5, 0.6, 1.1, 14]} />
      </mesh>
      <mesh position={[0, 1.12, 0]} material={ring}>
        <torusGeometry args={[0.5, 0.05, 8, 32]} />
      </mesh>
      <group position={[0, 1.12, 0]}>
        <Suspense fallback={null}>
          <TrophyModel height={tall} />
        </Suspense>
      </group>
      <group position={[0, 0.72, 0.62]} rotation={[-0.35, 0, 0]}>
        <Board w={1.1} h={0.55} mat={mat} thickness={0.05} />
      </group>
    </group>
  )
}

export function Cabinet({ e }: { e: Exhibit }) {
  const tile = useMemo(() => tiles.find((t) => t.id === e.tile), [e.tile])
  const screen = useMemo(() => {
    const c = document.createElement('canvas')
    c.width = 512
    c.height = 384
    const g = c.getContext('2d')!
    const [deep, bright] = tile?.accent ?? ['#1e293b', e.accent]
    const grd = g.createLinearGradient(0, 0, 512, 384)
    grd.addColorStop(0, deep)
    grd.addColorStop(1, bright)
    g.fillStyle = grd
    g.fillRect(0, 0, 512, 384)
    g.fillStyle = 'rgba(0,0,0,0.35)'
    g.fillRect(0, 250, 512, 134)
    g.fillStyle = '#ffffff'
    g.font = `800 44px ${FONT}`
    g.textBaseline = 'top'
    wrap(g, e.title.toUpperCase(), 470).slice(0, 2).forEach((l, i) => g.fillText(l, 22, 262 + i * 50))
    g.font = `500 22px ${FONT}`
    g.fillStyle = 'rgba(255,255,255,0.8)'
    g.fillText('INSERT COIN · E', 22, 348)
    const t = new THREE.CanvasTexture(c)
    t.colorSpace = THREE.SRGBColorSpace
    if (tile?.cover) {
      const img = new Image()
      img.onload = () => {
        g.drawImage(img, 0, 0, 512, 250)
        t.needsUpdate = true
      }
      img.src = tile.cover
    }
    return new THREE.MeshStandardMaterial({ map: t, emissive: '#ffffff', emissiveMap: t, emissiveIntensity: 1.1, roughness: 0.3 })
  }, [e, tile])
  const body = useMemo(() => new THREE.MeshStandardMaterial({ color: tile?.accent[0] ?? '#1e293b', roughness: 0.45, metalness: 0.3 }), [tile])
  const trim = useMemo(() => new THREE.MeshStandardMaterial({ color: e.accent, emissive: e.accent, emissiveIntensity: 0.8, roughness: 0.4 }), [e.accent])
  return (
    <group position={[e.x, e.y, e.z]} rotation={[0, e.yaw, 0]}>
      <mesh position={[0, 0.95, 0]} material={body} castShadow receiveShadow>
        <boxGeometry args={[0.95, 1.9, 0.8]} />
      </mesh>
      <mesh position={[0, 2.0, 0.1]} material={body} castShadow>
        <boxGeometry args={[0.95, 0.32, 0.6]} />
      </mesh>
      <mesh position={[0, 1.35, 0.41]} rotation={[-0.15, 0, 0]} material={screen}>
        <planeGeometry args={[0.78, 0.58]} />
      </mesh>
      <mesh position={[0, 0.82, 0.5]} rotation={[0.5, 0, 0]} material={trim}>
        <boxGeometry args={[0.8, 0.05, 0.3]} />
      </mesh>
      <mesh position={[0, 2.18, 0.28]} material={trim}>
        <boxGeometry args={[0.97, 0.04, 0.06]} />
      </mesh>
    </group>
  )
}

function Diorama({ e }: { e: Exhibit }) {
  const mat = useMemo(() => panelMaterial({ w: 768, h: 384, title: e.title, subtitle: e.subtitle, body: e.body, accent: e.accent, footer: 'E · read' }), [e])
  return (
    <group position={[e.x, e.y, e.z]} rotation={[0, e.yaw, 0]}>
      <group position={[0, 1.4, 0]} rotation={[-0.2, 0, 0]}>
        <Board w={2.6} h={1.3} mat={mat} thickness={0.08} />
      </group>
      <mesh position={[0, 0.5, -0.1]} material={POST} castShadow>
        <cylinderGeometry args={[0.06, 0.08, 1.0, 8]} />
      </mesh>
    </group>
  )
}

/* ---------- All of them ---------- */

export function Exhibits() {
  const list = useMemo(exhibits, [])
  const signs = list.filter((e) => e.kind === 'sign')
  // Solid pedestals, posts and cabinets.
  useEffect(() => {
    setExtraColliders(
      'exhibits',
      list.flatMap((e) =>
        e.kind === 'plaque' ? [circleCollider(e.x, e.z, 2.6, e.y + 4.8)] : e.kind === 'trophy' ? [circleCollider(e.x, e.z, 0.65, e.y + 2.2)] : e.kind === 'cabinet' ? [{ ...circleCollider(e.x, e.z, 0.6, e.y + 2.2), bottom: e.y - 0.5 }] : e.kind === 'board' ? [circleCollider(e.x, e.z, 0.25, e.y + 3.2)] : [],
      ),
    )
    return () => setExtraColliders('exhibits', [])
  }, [list])
  return (
    <group>
      {list.map((e) => {
        switch (e.kind) {
          case 'plaque':
            return <Plaque key={e.id} e={e} />
          case 'board':
            return <ExhibitBoard key={e.id} e={e} />
          case 'sign':
            return <Sign key={e.id} e={e} />
          case 'trophy':
            return <Trophy key={e.id} e={e} />
          case 'cabinet':
            // Drawn by the arcade hall itself, only while you are inside.
            return null
          case 'diorama':
            return <Diorama key={e.id} e={e} />
        }
      })}
      {signs.length > 0 && <SignPost x={signs[0].x} z={signs[0].z} y={signs[0].y - 1.6} n={signs.length} />}
    </group>
  )
}
