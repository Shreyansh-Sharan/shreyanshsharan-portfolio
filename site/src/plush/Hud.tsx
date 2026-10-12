// The in-game overlay for PLUSH PANIC: round info and timer, intro cards, countdown, the trick bar with costs
// and cooldowns, grudge and target, the peanut gallery's throwables, the Loft panel, round-end and results
// screens, and touch controls. Name tags and floating text are drawn by the engine directly (no React churn).
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  ArrowLeftRight, ChevronLeft, ChevronRight, Cookie, Copy, Crown, Feather, Hand, Heart, HeartCrack, Key, LogOut, Magnet, Milk, PawPrint, Pin, Settings2,
  Shield, Shirt, Skull, Sparkles, Star, Swords, Zap,
} from 'lucide-react'
import type { Game, Hud } from './engine/game'
import type { PlushAssets } from './engine/assets'
import type { Profile, ProfilePatch } from './engine/show'
import type { TrickIcon } from './engine/types'
import { quickPlayLevels } from './levels'
import { SettingsForm } from './Forms'
import { TrailIntro, TrailPanel } from './board/TrailPanel'
import { claimClaw } from './levels/loft/records'
import { clawPrize, RARITY_NAMES } from './wardrobe/catalog'
import { earnedChallenges, emotesOwned, ownedSet } from './wardrobe/store'
import { Wardrobe } from './wardrobe/Wardrobe'

const ICONS: Record<TrickIcon, typeof Cookie> = {
  crumb: Cookie, slam: Hand, milk: Milk, paw: PawPrint, crack: Zap, swap: ArrowLeftRight, bubble: Shield, tickle: Feather, key: Key, tack: Pin, magnet: Magnet, zap: Zap, star: Star,
}

