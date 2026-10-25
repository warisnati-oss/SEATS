// API Gateway: the only REST API of SEATS (ADR-12). Fake auth (progress 1), role check per route (FR-66), then one
// gRPC call to the owning service: path, query and JSON body in, JSON out, gRPC status mapped to an HTTP status.
// A route with auth 'none' (sign-in, the payment webhook) skips the headers and the role check. createApp() builds the
// app without listening: server.ts listens, and so do the monolith (ADR-14) and the in-process tests.
import { isGrpcServiceError } from '@seats/errors/src/index.js';
import { randomUUID, timingSafeEqual } from 'node:crypto';
import express, { type Request, type Response } from 'express';
import grpc from '@grpc/grpc-js';
import { DEADLINE_MS, healthOf } from './clients.js';
import { adapters } from './adapters.js';
import { ROUTES, type Role, type Route } from './routes.js';

const HTTP_STATUS: Partial<Record<grpc.status, number>> = {
  [grpc.status.INVALID_ARGUMENT]: 400, [grpc.status.UNAUTHENTICATED]: 401, [grpc.status.PERMISSION_DENIED]: 403, [grpc.status.NOT_FOUND]: 404,
  [grpc.status.ALREADY_EXISTS]: 409, [grpc.status.FAILED_PRECONDITION]: 409, [grpc.status.ABORTED]: 409, [grpc.status.UNIMPLEMENTED]: 501,
  [grpc.status.UNAVAILABLE]: 502, [grpc.status.DEADLINE_EXCEEDED]: 504,
};

/** Two log lines per request: `req` when it arrives (its number, who, the route and the gRPC method behind it) and `res`
 *  when it is answered (the status, the time taken, the gRPC status and message on a refusal). The number counts the
 *  requests of this process since it started, so the lines of one request pair up among those of the services. */
let seq = 0;
const clock = () => { const d = new Date(); return `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')}`; };
const line = (n: number, what: string) => console.log(`[gateway] #${n} ${clock()} ${what}`);

const unary = <Res>(run: (cb: grpc.requestCallback<Res>) => void) =>
  new Promise<Res>((resolve, reject) => run((err, res) => (err ? reject(err) : resolve(res as Res))));

function mountHealth(app: express.Express): void {
  app.get('/health', async (_req, res) => {
  const services = await Promise.all(Object.entries(healthOf).map(async ([service, client]) => {
    const ok = await unary<{ status: number }>((cb) => client.check({}, { deadline: Date.now() + DEADLINE_MS }, cb)).then((r) => r.status === 1).catch(() => false);
    return { service, ok };
  }));
  res.json({ service: 'gateway', ok: services.every((s) => s.ok), services });
  });
}

/** Who calls: the progress-1 headers x-user-id and x-role, or a LINE ID token as `Authorization: Bearer` verified by the LINE Login Adapter (a customer). */
async function identify(req: Request): Promise<{ userId: string; role: Role | '' }> {
  if (process.env.AUTH_MODE === 'kong') {
    return { userId: req.get('x-user-id') ?? '', role: (req.get('x-role') ?? '') as Role | '' };
  }
  const userId = req.get('x-user-id') ?? '';
  const role = (req.get('x-role') ?? '') as Role | '';
  if (userId && role) return { userId, role };
  const token = /^Bearer\s+(.+)$/i.exec(req.get('authorization') ?? '')?.[1];
  const line = token ? await adapters.lineLogin.verifyIdToken(token) : null;
  return line ? { userId: line.userId, role: 'customer' } : { userId: '', role: '' };
}

const handle = (route: Route) => async (req: Request, res: Response) => {
  const { userId, role } = await identify(req);
  const n = ++seq, started = Date.now();
  line(n, `req ${role || 'anonymous'}:${userId || '-'} ${req.method} ${req.originalUrl} -> gRPC ${route.label}`);
  const log = (status: number, note?: string) => line(n, `res ${req.method} ${req.originalUrl} ${status} (${Date.now() - started} ms)${note ? ` ${note}` : ''}`);
  if (route.auth !== 'none') {
    if (!userId || !role) { log(401); res.status(401).json({ error: 'no identity: send a LINE ID token as Authorization: Bearer, or the headers x-user-id and x-role (fake auth, progress 1)' }); return; }
    if (!route.roles.includes(role)) { log(403, `role ${role} may not`); res.status(403).json({ error: `role ${role} may not ${req.method} ${req.path}` }); return; }   // FR-66
  }
  const metadata = new grpc.Metadata();
  if (userId) metadata.set('x-user-id', userId);
  if (role) metadata.set('x-role', role);
  try {
    const request = route.request({ params: req.params as Record<string, string>, query: req.query as Record<string, string | undefined>, body: req.body ?? {}, header: (name) => req.get(name) });
    const out = await unary<any>((cb) => route.call(request, metadata, { deadline: Date.now() + DEADLINE_MS }, cb));
    const etag = route.etag?.(out);
    if (etag !== undefined && req.get('if-none-match') === etag) { log(304); res.status(304).end(); return; }
    if (etag !== undefined) res.set('ETag', etag);
    log(200);
    res.json(route.pick ? route.pick(out) : out);
  } catch (e) {
    if (!isGrpcServiceError(e)) {                                   // a defect in the gateway itself: logged with its stack, answered with a reference only
      const ref = randomUUID().slice(0, 8);
      console.error(`[gateway] [defect ${ref}]`, e instanceof Error ? e.stack ?? e.message : e);
      log(500, `defect ${ref}`);
      res.status(500).json({ error: `internal error (ref ${ref})` });
      return;
    }
    const err = e;
    const status = HTTP_STATUS[err.code] ?? 500;
    const raw = err.metadata?.get('error-details-bin')[0];
    const details = raw ? JSON.parse(raw.toString()) : undefined;
    log(status, err.code === grpc.status.UNAVAILABLE ? err.message : `${grpc.status[err.code]} ${err.details ?? err.message}`);
    const unreachable = status === 502 && details === undefined;   // a connection failure; an UNAVAILABLE with details is the service's own answer (an external system refused)
    res.status(status).json({ error: unreachable ? `the service behind ${req.path} is not reachable` : err.details ?? err.message, ...(details !== undefined ? { details } : {}) });
  }
};


/** The gateway as an Express app: JSON body, health, one handler per route, JSON 404. */
export function createApp(): express.Express {
  const app = express();
  if (process.env.AUTH_MODE === 'kong') {
    const secret = process.env.SEATS_ADAPTER_SECRET;
    if (!secret || secret.length < 32) throw new Error('Kong mode requires SEATS_ADAPTER_SECRET (at least 32 characters)');
    app.use((req, res, next) => {
      const actual = Buffer.from(req.get('x-seats-gateway-secret') ?? '');
      const expected = Buffer.from(secret);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
        res.status(401).json({ error: 'request must come through Kong' }); return;
      }
      next();
    });
  }
  app.use(express.json({ limit: '2mb' }));
  mountHealth(app);
  for (const route of ROUTES) app[route.method.toLowerCase() as 'get' | 'post' | 'put' | 'delete'](route.path, handle(route));
  app.use((req, res) => { res.status(404).json({ error: `no route for ${req.method} ${req.path}` }); });
  return app;
}

