// Private authentication-control endpoint for Kong; never exposed as a public REST API.
import { createServer } from 'node:http';
import { getSession } from '../domain/index.js';

export function startSessionIntrospection(port: number) {
  return createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'no-store');
    if (req.method !== 'GET' || req.url !== '/internal/session') {
      res.writeHead(404).end(JSON.stringify({ error: 'not found' })); return;
    }
    const token = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1];
    try {
      const session = token ? await getSession(token) : null;
      if (!session) { res.writeHead(401).end(JSON.stringify({ error: 'invalid session' })); return; }
      res.end(JSON.stringify({ userId: session.staffAccountId, role: session.role }));
    } catch {
      res.writeHead(503).end(JSON.stringify({ error: 'session store unavailable' }));
    }
  }).listen(port, '0.0.0.0');
}
