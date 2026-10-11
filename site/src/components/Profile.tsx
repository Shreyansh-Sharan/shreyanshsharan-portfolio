import { Suspense, lazy, useEffect, useState } from 'react'
import { Download, FileText, Link as LinkIcon, Mail, MapPin } from 'lucide-react'
import { profile, tiles } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'

const accent = tiles.find((t) => t.id === 'profile')!.accent
const LowPolyAvatar = lazy(() => import('./LowPolyAvatar'))
const base = import.meta.env.BASE_URL

function canRender3D() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

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

/** The visitor-facing avatar: the low-poly Higgsfield character with its move set. */
function ProfileMedia() {
  const [move, setMove] = useState<Move>('idle')
  const [nonce, setNonce] = useState(0)

  if (!canRender3D()) {
    return (
      <section className="profile-media">
        <div className="profile-stage">
          <img className="profile-poster" src={`${base}profile/poster.jpg`} alt={profile.name} />
        </div>
      </section>
    )
  }

  return (
    <section className="profile-media">
      <div className="profile-stage">
        <Suspense fallback={<img className="profile-poster" src={`${base}profile/poster.jpg`} alt="" />}>
          <LowPolyAvatar move={move} nonce={nonce} onDone={() => setMove('idle')} />
        </Suspense>
      </div>
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
      <p className="muted small">Low-poly avatar: image, mesh, rig and all nine animations generated with Higgsfield from a photo and a frame of the intro clip.</p>
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
