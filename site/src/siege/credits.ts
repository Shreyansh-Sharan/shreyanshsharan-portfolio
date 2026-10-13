// Third-party assets used by NEON SIEGE (all CC BY 4.0): shown in the menu's credits section and mirrored in
// public/siege/CREDITS.md. Names, authors and links are copied from the Sketchfab model pages.
// The six heroes, their blasters and most arena props are original models made for this project; the hero
// animation clips are retargeted from the CC BY characters below.
export interface Credit {
  /** What the file is used for in the game. */
  use: string
  name: string
  author: string
  authorUrl: string
  url: string
}

export const CC_BY = { name: 'CC BY 4.0', url: 'http://creativecommons.org/licenses/by/4.0/' }

/** Animation clips retargeted onto the heroes' rigs. */
export const CHARACTER_CREDITS: Credit[] = [
  { use: 'Aim, fire and death clips on every hero; the full clip set on WREN; ROOK’s Bulwark Dash', name: 'Star Soldier', author: 'Suvalien', authorUrl: 'https://sketchfab.com/Suvalien', url: 'https://sketchfab.com/3d-models/star-soldier-97ac0915492341148fe2419a1964f097' },
  { use: 'ROOK’s idle, walk and run; FLICK’s walk', name: 'Futuristic soldier (lowpoly)', author: 'SlagPerch 3D', authorUrl: 'https://sketchfab.com/slagperch3d', url: 'https://sketchfab.com/3d-models/futuristic-soldier-lowpoly-5ebade1ccbff4adb91ddd3a4d1fcd541' },
  { use: 'FURNACE’s idle, walk, death and Armour Pulse', name: 'Evil Robot – Game-Ready', author: 'CharlieCatling', authorUrl: 'https://sketchfab.com/charliecatling', url: 'https://sketchfab.com/3d-models/evil-robot-game-ready-5918ff9fae3342e59a76a919bf89391a' },
  { use: 'FLICK’s idle, run and Ghost Cloak', name: 'Cyber-diva Mark-2', author: 'SmugglersStudio', authorUrl: 'https://sketchfab.com/SmugglersStudio', url: 'https://sketchfab.com/3d-models/cyber-diva-mark-2-5fa032f5076247b6a0665f20fe226323' },
  { use: 'PIKE’s idle, walk, run and Minefield', name: 'Animated Stylized Character - Rogue Warrior', author: 'Karthik Naidu', authorUrl: 'https://sketchfab.com/Karthiknaidu97', url: 'https://sketchfab.com/3d-models/animated-stylized-character-rogue-warrior-e49c999cc7ce4668a7fdeff328ad0b93' },
  { use: 'SALVE’s idle, walk, run and Mend Zone', name: 'Rigged, animated Character free', author: 'Cris', authorUrl: 'https://sketchfab.com/cristopher.faundez', url: 'https://sketchfab.com/3d-models/rigged-animated-character-free-a950d1e0b2574fbd9ced0c6d6e0bb9b3' },
]

export const ENVIRONMENT_CREDITS: Credit[] = [
  { use: 'Shop fronts', name: 'Asian Shop #11', author: 'carlcapu9', authorUrl: 'https://sketchfab.com/carlcapu9', url: 'https://sketchfab.com/3d-models/asian-shop-11-59ab89e8a6784f20a8f561f8804439d5' },
  { use: 'Kessho Row block', name: 'Hong Kong buildings Alley-2k+ followers:)', author: 'Pasha', authorUrl: 'https://sketchfab.com/Pasha.', url: 'https://sketchfab.com/3d-models/hong-kong-buildings-alley-2k-followers-8192b1cd4a8144c88163c43a3a6abb3f' },
  { use: 'Skyline', name: 'Cyberpunk City - #1', author: 'John Doe', authorUrl: 'https://sketchfab.com/born2012', url: 'https://sketchfab.com/3d-models/cyberpunk-city-1-14d2eaa145ee42938e004115871adf6c' },
  { use: 'Sky', name: 'FREE - SkyBox Dystopian Alleyway', author: 'Paul', authorUrl: 'https://sketchfab.com/paul_paul_paul', url: 'https://sketchfab.com/3d-models/free-skybox-dystopian-alleyway-80ddc539289a4a439c0e3ea4e59e2b84' },
  { use: 'Low cover', name: 'Sci fi Case', author: 'KonstantinaBeratze', authorUrl: 'https://sketchfab.com/KonstantinaBeratze', url: 'https://sketchfab.com/3d-models/sci-fi-case-c59c954c785b4b4488362ef8bb866dfe' },
  { use: 'Underpass station', name: 'Subway station', author: 'Pasha', authorUrl: 'https://sketchfab.com/Pasha.', url: 'https://sketchfab.com/3d-models/subway-station-fa31f1ebe8cb437f9c753b22b3fdfc55' },
]

export const KENNEY_CREDITS = [{ use: 'Grenade', name: 'Blaster Kit 2.1', author: 'Kenney', authorUrl: 'https://kenney.nl', url: 'https://kenney.nl/assets/blaster-kit', licence: 'CC0 1.0' }]
