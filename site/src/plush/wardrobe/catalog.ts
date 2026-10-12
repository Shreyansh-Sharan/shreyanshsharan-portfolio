// The Sewing Table's wardrobe: ten trait slots, every item with its rarity and how it is unlocked. Pure data (no
// three.js), shared by the page (the wardrobe drawer), the engine (dressing toys) and the Loft (claw prizes).

export const WSLOTS = ['fabric', 'colour', 'eyes', 'mouth', 'hat', 'face', 'back', 'hand', 'feet', 'flair'] as const
export type WSlot = (typeof WSLOTS)[number]

export const SLOT_NAMES: Record<WSlot, string> = {
  fabric: 'Fabric', colour: 'Colour', eyes: 'Eyes', mouth: 'Mouth', hat: 'Hat', face: 'Face', back: 'Back', hand: 'Hand', feet: 'Feet', flair: 'Flair',
}

export const RARITIES = ['common', 'stitched', 'embroidered', 'golden'] as const
export type Rarity = (typeof RARITIES)[number]
export const RARITY_NAMES: Record<Rarity, string> = { common: 'Common', stitched: 'Stitched', embroidered: 'Embroidered', golden: 'Golden Thread' }
export const RARITY_COLORS: Record<Rarity, string> = { common: '#cbd5e1', stitched: '#60a5fa', embroidered: '#c084fc', golden: '#facc15' }

/** What a toy is wearing: an item id per slot (missing = the toy's own look). */
export type Outfit = Partial<Record<WSlot, string>>

/** Local stats the challenge unlocks look at (from the saved profile and the Loft records). */
export interface ChallengeStats {
  shows: number
  wins: number
  menace: number
  freezeBest: number
  vineBest: number
  bowlBest: number
  clawWins: number
}

export interface Item {
  id: string
  slot: WSlot
  name: string
  rarity: Rarity
  /** How you get it: free from the start, bought with buttons, only from the claw machine, or a challenge. */
  how: 'free' | 'shop' | 'claw' | 'challenge'
  price?: number
  /** Challenge text and test. */
  goal?: string
  test?: (s: ChallengeStats) => boolean
  /** Flair items that are emotes rather than trails (owning one adds it to the emote keys). */
  emote?: 'spin' | 'flip' | 'boogie'
  /** Swatch colour for the drawer. */
  swatch?: string
}

const I = (id: string, slot: WSlot, name: string, rarity: Rarity, how: Item['how'], extra: Partial<Item> = {}): Item => ({ id, slot, name, rarity, how, ...extra })

