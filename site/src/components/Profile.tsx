import { useEffect } from 'react'
import { Download, FileText, Link as LinkIcon, Mail, MapPin } from 'lucide-react'
import { profile, tiles } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'

const accent = tiles.find((t) => t.id === 'profile')!.accent

export function Profile({ onAccent }: { onAccent: (a: [string, string]) => void }) {
  useEffect(() => onAccent(accent), [onAccent])

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
