// The Sewing Table drawer: ten trait slots plus your toy, name and tint. Try anything on (your toy changes on
// every screen while you do), buy with buttons, wear what you own. Claw prizes and challenge pieces show how to
// get them. Your toy turns on the tape-measure podium while this is open.
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Lock, Shuffle, Sparkles, X } from 'lucide-react'
import type { Game } from '../engine/game'
import type { PlushAssets } from '../engine/assets'
import type { Profile, ProfilePatch } from '../engine/show'
import { Customise } from '../Forms'
import { loftUi } from '../levels/loft/ui'
import { cleanOutfit, DEFAULT_ITEM, ITEMS, RARITY_COLORS, RARITY_NAMES, SLOT_NAMES, WSLOTS, type Item, type Outfit, type WSlot } from './catalog'
import { challengeStats, ownedSet } from './store'
import './wardrobe.css'

type Tab = 'toy' | WSlot

export function Wardrobe(p: { profile: Profile; assets: PlushAssets | null; game: Game; onProfile: (p: ProfilePatch) => void; onClose: () => void }) {
  const { profile, game } = p
  const [tab, setTab] = useState<Tab>('hat')
  const [trying, setTrying] = useState<Item | null>(null)
  const owned = useMemo(() => ownedSet(profile), [profile])
  const stats = useMemo(() => challengeStats(profile), [profile])
  const outfit: Outfit = profile.outfit ?? {}
  const profileRef = useRef(profile)
  useEffect(() => {
    profileRef.current = profile
  })

  // Frame the toy for the preview while the drawer is open; put the real outfit back when it closes.
  useEffect(() => {
    loftUi.wardrobe = true
    if (document.pointerLockElement) document.exitPointerLock()
    return () => {
      loftUi.wardrobe = false
      const pr = profileRef.current
      game.setLook({ name: pr.name, kind: pr.kind, tint: pr.tint, outfit: pr.outfit })
    }
  }, [game])

  const look = (o: Outfit) => game.setLook({ name: profile.name, kind: profile.kind, tint: profile.tint, outfit: cleanOutfit(o) })
  const tryOn = (it: Item | null) => {
    setTrying(it)
    look(it && !it.emote ? { ...outfit, [it.slot]: it.id } : outfit)
  }
  const wear = (it: Item) => {
    setTrying(null)
    p.onProfile((prev) => {
      const o: Outfit = { ...(prev.outfit ?? {}) }
      if (it.id === DEFAULT_ITEM[it.slot] || o[it.slot] === it.id) delete o[it.slot]
      else o[it.slot] = it.id
      return { outfit: cleanOutfit(o) }
    })
  }
  const buy = (it: Item) => {
    setTrying(null)
    p.onProfile((prev) => {
      const have = ownedSet(prev)
      if (have.has(it.id) || !it.price || prev.buttons < it.price) return {}
      const o: Outfit = { ...(prev.outfit ?? {}) }
      if (!it.emote) o[it.slot] = it.id
      return { buttons: prev.buttons - it.price, owned: [...(prev.owned ?? []), it.id], outfit: cleanOutfit(o) }
    })
    if (it.emote) game.emote(it.emote)
  }
  const surprise = () => {
    setTrying(null)
    const o: Outfit = {}
    for (const slot of WSLOTS) {
      const mine = ITEMS.filter((i) => i.slot === slot && !i.emote && owned.has(i.id))
      if (mine.length && Math.random() < 0.75) o[slot] = mine[Math.floor(Math.random() * mine.length)].id
    }
    p.onProfile({ outfit: cleanOutfit(o) })
  }

  const items = tab === 'toy' ? [] : ITEMS.filter((i) => i.slot === tab)
  const count = ITEMS.filter((i) => owned.has(i.id)).length
  return (
    <div className="pp-wardrobe" data-testid="pp-wardrobe">
      <header>
        <h3>Sewing Table</h3>
        <span className="pp-wallet-chip" title="Buttons: earned in Shows and the Loft games">
          <Sparkles size={14} /> {profile.buttons}
        </span>
        <button className="btn btn-secondary pp-wr-close" aria-label="Close the wardrobe" onClick={p.onClose}>
          <X size={16} />
        </button>
      </header>
      <nav className="pp-wr-tabs">
        {(['toy', ...WSLOTS] as Tab[]).map((t) => (
          <button key={t} className={`pp-wr-tab ${tab === t ? 'is-active' : ''} ${t !== 'toy' && outfit[t as WSlot] ? 'is-worn' : ''}`} onClick={() => setTab(t)}>
            {t === 'toy' ? 'Toy' : SLOT_NAMES[t]}
          </button>
        ))}
      </nav>
      {tab === 'toy' ? (
        <Customise profile={profile} assets={p.assets} onProfile={p.onProfile} compact />
      ) : (
        <div className="pp-wr-grid">
          {items.map((it) => {
            const have = owned.has(it.id)
            const worn = it.emote ? false : (outfit[it.slot] ?? DEFAULT_ITEM[it.slot]) === it.id
            const done = it.test?.(stats)
            return (
              <div
                key={it.id}
                className={`pp-wr-item ${worn ? 'is-worn' : ''} ${have ? 'is-owned' : ''} ${trying?.id === it.id ? 'is-trying' : ''}`}
                style={{ ['--rar' as string]: RARITY_COLORS[it.rarity] }}
                data-testid={`item-${it.id}`}
              >
                <button
                  className="pp-wr-face"
                  title={have ? (it.emote ? 'Play it' : worn ? 'Take it off' : 'Wear it') : 'Try it on'}
                  onClick={() => (it.emote ? (have ? game.emote(it.emote) : tryOn(it)) : have ? wear(it) : tryOn(trying?.id === it.id ? null : it))}
                >
                  <i className="pp-wr-swatch" style={{ background: it.swatch ?? '#e7d8c9' }} />
                  <span className="pp-wr-name">{it.name}</span>
                  <span className="pp-wr-rar">{RARITY_NAMES[it.rarity]}</span>
                </button>
                {have ? (
                  <span className="pp-wr-state">{it.emote ? 'Play' : worn ? <><Check size={12} /> Wearing</> : 'Owned'}</span>
                ) : it.how === 'shop' ? (
                  <button className="btn btn-primary pp-wr-buy" disabled={profile.buttons < (it.price ?? 0)} onClick={() => buy(it)} data-testid={`buy-${it.id}`}>
                    {it.price} ✦
                  </button>
                ) : it.how === 'claw' ? (
                  <span className="pp-wr-state is-locked">
                    <Lock size={11} /> Button Claw prize
                  </span>
                ) : (
                  <span className="pp-wr-state is-locked" title={it.goal}>
                    <Lock size={11} /> {done ? 'Unlocking…' : it.goal}
                  </span>
                )}
              </div>
            )
          })}
        </div>
      )}
      {trying && (
        <div className="pp-wr-try">
          Trying on <strong>{trying.name}</strong>
          {trying.how === 'shop' && (
            <button className="btn btn-primary" disabled={profile.buttons < (trying.price ?? 0)} onClick={() => buy(trying)}>
              Buy for {trying.price} ✦
            </button>
          )}
          <button className="btn btn-secondary" onClick={() => tryOn(null)}>
            Take off
          </button>
        </div>
      )}
      <footer>
        <span className="muted small">
          {count}/{ITEMS.length} pieces · stand on the tape measure to spin
        </span>
        <button className="btn btn-secondary" onClick={surprise}>
          <Shuffle size={14} /> Surprise me
        </button>
      </footer>
    </div>
  )
}
