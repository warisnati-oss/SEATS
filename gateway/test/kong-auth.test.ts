import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApp } from '../src/app.js';

test('Kong mode requires its shared secret and keeps route role checks', async () => {
  const oldMode = process.env.AUTH_MODE, oldSecret = process.env.SEATS_ADAPTER_SECRET;
  process.env.AUTH_MODE = 'kong';
  process.env.SEATS_ADAPTER_SECRET = 'test-secret-0123456789-0123456789-0123456789';
  const server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/api/staff-accounts`;
  try {
    for (const secret of ['', 'wrong']) {
      const res = await fetch(url, { headers: { 'x-seats-gateway-secret': secret, 'x-role': 'manager', 'x-user-id': 'forged' } });
      assert.equal(res.status, 401);
    }
    const res = await fetch(url, { headers: { 'x-seats-gateway-secret': process.env.SEATS_ADAPTER_SECRET, 'x-role': 'customer', 'x-user-id': 'verified-customer' } });
    assert.equal(res.status, 403);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (oldMode === undefined) delete process.env.AUTH_MODE; else process.env.AUTH_MODE = oldMode;
    if (oldSecret === undefined) delete process.env.SEATS_ADAPTER_SECRET; else process.env.SEATS_ADAPTER_SECRET = oldSecret;
  }
});
