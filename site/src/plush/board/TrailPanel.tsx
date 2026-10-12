// Toy Box Trail HUD: whose turn and the turn timer, the dice, every toy's buttons and bag, your own bag of
// tricks with targets, fork / shop / duel / stake choices, surprise cards, a mini-map of the board and the
// turn log. Reads the level's HUD data (hud.levelHud.extra) and answers with game.levelAction().
import { useEffect, useMemo, useState } from 'react'
import { Bot, Cookie, Dices, Eye, Hammer, Magnet, Map as MapIcon, PackageOpen, Rat, Shield, ShoppingBag, Sparkles, Swords, Timer } from 'lucide-react'
import type { Game, Hud } from '../engine/game'
import { BAG_SLOTS, ITEMS, ITEM_IDS, PARTY_EVERY, type ItemId } from './items'
import { BOUNDS, JAR, TILE_INFO, TILES } from './layout'
import { setOverview, type TrailHud } from './trail'

const ITEM_ICONS: Record<ItemId, typeof Hammer> = { hammer: Hammer, trap: Rat, jack: PackageOpen, bubble: Shield, double: Dices, magnet: Magnet }

export function TrailIntro() {
  return (
    <div className="pp-card pp-intro tb-intro" style={{ ['--pp-accent' as string]: '#f59e0b' }}>
      <p className="pp-kicker">Board game · 2 to 6 toys</p>
      <h2>
        <Cookie size={26} /> Toy Box Trail
      </h2>
      <p className="pp-blurb">Roll the big foam die and hop along a trail of playing cards. First toy to the cookie jar wins.</p>
      <ul className="pp-howto">
        <li>Blue cards give buttons, red ones take them, purple ones are surprises.</li>
        <li>Land on another toy, or a duel card, for a 30-second duel. The winner takes buttons or swaps places.</li>
        <li>Every {PARTY_EVERY} rounds the whole table plays a mini-game for bonus buttons.</li>
        <li>The popsicle ladder is a big shortcut. The slide is not.</li>
      </ul>
      <div className="pp-tricklist">
        {ITEM_IDS.map((id) => {
          const I = ITEM_ICONS[id]
          return (
            <div key={id} className="pp-trickrow">
              <I size={16} />
              <strong>{ITEMS[id].name}</strong>
              <span className="pp-cost">{ITEMS[id].price} buttons</span>
              <span className="muted small">{ITEMS[id].desc}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function TrailPanel({ hud, game }: { hud: Hud; game: Game }) {
  const t = hud.levelHud?.extra as TrailHud | undefined
  const [aimRaw, setAim] = useState<number | null>(null)
  const [overview, setOv] = useState(false)
  const send = (a: string) => game.levelAction(a)
  // A target picker only lasts while you are choosing before your roll.
  const aim = t?.deciding && t.phase === 'pre' && !t.used ? aimRaw : null

  // Keys: Space rolls, 1-3 use (or aim) items, 1-2 pick a way at a fork.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!t || !t.deciding || e.repeat) return
      const n = e.code.startsWith('Digit') ? Number(e.code.slice(5)) - 1 : -1
      if (t.phase === 'pre') {
        if (e.code === 'Space' || e.code === 'Enter') send('roll')
        else if (n >= 0 && n < t.items.length) pickSlot(n)
        else if (e.code === 'Escape') setAim(null)
      } else if (t.phase === 'fork' && t.fork && n >= 0 && n < t.fork.length) send(`fork:${n}`)
      else if (t.phase === 'shop' && (e.code === 'Escape' || e.code === 'Enter')) send('done')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (!t) return null
  const item = aim !== null ? t.items.find((i) => i.slot === aim) : undefined

  function pickSlot(slot: number) {
    const it = t!.items.find((i) => i.slot === slot)
    if (!it) return
    if (it.aim === 'rival' || it.aim === 'tile') setAim(aim === slot ? null : slot)
    else send(`item:${slot}:-1`)
  }

  const me = t.players.find((p) => p.me)
  return (
    <>
      <div className="tb-top">
        <span className="tb-round">Round {t.round}</span>
        <strong style={{ color: t.turn.tint }}>{t.myTurn ? 'Your turn!' : `${t.turn.name}'s turn`}</strong>
        {t.timer !== null && (
          <span className={`tb-timer ${t.timer < 5 ? 'is-low' : ''}`}>
            <Timer size={14} /> {Math.ceil(t.timer)}
          </span>
        )}
        <span className="tb-party">{t.partyIn === PARTY_EVERY && t.round > 1 ? 'Mini-game round!' : `Mini-game in ${t.partyIn} ${t.partyIn === 1 ? 'round' : 'rounds'}`}</span>
      </div>

      <ol className="tb-players">
        {t.players.map((p) => (
          <li key={p.c} className={`${p.active ? 'is-active' : ''} ${p.me ? 'is-me' : ''}`}>
            <i style={{ background: p.tint }} />
            <span className="tb-name">
              {p.name}
              {p.me ? ' (you)' : ''}
              {p.bot && !p.me && <Bot size={12} aria-label="bot" />}
            </span>
            <span className="tb-buttons" title="Buttons">
              <Sparkles size={12} /> {p.b}
            </span>
            <span className="tb-bag">
              {Array.from({ length: BAG_SLOTS }, (_, k) => {
                const id = p.items[k]
                const I = id ? ITEM_ICONS[id] : null
                return <b key={k} title={id ? ITEMS[id].name : 'Empty slot'}>{I ? <I size={12} /> : null}</b>
              })}
            </span>
            <span className="tb-tags">
              <em>{p.dist === 0 ? 'jar!' : `${p.dist} to go`}</em>
              {p.bub && <Shield size={12} aria-label="Bubble Wrap" />}
              {p.dbl && <Dices size={12} aria-label="Double Die" />}
              {p.skip > 0 && <span className="tb-skip">stuck</span>}
              {p.grudge && p.me && <span className="tb-grudge">✕ {p.grudge}</span>}
            </span>
          </li>
        ))}
      </ol>

      <div className="tb-side">
        <MiniMap t={t} />
        <ul className="tb-log">
          {t.log.map(([id, text]) => (
            <li key={id}>{text}</li>
          ))}
        </ul>
      </div>

      {t.dice.length > 0 && (
        <div className="tb-dice">
          {t.dice.map((v, k) => (
            <span key={k} className={v ? '' : 'is-rolling'}>
              {v || '?'}
            </span>
          ))}
          {t.phase === 'move' && t.steps > 0 && <em>{t.steps} to hop</em>}
        </div>
      )}

      {t.card && (
        <div className="tb-card" key={t.card.title}>
          <span className="tb-card-kicker">Surprise!</span>
          <strong>{t.card.title}</strong>
          <p>{t.card.text}</p>
        </div>
      )}

      {t.duel && (
        <div className="tb-duel">
          <Swords size={22} />
          <strong>{t.duel.party ? 'Mini-game for everyone!' : t.duel.names.join(' vs ')}</strong>
          <span>{t.duel.level}</span>
          <em>{t.duel.party ? 'Bonus buttons by placing' : 'Winner takes buttons or swaps places'}</em>
        </div>
      )}

      {t.winner && t.phase === 'over' && (
        <div className="tb-duel tb-win">
          <Cookie size={26} />
          <strong>{t.winner} reached the Cookie Jar!</strong>
        </div>
      )}

      <div className="tb-actions">
        {t.deciding && t.phase === 'pre' && (
          <>
            <button className="btn btn-primary tb-roll" onClick={() => send('roll')} data-testid="tb-roll">
              <Dices size={18} /> Roll the die <kbd>Space</kbd>
            </button>
            <div className="tb-items">
              {t.items.map((it) => {
                const I = ITEM_ICONS[it.id]
                const blocked = t.used ? 'One trick per turn' : it.aim === 'rival' || it.aim === 'tile' ? (it.ok === true || it.ok === 'Pick a rival' || it.ok === 'Pick a tile' ? '' : it.ok) : it.ok === true ? '' : it.ok
                return (
                  <button key={it.slot} className={`pp-trick ${blocked ? '' : 'is-ready'} ${aim === it.slot ? 'is-aiming' : ''}`} title={`${it.name}: ${it.desc}`} onClick={() => pickSlot(it.slot)} disabled={!!blocked} data-testid={`tb-item-${it.id}`}>
                    <kbd>{it.slot + 1}</kbd>
                    <I size={20} />
                    <span className="pp-trickname">{it.name}</span>
                    {it.aim === 'leader' && it.leader && <span className="pp-cost">on {it.leader}</span>}
                    {blocked && <span className="pp-why">{blocked}</span>}
                  </button>
                )
              })}
              {t.items.length === 0 && <span className="muted small">Your bag is empty. Shops sell tricks.</span>}
            </div>
            {item && item.aim === 'rival' && (
              <div className="tb-pick">
                <span>{item.name} on…</span>
                {t.rivals.map((r) => (
                  <button key={r.c} className={`btn btn-secondary ${r.grudge ? 'is-grudge' : ''}`} onClick={() => send(`item:${item.slot}:${r.c}`)}>
                    {r.name}
                    {r.grudge && <em> revenge</em>}
                  </button>
                ))}
              </div>
            )}
            {item && item.aim === 'tile' && (
              <div className="tb-pick">
                <span>Set the Mousetrap…</span>
                {t.trapSpots.map((o) => (
                  <button key={o.tile} className="btn btn-secondary" onClick={() => send(`item:${item.slot}:${o.tile}`)}>
                    {o.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        {t.deciding && t.phase === 'fork' && t.fork && (
          <div className="tb-pick">
            <span>Which way?</span>
            {t.fork.map((label, k) => (
              <button key={k} className="btn btn-secondary" onClick={() => send(`fork:${k}`)} data-testid={`tb-fork-${k}`}>
                <kbd>{k + 1}</kbd> {label}
              </button>
            ))}
          </div>
        )}
        {t.deciding && t.phase === 'shop' && me && (
          <div className="tb-shop">
            <h3>
              <ShoppingBag size={16} /> Button Shop <span className="muted small">· you have {me.b} buttons · bag {me.items.length}/{BAG_SLOTS}</span>
            </h3>
            <div className="tb-shelf">
              {ITEM_IDS.map((id) => {
                const I = ITEM_ICONS[id]
                const why = me.items.length >= BAG_SLOTS ? 'Bag full' : me.b < ITEMS[id].price ? 'Too dear' : ''
                return (
                  <button key={id} className={`pp-trick ${why ? '' : 'is-ready'}`} disabled={!!why} title={ITEMS[id].desc} onClick={() => send(`buy:${id}`)} data-testid={`tb-buy-${id}`}>
                    <I size={20} />
                    <span className="pp-trickname">{ITEMS[id].name}</span>
                    <span className="pp-cost">{ITEMS[id].price} buttons</span>
                    {why && <span className="pp-why">{why}</span>}
                  </button>
                )
              })}
            </div>
            <button className="btn btn-primary" onClick={() => send('done')} data-testid="tb-shop-done">
              Done shopping
            </button>
          </div>
        )}
        {t.deciding && t.phase === 'pick' && (
          <div className="tb-pick">
            <span>Duel who?</span>
            {t.rivals.map((r) => (
              <button key={r.c} className="btn btn-secondary" onClick={() => send(`pick:${r.c}`)}>
                {r.name}
                {r.grudge && <em> grudge</em>}
              </button>
            ))}
          </div>
        )}
        {t.deciding && t.phase === 'stake' && t.stake && (
          <div className="tb-pick">
            <span>You won the duel!</span>
            <button className="btn btn-primary" onClick={() => send('stake:buttons')} data-testid="tb-stake-buttons">
              Take {t.stake.amount} buttons from each loser
            </button>
            <button className="btn btn-secondary" disabled={!t.stake.swapWith} onClick={() => send('stake:swap')} data-testid="tb-stake-swap">
              {t.stake.swapWith ? `Swap places with ${t.stake.swapWith}` : 'Nobody ahead to swap with'}
            </button>
          </div>
        )}
        {!t.deciding && t.phase !== 'over' && (
          <p className="tb-watch">
            {t.phase === 'stake' && t.stake ? `${t.stake.winner} is choosing the prize…` : t.myTurn ? '' : `Watching ${t.turn.name}…`}
          </p>
        )}
        <button
          className="btn btn-secondary tb-view"
          onClick={() => {
            setOverview(game.levelState(), !overview)
            setOv(!overview)
          }}
        >
          {overview ? <Eye size={14} /> : <MapIcon size={14} />} {overview ? 'Follow the action' : 'Whole board'}
        </button>
      </div>
    </>
  )
}

/** The board from above: tiles by colour, toys as dots, traps as crosses. */
function MiniMap({ t }: { t: TrailHud }) {
  const statics = useMemo(() => {
    const edges: { a: number; b: number; jump: boolean }[] = []
    for (const tile of TILES) {
      for (const n of tile.next) edges.push({ a: tile.i, b: n, jump: false })
      if (tile.to !== undefined) edges.push({ a: tile.i, b: tile.to, jump: true })
    }
    return edges
  }, [])
  const w = BOUNDS.maxX - BOUNDS.minX, h = BOUNDS.maxZ - BOUNDS.minZ
  // North (the window, +z) is up; x is mirrored so the map matches the camera looking north.
  const X = (x: number) => BOUNDS.maxX - x
  const Y = (z: number) => BOUNDS.maxZ - z
  const counts = new Map<number, number>()
  return (
    <svg className="tb-map" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Board map">
      <rect x={0} y={0} width={w} height={h} rx={1.2} className="tb-map-bg" />
      {statics.map((e, i) => (
        <line key={i} x1={X(TILES[e.a].x)} y1={Y(TILES[e.a].z)} x2={X(TILES[e.b].x)} y2={Y(TILES[e.b].z)} className={e.jump ? 'tb-map-jump' : 'tb-map-edge'} />
      ))}
      {TILES.map((tile) => (
        <rect key={tile.i} x={X(tile.x) - 0.55} y={Y(tile.z) - 0.55} width={1.1} height={1.1} rx={0.25} fill={TILE_INFO[tile.kind].color} opacity={0.9} />
      ))}
      <circle cx={X(JAR.x)} cy={Y(JAR.z) - 1.6} r={1.1} className="tb-map-jar" />
      {t.traps.map(([tile], i) => (
        <text key={i} x={X(TILES[tile].x)} y={Y(TILES[tile].z) + 0.45} className="tb-map-trap">
          ✕
        </text>
      ))}
      {t.players.map((p) => {
        const tile = TILES[p.tile]
        const k = counts.get(p.tile) ?? 0
        counts.set(p.tile, k + 1)
        return <circle key={p.c} cx={X(tile.x) + k * 0.5 - 0.25} cy={Y(tile.z) - 0.2 - k * 0.3} r={p.active ? 0.75 : 0.55} fill={p.tint} className={`tb-map-toy ${p.active ? 'is-active' : ''} ${p.me ? 'is-me' : ''}`} />
      })}
    </svg>
  )
}
