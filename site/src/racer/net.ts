// Multiplayer transport. The host's browser is the server: it runs the simulation and streams snapshots;
// clients send inputs. Online play uses WebRTC data channels via PeerJS (its free cloud server only brokers the
// connection). `?net=local` swaps in a BroadcastChannel so several tabs of one browser can play (and tests can run).
import type { DataConnection, Peer as PeerType } from 'peerjs'

export interface Link {
  readonly selfId: string
  readonly code: string
  readonly isHost: boolean
  /** Host: send to one peer (`to`) or everyone. Client: send to the host. */
  send(msg: unknown, to?: string): void
  onMessage(cb: (msg: unknown, from: string) => void): () => void
  onPeer(cb: (event: 'join' | 'leave', id: string) => void): () => void
  close(): void
}

const PREFIX = 'voltriot-'
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'

const STUN: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]

/** Metered's global relay endpoints (ports 80/443, UDP+TCP+TLS) for static username/password creds. */
const METERED_TURN_URLS = [
  'turn:global.relay.metered.ca:80',
  'turn:global.relay.metered.ca:80?transport=tcp',
  'turn:global.relay.metered.ca:443',
  'turns:global.relay.metered.ca:443?transport=tcp',
]

/**
 * ICE servers for WebRTC. Players on different networks need a TURN relay to connect. Configure one of:
 *  - VITE_TURN_USERNAME + VITE_TURN_CREDENTIAL — Metered static credentials (free account at
 *    metered.ca). Simplest: the relay URLs default to Metered's global endpoints.
 *  - VITE_TURN_URL as well — point the same username/credential at a different/self-hosted TURN.
 *  - VITE_METERED_SUBDOMAIN + VITE_METERED_API_KEY — fetch fresh creds from Metered's API instead.
 * Set these in Vercel's env settings. With none set, play works only on friendly/same networks.
 */
async function iceServers(): Promise<RTCIceServer[]> {
  // 1) Static TURN via env: username + credential, with URLs defaulting to Metered's global relay.
  const username = import.meta.env.VITE_TURN_USERNAME as string | undefined
  const credential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined
  if (username && credential) {
    const url = import.meta.env.VITE_TURN_URL as string | undefined
    const urls = url ? url.split(',').map((u) => u.trim()) : METERED_TURN_URLS
    return [...STUN, { urls, username, credential }]
  }

  // 2) Metered dynamic credentials (fetched per user).
  const sub = import.meta.env.VITE_METERED_SUBDOMAIN as string | undefined
  const key = import.meta.env.VITE_METERED_API_KEY as string | undefined
  if (sub && key) {
    try {
      const res = await fetch(`https://${sub}.metered.live/api/v1/turn/credentials?apiKey=${key}`)
      if (res.ok) {
        const list = (await res.json()) as RTCIceServer[]
        if (Array.isArray(list) && list.length) return list
      }
    } catch {
      // Fall through to STUN-only if the credentials service is unreachable.
    }
  }

  // 3) No TURN configured: STUN only (works on friendly/same networks, may fail across strict NATs).
  return STUN
}

/** Options passed to every PeerJS peer so the TURN config is applied consistently. */
async function peerOptions() {
  return { debug: 0, config: { iceServers: await iceServers() } }
}

export function newCode() {
  let s = ''
  for (let i = 0; i < 6; i++) s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)]
  return s
}

function localTransport() {
  return new URLSearchParams(window.location.search).get('net') === 'local'
}

class Emitter {
  msg = new Set<(msg: unknown, from: string) => void>()
  peer = new Set<(event: 'join' | 'leave', id: string) => void>()
  onMessage(cb: (msg: unknown, from: string) => void) {
    this.msg.add(cb)
    return () => void this.msg.delete(cb)
  }
  onPeer(cb: (event: 'join' | 'leave', id: string) => void) {
    this.peer.add(cb)
    return () => void this.peer.delete(cb)
  }
  emitMsg(m: unknown, from: string) {
    for (const cb of this.msg) cb(m, from)
  }
  emitPeer(e: 'join' | 'leave', id: string) {
    for (const cb of this.peer) cb(e, id)
  }
}

/* ---------- PeerJS (online) ---------- */

async function loadPeer() {
  const mod = await import('peerjs')
  return mod.Peer
}