export const ITEMS: Item[] = [
  // Fabric: a pattern over the knit, drawn in the stitch colour.
  I('fab-plain', 'fabric', 'Plain Knit', 'common', 'free', { swatch: '#e7d8c9' }),
  I('fab-stripes', 'fabric', 'Deckchair Stripes', 'common', 'shop', { price: 40, swatch: 'repeating-linear-gradient(0deg,#f87171 0 6px,#fff7e6 6px 12px)' }),
  I('fab-polka', 'fabric', 'Polka Dots', 'common', 'shop', { price: 40, swatch: 'radial-gradient(circle at 30% 30%,#fff7e6 22%,transparent 24%) 0 0/12px 12px,#60a5fa' }),
  I('fab-felt', 'fabric', 'Fuzzy Felt', 'common', 'shop', { price: 30, swatch: '#a78b6d' }),
  I('fab-corduroy', 'fabric', 'Corduroy', 'stitched', 'shop', { price: 80, swatch: 'repeating-linear-gradient(90deg,#b45309 0 3px,#92400e 3px 5px)' }),
  I('fab-denim', 'fabric', 'Patched Denim', 'stitched', 'claw', { swatch: 'repeating-linear-gradient(45deg,#1e40af 0 2px,#3b82f6 2px 4px)' }),
  I('fab-tartan', 'fabric', 'Picnic Tartan', 'embroidered', 'shop', { price: 160, swatch: 'repeating-linear-gradient(0deg,rgba(220,38,38,.6) 0 5px,transparent 5px 14px),repeating-linear-gradient(90deg,rgba(22,101,52,.7) 0 5px,#fde68a 5px 14px)' }),
  I('fab-velvet', 'fabric', 'Midnight Velvet', 'embroidered', 'claw', { swatch: 'radial-gradient(circle at 40% 30%,#c084fc,#4c1d95)' }),
  I('fab-glitter', 'fabric', 'Disco Glitter', 'golden', 'challenge', { goal: 'Freeze Dance: 12 clean stops in a row', test: (s) => s.freezeBest >= 12, swatch: 'radial-gradient(circle,#fff 10%,transparent 12%) 0 0/7px 7px,linear-gradient(135deg,#f472b6,#facc15,#22d3ee)' }),

  // Colour: the stitch / accent colour (patterns, capes, pom-poms and other trim).
  I('col-cream', 'colour', 'Cream Thread', 'common', 'free', { swatch: '#fff7e6' }),
  I('col-cherry', 'colour', 'Cherry Thread', 'common', 'shop', { price: 20, swatch: '#ef4444' }),
  I('col-sky', 'colour', 'Sky Thread', 'common', 'shop', { price: 20, swatch: '#38bdf8' }),
  I('col-mint', 'colour', 'Mint Thread', 'common', 'shop', { price: 20, swatch: '#34d399' }),
  I('col-lemon', 'colour', 'Lemon Thread', 'common', 'shop', { price: 25, swatch: '#fde047' }),
  I('col-plum', 'colour', 'Plum Thread', 'stitched', 'shop', { price: 60, swatch: '#a855f7' }),
  I('col-ink', 'colour', 'Ink Thread', 'stitched', 'claw', { swatch: '#1e293b' }),
  I('col-rainbow', 'colour', 'Rainbow Thread', 'embroidered', 'shop', { price: 150, swatch: 'linear-gradient(90deg,#ef4444,#f59e0b,#22c55e,#3b82f6,#a855f7)' }),
  I('col-gold', 'colour', 'Golden Thread', 'golden', 'challenge', { goal: 'Bath Bomb Bowling: score 120', test: (s) => s.bowlBest >= 120, swatch: 'linear-gradient(135deg,#fde68a,#d97706,#fef3c7)' }),

  // Eyes: small pieces over the toy's own button eyes.
  I('eye-button', 'eyes', 'Button Eyes', 'common', 'free', { swatch: '#3f2a1d' }),
  I('eye-googly', 'eyes', 'Googly Eyes', 'common', 'shop', { price: 50, swatch: 'radial-gradient(circle at 60% 60%,#111 30%,#fff 32%)' }),
  I('eye-sleepy', 'eyes', 'Sleepy Lids', 'common', 'shop', { price: 40, swatch: 'linear-gradient(180deg,#a8a29e 50%,#fff 50%)' }),
  I('eye-star', 'eyes', 'Star Eyes', 'stitched', 'claw', { swatch: '#facc15' }),
  I('eye-heart', 'eyes', 'Heart Eyes', 'stitched', 'shop', { price: 90, swatch: '#f43f5e' }),
  I('eye-monocle', 'eyes', 'Gold Monocle', 'embroidered', 'shop', { price: 150, swatch: 'radial-gradient(circle,transparent 50%,#d4a017 52%)' }),

  // Mouth.
  I('mouth-stitch', 'mouth', 'Stitched Smile', 'common', 'free', { swatch: '#3f2a1d' }),
  I('mouth-grin', 'mouth', 'Big Stitch Grin', 'common', 'shop', { price: 30, swatch: '#7c2d12' }),
  I('mouth-fangs', 'mouth', 'Felt Fangs', 'common', 'shop', { price: 40, swatch: '#f8fafc' }),
  I('mouth-tongue', 'mouth', 'Tongue Out', 'common', 'claw', { swatch: '#fb7185' }),
  I('mouth-whistle', 'mouth', 'Lifeguard Whistle', 'stitched', 'shop', { price: 70, swatch: '#facc15' }),

  // Hats.
  I('hat-none', 'hat', 'No Hat', 'common', 'free', { swatch: 'transparent' }),
  I('hat-party', 'hat', 'Party Cone', 'common', 'shop', { price: 60, swatch: 'repeating-linear-gradient(45deg,#f472b6 0 5px,#fff7e6 5px 10px)' }),
  I('hat-acorn', 'hat', 'Acorn Cap', 'common', 'shop', { price: 50, swatch: '#92400e' }),
  I('hat-thimble', 'hat', 'Thimble Helm', 'stitched', 'shop', { price: 90, swatch: 'radial-gradient(circle,#e5e7eb 30%,#9ca3af)' }),
  I('hat-bottlecap', 'hat', 'Bottle-Cap Crown', 'stitched', 'claw', { swatch: '#dc2626' }),
  I('hat-flowers', 'hat', 'Flower Crown', 'stitched', 'challenge', { goal: 'Vine Swing: 40 m', test: (s) => s.vineBest >= 40, swatch: 'radial-gradient(circle,#fde047 25%,#f9a8d4 27%)' }),
  I('hat-beanie', 'hat', 'Propeller Beanie', 'embroidered', 'shop', { price: 200, swatch: 'linear-gradient(180deg,#ef4444,#f59e0b,#22c55e,#3b82f6,#7c3aed)' }),
  I('hat-wizard', 'hat', 'Felt Wizard Hat', 'embroidered', 'shop', { price: 220, swatch: 'radial-gradient(circle at 50% 40%,#facc15 12%,#4c1d95 14%)' }),
  I('hat-crown', 'hat', 'Champion Crown', 'golden', 'challenge', { goal: 'Win 3 Shows', test: (s) => s.wins >= 3, swatch: 'linear-gradient(135deg,#fde68a,#d97706)' }),

  // Face.
  I('face-none', 'face', 'Nothing', 'common', 'free', { swatch: 'transparent' }),
  I('face-moustache', 'face', 'Curly Moustache', 'common', 'shop', { price: 40, swatch: '#3f2a1d' }),
  I('face-nose', 'face', 'Eraser Nose', 'common', 'shop', { price: 35, swatch: '#f9a8d4' }),
  I('face-bandage', 'face', 'Sticking Plaster', 'common', 'shop', { price: 30, swatch: '#f5d0a9' }),
  I('face-patch', 'face', 'Felt Eyepatch', 'stitched', 'challenge', { goal: 'Win Biggest Menace once', test: (s) => s.menace >= 1, swatch: '#111827' }),
  I('face-glasses', 'face', 'Pipe-Cleaner Specs', 'stitched', 'shop', { price: 110, swatch: 'radial-gradient(circle,transparent 45%,#ec4899 48%)' }),

  // Back.
  I('back-none', 'back', 'Nothing', 'common', 'free', { swatch: 'transparent' }),
  I('back-cape', 'back', 'Hero Cape', 'common', 'shop', { price: 70, swatch: '#dc2626' }),
  I('back-matchbox', 'back', 'Matchbox Backpack', 'stitched', 'shop', { price: 90, swatch: '#fbbf24' }),
  I('back-key', 'back', 'Wind-Up Key', 'embroidered', 'shop', { price: 160, swatch: 'radial-gradient(circle,#e5e7eb 30%,#6b7280)' }),
  I('back-wings', 'back', 'Paper Wings', 'golden', 'claw', { swatch: 'linear-gradient(135deg,#fbcfe8,#bfdbfe,#fef9c3)' }),

  // Hand.
  I('hand-none', 'hand', 'Nothing', 'common', 'free', { swatch: 'transparent' }),
  I('hand-lolly', 'hand', 'Swirl Lollipop', 'common', 'shop', { price: 45, swatch: 'conic-gradient(#f472b6,#fff,#60a5fa,#fff,#f472b6)' }),
  I('hand-brush', 'hand', 'Paintbrush', 'common', 'shop', { price: 50, swatch: '#a16207' }),
  I('hand-pencil', 'hand', 'Pencil Sword', 'stitched', 'shop', { price: 90, swatch: '#facc15' }),
  I('hand-balloon', 'hand', 'Party Balloon', 'stitched', 'claw', { swatch: '#ef4444' }),

  // Feet.
  I('feet-none', 'feet', 'Bare Paws', 'common', 'free', { swatch: 'transparent' }),
  I('feet-caps', 'feet', 'Bottle-Cap Shoes', 'common', 'shop', { price: 50, swatch: '#16a34a' }),
  I('feet-socks', 'feet', 'Sock Boots', 'stitched', 'shop', { price: 80, swatch: 'repeating-linear-gradient(0deg,#f87171 0 4px,#fff 4px 8px)' }),
  I('feet-skates', 'feet', 'Spool Skates', 'embroidered', 'claw', { swatch: '#f472b6' }),

  // Flair: trails (one at a time) and emotes (all you own).
  I('flair-none', 'flair', 'No Trail', 'common', 'free', { swatch: 'transparent' }),
  I('flair-stuffing', 'flair', 'Stuffing Puffs', 'common', 'shop', { price: 60, swatch: '#f8fafc' }),
  I('flair-bubbles', 'flair', 'Bubble Trail', 'stitched', 'claw', { swatch: 'radial-gradient(circle at 35% 35%,#fff 15%,#bae6fd 40%,#a5b4fc)' }),
  I('flair-glitter', 'flair', 'Glitter Trail', 'embroidered', 'shop', { price: 140, swatch: 'linear-gradient(135deg,#f472b6,#facc15,#22d3ee)' }),
  I('emote-spin', 'flair', 'Emote: Twirl', 'common', 'shop', { price: 60, emote: 'spin', swatch: '#fdba74' }),
  I('emote-flip', 'flair', 'Emote: Backflip', 'stitched', 'shop', { price: 100, emote: 'flip', swatch: '#fca5a5' }),
  I('emote-boogie', 'flair', 'Emote: Disco Fever', 'golden', 'challenge', { emote: 'boogie', goal: 'Freeze Dance: 20 clean stops in a row', test: (s) => s.freezeBest >= 20, swatch: 'conic-gradient(#f472b6,#facc15,#22d3ee,#a78bfa,#f472b6)' }),
]

