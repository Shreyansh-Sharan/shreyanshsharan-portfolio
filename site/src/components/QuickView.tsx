import { useEffect } from 'react'
import { Download, Gamepad2 } from 'lucide-react'
import { profile, skillTree, tiles, trophies } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'

const roles = tiles.filter((t) => t.tab === 'career' && t.id !== 'nit-academy')
const accent: [string, string] = ['#1e293b', '#64748b']

/** Plain, scannable resume for people who don't want to play. */
export function QuickView({ onAccent }: { onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'resume'), [onAccent])

  return (
    <Page onBack={() => navigate('#/home')} backLabel="Game mode" className="quick">
      <article className="resume">
        <header className="resume-head">
          <div>
            <h1>{profile.name}</h1>
            <p className="resume-headline">{profile.headline}</p>
            <p className="muted">
              {profile.location} · <a href={`mailto:${profile.email}`}>{profile.email}</a> ·{' '}
              <a href={profile.linkedin} target="_blank" rel="noreferrer">
                LinkedIn
              </a>
            </p>
          </div>
          <div className="resume-actions">
            <a className="btn btn-primary" href={profile.resumePdf} download>
              <Download size={16} /> PDF
            </a>
            <button className="btn btn-secondary" onClick={() => navigate('#/home')}>
              <Gamepad2 size={16} /> Play
            </button>
          </div>
        </header>

        <section>
          <h2>Summary</h2>
          <p>{profile.summary}</p>
        </section>

        <section>
          <h2>Experience &amp; Products</h2>
          {roles.map((r) => (
            <div className="resume-role" key={r.id}>
              <div className="resume-role-head">
                <h3>
                  {r.title}: {r.tagline}
                </h3>
                <span className="muted">{r.period}</span>
              </div>
              <p className="muted">{r.org}</p>
              <ul>
                {r.activities.map((a) => (
                  <li key={a.title}>
                    <strong>{a.title}.</strong> {a.detail}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>

        <section>
          <h2>Certifications &amp; Awards</h2>
          <ul className="resume-cols">
            {trophies.map((t) => (
              <li key={t.name}>
                {t.name} <span className="muted">· {t.issuer}</span>
              </li>
            ))}
          </ul>
        </section>

        <section>
          <h2>Skills</h2>
          {skillTree.map((b) => (
            <p key={b.branch}>
              <strong>{b.branch}:</strong> {b.skills.join(', ')}
            </p>
          ))}
        </section>

        <section>
          <h2>Education</h2>
          <p>B.Tech, Dr. B. R. Ambedkar National Institute of Technology (NIT) Jalandhar · 2014 – 2018</p>
        </section>
      </article>
    </Page>
  )
}
