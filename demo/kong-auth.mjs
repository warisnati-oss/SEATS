// Integration checks against the Compose deployment, with line_mode: fake.
import assert from 'node:assert/strict';
const G = process.env.GATEWAY ?? 'http://localhost:4000';
async function check(method, path, status, headers = {}, body) {
  const res = await fetch(G + path, { method, headers: { 'content-type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await res.json();
  assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(result)}`);
  assert.match(res.headers.get('via') ?? res.headers.get('server') ?? '', /kong/);
  console.log(`ok ${method} ${path} -> ${status}`);
  return result;
}
await check('GET', '/health', 200);
await check('GET', '/api/staff-accounts', 401, { 'x-user-id': 'forged', 'x-role': 'manager', 'x-seats-gateway-secret': 'forged' });
await check('GET', '/api/rounds', 401, { authorization: 'Bearer invalid' });
await check('POST', '/api/sessions', 401, {}, { username: 'manager', password: 'wrong' });
const session = await check('POST', '/api/sessions', 200, {}, { username: 'manager', password: 'manager' });
const staff = { authorization: `Bearer ${session.token}` };
await check('GET', '/api/staff-accounts', 200, { ...staff, 'x-user-id': 'forged', 'x-role': 'customer' });
await check('GET', '/api/rounds', 200, { authorization: 'Bearer fake-line-U-auth-test' });
await check('GET', '/api/staff-accounts', 403, { authorization: 'Bearer fake-line-U-auth-test', 'x-role': 'manager', 'x-user-id': 'forged' });
const username = `kong-auth-${Date.now()}`;
const account = await check('POST', '/api/staff-accounts', 200, staff, { username, password: 'test-password-123', role: 'front_staff' });
const door = await check('POST', '/api/sessions', 200, {}, { username, password: 'test-password-123' });
const doorHeaders = { authorization: `Bearer ${door.token}` };
await check('GET', '/api/staff-accounts', 403, doorHeaders);
await check('PUT', `/api/staff-accounts/${account.staffAccountId}`, 200, staff, { role: 'manager' });
await check('GET', '/api/staff-accounts', 200, doorHeaders);
await check('DELETE', `/api/staff-accounts/${account.staffAccountId}`, 200, staff);
await check('GET', '/api/staff-accounts', 401, doorHeaders);
await check('DELETE', '/api/sessions/current', 200, staff);
await check('GET', '/api/staff-accounts', 401, staff);
// The anonymous webhook must reach its own signature validation, not receive Kong's missing-token error.
const webhook = await fetch(G + '/api/payments/webhook', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
assert.notEqual(webhook.status, 404);
assert.ok(webhook.headers.get('x-kong-upstream-latency'), 'webhook reached adapter');
console.log('Kong authentication checks passed');
