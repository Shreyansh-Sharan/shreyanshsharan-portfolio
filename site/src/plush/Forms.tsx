// Shared form pieces: your toy (name, kind, tint) and the Show settings. Used by the menu and the Loft.
import { TOY_KINDS, TOY_NAMES, type PlushAssets } from './engine/assets'
import { MAX_SHOW, TINTS, type Profile, type ShowSettings } from './engine/show'
import { SPICE_NAMES } from './engine/types'

const DIFFS = ['Easy', 'Normal', 'Hard'] as const

export function Customise({ profile, assets, onProfile, compact }: { profile: Profile; assets: PlushAssets | null; onProfile: (p: Partial<Profile>) => void; compact?: boolean }) {
  const kinds = assets ? assets.kinds : TOY_KINDS.filter((k) => k !== 'bunny')
  return (
    <div className={`pp-custom ${compact ? 'is-compact' : ''}`}>
      <label className="field">
        <span>Name</span>
        <input value={profile.name} maxLength={16} onChange={(e) => onProfile({ name: e.target.value })} />
      </label>
      <div className="field">
        <span>Toy</span>
        <div className="seg seg-sm">
          {kinds.map((k) => (
            <button key={k} className={`seg-btn ${profile.kind === k ? 'is-active' : ''}`} onClick={() => onProfile({ kind: k })}>
              {TOY_NAMES[k]}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Tint</span>
        <div className="pp-swatches">
          {TINTS.map((c) => (
            <button
              key={c}
              aria-label={c === '#ffffff' ? 'Original colours' : `Tint ${c}`}
              className={`pp-swatch ${profile.tint === c ? 'is-active' : ''}`}
              style={{ background: c === '#ffffff' ? 'conic-gradient(#22d3ee, #f59e0b, #a3e635, #22d3ee)' : c }}
              onClick={() => onProfile({ tint: c })}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

export function SettingsForm({ settings, onChange, readOnly }: { settings: ShowSettings; onChange: (s: ShowSettings) => void; readOnly?: boolean }) {
  return (
    <div className="pp-settings">
      <label className="field">
        <span>Show size: {settings.size} toys</span>
        <input type="range" min={4} max={MAX_SHOW} value={settings.size} disabled={readOnly} onChange={(e) => onChange({ ...settings, size: Number(e.target.value) })} />
      </label>
      <div className="field">
        <span>Rounds</span>
        <div className="seg seg-sm">
          {[3, 4, 5].map((n) => (
            <button key={n} disabled={readOnly} className={`seg-btn ${settings.rounds === n ? 'is-active' : ''}`} onClick={() => onChange({ ...settings, rounds: n })}>
              {n}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Bots</span>
        <div className="seg seg-sm">
          {DIFFS.map((d, i) => (
            <button key={d} disabled={readOnly} className={`seg-btn ${settings.difficulty === i ? 'is-active' : ''}`} onClick={() => onChange({ ...settings, difficulty: i })}>
              {d}
            </button>
          ))}
        </div>
      </div>
      <div className="field">
        <span>Spice</span>
        <div className="seg seg-sm">
          {SPICE_NAMES.map((d, i) => (
            <button key={d} disabled={readOnly} className={`seg-btn ${settings.spice === i ? 'is-active' : ''}`} onClick={() => onChange({ ...settings, spice: i as 0 | 1 | 2 })}>
              {d}
            </button>
          ))}
        </div>
        <span className="muted small">Mild turns off Milk Splash and Plate Swap; Mean makes bots sabotage far more and cooldowns shorter.</span>
      </div>
    </div>
  )
}