const AWARD_ICONS = { crown: Crown, menace: Skull, betrayed: HeartCrack, revenge: Swords, saint: Heart }

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`

const TYPE_NAMES: Record<string, string> = { race: 'Race', survival: 'Survival', team: 'Team', logic: 'Logic', final: 'Final', hidden: 'Loft secret', hub: 'Hub' }

/** Buttons a Loft game pays out when it finishes. */
const LOFT_PAY: Record<string, (v: number) => number> = { freeze: (v) => Math.floor(v / 2), vine: (v) => Math.floor(v / 4), bowl: (v) => Math.floor(v / 10) }

export function PlushHud(p: { hud: Hud; game: Game; profile: Profile; assets: PlushAssets | null; onProfile: (p: ProfilePatch) => void; onQuit: () => void }) {
  const { hud, game, onProfile } = p
  const playing = hud.phase === 'play'
  const [toasts, setToasts] = useState<{ id: number; text: string }[]>([])
  const profileRef = useRef(p.profile)
  useEffect(() => {
    profileRef.current = p.profile
  })
  const toast = (text: string) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t.slice(-2), { id, text }])
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4200)
  }
  // Loft games report here (on this player's screen only): buttons for a finished game, claw prizes.
  useEffect(() => {
    game.onSignal = (name) => {
      if (name.startsWith('loft-score:')) {
        const [, g, v, fin] = name.split(':')
        const pay = fin === '1' ? Math.min(30, LOFT_PAY[g]?.(Number(v)) ?? 0) : 0
        if (pay > 0) {
          onProfile((prev) => ({ buttons: prev.buttons + pay }))
          toast(`+${pay} buttons`)
        }
      } else if (name.startsWith('loft-claw:')) {
        const seed = Number(name.split(':')[1]) || 1
        if (!claimClaw()) {
          toast("Today's prize is already claimed. Come back tomorrow!")
          return
        }
        let x = seed
        const rand = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648)
        const prize = clawPrize(ownedSet(profileRef.current), rand)
        if (!prize) {
          onProfile((prev) => ({ buttons: prev.buttons + 50 }))
          toast('You own everything! +50 buttons instead')
          return
        }
        onProfile((prev) => ({ owned: [...new Set([...(prev.owned ?? []), prize.id])] }))
        toast(`Button Claw prize: ${prize.name} (${RARITY_NAMES[prize.rarity]})!`)
      }
    }
    return () => {
      game.onSignal = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [game])
  // Challenge pieces unlock themselves once their goal is met.
  const earned = earnedChallenges(p.profile)
  const earnedKey = earned.map((i) => i.id).join()
  useEffect(() => {
    if (!earned.length) return
    onProfile((prev) => ({ owned: [...new Set([...(prev.owned ?? []), ...earned.map((i) => i.id)])] }))
    for (const it of earned) toast(`Unlocked: ${it.name}!`)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [earnedKey])
  return (
    <div className={`pp-hud ${hud.pointer === 'free' ? 'is-free' : ''}`}>
      {toasts.length > 0 && (
        <div className="pp-toasts">
          {toasts.map((t) => (
            <div key={t.id} className="pp-toast">
              {t.text}
            </div>
          ))}
        </div>
      )}
      <div className="pp-topbar">
        <button className="btn pp-leave" onClick={p.onQuit}>
          <LogOut size={16} /> Leave
        </button>
        {hud.phase !== 'loft' && hud.level && hud.mode !== 'board' && (
          <div className="pp-roundinfo" style={{ ['--pp-accent' as string]: hud.level.accent }}>
            <span className="pp-roundname">
              {hud.duel ? (hud.duel.party ? 'Table mini-game' : 'Duel') : hud.mode === 'quick' ? 'Quick Play' : hud.round.final ? 'Final' : `Round ${hud.round.index + 1} of ${hud.round.total}`} · {hud.level.name}
            </span>
            <strong className={`pp-timer ${playing && hud.timeLeft < 15 ? 'is-low' : ''}`}>{fmt(hud.timeLeft)}</strong>
            {hud.mode === 'show' && !hud.teams && (
              <span className="pp-count">
                {hud.round.final ? 'One wins the crown' : `${hud.qualified}/${hud.target} through · ${hud.active} still in`}
              </span>
            )}
            {hud.teams && <TeamScores hud={hud} />}
          </div>
        )}
        <ul className="pp-feed">
          {hud.feed.map((f) => (
            <li key={f.id}>{f.text}</li>
          ))}
        </ul>
      </div>

      {hud.banner && (
        <div key={hud.banner.id} className="pp-banner" style={{ color: hud.banner.color }}>
          {hud.banner.text}
        </div>
      )}
      {hud.phase === 'countdown' && hud.countdown > 0 && (
        <div key={hud.countdown} className="pp-countdown">
          {hud.countdown}
        </div>
      )}

      {hud.phase === 'intro' && hud.level && (hud.mode === 'board' ? <TrailIntro /> : <IntroCard hud={hud} />)}
      {hud.phase === 'end' && hud.roundEnd && <RoundEnd hud={hud} />}
      {hud.phase === 'results' && hud.results && <Results hud={hud} game={game} onQuit={p.onQuit} />}
      {hud.phase === 'loft' && <LoftPanel hud={hud} game={game} profile={p.profile} assets={p.assets} onProfile={p.onProfile} />}

      {(playing || hud.phase === 'countdown') && hud.mode !== 'board' && <PlayHud hud={hud} game={game} />}
      {hud.mode === 'board' && hud.phase !== 'results' && hud.phase !== 'intro' && <TrailPanel hud={hud} game={game} />}
      {hud.touch && hud.phase !== 'results' && <TouchControls hud={hud} game={game} />}
      {!hud.touch && hud.pointer === 'look' && !hud.locked && (playing || hud.phase === 'loft') && <div className="pp-lockhint">Click to look around with the mouse</div>}
    </div>
  )
}

/** Team levels: both scores side by side, your team marked. */
function TeamScores({ hud }: { hud: Hud }) {
  const t = hud.teams!
  return (
    <div className="pp-teams" data-testid="pp-teams">
      {t.map((x, i) => (
        <span key={x.name} className={`pp-team ${x.mine ? 'is-mine' : ''} ${x.won ? 'is-won' : ''}`} style={{ ['--pp-team' as string]: x.color, order: i * 2 }}>
          <i />
          {x.name}
          <b>{Math.round(x.score)}</b>
        </span>
      ))}
      <span className="pp-teamvs" style={{ order: 1 }}>
        {hud.teamScoreName}
      </span>
    </div>
  )
}

function IntroCard({ hud }: { hud: Hud }) {
  const l = hud.level!
  const myTeam = hud.teams && hud.me.team >= 0 ? hud.teams[hud.me.team] : null
  return (
    <div className="pp-card pp-intro" style={{ ['--pp-accent' as string]: l.accent }}>
      <p className="pp-kicker">
        {hud.duel
          ? hud.duel.party
            ? `Table mini-game · ${hud.duel.seconds} s · bonus buttons by placing`
            : `Duel · ${hud.duel.names.join(' vs ')} · ${hud.duel.seconds} s`
          : hud.mode === 'quick'
            ? 'Quick Play'
            : hud.round.final
              ? 'The Final'
              : `Round ${hud.round.index + 1} of ${hud.round.total}`}{' '}
        · {TYPE_NAMES[l.type] ?? l.type}
      </p>
      <h2>{l.name}</h2>
      <p className="pp-blurb">{l.blurb}</p>
      <ul className="pp-howto">
        {l.howTo.map((h) => (
          <li key={h}>{h}</li>
        ))}
      </ul>
      {myTeam && (
        <p className="pp-myteam" style={{ ['--pp-team' as string]: myTeam.color }}>
          You are on <strong>Team {myTeam.name}</strong>
        </p>
      )}
      {hud.mode === 'show' && (
        <p className="pp-goal">{hud.teams ? 'The winning team goes through. The losing team is out.' : hud.round.final ? 'One toy takes the crown.' : `${hud.target} of ${hud.field} go through.`}</p>
      )}
      {l.tricks.length > 0 && (
        <div className="pp-tricklist">
          {l.tricks.map((t) => {
            const I = ICONS[t.icon] ?? Sparkles
            return (
              <div key={t.name} className="pp-trickrow">
                <I size={16} />
                <strong>{t.name}</strong>
                <span className="pp-cost">{t.cost} ✦</span>
                <span className="muted small">{t.desc}</span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function RoundEnd({ hud }: { hud: Hud }) {
  const r = hud.roundEnd!
  return (
    <div className="pp-card pp-roundend">
      <h2>{hud.round.final ? 'And the crown goes to…' : r.team ? <span style={{ color: r.team.color }}>Team {r.team.name} wins!</span> : 'Round over'}</h2>
      <div className="pp-cols">
        <div>
          <h3 className="pp-through">Through</h3>
          <ul>
            {r.through.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
        <div>
          <h3 className="pp-out">Out</h3>
          <ul>
            {r.out.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  )
}

function Results({ hud, game, onQuit }: { hud: Hud; game: Game; onQuit: () => void }) {
  const res = hud.results!
  const me = hud.roster.find((r) => r.me)
  const winner = res.rows[0]
  const mine = me ? (res.buttons[me.idx] ?? 0) : 0
  const lvl = quickPlayLevels().find((l) => l.name === res.levelName)
  return (
    <div className="pp-card pp-results" data-testid="pp-results">
      <p className="pp-kicker">{res.title ?? (res.quick ? `Quick Play · ${res.levelName}` : 'Show results')}</p>
      <h2>
        <Crown size={26} color="#facc15" /> {winner ? (me && winner.idx === me.idx ? 'You win!' : `${winner.name} wins!`) : 'Show over'}
      </h2>
      {res.awards.length > 0 && (
        <div className="pp-awards">
          {res.awards.map((a) => {
            const I = AWARD_ICONS[a.id] ?? Star
            const who = res.rows.find((r) => r.idx === a.who)
            return (
              <div key={a.id} className="pp-award">
                <I size={20} />
                <strong>{a.title}</strong>
                <span>{who?.name ?? '?'}</span>
                <span className="muted small">
                  {a.blurb} · +{a.buttons} buttons
                </span>
              </div>
            )
          })}
        </div>
      )}
      <ol className="pp-placings">
        {res.rows.map((r) => (
          <li key={r.idx} className={me && r.idx === me.idx ? 'is-me' : ''}>
            <i style={{ background: r.tint === '#ffffff' ? '#fde68a' : r.tint }} />
            <span>{r.name}</span>
            <span className="muted small">
              {r.place === 1 ? (res.quick ? 'first' : 'crowned') : r.outRound >= 0 && !res.quick ? `out in round ${r.outRound + 1}` : `#${r.place}`} · {r.stats.menace} sabotage
            </span>
            <b>+{res.buttons[r.idx] ?? 0}</b>
          </li>
        ))}
      </ol>
      <p className="pp-earned">
        <Sparkles size={16} /> You earned {mine} buttons
      </p>
      <div className="pp-actions">
        {hud.role !== 'client' ? (
          <>
            {res.quick && lvl && (
              <button className="btn btn-primary" onClick={() => game.startQuick(lvl.id)}>
                Play again
              </button>
            )}
            {res.title && (
              <button className="btn btn-primary" onClick={() => game.startBoard()} data-testid="tb-again">
                Play again
              </button>
            )}
            <button className={`btn ${res.quick || res.title ? '' : 'btn-primary'}`} onClick={() => game.toLoft()}>
              Back to the Loft
            </button>
          </>
        ) : (
          <span className="muted small">Waiting for the host to head back to the Loft…</span>
        )}
        <button className="btn" onClick={onQuit}>
          Leave
        </button>
      </div>
    </div>
  )
}

