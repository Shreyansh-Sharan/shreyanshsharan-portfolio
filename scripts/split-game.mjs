#!/usr/bin/env node
// Splits one of the portfolio's games into a standalone Vite + React app that can live in its own repository.
//
//   node scripts/split-game.mjs racer              # → games-split/volt-riot/
//   node scripts/split-game.mjs all                # every game
//   node scripts/split-game.mjs cricket --no-git   # skip git init / the initial commit
//   node scripts/split-game.mjs golf --owner someone --author "Name <email>"
//
// The app holds only that game: its sources plus every shared module they import (resolved transitively from the
// game's entry), the CSS rules those files use (carved out of site/src/styles.css), the public assets it loads
// (its own folder plus whatever it borrows from the other games and the open world), a package.json pruned to
// what is imported, Vite/TypeScript/lint configs, a GitHub Pages workflow, a vercel.json, a README and a
// DEPLOY.md. Re-runnable: an existing output folder is replaced (its node_modules and .git are kept).
//
// No dependencies beyond Node 18+.

import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SITE = join(ROOT, 'site')
const SRC = join(SITE, 'src')
const PUBLIC = join(SITE, 'public')

const DEFAULT_OWNER = 'Shreyansh-Sharan'
const PORTFOLIO_REPO = 'shreyanshsharan-portfolio'

/** One entry per game: where it lives in the portfolio and what the standalone app should say about itself. */
const GAMES = {
  racer: {
    repo: 'volt-riot',
    title: 'VOLT RIOT',
    tile: 'volt-riot',
    route: 'racer',
    entry: 'racer/Racer.tsx',
    component: 'Racer',
    publicDirs: ['racer'],
    icon: 'racer',
    extraDocs: {},
  },
  cricket: {
    repo: 'cricket-arena',
    title: 'Cricket Arena',
    tile: 'cricket',
    route: 'cricket',
    entry: 'components/Cricket.tsx',
    component: 'Cricket',
    publicDirs: ['cricket'],
    extraDocs: {},
  },
  plush: {
    repo: 'plush-panic',
    title: 'PLUSH PANIC',
    tile: 'plush-panic',
    route: 'plush',
    entry: 'plush/Plush.tsx',
    component: 'Plush',
    publicDirs: ['plush'],
    extraDocs: { 'docs/ENGINE.md': 'src/plush/README.md' },
  },
  siege: {
    repo: 'neon-siege',
    title: 'NEON SIEGE',
    tile: 'neon-siege',
    route: 'siege',
    entry: 'siege/Siege.tsx',
    component: 'Siege',
    publicDirs: ['siege'],
    extraDocs: {},
  },
  golf: {
    repo: 'bogey-brawl',
    title: 'BOGEY BRAWL',
    tile: 'bogey-brawl',
    route: 'golf',
    entry: 'golf/Golf.tsx',
    component: 'Golf',
    publicDirs: ['golf'],
    extraDocs: {},
  },
  sports: {
    repo: 'sports-complex',
    title: 'SPORTS COMPLEX',
    tile: 'sports-complex',
    route: 'sports',
    entry: 'sports/Sports.tsx',
    component: 'Sports',
    publicDirs: ['sports'],
    extraDocs: {},
  },
  arena: {
    repo: 'dunes-arena',
    title: 'Dunes Arena',
    tile: 'arena',
    route: 'arena',
    entry: 'components/Arena.tsx',
    component: 'Arena',
    publicDirs: ['games/arena'],
    unity: true,
    builtWith: 'Unity 6 (WebGL build) with a React lobby',
    extraDocs: {},
  },
}

/** Kept across re-runs: the install, the repository and the lock file npm wrote for it. */
const KEEP = new Set(['node_modules', '.git', 'package-lock.json'])

/** Shared files every split app gets even when nothing imports them (the loader, the backdrop, the app shell). */
const ALWAYS_SRC = ['lib/loader3d.ts', 'components/Loader3D.tsx', 'components/Background.tsx', 'lib/style.ts', 'lib/input.ts']

