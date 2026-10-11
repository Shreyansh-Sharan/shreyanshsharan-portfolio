import { Suspense, lazy, useEffect, useMemo, useRef, useState } from 'react'
import { Dices, Download, FileText, GraduationCap, Link as LinkIcon, Mail, MapPin } from 'lucide-react'
import { profile, skillTree, tiles, trophies } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'
import { DISTRICTS, reset, stroll, type Move } from './profile/strollState'

const accent = tiles.find((t) => t.id === 'profile')!.accent
const Stroll = lazy(() => import('./profile/Stroll'))
const base = import.meta.env.BASE_URL

function canRender3D() {
  try {
    return !!document.createElement('canvas').getContext('webgl2')
  } catch {
    return false
  }
}

const SURPRISES: Move[] = ['jump', 'wave', 'swing', 'flip', 'spell', 'cheer']
const career = tiles.filter((t) => t.tab === 'career')
const certs = trophies.filter((t) => t.kind === 'Certification').length
const awards = trophies.filter((t) => t.kind === 'Award').length

/** Counts up to a number the first time its section comes into view. */
function CountUp({ to, suffix = '', run }: { to: number; suffix?: string; run: boolean }) {
  const [n, setN] = useState(0)
  useEffect(() => {
    if (!run) return
    const start = performance.now()
    let raf = 0
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / 1100)
      setN(Math.round(to * (1 - Math.pow(1 - p, 3))))
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [run, to])
  return (
    <>
      {n}
      {suffix}
    </>
  )
}

function Section({ index, children }: { index: number; children: React.ReactNode }) {
  const d = DISTRICTS[index]
  // The character stands on `d.side`; the text takes the other side.
  return (
    <section className={`stroll-section text-${d.side < 0 ? 'right' : 'left'}`} id={`chapter-${d.id}`} data-index={index}>
      <div className="stroll-card">
        <p className="stroll-kicker">
          <span>{String(index + 1).padStart(2, '0')}</span> {d.place}
        </p>
        {children}
      </div>
    </section>
  )
}

