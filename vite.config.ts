import { defineConfig, type Plugin } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

const MIME_TYPES: Record<string, string> = {
  '.json': 'application/json; charset=utf-8',
  '.webp': 'image/webp',
  '.png': 'image/png',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.txt': 'text/plain; charset=utf-8',
};

function customPackMiddleware(): Plugin {
  const assetsRoot = path.resolve(__dirname, '.krunkedtato-assets');
  const prefix = '/__krunked_custom_pack__/';
  return {
    name: 'krunked-custom-pack-dev-middleware',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url || !req.url.startsWith(prefix)) {
          next();
          return;
        }
        if (!fs.existsSync(assetsRoot)) {
          res.statusCode = 404;
          res.end('No local custom pack found');
          return;
        }
        const rel = decodeURIComponent(req.url.slice(prefix.length).split('?')[0]);
        const target = path.resolve(assetsRoot, rel);
        if (!target.startsWith(assetsRoot) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
          res.statusCode = 404;
          res.end('Asset not found');
          return;
        }
        const ext = path.extname(target).toLowerCase();
        res.setHeader('Content-Type', MIME_TYPES[ext] ?? 'application/octet-stream');
        res.setHeader('Cache-Control', 'no-cache');
        fs.createReadStream(target).pipe(res);
      });
    },
  };
}

export default defineConfig({
  plugins: [customPackMiddleware()],
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    outDir: 'dist',
    emptyOutDir: true,
  },
});
