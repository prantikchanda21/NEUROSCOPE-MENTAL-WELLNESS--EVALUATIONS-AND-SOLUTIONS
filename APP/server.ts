// Local / Cloud Run entry point. All the actual Gemini & Groq routes live in
// server-app.ts so they can be shared with the Netlify Function
// (netlify/functions/api.ts). This file just adds the pieces a long-running
// Node process needs: env vars, Vite dev middleware, static file serving, and
// the actual app.listen().
import path from 'path';
import express from 'express';
import dotenv from 'dotenv';
import { createServer as createViteServer } from 'vite';
import app from './server-app.js';

// Load `.env` first, then let `.env.local` override it if present. Vite's own
// dev server already follows this convention for VITE_-prefixed client vars,
// but dotenv's default `config()` only ever reads `./.env` — so GEMINI_API_KEY /
// GROQ_API_KEY placed in `.env.local` (as the README instructs) were silently
// never picked up server-side, and every AI call below fell back to the local
// generator no matter what key the user set. Loading both fixes that.
dotenv.config();
dotenv.config({ path: '.env.local', override: true });

const PORT = 3000;

async function startServer() {
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n  NeuroScope Server running!`);
    console.log(`  ➜ Local:   http://localhost:${PORT}`);
    console.log(`  ➜ Network: http://127.0.0.1:${PORT}\n`);
  });
}

startServer();