function waitOpen(peer: PeerType) {
  return new Promise<string>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('Could not reach the matchmaking server.')), 15000)
    peer.once('open', (id) => {
      window.clearTimeout(t)
      resolve(id)
    })
    peer.once('error', (e) => {
      window.clearTimeout(t)
      reject(e)
    })
  })
}

export async function hostRoom(): Promise<Link> {
  if (localTransport()) return localHost()
  const Peer = await loadPeer()
  for (let attempt = 0; attempt < 4; attempt++) {
    const code = newCode()
    const peer = new Peer(PREFIX + code, await peerOptions())
    try {
      await waitOpen(peer)
    } catch (e) {
      peer.destroy()
      if ((e as { type?: string }).type === 'unavailable-id') continue
      throw e
    }
    const em = new Emitter()
    const conns = new Map<string, DataConnection>()
    peer.on('connection', (conn) => {
      conn.on('open', () => {
        conns.set(conn.peer, conn)
        em.emitPeer('join', conn.peer)
      })
      conn.on('data', (d) => em.emitMsg(d, conn.peer))
      const gone = () => {
        if (conns.delete(conn.peer)) em.emitPeer('leave', conn.peer)
      }
      conn.on('close', gone)
      conn.on('error', gone)
    })
    // Keep the room reachable if the signalling socket drops (existing peers stay connected regardless).
    peer.on('disconnected', () => !peer.destroyed && peer.reconnect())
    return {
      selfId: 'host',
      code,
      isHost: true,
      send(msg, to) {
        if (to) conns.get(to)?.send(msg)
        else for (const c of conns.values()) c.send(msg)
      },
      onMessage: (cb) => em.onMessage(cb),
      onPeer: (cb) => em.onPeer(cb),
      close() {
        for (const c of conns.values()) c.close()
        peer.destroy()
      },
    }
  }
  throw new Error('Could not create a room. Try again.')
}

export async function joinRoom(code: string): Promise<Link> {
  code = code.trim().toUpperCase()
  if (localTransport()) return localJoin(code)
  const Peer = await loadPeer()
  const peer = new Peer(await peerOptions())
  const selfId = await waitOpen(peer)
  const em = new Emitter()
  const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })
  await new Promise<void>((resolve, reject) => {
    // Slow timeout: the room exists but the peer-to-peer link never opened — usually a strict
    // network with no TURN relay configured.
    const t = window.setTimeout(
      () => reject(new Error('Found the room but couldn’t connect — your network may be blocking peer-to-peer play.')),
      15000,
    )
    conn.on('open', () => {
      window.clearTimeout(t)
      resolve()
    })
    peer.on('error', (e) => {
      window.clearTimeout(t)
      // Instant "unavailable": no host registered that code (wrong code, or the host left / hasn’t created it yet).
      reject(
        (e as { type?: string }).type === 'peer-unavailable'
          ? new Error('No open room with that code — double-check it, and make sure the host’s tab is still open.')
          : e,
      )
    })
  })
  conn.on('data', (d) => em.emitMsg(d, 'host'))
  conn.on('close', () => em.emitPeer('leave', 'host'))
  conn.on('error', () => em.emitPeer('leave', 'host'))
  return {
    selfId,
    code,
    isHost: false,
    send(msg) {
      if (conn.open) conn.send(msg)
    },
    onMessage: (cb) => em.onMessage(cb),
    onPeer: (cb) => em.onPeer(cb),
    close() {
      conn.close()
      peer.destroy()
    },
  }
}

/* ---------- BroadcastChannel (same browser, for tabs and tests) ---------- */

interface Envelope {
  from: string
  to: string | null // null = broadcast
  kind: 'hello' | 'welcome' | 'bye' | 'msg'
  msg?: unknown
}

