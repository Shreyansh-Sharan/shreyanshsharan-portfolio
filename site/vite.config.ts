import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv, type Plugin } from 'vite'

/** Writes ads.txt (required by AdSense) into the build when a publisher ID is configured. */
function adsTxt(client: string): Plugin {
  return {
    name: 'ads-txt',
    apply: 'build',
    generateBundle() {
      const pub = client.replace(/^ca-/, '')
      if (!pub) return
      this.emitFile({ type: 'asset', fileName: 'ads.txt', source: `google.com, ${pub}, DIRECT, f08c47fec0942fa0\n` })
    },
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd())
  return {
    plugins: [react(), adsTxt(env.VITE_ADSENSE_CLIENT ?? '')],
    // Relative asset paths so the build works from any sub-path (e.g. GitHub Pages /<repo>/).
    base: './',
  }
})
