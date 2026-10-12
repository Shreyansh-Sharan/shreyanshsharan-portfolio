import { ExternalLink, ShoppingBag } from 'lucide-react'
import { AMAZON_TAG, GEAR, affiliateUrl, type GearTopic } from '../data/affiliates'

/** Affiliate gear picks for a game's menu page, with the disclosure Amazon requires. Hidden without a tag. */
export function GearShelf({ topic }: { topic: GearTopic }) {
  if (!AMAZON_TAG) return null
  const { heading, picks } = GEAR[topic]
  return (
    <section className="gear-shelf" aria-labelledby={`gear-${topic}`}>
      <h2 className="section-title" id={`gear-${topic}`}>
        <ShoppingBag size={16} aria-hidden="true" /> {heading}
      </h2>
      <ul className="gear-list">
        {picks.map((p) => (
          <li key={p.title}>
            <a href={affiliateUrl(p.query)} target="_blank" rel="sponsored noopener noreferrer">
              <strong>{p.title}</strong>
              <span>{p.note}</span>
              <ExternalLink size={14} aria-hidden="true" />
            </a>
          </li>
        ))}
      </ul>
      <p className="muted small">As an Amazon Associate I earn from qualifying purchases. Prices and availability are on Amazon.</p>
    </section>
  )
}
