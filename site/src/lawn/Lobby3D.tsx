// A slot for the lobby's shared 3D canvas: shows `fallback` (the portrait, the sketch or a pre-rendered image)
// until the stage has drawn its first frame here, then fades the live view in over it.
import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { HeroSpec, HouseSpec, LobbyStage } from './view/lobby'

type Props = { stage: LobbyStage | null; fallback: ReactNode; className?: string; testId?: string } & ({ mode: 'house'; spec: HouseSpec } | { mode: 'hero'; spec: HeroSpec })

export function Lobby3D(p: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [ready, setReady] = useState(false)
  const { stage, mode } = p
  const key = JSON.stringify(p.spec)
  useEffect(() => {
    if (!stage) return
    const spec = JSON.parse(key)
    if (mode === 'house') stage.setHouse(spec as HouseSpec)
    else stage.setHero(spec as HeroSpec)
  }, [stage, mode, key])
  useEffect(() => {
    const el = host.current
    if (!stage || !el) return
    stage.attach(el, mode, () => setReady(true))
    return () => {
      stage.detach(el)
      setReady(false)
    }
  }, [stage, mode])
  return (
    <div className={`lw-3d ${p.className ?? ''} ${ready ? 'is-live' : ''}`} data-testid={p.testId}>
      <div className="lw-3dfallback" aria-hidden={ready}>
        {p.fallback}
      </div>
      <div ref={host} className="lw-3dhost" />
      {ready && <span className="lw-3dhint">Drag to turn</span>}
    </div>
  )
}
