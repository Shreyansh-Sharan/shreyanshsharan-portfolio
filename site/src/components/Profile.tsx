import { Suspense, lazy, useEffect, useState } from 'react'
import { Box, Download, FileText, Gem, Link as LinkIcon, Mail, MapPin, Video } from 'lucide-react'
import { profile, tiles } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'

const accent = tiles.find((t) => t.id === 'profile')!.accent
const ProfileAvatar = lazy(() => import('./ProfileAvatar'))
const LowPolyAvatar = lazy(() => import('./LowPolyAvatar'))
const base = import.meta.env.BASE_URL

function canRender3D() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

type View = 'lowpoly' | '3d' | 'video'
type Move = import('./LowPolyAvatar').Move

const MOVES: { id: Move; label: string }[] = [
  { id: 'idle', label: 'Idle' },
  { id: 'walk', label: 'Walk' },
  { id: 'run', label: 'Run' },
  { id: 'jump', label: 'Jump' },
  { id: 'spell', label: 'Cast spell' },
  { id: 'wave', label: 'Wave' },
  { id: 'swing', label: 'Golf swing' },
  { id: 'dance', label: 'Dance' },
  { id: 'flip', label: 'Backflip' },
]

/** The Higgsfield-generated avatars (low-poly with a move set, and detailed 3D) and the intro clip. */
function ProfileMedia() {
  const [view, setView] = useState<View>(() => (canRender3D() ? 'lowpoly' : 'video'))
  const [move, setMove] = useState<Move>('idle')
  const [nonce, setNonce] = useState(0)
  const tabs: [View, string, typeof Box][] = [
    ['lowpoly', 'Low-poly avatar', Gem],
    ['3d', '3D avatar', Box],
    ['video', 'Intro video', Video],
  ]
  return (
    <section className="profile-media">
      <div className="seg seg-sm" role="tablist" aria-label="Avatar view">
        {tabs.map(([id, label, Icon]) => (
          <button key={id} role="tab" aria-selected={view === id} className={`seg-btn ${view === id ? 'is-active' : ''}`} onClick={() => setView(id)}>
            <Icon size={14} /> {label}
          </button>
        ))}
      </div>
      <div className="profile-stage">
        {view === 'video' ? (
          <video className="profile-video" src={`${base}profile/intro.mp4`} poster={`${base}profile/poster.jpg`} autoPlay muted loop playsInline />
        ) : (
          <Suspense fallback={<img className="profile-poster" src={`${base}profile/poster.jpg`} alt="" />}>
            {view === 'lowpoly' ? <LowPolyAvatar move={move} nonce={nonce} onDone={() => setMove('idle')} /> : <ProfileAvatar />}
          </Suspense>
        )}
      </div>
      {view === 'lowpoly' && (
        <div className="chip-row lp-moves" role="group" aria-label="Animations">
          {MOVES.map((m) => (
            <button
              key={m.id}
              className={`chip lp-move ${move === m.id ? 'is-active' : ''}`}
              aria-pressed={move === m.id}
              onClick={() => {
                setMove(m.id)
                setNonce((n) => n + 1)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
      )}
      <p className="muted small">
        {view === 'lowpoly'
          ? 'Low-poly image, mesh, rig and every animation generated with Higgsfield from a photo and a frame of the intro clip.'
          : '3D model, intro clip and textures generated with Higgsfield from a photo.'}
      </p>
    </section>
  )
}

export function Profile({ onAccent }: { onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'profile'), [onAccent])

  return (
    <Page onBack={() => navigate('#/home/profile')}>
      <header className="profile-head">
        <span className="profile-avatar" aria-hidden="true">
          {profile.initials}
        </span>
        <div>
          <p className="eyebrow">Player profile</p>
          <h1 className="page-title">{profile.name}</h1>
          <p className="page-lead">{profile.headline}</p>
          <p className="muted">
            <MapPin size={14} aria-hidden="true" /> {profile.location}
          </p>
        </div>
      </header>

      <ProfileMedia />

      <section className="section">
        <h2 className="section-title">About</h2>
        <p className="prose">{profile.summary}</p>
      </section>

      <section className="section">
        <h2 className="section-title">Off the clock</h2>
        <div className="chip-row">
          {profile.hobbies.map((h) => (
            <span className="chip" key={h}>
              {h}
            </span>
          ))}
        </div>
      </section>

      <section className="section">
        <h2 className="section-title">Education</h2>
        <p className="prose">B.Tech, Dr. B. R. Ambedkar National Institute of Technology (NIT) Jalandhar</p>
      </section>

      <section className="section">
        <h2 className="section-title">Contact</h2>
        <div className="chip-row">
          <a className="btn btn-secondary" href={`mailto:${profile.email}`}>
            <Mail size={16} /> Email
          </a>
          <a className="btn btn-secondary" href={profile.linkedin} target="_blank" rel="noreferrer">
            <LinkIcon size={16} /> LinkedIn
          </a>
          <a className="btn btn-secondary" href={profile.github} target="_blank" rel="noreferrer">
            <LinkIcon size={16} /> GitHub
          </a>
          <a className="btn btn-primary" href={profile.resumePdf} download>
            <Download size={16} /> Resume PDF
          </a>
          <button className="btn btn-secondary" onClick={() => navigate('#/resume')}>
            <FileText size={16} /> Quick View
          </button>
        </div>
      </section>
    </Page>
  )
}
