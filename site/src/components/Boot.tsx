import { useEffect, useRef, useState } from 'react'
import { FileText, Gamepad2 } from 'lucide-react'
import { profile } from '../data/content'
import { useActions } from '../lib/input'
import { play } from '../lib/sound'
import { navigate } from '../lib/router'
import { HintBar } from './HintBar'

const choices = [
  { id: 'play', label: 'Explore', sub: 'Game mode', icon: Gamepad2, to: '#/home' },
  { id: 'recruiter', label: 'Recruiter', sub: 'Quick view', icon: FileText, to: '#/resume' },
] as const

export function Boot() {
  const [index, setIndex] = useState(0)
  const refs = useRef<(HTMLButtonElement | null)[]>([])

  useEffect(() => {
    refs.current[index]?.focus({ preventScroll: true })
  }, [index])

  const choose = (i: number) => {
    play(i === 0 ? 'boot' : 'select')
    navigate(choices[i].to)
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
