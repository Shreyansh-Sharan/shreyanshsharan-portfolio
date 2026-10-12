// Gear picks shown next to each game, as Amazon Associates links. Search links carry the associate tag, so they
// earn on whatever the visitor buys in that session without hard-coding products that go out of stock.
// Set VITE_AMAZON_TAG (and VITE_AMAZON_DOMAIN, e.g. amazon.in or amazon.com) to switch them on.

export const AMAZON_TAG = (import.meta.env.VITE_AMAZON_TAG as string | undefined)?.trim() || ''
export const AMAZON_DOMAIN = (import.meta.env.VITE_AMAZON_DOMAIN as string | undefined)?.trim() || 'amazon.in'

export interface GearPick {
  title: string
  note: string
  query: string
}

export type GearTopic = 'gaming' | 'cricket' | 'racing' | 'golf' | 'sports' | 'party'

export const GEAR: Record<GearTopic, { heading: string; picks: GearPick[] }> = {
  gaming: {
    heading: 'Gear for shooters',
    picks: [
      { title: 'Lightweight gaming mouse', note: 'High-DPI sensor, under 70 g', query: 'lightweight wireless gaming mouse' },
      { title: 'Mechanical keyboard', note: 'Fast switches for WASD play', query: 'mechanical gaming keyboard' },
      { title: 'Gaming headset', note: 'Hear footsteps and reloads', query: 'gaming headset with microphone' },
      { title: 'Large mouse pad', note: 'Room for low-sensitivity aim', query: 'extended gaming mouse pad xxl' },
    ],
  },
  cricket: {
    heading: 'Cricket kit',
    picks: [
      { title: 'English willow bat', note: 'Grade 1–3 willow for leather ball', query: 'english willow cricket bat' },
      { title: 'Kashmir willow bat', note: 'Great value for tennis or leather', query: 'kashmir willow cricket bat' },
      { title: 'Leather cricket balls', note: 'Match-grade four-piece', query: 'leather cricket ball pack' },
      { title: 'Batting pads and gloves', note: 'Lightweight protection set', query: 'cricket batting pads gloves set' },
      { title: 'Cricket helmet', note: 'Steel grille, adjustable fit', query: 'cricket helmet' },
      { title: 'Cricket shoes', note: 'Rubber studs for turf and grass', query: 'cricket shoes' },
    ],
  },
  racing: {
    heading: 'Racing setup',
    picks: [
      { title: 'Racing wheel and pedals', note: 'Force feedback for PC', query: 'racing wheel pedals pc force feedback' },
      { title: 'Game controller', note: 'Analogue triggers for throttle', query: 'wireless pc game controller' },
      { title: 'Gaming chair', note: 'Comfort for long sessions', query: 'ergonomic gaming chair' },
    ],
  },
  golf: {
    heading: 'Golf at home',
    picks: [
      { title: 'Putting mat', note: 'Practise on the living-room floor', query: 'indoor golf putting mat' },
      { title: 'Practice net', note: 'Full swings in the garden', query: 'golf practice net' },
      { title: 'Golf balls', note: 'Two-piece distance balls', query: 'golf balls pack' },
    ],
  },
  sports: {
    heading: 'Sports gear',
    picks: [
      { title: 'Football', note: 'Size 5 match ball', query: 'football size 5' },
      { title: 'Badminton racket set', note: 'Rackets and shuttlecocks', query: 'badminton racket set shuttlecock' },
      { title: 'Table tennis set', note: 'Bats, balls and a net', query: 'table tennis racket set' },
    ],
  },
  party: {
    heading: 'Party night picks',
    picks: [
      { title: 'Plush toys', note: 'Soft, squishy and huggable', query: 'cute plush toy' },
      { title: 'Party board games', note: 'For game night with friends', query: 'party board game for friends' },
      { title: 'Extra controllers', note: 'Everyone gets a pad', query: 'wireless pc game controller' },
    ],
  },
}

export function affiliateUrl(query: string) {
  const params = new URLSearchParams({ k: query, tag: AMAZON_TAG })
  return `https://www.${AMAZON_DOMAIN}/s?${params}`
}
