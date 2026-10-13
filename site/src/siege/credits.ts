// Third-party models used by NEON SIEGE (all CC BY 4.0): shown in the menu's credits section and mirrored in
// public/siege/CREDITS.md. Names, authors and links are copied from the Sketchfab model pages.
export interface Credit {
  /** What the file is used for in the game. */
  use: string
  name: string
  author: string
  authorUrl: string
  url: string
}

export const CC_BY = { name: 'CC BY 4.0', url: 'http://creativecommons.org/licenses/by/4.0/' }

export const CHARACTER_CREDITS: Credit[] = [
  { use: 'ROOK', name: 'Futuristic soldier (lowpoly)', author: 'SlagPerch 3D', authorUrl: 'https://sketchfab.com/slagperch3d', url: 'https://sketchfab.com/3d-models/futuristic-soldier-lowpoly-5ebade1ccbff4adb91ddd3a4d1fcd541' },
  { use: 'WREN', name: 'Star Soldier', author: 'Suvalien', authorUrl: 'https://sketchfab.com/Suvalien', url: 'https://sketchfab.com/3d-models/star-soldier-97ac0915492341148fe2419a1964f097' },
  { use: 'FURNACE', name: 'Evil Robot – Game-Ready', author: 'CharlieCatling', authorUrl: 'https://sketchfab.com/charliecatling', url: 'https://sketchfab.com/3d-models/evil-robot-game-ready-5918ff9fae3342e59a76a919bf89391a' },
  { use: 'FLICK', name: 'Cyber-diva Mark-2', author: 'SmugglersStudio', authorUrl: 'https://sketchfab.com/SmugglersStudio', url: 'https://sketchfab.com/3d-models/cyber-diva-mark-2-5fa032f5076247b6a0665f20fe226323' },
  { use: 'PIKE', name: 'Animated Stylized Character - Rogue Warrior', author: 'Karthik Naidu', authorUrl: 'https://sketchfab.com/Karthiknaidu97', url: 'https://sketchfab.com/3d-models/animated-stylized-character-rogue-warrior-e49c999cc7ce4668a7fdeff328ad0b93' },
  { use: 'SALVE', name: 'Rigged, animated Character free', author: 'Cris', authorUrl: 'https://sketchfab.com/cristopher.faundez', url: 'https://sketchfab.com/3d-models/rigged-animated-character-free-a950d1e0b2574fbd9ced0c6d6e0bb9b3' },
]

