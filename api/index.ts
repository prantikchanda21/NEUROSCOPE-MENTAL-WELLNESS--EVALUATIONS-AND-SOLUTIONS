// Vercel Node.js functions accept a plain (req, res) request handler — which
// is exactly what an Express app already is when called as a function
// (app(req, res)). So the same Express app used by `npm run dev` / the
// Netlify function (server-app.ts) can be exported directly here with no
// extra adapter needed.
//
// vercel.json rewrites every /api/* request to this function while keeping
// the original path in req.url, so the existing app.get('/api/...') /
// app.post('/api/...') routes in server-app.ts match unchanged.
import app from '../server-app.js';

export default app;