/* ---------- CLI ---------- */

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 ? args[i + 1] : fallback
}
const ids = args.filter((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--owner' && args[args.indexOf(a) - 1] !== '--author' && args[args.indexOf(a) - 1] !== '--out')
const owner = flag('--owner', DEFAULT_OWNER)
const author = flag('--author', `Shreyansh Sharan <${owner.toLowerCase()}@users.noreply.github.com>`)
const outRoot = resolve(ROOT, flag('--out', 'games-split'))
const noGit = args.includes('--no-git')

if (!ids.length || ids.some((id) => id !== 'all' && !GAMES[id])) {
  console.error(`Usage: node scripts/split-game.mjs <${Object.keys(GAMES).join('|')}|all> [--owner X] [--author "Name <email>"] [--out dir] [--no-git]`)
  process.exit(1)
}

/* ---------- Helpers ---------- */

const read = (p) => readFileSync(p, 'utf8')
const write = (p, s) => {
  mkdirSync(dirname(p), { recursive: true })
  writeFileSync(p, s)
}
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) walk(p, out)
    else out.push(p)
  }
  return out
}
const posix = (p) => p.split(sep).join('/')
const fmtBytes = (n) => (n >= 1 << 20 ? `${(n / (1 << 20)).toFixed(1)} MB` : `${Math.round(n / 1024)} kB`)
const dirSize = (dir, skip = []) => walk(dir).filter((f) => !skip.some((s) => f.includes(`${sep}${s}${sep}`))).reduce((a, f) => a + statSync(f).size, 0)

/* ---------- Import resolution ---------- */

// Static imports/re-exports (possibly spanning lines), side-effect imports and dynamic import() calls.
const IMPORT_RES = [/^\s*(?:import|export)\b[^'";]*?\bfrom\s*['"]([^'"]+)['"]/gm, /^\s*import\s*['"]([^'"]+)['"]/gm, /import\(\s*['"]([^'"]+)['"]\s*\)/g]
const EXTS = ['', '.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.tsx']

/** Resolve a relative specifier to a file under src; returns null for packages. */
function resolveLocal(from, spec) {
  if (!spec.startsWith('.')) return null
  const base = resolve(dirname(from), spec)
  for (const ext of EXTS) {
    const p = base + ext
    if (existsSync(p) && statSync(p).isFile()) return p
  }
  throw new Error(`Cannot resolve '${spec}' from ${relative(ROOT, from)}`)
}

/** Package name for a bare specifier ('three/examples/jsm/...' → 'three', '@react-three/drei' → itself). */
function packageOf(spec) {
  if (spec.startsWith('node:')) return null
  const parts = spec.split('/')
  return spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]
}

/** Every local file reachable from the entries, plus the packages they import. */
function collect(entries) {
  const files = new Set()
  const packages = new Set()
  const queue = [...entries]
  while (queue.length) {
    const file = queue.pop()
    if (files.has(file)) continue
    files.add(file)
    if (!/\.(tsx?|jsx?)$/.test(file)) continue
    const text = read(file)
    for (const m of IMPORT_RES.flatMap((re) => [...text.matchAll(re)])) {
      const spec = m[1]
      const local = resolveLocal(file, spec)
      if (local) queue.push(local)
      else {
        const pkg = packageOf(spec)
        if (pkg) packages.add(pkg)
      }
    }
  }
  return { files, packages }
}

/* ---------- CSS carving ---------- */

/** Split a stylesheet into top-level nodes: comments, rules and at-rules (nested blocks parsed recursively). */
function parseCss(text) {
  const nodes = []
  let i = 0
  const n = text.length
  while (i < n) {
    if (/\s/.test(text[i])) {
      i++
      continue
    }
    if (text.startsWith('/*', i)) {
      const end = text.indexOf('*/', i + 2)
      nodes.push({ type: 'comment', text: text.slice(i, end + 2) })
      i = end + 2
      continue
    }
    // Prelude up to the next '{' or ';' (at-rules such as @import end with ';').
    let j = i
    let depth = 0
    let quote = null
    while (j < n) {
      const c = text[j]
      if (quote) {
        if (c === quote && text[j - 1] !== '\\') quote = null
      } else if (c === '"' || c === "'") quote = c
      else if (c === '(') depth++
      else if (c === ')') depth--
      else if (c === '{' && depth === 0) break
      else if (c === ';' && depth === 0) break
      j++
    }
    const prelude = text.slice(i, j).trim()
    if (text[j] === ';' || j >= n) {
      nodes.push({ type: 'statement', text: prelude + ';' })
      i = j + 1
      continue
    }
    // Body: match braces.
    let k = j + 1
    depth = 1
    quote = null
    while (k < n && depth > 0) {
      const c = text[k]
      if (quote) {
        if (c === quote && text[k - 1] !== '\\') quote = null
      } else if (c === '"' || c === "'") quote = c
      else if (text.startsWith('/*', k)) {
        k = text.indexOf('*/', k + 2) + 1
      } else if (c === '{') depth++
      else if (c === '}') depth--
      k++
    }
    const body = text.slice(j + 1, k - 1)
    if (prelude.startsWith('@') && /^@(media|supports|layer|container|document)/.test(prelude)) nodes.push({ type: 'at', prelude, children: parseCss(body) })
    else if (prelude.startsWith('@')) nodes.push({ type: 'atblock', prelude, body })
    else nodes.push({ type: 'rule', prelude, body })
    i = k
  }
  return nodes
}

