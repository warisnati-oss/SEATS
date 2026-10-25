// Smoke test of the two Deliverable 3 flows through the gateway. Run the services (npm run dev), then `npm run smoke`.
const G = process.env.GATEWAY ?? 'http://localhost:4000';
const signed = await fetch(G + '/api/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'manager', password: 'manager' }) });
if (!signed.ok) throw new Error(`Staff sign-in failed: ${signed.status}`);
const session = await signed.json();
const H = (token) => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' });
const manager = { ...H(session.token), 'x-user-id': session.staffAccountId, 'x-role': session.role }, somchai = H('fake-line-U-somchai'), malee = H('fake-line-U-malee');
let failures = 0;
async function call(headers, method, path, body, expect) {
  const r = await fetch(G + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const json = r.status === 304 ? null : await r.json().catch(() => null);
  const ok = r.status === expect;
  console.log(`${ok ? 'ok  ' : 'FAIL'} ${method} ${path} -> ${r.status}${ok ? '' : ` (expected ${expect}) ${JSON.stringify(json)}`}`);
  if (!ok) failures++;
  return json;
}
const day = new Date(Date.now() + (2 + Math.floor(Math.random() * 300)) * 864e5).toISOString().slice(0, 10);   // random future date: repeated runs must not overlap
const at = (h) => `${day}T${h}:00:00Z`;

await call(manager, 'PUT', '/api/table-types/round2', { name: '2-person round table', capacity: 2 }, 200);
await call(manager, 'PUT', '/api/table-types/sofa6', { name: '6-person sofa', capacity: 6 }, 200);
const map = await call(manager, 'POST', '/api/zone-maps', { name: 'Main hall' }, 200);
await call(manager, 'POST', `/api/zone-maps/${map.id}/image`, { fileName: 'hall.png' }, 200);
const badMap = await call(manager, 'POST', `/api/zone-maps/${map.id}/validate`, null, 200);
if (badMap.valid) { console.log('FAIL an empty map validated'); failures++; }
await call(manager, 'PUT', `/api/zone-maps/${map.id}`, { zones: [{ id: 'A', name: 'Zone A' }], tables: [{ tableNumber: 1, zoneId: 'A', tableTypeId: 'sofa6', capacity: 6 }, { tableNumber: 2, zoneId: 'A', tableTypeId: 'round2', capacity: 2 }] }, 200);
await call(manager, 'POST', `/api/zone-maps/${map.id}/activate`, null, 200);
await call(manager, 'DELETE', `/api/zone-maps/${map.id}`, null, 409);                       // Active: not discardable
const round = await call(manager, 'POST', '/api/rounds', { name: 'Friday Live' }, 200);
await call(manager, 'POST', `/api/rounds/${round.id}/publish`, null, 400);                     // not valid yet
await call(manager, 'PUT', `/api/rounds/${round.id}`, { artist: 'The Band', date: day, doorsOpenAt: at('18'), startAt: at('20'), bookingOpenAt: new Date(Date.now() - 60e3).toISOString(), zoneMapId: map.id, prices: [{ zoneId: 'A', tableTypeId: 'sofa6', packagePrice: 7200 }, { zoneId: 'A', tableTypeId: 'round2', packagePrice: 2400 }] }, 200);
await call(manager, 'POST', `/api/rounds/${round.id}/publish`, null, 200);
await call(manager, 'POST', `/api/rounds/${round.id}/publish`, null, 200);                     // idempotent (EF-2)
await call(somchai, 'POST', `/api/rounds/${round.id}/publish`, null, 403);                     // role check
const rounds = await call(somchai, 'GET', '/api/rounds', null, 200);
if (rounds.find((r) => r.id === round.id)?.status !== 'open') { console.log('FAIL round not open'); failures++; }
const status = await call(somchai, 'GET', `/api/rounds/${round.id}/table-status`, null, 200);
const r304 = await fetch(`${G}/api/rounds/${round.id}/table-status`, { headers: { ...somchai, 'if-none-match': String(status.version) } });
console.log(`${r304.status === 304 ? 'ok  ' : 'FAIL'} GET table-status with If-None-Match -> ${r304.status}`); if (r304.status !== 304) failures++;
const booking = await call(somchai, 'POST', '/api/bookings', { roundId: round.id, tableNumber: 1 }, 200);
await call(malee, 'POST', '/api/bookings', { roundId: round.id, tableNumber: 1 }, 409);       // first lock wins
const fee = await call(somchai, 'PUT', `/api/bookings/${booking.id}/party-size`, { partySize: 7 }, 200);
if (fee.fee?.fullTableFee !== 7800) { console.log(`FAIL fee ${fee.fee?.fullTableFee} != 7800`); failures++; }
await call(malee, 'GET', `/api/bookings/${booking.id}`, null, 404);                           // own bookings only
await call(somchai, 'GET', '/api/customers/me', null, 404);
await call(somchai, 'POST', '/api/customers/me', { name: 'Somchai', phone: '0812345678', consent: true }, 200);
await call(somchai, 'GET', `/api/bookings/${booking.id}/terms`, null, 200);
await call(somchai, 'POST', `/api/bookings/${booking.id}/terms-acceptance`, null, 200);
await call(somchai, 'POST', `/api/bookings/${booking.id}/payment`, null, 501);
await call(somchai, 'POST', `/api/bookings/${booking.id}/cancel`, null, 200);
const after = await call(somchai, 'GET', `/api/rounds/${round.id}/table-status`, null, 200);
if (after.tables[0].status !== 'AVAILABLE') { console.log('FAIL table not released'); failures++; }
await call(malee, 'POST', '/api/bookings', { roundId: round.id, tableNumber: 1 }, 200);       // free again
const draft = await call(manager, 'POST', '/api/rounds', { name: 'scratch' }, 200);
await call(manager, 'DELETE', `/api/rounds/${draft.id}`, null, 200);
await call(manager, 'DELETE', `/api/rounds/${round.id}`, null, 409);
console.log(failures ? `\n${failures} check(s) failed` : '\nall checks passed');
process.exit(failures ? 1 : 0);
