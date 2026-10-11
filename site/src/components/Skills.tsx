import { useEffect } from 'react'
import { skillTree, tiles } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'

const accent = tiles.find((t) => t.id === 'skill-tree')!.accent

export function Skills({ onAccent }: { onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'skill-tree'), [onAccent])

  return (
    <Page onBack={() => navigate('#/home/skill-tree')}>
      <header className="page-header">
        <p className="eyebrow">Loadout</p>
        <h1 className="page-title">Skill Tree</h1>
        <p className="page-lead">{skillTree.length} branches, unlocked over 8+ years of client delivery.</p>
      </header>
      <div className="branch-grid">
        {skillTree.map((b) => (
          <section className="branch" key={b.branch}>
            <h2 className="branch-title">{b.branch}</h2>
            <ul className="branch-nodes">
              {b.skills.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Page>
  )
}