/** Class names mentioned in a selector list. */
const classesIn = (selector) => [...selector.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1])

/**
 * Keep the rules whose classes the app's source mentions. Tokens are every identifier-ish word in the copied
 * sources; a token ending in '-' (`'tier-' + x`) matches any class with that prefix. Rules without a class
 * (`:root`, `body`, `button`) always stay, as do keyframes and font faces.
 */
function carveCss(text, tokens, prefixes) {
  const keep = (cls) => tokens.has(cls) || prefixes.some((p) => cls.startsWith(p))
  const ruleWanted = (rule) => {
    const classes = classesIn(rule.prelude)
    return classes.length === 0 || classes.some(keep)
  }
  const render = (nodes, indent = '') => {
    const out = []
    let pendingComment = null
    for (const node of nodes) {
      if (node.type === 'comment') {
        pendingComment = node.text
        continue
      }
      let text = null
      if (node.type === 'statement') text = node.text
      else if (node.type === 'atblock') text = `${node.prelude} {${node.body}}`
      else if (node.type === 'rule') text = ruleWanted(node) ? `${node.prelude} {${node.body}}` : null
      else if (node.type === 'at') {
        const inner = render(node.children, indent + '  ')
        text = inner.trim() ? `${node.prelude} {\n${inner}\n${indent}}` : null
      }
      if (text) {
        if (pendingComment) out.push(indent + pendingComment)
        out.push(indent + text)
      }
      pendingComment = null
    }
    return out.join('\n\n')
  }
  return render(parseCss(text)) + '\n'
}

/* ---------- Public assets ---------- */

/** The game's own folders in full, plus any other public file the sources clearly refer to. */
function pickPublic(game, sourceText, tokens) {
  const all = walk(PUBLIC).map((f) => posix(relative(PUBLIC, f)))
  const own = (rel) => game.publicDirs.some((d) => rel === d || rel.startsWith(d + '/'))
  const wanted = new Set(['favicon.svg'])
  for (const rel of all) {
    if (own(rel)) {
      wanted.add(rel)
      continue
    }
    const dir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/') + 1) : ''
    const base = rel.slice(rel.lastIndexOf('/') + 1).replace(/\.[^.]+$/, '')
    // Full path spelled out, or the folder is mentioned and the file's name is a token (`'world/models/' + name`).
    if (sourceText.includes(rel) || (dir && sourceText.includes(dir) && tokens.has(base))) wanted.add(rel)
  }
  return [...wanted].sort()
}

/* ---------- Generated files ---------- */

function routerFile(game, portfolioUrl) {
  return `// Generated by scripts/split-game.mjs: this site serves one game at \`#/\`. The game's own sources still call
// navigate() with portfolio routes (Home, the hub); those leave for the portfolio site.
import { useEffect, useState } from 'react'
import { parse as parseFull, type Route } from './router.base'

export type { Route }

const GAME = '${game.route}'
export const PORTFOLIO_URL = '${portfolioUrl}'

/** \`#/\`, \`#/?auto=...\` and \`#/${game.route}?...\` all mean the game; only the query matters. */
export function parse(hash: string): Route {
  const query = hash.includes('?') ? hash.slice(hash.indexOf('?')) : ''
  return parseFull(\`#/\${GAME}\${query}\`)
}

export function navigate(to: string) {
  if (parseFull(to).name === GAME) {
    const query = to.includes('?') ? to.slice(to.indexOf('?')) : ''
    const next = \`#/\${query}\`
    if (window.location.hash !== next) window.location.hash = next
    return
  }
  window.location.assign(PORTFOLIO_URL + to)
}

export function useRoute(): Route {
  const [route, setRoute] = useState(() => parse(window.location.hash))
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash))
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  return route
}
`
}

