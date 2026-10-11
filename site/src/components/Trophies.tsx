import { useEffect } from 'react'
import { Trophy } from 'lucide-react'
import { tiles, trophies, type TrophyTier } from '../data/content'
import { navigate } from '../lib/router'
import { Page } from './Page'

const TIERS: TrophyTier[] = ['platinum', 'gold', 'silver', 'bronze']
const accent = tiles.find((t) => t.id === 'trophies')!.accent

export function Trophies({ onAccent }: { onAccent: (a: [string, string], emblem: string) => void }) {
  useEffect(() => onAccent(accent, 'trophies'), [onAccent])
  const certs = trophies.filter((t) => t.kind === 'Certification').length

  return (
    <Page onBack={() => navigate('#/home/trophies')}>
      <header className="page-header">
        <p className="eyebrow">Collection</p>
        <h1 className="page-title">Trophies</h1>
        <p className="page-lead">
          {certs} certifications and {trophies.length - certs} awards across Anthropic, Databricks, Microsoft, Qlik and Wipro.
        </p>
        <div className="tier-summary">
          {TIERS.map((tier) => (
            <span key={tier} className={`tier-count tier-${tier}`}>
              <Trophy size={18} aria-hidden="true" />
              <strong>{trophies.filter((t) => t.tier === tier).length}</strong>
              <span>{tier}</span>
            </span>
          ))}
        </div>
      </header>

      <ul className="trophy-grid">
        {trophies.map((t) => {
          const Icon = t.icon
          return (
            <li key={t.name} className={`trophy tier-${t.tier}`}>
              <span className="trophy-icon">
                <Icon size={26} strokeWidth={1.6} aria-hidden="true" />
              </span>
              <div>
                <h3>{t.name}</h3>
                <p>
                  {t.issuer} · {t.kind}
                </p>
              </div>
              <span className="trophy-tier">{t.tier}</span>
            </li>
          )
        })}
      </ul>
    </Page>
  )
}
