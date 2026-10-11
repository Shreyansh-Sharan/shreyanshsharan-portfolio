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
    const peer = new Peer(PREFIX + code, { debug: 0 })
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
  const peer = new Peer({ debug: 0 })
  const selfId = await waitOpen(peer)
  const em = new Emitter()
  const conn = peer.connect(PREFIX + code, { reliable: true, serialization: 'json' })
  await new Promise<void>((resolve, reject) => {
    const t = window.setTimeout(() => reject(new Error('No room with that code answered.')), 15000)
    conn.on('open', () => {
      window.clearTimeout(t)
      resolve()
    })
    peer.on('error', (e) => {
      window.clearTimeout(t)
      reject((e as { type?: string }).type === 'peer-unavailable' ? new Error('No room with that code.') : e)
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
/** Deathmatch map: the city circuit, or the Dust Bowl arena. Races always use the circuit. */
export type MapId = 'harbor' | 'bowl'

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