/** The game's JSX from the portfolio's App.tsx, so the props stay in step with the original. */
function gameElement(game) {
  const app = read(join(SRC, 'App.tsx'))
  const m = app.match(new RegExp(`case '${game.route}':[\\s\\S]*?(<${game.component}\\b[\\s\\S]*?/>)`))
  if (!m) throw new Error(`No <${game.component}> in site/src/App.tsx for route '${game.route}'`)
  return m[1].replace(/\s+/g, ' ')
}

function appFile(game) {
  const element = gameElement(game)
  return `// Generated by scripts/split-game.mjs. The whole site is this one game.
import { useCallback, useEffect, useState } from 'react'
import { tiles } from './data/content'
import { useRoute } from './lib/router'
import { accentVars } from './lib/style'
import { endBoot } from './lib/loader3d'
import { Background } from './components/Background'
import { GameRoute } from './components/Loader3D'
import { ${game.component} } from './${game.entry.replace(/\.tsx?$/, '')}'

const tile = tiles.find((t) => t.id === '${game.tile}')!

export default function App() {
  const route = useRoute()
  const [accent, setAccentState] = useState<[string, string]>(tile.accent)
  const setAccent = useCallback((next: [string, string]) => {
    setAccentState((prev) => (prev[0] === next[0] && prev[1] === next[1] ? prev : next))
  }, [])
  // The boot overlay (from index.html) hands over to the game's own loading gate once the app has mounted.
  useEffect(() => endBoot(), [])
  if (route.name !== '${game.route}') return null
  return (
    <>
      <Background accent={accent} />
      <main className="app" style={accentVars(accent)}>
        <GameRoute title="${game.title}">
          ${element}
        </GameRoute>
      </main>
    </>
  )
}
`
}

function mainFile() {
  return `import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
import { bootLoader } from './lib/loader3d'
import App from './App.tsx'

// Take over the static loading shell from index.html before React paints anything, so there is never a black frame.
bootLoader({ status: 'Starting up…', progress: null })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
`
}