export const ENVIRONMENT_CREDITS: Credit[] = [
  { use: 'Wall shutters', name: 'Alley Shop', author: 'Ted Mebratu', authorUrl: 'https://sketchfab.com/paraside', url: 'https://sketchfab.com/3d-models/alley-shop-d78ed5e713534fada31d4aaa45e6a394' },
  { use: 'Shop fronts', name: 'Asian Shop #11', author: 'carlcapu9', authorUrl: 'https://sketchfab.com/carlcapu9', url: 'https://sketchfab.com/3d-models/asian-shop-11-59ab89e8a6784f20a8f561f8804439d5' },
  { use: 'Towers', name: 'Sci-fi Buildings Pack (low-poly, game ready)', author: 'TampaJoey', authorUrl: 'https://sketchfab.com/TampaJoey', url: 'https://sketchfab.com/3d-models/sci-fi-buildings-pack-low-poly-game-ready-333a430644b34e688aecfdc874f4cbf2' },
  { use: 'Kessho Row block', name: 'Hong Kong buildings Alley-2k+ followers:)', author: 'Pasha', authorUrl: 'https://sketchfab.com/Pasha.', url: 'https://sketchfab.com/3d-models/hong-kong-buildings-alley-2k-followers-8192b1cd4a8144c88163c43a3a6abb3f' },
  { use: 'Skyline', name: 'Cyberpunk City - #1', author: 'John Doe', authorUrl: 'https://sketchfab.com/born2012', url: 'https://sketchfab.com/3d-models/cyberpunk-city-1-14d2eaa145ee42938e004115871adf6c' },
  { use: 'Blade signs', name: 'Game Ready Japanese Small Vertical Neon Sign', author: 'Alex Bes', authorUrl: 'https://sketchfab.com/alexbescg', url: 'https://sketchfab.com/3d-models/game-ready-japanese-small-vertical-neon-sign-5849c107ecb7472bb1eef028f5b97f0d' },
  { use: 'Sky', name: 'FREE - SkyBox Dystopian Alleyway', author: 'Paul', authorUrl: 'https://sketchfab.com/paul_paul_paul', url: 'https://sketchfab.com/3d-models/free-skybox-dystopian-alleyway-80ddc539289a4a439c0e3ea4e59e2b84' },
  { use: 'Crates', name: 'Sci-fi Crate', author: 'Darren McNerney 3D', authorUrl: 'https://sketchfab.com/DarrenMcnerney3D', url: 'https://sketchfab.com/3d-models/sci-fi-crate-0e60a62a8f1e4048b638a32eb0661015' },
  { use: 'Crates', name: 'Basic Sci-Fi Crate', author: 'LaVADraGoN', authorUrl: 'https://sketchfab.com/lavadragon', url: 'https://sketchfab.com/3d-models/basic-sci-fi-crate-042201dac61041fabb88f483368daa3f' },
  { use: 'Crates', name: 'Low Poly Sci-Fi crate', author: 'Tom.McCahey', authorUrl: 'https://sketchfab.com/Tom.McCahey', url: 'https://sketchfab.com/3d-models/low-poly-sci-fi-crate-5f328b69346a42bc8fb6e4c03b17bdd5' },
  { use: 'Crates', name: 'Military Crate', author: 'LuddePudde', authorUrl: 'https://sketchfab.com/luddepubde', url: 'https://sketchfab.com/3d-models/military-crate-19c943e409644a8281cc96f63e6743c6' },
  { use: 'Loot crates', name: 'Openable Crate / Loot Box  / Chest', author: 'Shaz', authorUrl: 'https://sketchfab.com/shaz13', url: 'https://sketchfab.com/3d-models/openable-crate-loot-box-chest-93d4333ad5764cf7941744b09cafff78' },
  { use: 'Low cover', name: 'Sci fi Case', author: 'KonstantinaBeratze', authorUrl: 'https://sketchfab.com/KonstantinaBeratze', url: 'https://sketchfab.com/3d-models/sci-fi-case-c59c954c785b4b4488362ef8bb866dfe' },
  { use: 'Kiosks', name: 'Reston B2 Terminal', author: 'Iteration Unlimited', authorUrl: 'https://sketchfab.com/iterationunlimited', url: 'https://sketchfab.com/3d-models/reston-b2-terminal-91b08809f18244628385193e396dd3da' },
  { use: 'Railings', name: 'Metal Rails JFG', author: 'Jesus Fernandez Garcia', authorUrl: 'https://sketchfab.com/jamyzgenius', url: 'https://sketchfab.com/3d-models/metal-rails-jfg-257d620e3a254a4a8b7980a856e88ce8' },
  { use: 'Rooftop vents', name: 'Rooftop 1 HD JFG - Roblox Showcase Prop', author: 'Jesus Fernandez Garcia', authorUrl: 'https://sketchfab.com/jamyzgenius', url: 'https://sketchfab.com/3d-models/rooftop-1-hd-jfg-roblox-showcase-prop-a1bc290c55ee4d93b220b45bf3a6ae8a' },
  { use: 'Rooftop vents', name: 'Rooftop 2 HD JFG - Roblox Showcase Prop', author: 'Jesus Fernandez Garcia', authorUrl: 'https://sketchfab.com/jamyzgenius', url: 'https://sketchfab.com/3d-models/rooftop-2-hd-jfg-roblox-showcase-prop-7a3e4c39319745dc87ecca97fe315741' },
  { use: 'Helipad dish', name: 'Old Scifi satellite dish', author: 'CGKnuenz', authorUrl: 'https://sketchfab.com/Knuenzj', url: 'https://sketchfab.com/3d-models/old-scifi-satellite-dish-f01a91e9773e4622b25c4d27903e85c6' },
  { use: 'Helipad truss', name: 'Stylised Low Poly - City Metal Bridge', author: 'remidoes3d', authorUrl: 'https://sketchfab.com/remidoes3d', url: 'https://sketchfab.com/3d-models/stylised-low-poly-city-metal-bridge-674aee9cfd7b478b93c2f3e2d7026a0c' },
  { use: 'Underpass gates', name: 'Low Poly Turnstiles', author: 'anDDDres', authorUrl: 'https://sketchfab.com/anDDDres', url: 'https://sketchfab.com/3d-models/low-poly-turnstiles-12536f966f9048dcba7e33fa08d9d6b5' },
  { use: 'Underpass train', name: 'LowPoly 3D Train', author: 'Ajaya Tamang Moktan', authorUrl: 'https://sketchfab.com/ajaa', url: 'https://sketchfab.com/3d-models/lowpoly-3d-train-eefc996de2be46fa8eccc6853c765aa4' },
  { use: 'Underpass station', name: 'Subway station', author: 'Pasha', authorUrl: 'https://sketchfab.com/Pasha.', url: 'https://sketchfab.com/3d-models/subway-station-fa31f1ebe8cb437f9c753b22b3fdfc55' },
  { use: 'Cars', name: 'Hover-Car - Low-Poly, Sci-Fi, Game-Ready', author: 'Mert Tetik', authorUrl: 'https://sketchfab.com/merttetik', url: 'https://sketchfab.com/3d-models/hover-car-low-poly-sci-fi-game-ready-95fc47d2715247f89c8e359dc1838b14' },
  { use: 'Cars', name: 'sci-fi car low-poly', author: 'LOST', authorUrl: 'https://sketchfab.com/faraon666rdsv', url: 'https://sketchfab.com/3d-models/sci-fi-car-low-poly-9fbf7336ee7a4046a4e057e24528ab96' },
  { use: 'Cars', name: 'sci-fi car low-poly', author: 'LOST', authorUrl: 'https://sketchfab.com/faraon666rdsv', url: 'https://sketchfab.com/3d-models/sci-fi-car-low-poly-63083240f5314baeb9214471a5016694' },
  { use: 'Sentry Pod', name: 'Futuristic flying animated Robot - Low Poly', author: 'Shayan', authorUrl: 'https://sketchfab.com/mshayan02', url: 'https://sketchfab.com/3d-models/futuristic-flying-animated-robot-low-poly-c5b92c281dc444448e64c0607719c7a2' },
]

export const KENNEY_CREDITS = [
  { use: 'Blasters, grenade, crates', name: 'Blaster Kit 2.1', author: 'Kenney', authorUrl: 'https://kenney.nl', url: 'https://kenney.nl/assets/blaster-kit', licence: 'CC0 1.0' },
]