function localHost(): Link {
  const code = newCode()
  const ch = new BroadcastChannel(PREFIX + code)
  const em = new Emitter()
  const peers = new Set<string>()
  ch.onmessage = (ev: MessageEvent<Envelope>) => {
    const e = ev.data
    if (e.to && e.to !== 'host') return
    if (e.kind === 'hello') {
      peers.add(e.from)
      ch.postMessage({ from: 'host', to: e.from, kind: 'welcome' } satisfies Envelope)
      em.emitPeer('join', e.from)
    } else if (e.kind === 'bye') {
      if (peers.delete(e.from)) em.emitPeer('leave', e.from)
    } else if (e.kind === 'msg' && peers.has(e.from)) em.emitMsg(structuredClone(e.msg), e.from)
  }
  return {
    selfId: 'host',
    code,
    isHost: true,
    send(msg, to) {
      ch.postMessage({ from: 'host', to: to ?? null, kind: 'msg', msg } satisfies Envelope)
    },
    onMessage: (cb) => em.onMessage(cb),
    onPeer: (cb) => em.onPeer(cb),
    close() {
      ch.postMessage({ from: 'host', to: null, kind: 'bye' } satisfies Envelope)
      ch.close()
    },
  }
}

function localJoin(code: string): Promise<Link> {
  const selfId = 'tab-' + Math.random().toString(36).slice(2, 8)
  const ch = new BroadcastChannel(PREFIX + code)
  const em = new Emitter()
  return new Promise((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('No room with that code.')), 4000)
    ch.onmessage = (ev: MessageEvent<Envelope>) => {
      const e = ev.data
      if (e.from !== 'host' || (e.to && e.to !== selfId)) return
      if (e.kind === 'welcome') {
        window.clearTimeout(t)
        resolve({
          selfId,
          code,
          isHost: false,
          send(msg) {
            ch.postMessage({ from: selfId, to: 'host', kind: 'msg', msg } satisfies Envelope)
          },
          onMessage: (cb) => em.onMessage(cb),
          onPeer: (cb) => em.onPeer(cb),
          close() {
            ch.postMessage({ from: selfId, to: 'host', kind: 'bye' } satisfies Envelope)
            ch.close()
          },
        })
      } else if (e.kind === 'bye') em.emitPeer('leave', 'host')
      else if (e.kind === 'msg') em.emitMsg(structuredClone(e.msg), 'host')
    }
    ch.postMessage({ from: selfId, to: 'host', kind: 'hello' } satisfies Envelope)
  })
}

/* ---------- Protocol ---------- */

export type NetMode = 'race' | 'deathmatch'
/** The circuit (Race and Deathmatch), or the Dust Bowl arena (Deathmatch only). Clients build the same one. */
export type MapId = 'harbor' | 'river' | 'gothic' | 'pier' | 'bowl'

/** Menu copy and accent colour per map. */
export const MAP_INFO: Record<MapId, { name: string; blurb: string; color: string }> = {
  harbor: { name: 'Harbor Loop', blurb: 'Neon docks at night', color: '#22d3ee' },
  river: { name: 'Concrete River', blurb: 'Storm channel, downtown, sunset', color: '#fb923c' },
  gothic: { name: 'Gothic Quarter', blurb: 'Cobbled old town, seafront', color: '#facc15' },
  pier: { name: 'Pier & Promenade', blurb: 'Seafront, pier, terraces', color: '#5eead4' },
  bowl: { name: 'Dust Bowl', blurb: 'Open desert arena', color: '#f97316' },
}
export const CIRCUIT_MAPS: MapId[] = ['harbor', 'river', 'gothic', 'pier']

export interface MatchSettings {
  mode: NetMode
  laps: number
  minutes: number
  bots: number
  difficulty: number
  map: MapId
}

export interface LobbyPlayer {
  id: string
  name: string
  carId: string
}

export interface Slot {
  kind: 'human' | 'ai'
  id: string // peer id for humans ('host' for the host), 'ai-N' for bots
  name: string
  carId: string
  driver?: number
}

export interface MatchSetup {
  settings: MatchSettings
  slots: Slot[]
  seed: number
}

/** Messages. Inputs: [throttle, brake, steer, handbrake, look, fireHeld, fireBackHeld] plus one-shot actions. */
export type Msg =
  | { t: 'hello'; name: string; carId: string }
  | { t: 'lobby'; players: LobbyPlayer[]; settings: MatchSettings }
  | { t: 'start'; setup: MatchSetup }
  | { t: 'input'; i: [number, number, number, number, number, number, number]; a: string[] }
  | { t: 'snap'; s: unknown }
  | { t: 'ev'; e: unknown[] }
  | { t: 'result'; r: unknown }
  | { t: 'lobbyback' }
  | { t: 'full' }
