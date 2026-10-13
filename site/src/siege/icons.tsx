// Icons for powers, power-ups and status effects (lucide), shared by the hero sheet, the gear screen and the HUD.
import type { LucideIcon } from 'lucide-react'
import {
  Biohazard,
  BrickWallShield,
  CircleFadingArrowUp,
  Crosshair,
  Eye,
  Flame,
  Footprints,
  Gauge,
  Ghost,
  HeartPlus,
  HeartPulse,
  Magnet,
  RotateCcw,
  ScanEye,
  ShieldCheck,
  ShieldPlus,
  Snail,
  Spline,
  Swords,
  Droplets,
} from 'lucide-react'
import type { PowerKind, PowerUpKind, StatusKind } from './engine/powers'

export const POWER_ICONS: Record<PowerKind, LucideIcon> = {
  wall: BrickWallShield,
  dart: ScanEye,
  vent: Flame,
  blink: Ghost,
  toxin: Biohazard,
  purge: HeartPulse,
}

export const POWERUP_ICONS: Record<PowerUpKind, LucideIcon> = {
  hyper: Gauge,
  overshield: ShieldPlus,
  haste: Footprints,
  amp: Swords,
  reset: RotateCcw,
  ricochet: Spline,
  magnet: Magnet,
  phase: Ghost,
  medkit: HeartPlus,
  revive: CircleFadingArrowUp,
}

export const STATUS_ICONS: Record<StatusKind, LucideIcon> = {
  slow: Snail,
  toxin: Droplets,
  scorch: Flame,
  mark: Crosshair,
  revealed: Eye,
  purged: ShieldCheck,
  hyper: Gauge,
  haste: Footprints,
  amp: Swords,
  ricochet: Spline,
  magnet: Magnet,
  overshield: ShieldPlus,
  phased: Ghost,
  revive: CircleFadingArrowUp,
}