function indexHtml(game, tile) {
  const siteHtml = read(join(SITE, 'index.html'))
  const shellStyle = siteHtml.match(/<style>[\s\S]*?<\/style>/)[0]
  const shell = siteHtml.match(/<div id="ld3"[\s\S]*?<\/div>\s*<\/div>\s*<\/div>/)[0].replace('>SS<', `>${initials(game.title)}<`).replace('Starting up…', `Starting ${game.title}…`)
  const description = tile.blurb.replace(/"/g, '&quot;')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <link rel="icon" type="image/svg+xml" href="./favicon.svg" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#05060f" />
    <title>${game.title} · ${tile.tagline}</title>
    <meta name="description" content="${description}" />
    <meta property="og:title" content="${game.title} · ${tile.tagline}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    ${shellStyle}
  </head>
  <body>
    <div id="root"></div>
    ${shell}
    <noscript>
      <h1>${game.title}</h1>
      <p>${description}</p>
      <p>This game needs JavaScript and WebGL.</p>
    </noscript>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
`
}

const initials = (title) =>
  title
    .split(/\s+/)
    .map((w) => w[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

function packageJson(game, packages, sitePkg) {
  const deps = {}
  for (const name of [...packages].sort()) {
    if (name === 'react' || name === 'react-dom') continue
    if (!sitePkg.dependencies[name]) throw new Error(`'${name}' is imported but not in site/package.json`)
    deps[name] = sitePkg.dependencies[name]
  }
  const dependencies = { react: sitePkg.dependencies.react, 'react-dom': sitePkg.dependencies['react-dom'], ...deps }
  const devNames = ['@types/node', '@types/react', '@types/react-dom', '@vitejs/plugin-react', 'oxlint', 'typescript', 'vite']
  if (packages.has('three')) devNames.push('@types/three')
  const devDependencies = Object.fromEntries(devNames.sort().map((n) => [n, sitePkg.devDependencies[n]]))
  return (
    JSON.stringify(
      {
        name: game.repo,
        private: true,
        version: '1.0.0',
        type: 'module',
        scripts: { dev: 'vite', build: 'tsc -b && vite build', lint: 'oxlint', preview: 'vite preview' },
        dependencies,
        devDependencies,
      },
      null,
      2,
    ) + '\n'
  )
}

function workflow(game) {
  return `name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run lint
      - run: npm run build
        env:
          # Ads and affiliate IDs come from repository variables (Settings → Secrets and variables → Actions →
          # Variables). Empty variables leave ads switched off.
          VITE_ADSENSE_CLIENT: \${{ vars.VITE_ADSENSE_CLIENT }}
          VITE_ADSENSE_SLOT_LOBBY: \${{ vars.VITE_ADSENSE_SLOT_LOBBY }}
          VITE_ADSENSE_SLOT_SIDE: \${{ vars.VITE_ADSENSE_SLOT_SIDE }}
          VITE_H5_GAME_ADS: \${{ vars.VITE_H5_GAME_ADS }}
          VITE_AMAZON_TAG: \${{ vars.VITE_AMAZON_TAG }}
          VITE_AMAZON_DOMAIN: \${{ vars.VITE_AMAZON_DOMAIN }}
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: \${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
`
}

function vercelJson(game) {
  const headers = [{ source: '/assets/(.*)', headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }] }]
  if (game.unity) headers.push({ source: '/games/arena/Build/(.*)\\.unityweb', headers: [{ key: 'Content-Encoding', value: 'gzip' }] })
  return (
    JSON.stringify(
      {
        $schema: 'https://openapi.vercel.sh/vercel.json',
        framework: 'vite',
        buildCommand: 'npm run build',
        outputDirectory: 'dist',
        rewrites: [{ source: '/((?!assets/|games/|favicon.svg).*)', destination: '/index.html' }],
        headers,
      },
      null,
      2,
    ) + '\n'
  )
}

/** Control hints straight from the game's lobby (`<li><kbd>W</kbd> Accelerate</li>`), so the README stays true. */
function controlsFrom(files) {
  const lines = new Set()
  for (const file of files) {
    if (!file.endsWith('.tsx')) continue
    const text = read(file)
    for (const m of text.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/g)) {
      const item = m[1]
      if (!item.includes('<kbd>')) continue
      const plain = item
        .replace(/<\/kbd><kbd>/g, '</kbd> <kbd>')
        .replace(/<kbd>([\s\S]*?)<\/kbd>/g, '`$1`')
        .replace(/\{['"`]([^'"`]*)['"`]\}/g, '$1')
        .replace(/<[^>]+>/g, '')
        .replace(/\{[^}]*\}/g, '')
        .replace(/\s+/g, ' ')
        .trim()
      if (plain && plain.length < 160) lines.add(plain)
    }
  }
  return [...lines]
}

function readme(game, tile, controls, credits, docs, pagesUrl) {
  const creditLine = credits.length ? `\n\n## Credits\n\nAsset sources and licences: ${credits.map((c) => `[${c}](${c})`).join(', ')}.` : ''
  const docLine = docs.length ? `\n\n## More\n\n${docs.map((d) => `- [${d}](${d})`).join('\n')}` : ''
  const unity = game.unity
    ? `\n\n## The Unity build\n\n\`public/games/arena/\` is the WebGL build of the shooter (Unity 6, \`unity/ArenaShooter\` in the portfolio repository). The React page is the lobby and the full-screen player that embeds it in an iframe; launch options go in the URL (\`?mode=solo|host|join&bots=&diff=&name=&code=\`). Rebuild the game in Unity and copy the \`Build/\` folder here to update it.`
    : ''
  return `# ${game.title} · ${tile.tagline}

${tile.blurb}

Built with ${game.builtWith ?? tile.org}. Part of [Shreyansh Sharan's portfolio](${pagesUrl.replace(/\/[^/]+\/$/, `/${PORTFOLIO_REPO}/`)}), split into its own site.

\`\`\`bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
npm run lint     # oxlint
\`\`\`

The site is a single page: \`#/\` is the game's menu, and the same query parameters the portfolio used still work
(for example \`#/?auto=...\` to skip the menu, \`#/?join=CODE\` for an invite link).

## Controls

${controls.length ? controls.map((c) => `- ${c}`).join('\n') : 'Keyboard, mouse and gamepad; the menu lists the keys.'}

## Ads and gear

Optional AdSense and Amazon affiliate IDs come from environment variables (see \`.env.example\`). Leave them empty and
no ad or shop code loads.${unity}${creditLine}${docLine}
`
}

