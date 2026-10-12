// Team builder: your own side's name, kit colours and XI (roles, batting hand, bowling style and ratings), saved in
// this browser.
import { useState } from 'react'
import { cloneTeam, customTeams, deleteTeam, newCustomTeam, randomName, ROLE_NAMES, saveTeam, STYLE_NAMES, validateTeam, type Player, type Role, type Team } from '../sim/teams'
import type { BowlStyle } from '../sim/delivery'
import { Rng } from '../sim/vec'

export function TeamBuilder({ onDone }: { onDone: (savedId?: string) => void }) {
  const [list, setList] = useState(customTeams)
  const [team, setTeam] = useState<Team>(() => list[0] ?? newCustomTeam())
  const [saved, setSaved] = useState(false)

  const update = (patch: Partial<Team>) => {
    setTeam((t) => ({ ...t, ...patch }))
    setSaved(false)
  }
  const updatePlayer = (i: number, patch: Partial<Player>) => {
    setTeam((t) => ({ ...t, players: t.players.map((p, k) => (k === i ? { ...p, ...patch } : p)) }))
    setSaved(false)
  }

  const save = () => {
    const t = saveTeam(cloneTeam(team))
    setTeam(cloneTeam(t))
    setList(customTeams())
    setSaved(true)
  }

  return (
    <section className="arena-panel ck-builder">
      <div className="ck-builder-top">
        <label className="field">
          <span>Edit</span>
          <select
            className="cricket-select"
            value={team.id}
            onChange={(e) => {
              const t = list.find((x) => x.id === e.target.value)
              setTeam(t ? cloneTeam(t) : newCustomTeam())
            }}
          >
            {list.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
            <option value="my-new">+ New team</option>
          </select>
        </label>
        <label className="field">
          <span>Team name</span>
          <input value={team.name} maxLength={22} onChange={(e) => update({ name: e.target.value })} />
        </label>
        <label className="field ck-short">
          <span>Short</span>
          <input value={team.short} maxLength={3} onChange={(e) => update({ short: e.target.value.toUpperCase() })} />
        </label>
        <label className="field ck-color">
          <span>Shirt</span>
          <input type="color" value={team.primary} onChange={(e) => update({ primary: e.target.value })} />
        </label>
        <label className="field ck-color">
          <span>Trim</span>
          <input type="color" value={team.secondary} onChange={(e) => update({ secondary: e.target.value })} />
        </label>
        <label className="field ck-color">
          <span>Trousers</span>
          <input type="color" value={team.trousers} onChange={(e) => update({ trousers: e.target.value })} />
        </label>
        <div className="field">
          <span>Kit</span>
          <div className="seg seg-sm">
            {(['coloured', 'whites'] as const).map((k) => (
              <button key={k} className={`seg-btn ${team.kit === k ? 'is-active' : ''}`} onClick={() => update({ kit: k })}>
                {k === 'coloured' ? 'Coloured' : 'Whites'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="ck-xi">
        <table className="ck-xi-table">
          <thead>
            <tr>
              <th>#</th>
              <th>Name</th>
              <th>Role</th>
              <th>Bats</th>
              <th>Bowls</th>
              <th>Bat</th>
              <th>Bowl</th>
              <th>Field</th>
              <th>Pace</th>
              <th>C</th>
              <th>WK</th>
            </tr>
          </thead>
          <tbody>
            {team.players.map((p, i) => (
              <tr key={i}>
                <td>{i + 1}</td>
                <td>
                  <input value={p.name} maxLength={24} onChange={(e) => updatePlayer(i, { name: e.target.value })} aria-label={`Player ${i + 1} name`} />
                </td>
                <td>
                  <select value={p.role} onChange={(e) => updatePlayer(i, { role: e.target.value as Role })} aria-label="Role">
                    {(Object.keys(ROLE_NAMES) as Role[]).map((r) => (
                      <option key={r} value={r}>
                        {ROLE_NAMES[r]}
                      </option>
                    ))}
                  </select>
                </td>
                <td>
                  <button className="ck-mini" onClick={() => updatePlayer(i, { leftBat: !p.leftBat })}>
                    {p.leftBat ? 'Left' : 'Right'}
                  </button>
                </td>
                <td>
                  <select value={p.bowl} onChange={(e) => updatePlayer(i, { bowl: e.target.value as BowlStyle })} aria-label="Bowling style">
                    {(Object.keys(STYLE_NAMES) as BowlStyle[]).map((s) => (
                      <option key={s} value={s}>
                        {STYLE_NAMES[s]}
                      </option>
                    ))}
                  </select>
                  <button className="ck-mini" onClick={() => updatePlayer(i, { leftArm: !p.leftArm })}>
                    {p.leftArm ? 'L' : 'R'}
                  </button>
                </td>
                {(['batting', 'bowling', 'fielding', 'pace'] as const).map((k) => (
                  <td key={k}>
                    <input className="ck-num" type="number" min={1} max={99} value={p[k]} onChange={(e) => updatePlayer(i, { [k]: Number(e.target.value) } as Partial<Player>)} aria-label={k} />
                  </td>
                ))}
                <td>
                  <input type="radio" name="captain" checked={team.captain === i} onChange={() => update({ captain: i })} aria-label="Captain" />
                </td>
                <td>
                  <input type="radio" name="keeper" checked={team.keeper === i} onChange={() => update({ keeper: i })} aria-label="Wicketkeeper" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ck-row ck-row-left">
        <button className="btn btn-primary" onClick={save}>
          {saved ? 'Saved' : 'Save team'}
        </button>
        <button
          className="btn"
          onClick={() => {
            const rng = new Rng(Date.now() & 0xffffff)
            update({ players: team.players.map((p) => ({ ...p, name: randomName(rng) })) })
          }}
        >
          Random names
        </button>
        {team.id.startsWith('my-') && team.id !== 'my-new' && (
          <button
            className="btn"
            onClick={() => {
              deleteTeam(team.id)
              const l = customTeams()
              setList(l)
              setTeam(l[0] ?? newCustomTeam())
            }}
          >
            Delete
          </button>
        )}
        <button className="btn" onClick={() => onDone(saved ? team.id : undefined)}>
          Done
        </button>
      </div>
      <p className="muted small">
        Ratings run 1–99. The game makes sure there's a keeper and at least five bowlers ({validateTeam(cloneTeam(team)).players.filter((p) => p.role === 'bowler' || p.role === 'allrounder' || p.bowling >= 45).length} can bowl now).
      </p>
    </section>
  )
}