export const ITEM = new Map(ITEMS.map((i) => [i.id, i]))

/** Items everyone owns from the start. */
export const FREE = ITEMS.filter((i) => i.how === 'free').map((i) => i.id)

/** The item a slot shows when nothing is chosen. */
export const DEFAULT_ITEM: Record<WSlot, string> = {
  fabric: 'fab-plain', colour: 'col-cream', eyes: 'eye-button', mouth: 'mouth-stitch', hat: 'hat-none', face: 'face-none', back: 'back-none', hand: 'hand-none',
  feet: 'feet-none', flair: 'flair-none',
}

/** Keep only known items in the right slots (outfits arrive from the network and from old saves). */
export function cleanOutfit(o: unknown): Outfit {
  const out: Outfit = {}
  if (!o || typeof o !== 'object') return out
  for (const slot of WSLOTS) {
    const id = (o as Record<string, unknown>)[slot]
    if (typeof id !== 'string') continue
    const it = ITEM.get(id)
    if (it && it.slot === slot && !it.emote && id !== DEFAULT_ITEM[slot]) out[slot] = id
  }
  return out
}

/** A stable key for an outfit (to tell whether a toy needs re-dressing). */
export function outfitKey(o: Outfit | undefined) {
  if (!o) return ''
  return WSLOTS.map((s) => o[s] ?? '').join('|')
}

