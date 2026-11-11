import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

// Dev only: the React refresh preamble is an inline script, so the CSP meta tag in index.html needs 'unsafe-inline' under `vite`.
const devCsp = {
  name: 'artemis-dev-csp', apply: 'serve',
  transformIndexHtml: (html) => html.replace("script-src 'self'", "script-src 'self' 'unsafe-inline'")
};

// The whiteboard's hand-drawn fonts ship with the app (served at ./excalidraw/fonts/), so it works offline and the CSP
// never has to allow a font CDN. BoardView.jsx points window.EXCALIDRAW_ASSET_PATH at ./excalidraw/.
const FONTS = path.resolve('node_modules/@excalidraw/excalidraw/dist/prod/fonts');
const excalidrawFonts = {
  name: 'artemis-excalidraw-fonts',
  configureServer(server) {
    server.middlewares.use('/excalidraw/fonts', (req, res, next) => {
      const file = path.join(FONTS, decodeURIComponent((req.url || '').split('?')[0]));
      if (!file.startsWith(FONTS) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return next();
      res.setHeader('Content-Type', file.endsWith('.woff2') ? 'font/woff2' : 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
  },
  writeBundle(opts) { if (fs.existsSync(FONTS)) fs.cpSync(FONTS, path.join(opts.dir || 'dist/renderer', 'excalidraw', 'fonts'), { recursive: true }); }
};

export default defineConfig({
  plugins: [react(), devCsp, excalidrawFonts],
  base: './',
  build: { outDir: 'dist/renderer', emptyOutDir: true },
  server: { port: 5173, strictPort: true }
});