function deployMd(game, pagesUrl) {
  return `# Deploying ${game.title}

This folder is a complete repository: an initial commit is already made on \`main\`.

## 1. Create the GitHub repository

Create an empty repository called **${game.repo}** under **${owner}** (no README, no licence, no .gitignore), then:

\`\`\`bash
git remote add origin git@github.com:${owner}/${game.repo}.git
git push -u origin main
\`\`\`

## 2. Enable GitHub Pages

Settings → Pages → Build and deployment → Source: **GitHub Actions**. The workflow in
\`.github/workflows/deploy.yml\` builds on every push to \`main\` and publishes \`dist/\`. The site appears at

    ${pagesUrl}

(\`base: './'\` in \`vite.config.ts\` keeps asset paths relative, so it also works from a custom domain or Vercel.)

Ads and affiliate IDs are optional repository variables: Settings → Secrets and variables → Actions → Variables
(\`VITE_ADSENSE_CLIENT\`, \`VITE_ADSENSE_SLOT_LOBBY\`, \`VITE_ADSENSE_SLOT_SIDE\`, \`VITE_H5_GAME_ADS\`, \`VITE_AMAZON_TAG\`,
\`VITE_AMAZON_DOMAIN\`).

## 3. Point the portfolio at it

In the portfolio repository, \`site/src/data/gameLinks.ts\` lists this URL. Once the site is live, set
\`GAMES_EXTERNAL = true\` there and the portfolio's Play button opens it in a new tab.

## Vercel instead

\`vercel.json\` is included (SPA rewrite, immutable \`/assets\`). Import the repository in Vercel with the default
Vite settings.
`
}

/* ---------- Main ---------- */

