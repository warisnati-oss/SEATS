import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { startSessionIntrospection } from '../src/api/session-http.js';
import { wire, resetStore } from '../src/infrastructure/index.js';
import { seedStaffAccounts, signIn, signOut } from '../src/domain/index.js';

test('private introspection validates sessions and immediately observes sign-out', async () => {
  wire(); await resetStore(); await seedStaffAccounts();
  const server = startSessionIntrospection(0);
  await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}/internal/session`;
  try {
    assert.equal((await fetch(url)).status, 401);
    assert.equal((await fetch(url, { method: 'POST' })).status, 404);
    const session = await signIn({ username: 'manager', password: 'manager' });
    const headers = { authorization: `Bearer ${session.token}` };
    const res = await fetch(url, { headers });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { userId: session.staffAccountId, role: 'manager' });
    await signOut({ token: session.token });
    assert.equal((await fetch(url, { headers })).status, 401);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
