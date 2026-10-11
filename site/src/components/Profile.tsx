import { Suspense, lazy, useEffect, useState } from 'react'
import { Download, FileText, Gamepad2, Link as LinkIcon, Mail, MapPin, User } from 'lucide-react'
import { profile, tiles } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'

const accent = tiles.find((t) => t.id === 'profile')!.accent
const ProfileAvatar = lazy(() => import('./ProfileAvatar'))
const base = import.meta.env.BASE_URL

function canRender3D() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

/** The interactive 3D avatar: your Higgsfield-generated likeness, or a free game character to switch to. */
function ProfileMedia() {
  const [who, setWho] = useState<'me' | 'game'>('me')
  const has3D = canRender3D()

  if (!has3D) {
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
      <div className="seg seg-sm" role="tablist" aria-label="Avatar view">
        <button role="tab" aria-selected={who === 'me'} className={`seg-btn ${who === 'me' ? 'is-active' : ''}`} onClick={() => setWho('me')}>
          <User size={14} /> My avatar
        </button>
        <button role="tab" aria-selected={who === 'game'} className={`seg-btn ${who === 'game' ? 'is-active' : ''}`} onClick={() => setWho('game')}>
          <Gamepad2 size={14} /> Game character
        </button>
      </div>
      <div className="profile-stage">
        <Suspense fallback={<img className="profile-poster" src={`${base}profile/poster.jpg`} alt="" />}>
          <ProfileAvatar variant={who} />
        </Suspense>
      </div>
      <p className="muted small">
        {who === 'me'
          ? '3D model and textures generated with Higgsfield from a photo.'
          : 'Game character: “Fox” by tomkranis / Asobo Studio (CC-BY 4.0), via the Khronos glTF sample assets.'}
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