function split(id) {
  const game = GAMES[id]
  const out = join(outRoot, game.repo)
  const pagesUrl = `https://${owner.toLowerCase()}.github.io/${game.repo}/`
  const portfolioUrl = `https://${owner.toLowerCase()}.github.io/${PORTFOLIO_REPO}/`
  console.log(`\n== ${id} → ${relative(ROOT, out)}`)

  // Fresh output, keeping an earlier install, its lock file and the repository.
  if (existsSync(out)) for (const name of readdirSync(out)) if (!KEEP.has(name)) rmSync(join(out, name), { recursive: true, force: true })
  mkdirSync(out, { recursive: true })

  // 1. Sources: the game's entry and everything it imports.
  const entry = join(SRC, game.entry)
  const { files, packages } = collect([entry, ...ALWAYS_SRC.map((f) => join(SRC, f))])
  const sitePkg = JSON.parse(read(join(SITE, 'package.json')))
  let sourceText = ''
  for (const file of files) {
    const rel = relative(SRC, file)
    const dest = join(out, 'src', rel === 'lib/router.ts' ? 'lib/router.base.ts' : rel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(file, dest)
    // content.ts is the portfolio's data (cover art, the resume); it must not pull those files into a game.
    if (/\.(tsx?|css)$/.test(file) && rel !== 'data/content.ts') sourceText += read(file) + '\n'
  }
  // The portfolio's router becomes router.base.ts; the generated router keeps the same exports.
  write(join(out, 'src/lib/router.ts'), routerFile(game, portfolioUrl))
  write(join(out, 'src/App.tsx'), appFile(game))
  write(join(out, 'src/main.tsx'), mainFile())
  sourceText += read(join(out, 'src/App.tsx')) + read(join(out, 'src/main.tsx'))

  // 2. Styles: the shared stylesheet carved down to what these sources use.
  const tokens = new Set(sourceText.match(/[A-Za-z_][\w-]*/g))
  const prefixes = [...tokens].filter((t) => t.endsWith('-') && t.length > 2)
  const css = carveCss(read(join(SRC, 'styles.css')), tokens, prefixes)
  write(join(out, 'src/styles.css'), css)

  // 3. Public assets.
  const assets = pickPublic(game, sourceText, tokens)
  for (const rel of assets) {
    const dest = join(out, 'public', rel)
    mkdirSync(dirname(dest), { recursive: true })
    cpSync(join(PUBLIC, rel), dest)
  }

  // 4. Project files.
  const contentText = read(join(SRC, 'data/content.ts'))
  const tileMatch = contentText.match(new RegExp(`\\{\\s*id: '${game.tile}',[\\s\\S]*?\\n  \\},`))
  if (!tileMatch) throw new Error(`Tile '${game.tile}' not found in content.ts`)
  const field = (name) => {
    const m = tileMatch[0].match(new RegExp(`${name}:\\s*\\n?\\s*'((?:[^'\\\\]|\\\\.)*)'`))
    return m ? m[1].replace(/\\'/g, "'") : ''
  }
  const tile = { tagline: field('tagline'), blurb: field('blurb'), org: field('org') }
  write(join(out, 'index.html'), indexHtml(game, tile))
  write(join(out, 'package.json'), packageJson(game, packages, sitePkg))
  write(join(out, 'vite.config.ts'), read(join(SITE, 'vite.config.ts')))
  for (const f of ['tsconfig.json', 'tsconfig.app.json', 'tsconfig.node.json', '.oxlintrc.json', '.gitignore', '.env.example']) cpSync(join(SITE, f), join(out, f))
  write(join(out, '.github/workflows/deploy.yml'), workflow(game))
  write(join(out, 'vercel.json'), vercelJson(game))

  // Credits and docs that travel with the game.
  const credits = []
  for (const rel of assets) {
    if (/CREDITS\.md$/i.test(rel)) {
      cpSync(join(PUBLIC, rel), join(out, 'CREDITS.md'))
      credits.push('CREDITS.md')
    }
  }
  const docs = []
  for (const [dest, from] of Object.entries(game.extraDocs)) {
    cpSync(join(SITE, from), join(out, dest))
    docs.push(dest)
  }
  write(join(out, 'README.md'), readme(game, tile, controlsFrom(files), [...new Set(credits)], docs, pagesUrl))
  write(join(out, 'DEPLOY.md'), deployMd(game, pagesUrl))

  // 5. A repository with one commit.
  if (!noGit) {
    const git = (...a) => execFileSync('git', a, { cwd: out, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim()
    if (!existsSync(join(out, '.git'))) git('init', '-q', '-b', 'main')
    git('add', '-A')
    const m = author.match(/^(.*?)\s*<([^>]+)>$/)
    if (!m) throw new Error('--author must be "Name <email>"')
    const env = { GIT_AUTHOR_NAME: m[1], GIT_AUTHOR_EMAIL: m[2], GIT_COMMITTER_NAME: m[1], GIT_COMMITTER_EMAIL: m[2] }
    const hasCommits = (() => {
      try {
        git('rev-parse', '--verify', 'HEAD')
        return true
      } catch {
        return false
      }
    })()
    const staged = execFileSync('git', ['status', '--porcelain'], { cwd: out }).toString().trim()
    if (staged || !hasCommits) {
      execFileSync('git', ['commit', '-q', '-m', hasCommits ? `Update ${game.title} from the portfolio` : `${game.title}: standalone site split from the portfolio`], {
        cwd: out,
        env: { ...process.env, ...env },
      })
    }
  }

  const srcSize = dirSize(join(out, 'src'))
  const pubSize = dirSize(join(out, 'public'))
  console.log(`   ${files.size} source files (${fmtBytes(srcSize)}), ${assets.length} public files (${fmtBytes(pubSize)}), packages: ${[...packages].sort().join(', ')}`)
  console.log(`   styles.css ${fmtBytes(Buffer.byteLength(css))} of ${fmtBytes(statSync(join(SRC, 'styles.css')).size)}`)
  return { id, out, files: files.size, assets: assets.length, srcSize, pubSize }
}

const results = (ids.includes('all') ? Object.keys(GAMES) : ids).map(split)
console.log('\nDone. Next: cd into each folder, `npm install && npm run build`, then see DEPLOY.md.')
console.log(results.map((r) => `  ${r.id.padEnd(8)} ${relative(ROOT, r.out)}`).join('\n'))