function LoftPanel(p: { hud: Hud; game: Game; profile: Profile; assets: PlushAssets | null; onProfile: (p: ProfilePatch) => void }) {
  const { hud, game } = p
  const [open, setOpen] = useState<null | 'custom' | 'settings' | 'quick'>(null)
  const [copied, setCopied] = useState(false)
  const lastZone = useRef<string | null>(null)
  const auto = useRef(false)
  useEffect(() => {
    // Stepping onto the tape-measure podium opens the wardrobe (and stepping off closes it again).
    if (hud.zone === 'sewing' && lastZone.current !== 'sewing') {
      setOpen('custom')
      auto.current = true
    } else if (hud.zone !== 'sewing' && lastZone.current === 'sewing' && auto.current) {
      setOpen((o) => (o === 'custom' ? null : o))
      auto.current = false
    }
    lastZone.current = hud.zone
  }, [hud.zone])
  const lh = hud.levelHud
  const emotes = emotesOwned(p.profile)
  const host = hud.role !== 'client'
  const people = hud.roster.filter((r) => r.human)
  return (
    <>
      <div className="pp-loft">
        <h2>The Loft</h2>
        {hud.online && (
          <div className="pp-room">
            <span className="muted small">Room code</span>
            <strong data-testid="pp-room-code">{hud.online.code}</strong>
            <button
              className="btn btn-secondary"
              onClick={() => {
                void navigator.clipboard?.writeText(hud.online!.code).then(() => setCopied(true))
              }}
            >
              <Copy size={14} /> {copied ? 'Copied' : 'Copy'}
            </button>
            <span className="muted small">
              {people.length} {people.length === 1 ? 'person' : 'people'}: {people.map((x) => x.name).join(', ')}
            </span>
          </div>
        )}
        <div className="pp-loftbtns">
          {host && (
            <button className="btn btn-primary" onClick={() => game.startShow()}>
              <Crown size={16} /> Start the Show
            </button>
          )}
          {host && (
            <button className="btn" onClick={() => setOpen(open === 'quick' ? null : 'quick')}>
              <Zap size={16} /> Quick Play
            </button>
          )}
          {host && (
            <button className="btn" onClick={() => game.startBoard()} data-testid="pp-board">
              <Cookie size={16} /> Toy Box Trail
            </button>
          )}
          <button className="btn" onClick={() => setOpen(open === 'custom' ? null : 'custom')}>
            <Shirt size={16} /> Customise
          </button>
          {host && (
            <button className="btn" onClick={() => setOpen(open === 'settings' ? null : 'settings')}>
              <Settings2 size={16} /> Settings
            </button>
          )}
        </div>
        <div className="pp-emotes">
          {emotes.map((e, i) => (
            <button key={e} className="btn btn-secondary" onClick={() => game.emote(e)}>
              <kbd>{i + 1}</kbd> {EMOTE_NAMES[e] ?? e}
            </button>
          ))}
        </div>
        {!host && <p className="muted small">The host starts the Show. Jump in the toy chest to show you're ready.</p>}
      </div>
      {open === 'custom' && <Wardrobe profile={p.profile} assets={p.assets} game={game} onProfile={p.onProfile} onClose={() => setOpen(null)} />}
      {lh && (
        <div className="pp-loftgame">
          {lh.status && (
            <div className={`pp-status ${lh.status.pulse ? 'is-pulse' : ''}`} style={{ color: lh.status.color, borderColor: lh.status.color }}>
              {lh.status.text}
            </div>
          )}
          {lh.chips && lh.chips.length > 0 && (
            <div className="pp-chips">
              {lh.chips.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </div>
          )}
          {lh.bars && lh.bars.length > 0 && (
            <div className="pp-left">
              {lh.bars.map((b) => (
                <div key={b.label} className={`pp-bar ${b.danger ? 'is-danger' : ''}`}>
                  <span>{b.label}</span>
                  <i>
                    <b style={{ width: `${Math.round(b.value * 100)}%`, background: b.color }} />
                  </i>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {open && open !== 'custom' && (
        <div className="pp-drawer">
          {open === 'settings' && (
            <>
              <h3>Show settings</h3>
              <SettingsForm settings={p.profile.settings} onChange={(s) => p.onProfile({ settings: s })} />
            </>
          )}
          {open === 'quick' && (
            <>
              <h3>Quick Play</h3>
              {quickPlayLevels().map((l) => (
                <button key={l.id} className="pp-levelcard" style={{ ['--pp-accent' as string]: l.accent }} onClick={() => game.startQuick(l.id)}>
                  <strong>{l.name}</strong>
                  <span className="muted small">{l.blurb}</span>
                </button>
              ))}
            </>
          )}
          <button className="btn" onClick={() => setOpen(null)}>
            Close
          </button>
        </div>
      )}
      <div className="pp-prompt is-loft">
        {lh?.prompt
          ? lh.prompt
          : hud.zone === 'chest'
            ? host
              ? 'Climb the blocks and jump into the toy chest to start the Show! Hop on the board-game box beside it for Toy Box Trail.'
              : 'Jump in the toy chest to show you are ready.'
            : hud.zone === 'sewing'
              ? 'The Sewing Table: dress up from ten trait slots. Your toy turns on the tape measure.'
              : hud.zone
                ? ZONE_HINTS[hud.zone] ?? zoneName(hud.zone)
                : hud.touch
                  ? 'Stick to walk · Jump · Dive · Grab (hold) · Shove'
                  : `WASD to walk · Space jump · Shift dive · E grab · click to shove · 1–${emotes.length} emotes`}
      </div>
    </>
  )
}

const EMOTE_NAMES: Record<string, string> = { wave: 'Wave', dance: 'Dance', stomp: 'Stomp', spin: 'Twirl', flip: 'Backflip', boogie: 'Disco Fever' }

const ZONE_HINTS: Record<string, string> = {
  disco: 'Disco Closet: step onto the light-up floor for Freeze Dance. Climb the shoebox to the coat-hanger balcony.',
  jungle: 'Houseplant Jungle: stand on the pot by the hoop and press R (Act) for Vine Swing.',
  beach: 'Bathtub Beach: Bath Bomb Bowling starts at the end of the bath mat. Press R (Act) there.',
  arcade: 'Cardboard Arcade: press R (Act) at the claw machine for Button Claw. One prize a day!',
}

function zoneName(z: string) {
  return ({ disco: 'Disco Closet', jungle: 'Houseplant Jungle', beach: 'Bathtub Beach', arcade: 'Cardboard Arcade' } as Record<string, string>)[z] ?? z
}

function PlayHud({ hud, game }: { hud: Hud; game: Game }) {
  const lh = hud.levelHud
  const res = hud.level?.resource ?? 'Sprinkles'
  return (
    <>
      {lh?.status && (
        <div className={`pp-status ${lh.status.pulse ? 'is-pulse' : ''}`} style={{ color: lh.status.color, borderColor: lh.status.color }}>
          {lh.status.text}
        </div>
      )}
      {lh?.chips && lh.chips.length > 0 && (
        <div className="pp-chips">
          {lh.chips.map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      )}
      {lh?.prompt && <div className="pp-prompt">{lh.prompt}</div>}

      <div className="pp-left">
        {lh?.bars?.map((b) => (
          <div key={b.label} className={`pp-bar ${b.danger ? 'is-danger' : ''}`}>
            <span>{b.label}</span>
            <i>
              <b style={{ width: `${Math.round(b.value * 100)}%`, background: b.color }} />
            </i>
          </div>
        ))}
        {hud.me.status === 'play' && (
          <div className="pp-wallet-hud" title={res}>
            <Sparkles size={18} /> <strong>{hud.me.sprinkles}</strong> <span>{res}</span>
          </div>
        )}
        {hud.me.grudge && (
          <div className="pp-grudge">
            <span className="pp-stitch">✕</span> Grudge: {hud.me.grudge} <em>revenge is half price</em>
          </div>
        )}
        {hud.me.bubble && (
          <div className="pp-bubble">
            <Shield size={14} /> Bubble Wrap on
          </div>
        )}
      </div>

      {hud.tricks.length > 0 && (
        <div className="pp-tricks">
          <div className="pp-aim">
            {hud.aim ? (
              <>
                Target: <strong>{hud.aim.name}</strong>
                {hud.aim.grudge && <em> · revenge, half price</em>}
              </>
            ) : (
              <span className="muted">{hud.pointer === 'free' ? 'Click a rival plate to pick a target' : 'Aim at a rival, or Tab to pick one'}</span>
            )}
          </div>
          <div className="pp-trickbar">
            {hud.tricks.map((t) => {
              const I = ICONS[t.icon] ?? Sparkles
              return (
                <button
                  key={t.id}
                  className={`pp-trick ${t.ready ? 'is-ready' : ''} ${t.revenge ? 'is-revenge' : ''}`}
                  title={`${t.name}: ${t.desc}\nCounter: ${t.counter}`}
                  onClick={() => game.useTrick(t.id)}
                  data-testid={`trick-${t.id}`}
                >
                  <kbd>{t.key}</kbd>
                  <I size={20} />
                  <span className="pp-trickname">{t.name}</span>
                  <span className="pp-cost">
                    {t.revenge && t.price !== t.cost && <s>{t.cost}</s>} {t.price} ✦
                  </span>
                  {t.cd > 0 && <span className="pp-cd" style={{ height: `${Math.min(100, (t.cd / Math.max(0.1, t.cooldown)) * 100)}%` }} />}
                  {!t.ready && t.reason && <span className="pp-why">{t.reason}</span>}
                </button>
              )
            })}
          </div>
        </div>
      )}

      {hud.me.status === 'gallery' && (
        <div className="pp-gallery">
          <div className="pp-spec">
            <button className="btn btn-secondary" aria-label="Previous toy" onClick={() => game.spectateNext(-1)}>
              <ChevronLeft size={16} />
            </button>
            <span>
              Peanut gallery · watching <strong>{hud.spectating ?? '…'}</strong>
            </span>
            <button className="btn btn-secondary" aria-label="Next toy" onClick={() => game.spectateNext(1)}>
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="pp-trickbar">
            {hud.ammo.map((a, i) => (
              <button key={a.kind} className={`pp-trick ${a.ready ? 'is-ready' : ''}`} title={a.desc} onClick={() => game.throwAt(a.kind)} data-testid={`throw-${a.kind}`}>
                <kbd>{i + 1}</kbd>
                {a.kind === 'feather' ? <Feather size={20} /> : a.kind === 'crumb' ? <Cookie size={20} /> : <Sparkles size={20} />}
                <span className="pp-trickname">{a.name}</span>
                <span className="pp-cost">×{a.n}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      {hud.me.status === 'qualified' && hud.mode === 'show' && <div className="pp-through-badge">Through! Watching the others…</div>}
    </>
  )
}

function TouchControls({ hud, game }: { hud: Hud; game: Game }) {
  const stick = useRef<HTMLDivElement>(null)
  const knob = useRef<HTMLDivElement>(null)
  const id = useRef<number | null>(null)
  const move = (e: React.PointerEvent) => {
    const el = stick.current
    if (!el || id.current !== e.pointerId) return
    const r = el.getBoundingClientRect()
    let x = (e.clientX - (r.left + r.width / 2)) / (r.width / 2)
    let y = (e.clientY - (r.top + r.height / 2)) / (r.height / 2)
    const l = Math.hypot(x, y)
    if (l > 1) {
      x /= l
      y /= l
    }
    game.input.touchMove(x, -y)
    if (knob.current) knob.current.style.transform = `translate(${x * 34}px, ${y * 34}px)`
  }
  const end = () => {
    id.current = null
    game.input.touchMove(0, 0)
    if (knob.current) knob.current.style.transform = ''
  }
  const btn = (name: string, label: ReactNode, cls = '') => (
    <button
      className={`pp-tbtn ${cls}`}
      onPointerDown={(e) => {
        e.preventDefault()
        game.input.touchButton(name, true)
      }}
      onPointerUp={() => game.input.touchButton(name, false)}
      onPointerLeave={() => game.input.touchButton(name, false)}
      onPointerCancel={() => game.input.touchButton(name, false)}
    >
      {label}
    </button>
  )
  if (hud.pointer === 'free') return null
  return (
    <div className="pp-touch">
      <div
        ref={stick}
        className="pp-stick"
        onPointerDown={(e) => {
          id.current = e.pointerId
          ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
          move(e)
        }}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      >
        <div ref={knob} className="pp-knob" />
      </div>
      <div className="pp-tbtns">
        {btn('jump', 'Jump', 'is-big')}
        {btn('dive', 'Dive')}
        {btn('grab', 'Grab')}
        {btn('shove', 'Shove')}
        {btn('act', 'Act')}
      </div>
    </div>
  )
}