export function Profile({ onAccent }: { onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'profile'), [onAccent])
  const has3D = useMemo(canRender3D, [])
  const [active, setActive] = useState(0)
  const [seen, setSeen] = useState(() => new Set([0]))
  const rootRef = useRef<HTMLDivElement>(null)
  const bgRef = useRef<HTMLDivElement>(null)

  // Track which chapter the middle of the screen is in, and how far through it the visitor is (the backdrop eases
  // in as he walks towards it).
  useEffect(() => {
    reset()
    const root = rootRef.current
    const body = root?.closest('.page-body') as HTMLElement | null
    if (!root || !body) return
    const sections = Array.from(root.querySelectorAll<HTMLElement>('.stroll-section'))
    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let raf = 0
    const update = () => {
      raf = 0
      const top = body.getBoundingClientRect().top
      const mid = body.clientHeight * 0.5
      let idx = 0
      sections.forEach((el, i) => {
        if (el.getBoundingClientRect().top - top <= mid) idx = i
      })
      const r = sections[idx].getBoundingClientRect()
      const through = Math.min(1, Math.max(0, (mid - (r.top - top)) / r.height))
      if (!still) bgRef.current?.style.setProperty('--zoom', (1.02 + through * 0.08).toFixed(4))
      stroll.active = idx
      setActive(idx)
      setSeen((s) => (s.has(idx) ? s : new Set(s).add(idx)))
    }
    const onScroll = () => {
      stroll.lastScroll = performance.now()
      if (!raf) raf = requestAnimationFrame(update)
    }
    update()
    body.addEventListener('scroll', onScroll, { passive: true })
    window.addEventListener('resize', onScroll)
    return () => {
      body.removeEventListener('scroll', onScroll)
      window.removeEventListener('resize', onScroll)
      cancelAnimationFrame(raf)
    }
  }, [])

  const goTo = (i: number) => document.getElementById(`chapter-${DISTRICTS[i].id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  const textSide = DISTRICTS[active].side < 0 ? 'right' : 'left'

  return (
    <Page onBack={() => navigate('#/home/profile')} className="stroll">
      <div ref={rootRef}>
        <div className="stroll-bg" ref={bgRef} aria-hidden="true">
          {DISTRICTS.map((d, i) => (
            <img key={d.id} src={`${base}profile/scenes/${d.img}.webp`} alt="" className={i === active ? 'is-on' : ''} decoding="async" />
          ))}
          <div className={`stroll-scrim scrim-left ${textSide === 'left' ? 'is-on' : ''}`} />
          <div className={`stroll-scrim scrim-right ${textSide === 'right' ? 'is-on' : ''}`} />
          <div className="stroll-shade" />
        </div>

        {has3D ? (
          <Suspense fallback={null}>
            <Stroll />
          </Suspense>
        ) : (
          <img className={`stroll-poster side-${DISTRICTS[active].side < 0 ? 'left' : 'right'}`} src={`${base}profile/poster.jpg`} alt="" />
        )}

        <nav className="stroll-rail" aria-label="Chapters">
          {DISTRICTS.map((d, i) => (
            <button key={d.id} className={i === active ? 'is-on' : ''} aria-current={i === active ? 'step' : undefined} onClick={() => goTo(i)}>
              <span className="stroll-dot" />
              <span className="stroll-rail-label">{d.chapter}</span>
            </button>
          ))}
        </nav>

        {has3D && (
          <button
            className="stroll-surprise"
            onClick={() => {
              stroll.request = SURPRISES[Math.floor(Math.random() * SURPRISES.length)]
            }}
          >
            <Dices size={16} /> Surprise move
          </button>
        )}

        <Section index={0}>
          <p className="eyebrow">Player profile</p>
          <h1 className="stroll-title">{profile.name}</h1>
          <p className="stroll-lead">{profile.headline}</p>
          <p className="stroll-meta">
            <MapPin size={15} aria-hidden="true" /> {profile.location}
          </p>
          <div className="stroll-stats">
            <div>
              <strong>
                <CountUp to={8} suffix="+" run={seen.has(0)} />
              </strong>
              <span>years</span>
            </div>
            <div>
              <strong>
                <CountUp to={30} suffix="+" run={seen.has(0)} />
              </strong>
              <span>enterprise clients</span>
            </div>
            <div>
              <strong>
                <CountUp to={certs} run={seen.has(0)} />
              </strong>
              <span>certifications</span>
            </div>
            <div>
              <strong>
                <CountUp to={awards} run={seen.has(0)} />
              </strong>
              <span>awards</span>
            </div>
          </div>
          <p className="stroll-prose">{profile.summary}</p>
          <p className="stroll-hint">Scroll to walk through the career ↓</p>
        </Section>

        <Section index={1}>
          <h2 className="stroll-h2">Experience</h2>
          <ol className="stroll-timeline">
            {career.map((t) => {
              const Icon = t.icon
              return (
                <li key={t.id}>
                  <button onClick={() => navigate(`#/game/${t.id}`)} style={{ ['--a' as string]: t.accent[1] }}>
                    <span className="stroll-tl-icon">
                      <Icon size={16} aria-hidden="true" />
                    </span>
                    <span className="stroll-tl-body">
                      <strong>{t.title}</strong>
                      <span>{t.org}</span>
                    </span>
                    <span className="stroll-tl-period">{t.period}</span>
                  </button>
                </li>
              )
            })}
          </ol>
        </Section>

        <Section index={2}>
          <h2 className="stroll-h2">Skill tree</h2>
          <div className="stroll-branches">
            {skillTree.map((b) => (
              <div key={b.branch} className="stroll-branch">
                <h3>{b.branch}</h3>
                <div className="stroll-chips">
                  {b.skills.map((s) => (
                    <span key={s}>{s}</span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>

        <Section index={3}>
          <h2 className="stroll-h2">Trophies</h2>
          <ul className="stroll-trophies">
            {trophies.map((t) => {
              const Icon = t.icon
              return (
                <li key={t.name} className={`tier-${t.tier}`}>
                  <Icon size={16} aria-hidden="true" />
                  <span>
                    <strong>{t.name}</strong>
                    <small>
                      {t.issuer} · {t.kind}
                    </small>
                  </span>
                </li>
              )
            })}
          </ul>
        </Section>

        <Section index={4}>
          <h2 className="stroll-h2">Off the clock</h2>
          <div className="stroll-chips stroll-chips-lg">
            {profile.hobbies.map((h) => (
              <span key={h}>{h}</span>
            ))}
          </div>
          <h3 className="stroll-h3">
            <GraduationCap size={16} aria-hidden="true" /> Education
          </h3>
          <p className="stroll-prose">B.Tech, Dr. B. R. Ambedkar National Institute of Technology (NIT) Jalandhar</p>
          <h3 className="stroll-h3">Say hello</h3>
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
        </Section>
      </div>
    </Page>
  )
}
