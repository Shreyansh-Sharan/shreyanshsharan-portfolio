import type { JSX } from 'react'
import { Avatar, Bars, Bottle, Cap, Crates, Crosshair, Cup, Flag, Flask, Graph, Knot, Layers, Pages, Tower, type EmblemProps } from './Emblems'

export const EMBLEMS: Record<string, (p: EmblemProps) => JSX.Element> = {
  'omni-studio': Layers,
  'diageo-devops': Bottle,
  'architect-mode': Tower,
  'lakehouse-logistics': Crates,
  'qlik-legends': Bars,
  'wipro-origins': Flask,
  'nit-academy': Cap,
  trophies: Cup,
  'skill-tree': Graph,
  profile: Avatar,
  resume: Pages,
  'sports-complex': Flag,
  arena: Crosshair,
  boot: Knot,
}
