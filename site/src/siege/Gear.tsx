// Gear screen: equip cards, merge two of the same type and rarity into the next tier, buy a chest with coins or
// watch a rewarded ad for a free one. The loadout panel shows what the cards do to the selected hero's kit.
import { useState } from 'react'
import { Gift, Package, Sparkles, Zap } from 'lucide-react'
import { rewardedAd, adsEnabled, GAME_ADS } from '../lib/ads'
import { play as uiSound } from '../lib/sound'
import { HEROES } from './engine/heroes'
import { POWERS } from './engine/powers'
import { CHEST_COST, GEAR_INFO, GEAR_TYPES, MAX_TIER, TIER_COLORS, TIER_NAMES, equip, gearMods, mergeCards, openChest, type GearCard, type Profile } from './engine/progress'
import { POWER_ICONS } from './icons'
import { portrait } from './portraits'

export function GearScreen({ profile, onProfile }: { profile: Profile; onProfile: (p: Profile | ((p: Profile) => Profile)) => void }) {
  const [sel, setSel] = useState<string | null>(null)
  const [last, setLast] = useState<GearCard | null>(null)
  const [adBusy, setAdBusy] = useState(false)
  const mods = gearMods(profile)
  const cards = [...profile.gear].sort((a, b) => GEAR_TYPES.indexOf(a.type) - GEAR_TYPES.indexOf(b.type) || b.tier - a.tier)
  const selCard = sel ? profile.gear.find((g) => g.id === sel) : null
  const canMergeWith = (c: GearCard) => !!selCard && selCard.id !== c.id && selCard.type === c.type && selCard.tier === c.tier && c.tier < MAX_TIER
  const click = (c: GearCard) => {
    if (selCard && canMergeWith(c)) {
      onProfile((p) => mergeCards(p, selCard.id, c.id) ?? p)
      uiSound('select')
      setSel(null)
      return
    }
    setSel(sel === c.id ? null : c.id)
  }
  const chest = (free: boolean) => {
    onProfile((p) => {
      const r = openChest(p, free)
      if (!r) return p
      setLast(r.card)
      return r.profile
    })
    uiSound('select')
  }
  const freeChest = () => {
    setAdBusy(true)
    rewardedAd('siege-chest', {
      granted: (ok) => {
        setAdBusy(false)
        if (ok || !adsEnabled() || !GAME_ADS) chest(true)
      },
    })
  }
  const hero = HEROES[profile.hero]
  const power = POWERS[hero.power]
  const PowerIcon = POWER_ICONS[hero.power]
  const dps = (hero.weapon.dmg * hero.weapon.count) / hero.weapon.cooldown
  const row = (label: string, base: number, mul: number, unit = '', digits = 0, lowerIsBetter = false) => {
    const v = base * mul
    const better = lowerIsBetter ? v < base - 1e-6 : v > base + 1e-6
    return (
      <li>
        <span>{label}</span>
        <strong className={better ? 'is-up' : ''}>
          {v.toFixed(digits)}
          {unit}
        </strong>
        <em>{better ? `${lowerIsBetter ? '−' : '+'}${Math.abs(Math.round((mul - 1) * 100))}%` : 'base'}</em>
      </li>
    )
  }
  return (
    <div className="sg-gear" data-testid="sg-gear">
      <div className="sg-loadout" style={{ ['--sg-accent' as string]: hero.colors[0] }} data-testid="sg-loadout">
        <img src={portrait(profile.hero)} alt="" />
        <div>
          <h4>
            {hero.name} with this loadout
          </h4>
          <ul>
            {row('Health', hero.hp, mods.hp)}
            {row('Speed', hero.speed, mods.speed, ' m/s', 2)}
            {row('Damage / s', dps, mods.dmg)}
            {row(power.name, power.cooldown, 1 / Math.sqrt(mods.charge), ' s', 1, true)}
            {row('Super fill', 100, mods.charge, '%')}
          </ul>
          <p className="sg-power small" style={{ ['--sg-c' as string]: power.color }}>
            <PowerIcon size={13} /> <strong>{power.name}</strong> · <Zap size={12} /> <strong>{hero.superName}</strong>
          </p>
        </div>
      </div>
      <p className="muted small">
        Equip one card per slot. Tap two cards of the same type and rarity to merge them. Capacitors also shorten the power cooldown.
      </p>
      <div className="sg-slots">
        {GEAR_TYPES.map((t) => {
          const id = profile.equipped[t]
          const c = id ? profile.gear.find((g) => g.id === id) : null
          return (
            <div key={t} className="sg-slot" style={{ ['--sg-tier' as string]: c ? TIER_COLORS[c.tier] : '#444' }}>
              <span>{GEAR_INFO[t].name}</span>
              <strong>{c ? `${TIER_NAMES[c.tier]} · +${Math.round(GEAR_INFO[t].perTier * c.tier * 100)}% ${GEAR_INFO[t].stat}` : 'empty'}</strong>
            </div>
          )
        })}
      </div>
      <div className="sg-cards">
        {cards.map((c) => (
          <button
            key={c.id}
            className={`sg-card ${sel === c.id ? 'is-sel' : ''} ${canMergeWith(c) ? 'is-mergeable' : ''} ${profile.equipped[c.type] === c.id ? 'is-equipped' : ''}`}
            style={{ ['--sg-tier' as string]: TIER_COLORS[c.tier] }}
            onClick={() => click(c)}
            data-testid={`sg-card-${c.type}-${c.tier}`}
          >
            <strong>{GEAR_INFO[c.type].name}</strong>
            <span>{TIER_NAMES[c.tier]}</span>
            <em>+{Math.round(GEAR_INFO[c.type].perTier * c.tier * 100)}% {GEAR_INFO[c.type].stat}</em>
            {profile.equipped[c.type] === c.id && <small>EQUIPPED</small>}
          </button>
        ))}
        {!cards.length && <p className="muted small">No cards yet. Open a chest.</p>}
      </div>
      {selCard && (
        <div className="sg-online">
          <button className="btn" onClick={() => onProfile((p) => equip(p, selCard.id))} data-testid="sg-equip">
            {profile.equipped[selCard.type] === selCard.id ? 'Unequip' : 'Equip'} {GEAR_INFO[selCard.type].name}
          </button>
          <span className="muted small">{selCard.tier < MAX_TIER ? `Tap another ${TIER_NAMES[selCard.tier]} ${GEAR_INFO[selCard.type].name} to merge.` : 'Max rarity.'}</span>
        </div>
      )}
      <h3 className="sg-sub">Chests</h3>
      <div className="sg-online">
        <button className="btn" disabled={profile.coins < CHEST_COST} onClick={() => chest(false)} data-testid="sg-chest">
          <Package size={16} /> Open a chest · {CHEST_COST} coins
        </button>
        <button className="btn" disabled={adBusy} onClick={freeChest} data-testid="sg-chest-ad">
          <Gift size={16} /> {adsEnabled() && GAME_ADS ? 'Watch an ad for a free chest' : 'Free chest'}
        </button>
      </div>
      {last && (
        <p className="sg-drop" style={{ color: TIER_COLORS[last.tier] }}>
          <Sparkles size={14} /> {TIER_NAMES[last.tier]} {GEAR_INFO[last.type].name} dropped.
        </p>
      )}
    </div>
  )
}
