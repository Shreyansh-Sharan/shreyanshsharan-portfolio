// Toy Box Trail: the bag of tricks (bought with buttons at shop tiles, three slots) and the surprise deck.
// Pure data, shared by the rules (trail.ts) and the HUD.

export type ItemId = 'hammer' | 'trap' | 'jack' | 'bubble' | 'double' | 'magnet'

export interface ItemDef {
  id: ItemId
  name: string
  price: number
  /** Who it is aimed at: a rival you pick, the leader, a tile, or yourself. */
  aim: 'rival' | 'leader' | 'tile' | 'self'
  desc: string
}

export const ITEMS: Record<ItemId, ItemDef> = {
  hammer: { id: 'hammer', name: 'Squeaky Hammer', price: 6, aim: 'rival', desc: 'Bonk a rival back 3 tiles.' },
  trap: { id: 'trap', name: 'Mousetrap', price: 4, aim: 'tile', desc: 'Set it on a tile. The next rival to step on it stops dead and pays you 4 buttons.' },
  jack: { id: 'jack', name: 'Jack-in-the-Box', price: 7, aim: 'self', desc: 'Boing! Pop out next to a random toy.' },
  bubble: { id: 'bubble', name: 'Bubble Wrap', price: 4, aim: 'self', desc: 'Blocks the next trick aimed at you and bounces it back: the sender goes back 3 tiles.' },
  double: { id: 'double', name: 'Double Die', price: 5, aim: 'self', desc: 'Roll two dice this turn.' },
  magnet: { id: 'magnet', name: 'Magnet Spool', price: 7, aim: 'leader', desc: 'Reel the leader back to your tile.' },
}

export const ITEM_IDS = Object.keys(ITEMS) as ItemId[]
export const BAG_SLOTS = 3
export const START_BUTTONS = 10
/** Buttons a duel winner can take from each loser. */
export const DUEL_STAKE = 6
/** What a table mini-game pays by placing. */
export const PARTY_BONUS = [10, 6, 4, 2, 1, 1]
/** A table mini-game after every this many table rounds. */
export const PARTY_EVERY = 3

export interface CardDef {
  id: string
  title: string
  text: string
}

/** The surprise deck: funny events from around the attic. */
export const CARDS: CardDef[] = [
  { id: 'penny', title: 'Lucky Penny', text: 'You find a penny under the rug and trade it for 6 buttons.' },
  { id: 'lint', title: 'Lint Storm', text: 'A gust from the window! Every toy drops 2 buttons.' },
  { id: 'nap', title: 'Cat Nap', text: 'The cat curls up on top of you. Miss your next turn.' },
  { id: 'wind', title: 'Tailwind', text: 'A draught from the window blows you 3 tiles ahead.' },
  { id: 'sneeze', title: 'Dust Sneeze', text: 'Achoo! You tumble back 2 tiles.' },
  { id: 'party', title: 'Un-birthday', text: 'Happy un-birthday! Every toy gives you 2 buttons.' },
  { id: 'gift', title: 'Gift Box', text: 'A free trick for your bag (if you have room).' },
  { id: 'wrap', title: 'Spare Bubble Wrap', text: 'You find a sheet of Bubble Wrap. You are wrapped!' },
  { id: 'pillow', title: 'Pillow Fight', text: 'Pillow fight! Duel the nearest toy.' },
  { id: 'tidy', title: 'Spring Clean', text: 'Someone tidied up. Every mousetrap is swept away.' },
  { id: 'share', title: 'Hand-me-down', text: 'The leader feels generous and gives you 3 buttons.' },
  { id: 'chairs', title: 'Musical Chairs', text: 'The music stops! Swap places with a random toy.' },
  { id: 'pocket', title: 'Sticky Fingers', text: 'You pinch a random trick from the leader’s bag.' },
  { id: 'rain', title: 'Button Rain', text: 'The button tin tips over. Every toy gets 3 buttons.' },
]
