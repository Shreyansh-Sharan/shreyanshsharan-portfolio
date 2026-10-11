# Shreyansh Sharan · Console-style portfolio

A game-console-style home screen for the portfolio: career roles are "games", certifications are trophies, and a
Quick View page gives recruiters a plain resume.

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # production build in dist/
```

## Editing content

Everything the site shows lives in [`src/data/content.ts`](src/data/content.ts): profile and contact links, tiles
(roles, product, extras), trophies and the skill tree. To use generated cover art for a tile, put the image in
`public/` and set `cover: 'my-image.webp'` on that tile.

## Controls

| Input | Keyboard | Gamepad |
| --- | --- | --- |
| Navigate | Arrow keys | D-pad / left stick |
| Open | Enter | Bottom face button |
| Back | Esc | Right face button |
| Switch tab | Q / E | Shoulder buttons |

Mouse and touch work too: tap a tile to select it, tap again to open.

## Structure

- `src/components/Background.tsx`: animated ribbon background as a single WebGL fragment shader (no 3D library)
- `src/components/Home.tsx`: the home screen (tabs, tile row, hero, activity cards)
- `src/components/GameHub.tsx`: per-role detail page
- `src/lib/input.ts`: unified keyboard + gamepad input
- `src/lib/sound.ts`: synthesised UI sounds (no audio files)

## Deploying

`.github/workflows/deploy-site.yml` builds and publishes to GitHub Pages on pushes to `main`. Enable it once under
**Settings → Pages → Source: GitHub Actions**.