/** A cheerful random outfit for a bot: mostly common and stitched pieces, a few empty slots. */
export function randomOutfit(rand: () => number): Outfit {
  const o: Outfit = {}
  for (const slot of WSLOTS) {
    if (rand() < (slot === 'hat' ? 0.35 : slot === 'flair' ? 0.8 : 0.55)) continue
    const pool = ITEMS.filter((i) => i.slot === slot && !i.emote && i.how !== 'free' && (i.rarity === 'common' || i.rarity === 'stitched' || rand() < 0.25))
    if (pool.length) o[slot] = pool[Math.floor(rand() * pool.length)].id
  }
  return o
}

/** Claw prizes: anything not challenge-locked that you don't own yet, the rarer the less likely. */
export function clawPrize(owned: ReadonlySet<string>, rand: () => number): Item | null {
  const w: Record<Rarity, number> = { common: 6, stitched: 4, embroidered: 2, golden: 1 }
  const pool = ITEMS.filter((i) => (i.how === 'shop' || i.how === 'claw') && !owned.has(i.id))
  if (!pool.length) return null
  let total = 0
  for (const i of pool) total += w[i.rarity] * (i.how === 'claw' ? 2 : 1)
  let r = rand() * total
  for (const i of pool) {
    r -= w[i.rarity] * (i.how === 'claw' ? 2 : 1)
    if (r <= 0) return i
  }
  return pool[pool.length - 1]
}
