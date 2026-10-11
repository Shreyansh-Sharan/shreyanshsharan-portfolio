import { useEffect, useRef, useState } from 'react'
import { FileText, Gamepad2, Mountain } from 'lucide-react'
import { profile, tiles } from '../data/content'
import { useActions } from '../lib/input'
import { play } from '../lib/sound'
import { navigate } from '../lib/router'
import { world } from '../world/store'
import { HintBar } from './HintBar'

const allChoices = [
  { id: 'play', label: 'Console', sub: 'Browse the portfolio', icon: Gamepad2, to: '#/home' },
  { id: 'world', label: 'Open World', sub: 'Play the missions', icon: Mountain, to: '#/home?explore' },
  { id: 'recruiter', label: 'Recruiter', sub: 'Quick view', icon: FileText, to: '#/resume' },
] as const

export function Boot({ onAccent, canExplore }: { onAccent: (a: [string, string], emblem: string) => void; canExplore: boolean }) {
  useEffect(() => onAccent(tiles[0].accent, 'boot'), [onAccent])
  const choices = canExplore ? allChoices : allChoices.filter((c) => c.id !== 'world')
  const [index, setIndex] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    refs.current[index]?.focus({ preventScroll: true })
  }, [index])

  const choose = (i: number) => {
    const c = choices[i]
    if (c.id === 'world') {
      // Start on Basecamp and drop straight into explore mode.
      world.set({ requestPlay: true })
      navigate('#/home/profile')
      return
    }
    play(i === 0 ? 'boot' : 'select')
    navigate(c.to)
  }

  useActions((action) => {
    if (action === 'left' || action === 'right') {
      setIndex((i) => (i + (action === 'right' ? 1 : -1) + choices.length) % choices.length)
      play('move')
      return true
    }
    if (action === 'confirm') {
      choose(index)
      return true
    }
    return false
  })

  return (
    <div className="boot">
      <div className="boot-logo" aria-hidden="true">
        {profile.initials}
      </div>
      <h1 className="boot-title">Who's playing?</h1>
      <p className="boot-sub">{profile.name} · {profile.headline}</p>
      <div className="boot-choices">
        {choices.map((c, i) => {
          const Icon = c.icon
          return (
            <button
              key={c.id}
              ref={(el) => {
                refs.current[i] = el
              }}
              className={`boot-choice ${i === index ? 'is-selected' : ''}`}
              onClick={() => choose(i)}
              onFocus={() => setIndex(i)}
            >
              <span className="boot-avatar">
                <Icon size={40} strokeWidth={1.5} />
              </span>
              <span className="boot-label">{c.label}</span>
              <span className="boot-label-sub">{c.sub}</span>
            </button>
          )
        })}
      </div>
      <HintBar hints={[['← →', 'Choose'], ['Enter', 'Start']]} />
    </div>
  )
}
