// Local API evidence only: 50-way contention and a 10-second, 5 holds/sec sample.
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { setTimeout as delay } from 'node:timers/promises';
import { writeFile } from 'node:fs/promises';
const G = process.env.GATEWAY ?? 'http://localhost:4000';
const prefix = `nfr-${Date.now()}`;
const H = token => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
async function call(method, path, token, body) {
  const start = performance.now();
  const r = await fetch(G + path, { method, headers: token ? H(token) : { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  const data = await r.json();
  return { status: r.status, data, ms: performance.now() - start };
}
async function ok(method, path, token, body) {
  const r = await call(method, path, token, body);
  assert.equal(r.status, 200, `${method} ${path}: ${JSON.stringify(r.data)}`);
  return r.data;
}
const staff = await ok('POST', '/api/sessions', null, { username: 'manager', password: 'manager' });
const token = staff.token;
let round;
const bookings = [];
try {
  const type = `${prefix}-type`;
  await ok('PUT', `/api/table-types/${type}`, token, { name: 'NFR test table', capacity: 2 });
  const map = await ok('POST', '/api/zone-maps', token, { name: prefix });
  await ok('POST', `/api/zone-maps/${map.id}/image`, token, { fileName: 'nfr-test.png' });
  await ok('PUT', `/api/zone-maps/${map.id}`, token, { zones: [{ id: 'A', name: 'Test' }], tables: Array.from({ length: 60 }, (_, i) => ({ tableNumber: i + 1, zoneId: 'A', tableTypeId: type, capacity: 2 })) });
  await ok('POST', `/api/zone-maps/${map.id}/activate`, token);
  round = await ok('POST', '/api/rounds', token, { name: prefix });
  // MongoDB retains published rounds between runs. Try future dates in order;
  // only an explicit schedule-overlap refusal may advance to another date.
  let published = false;
  for (let offset = 350; offset < 350 + 3650; offset++) {
    const day = new Date(Date.now() + offset * 864e5).toISOString().slice(0, 10);
    await ok('PUT', `/api/rounds/${round.id}`, token, { artist: 'NFR test', date: day, doorsOpenAt: `${day}T18:00:00Z`, startAt: `${day}T20:00:00Z`, bookingOpenAt: new Date(Date.now() - 60000).toISOString(), zoneMapId: map.id, prices: [{ zoneId: 'A', tableTypeId: type, packagePrice: 1000 }] });
    const result = await call('POST', `/api/rounds/${round.id}/publish`, token);
    if (result.status === 200) {
      published = true;
      console.log(`Test fixture published on ${day}; existing rounds preserved.`);
      break;
    }
    const overlapOnly = result.status === 400 && Array.isArray(result.data.details) &&
      result.data.details.length > 0 && result.data.details.every(problem =>
        typeof problem === 'string' && problem.startsWith('overlaps the published round '));
    assert.ok(overlapOnly, `POST /api/rounds/${round.id}/publish: ${JSON.stringify(result.data)}`);
  }
  assert.ok(published, 'No available test date found within the next ten years');
  const hold = async (i, tableNumber) => {
    const customer = `fake-line-${prefix}-customer-${i}`;
    const r = await call('POST', '/api/bookings', customer, { roundId: round.id, tableNumber });
    if (r.status === 200) bookings.push({ id: r.data.id, token: customer });
    return r;
  };
  const contenders = await Promise.all(Array.from({ length: 50 }, (_, i) => hold(i, 60)));
  const winners = contenders.filter(r => r.status === 200).length;
  const conflicts = contenders.filter(r => r.status === 409).length;
  const concurrency = { attempts: 50, winners, conflicts, pass: winners === 1 && conflicts === 49 };
  console.log('NFR-20:', JSON.stringify(concurrency));
  // Open-loop scheduling: requests launch every 200ms regardless of earlier completion.
  const start = performance.now();
  const load = await Promise.all(Array.from({ length: 50 }, (_, i) => (async () => {
    await delay(Math.max(0, start + i * 200 - performance.now()));
    const launched = performance.now() - start;
    const r = await hold(100 + i, i + 1);
    return { ...r, launched };
  })()));
  const sorted = load.map(r => r.ms).sort((a,b) => a-b);
  const p95 = sorted[Math.ceil(sorted.length * 0.95) - 1];
  const successes = load.filter(r => r.status === 200).length;
  const span = load.at(-1).launched - load[0].launched;
  const observedLaunchRate = 49 / (span / 1000);
  const performanceResult = { requests: 50, targetRequestsPerSecond: 5, observedLaunchRate: Number(observedLaunchRate.toFixed(2)), successes, p95Milliseconds: Number(p95.toFixed(2)), maxLaunchLagMs: Number(Math.max(...load.map((r,i)=>r.launched-i*200)).toFixed(2)), pass: successes === 50 && p95 < 2000 && observedLaunchRate >= 4.9 };
  console.log('NFR-01 / NFR-04 (hold API only):', JSON.stringify(performanceResult));
  const result = { at: new Date().toISOString(), gateway: G, scope: 'Single local Compose instance; demo LINE tokens; in-memory booking store; 10-second API sample. Not full NFR-04 certification or production capacity evidence.', concurrency, performance: performanceResult };
  await writeFile(new URL('./nfr-results.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
  if (!concurrency.pass || !performanceResult.pass) process.exitCode = 1;
} finally {
  for (const booking of bookings) await ok('POST', `/api/bookings/${booking.id}/cancel`, booking.token);
  await ok('DELETE', '/api/sessions/current', token);
  console.log('Released test holds and signed out; named NFR venue fixtures remain for inspection.');
}
