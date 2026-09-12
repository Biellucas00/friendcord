import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
const source = readFileSync(new URL('./api.ts', import.meta.url), 'utf8').replace('import.meta.env.VITE_API_URL', '"https://example.test"');
const { api, uploadFile, subscribeToLoading } = await import('data:text/javascript;base64,' + Buffer.from(stripTypeScriptTypes(source)).toString('base64'));
let counts, unsubscribe;
beforeEach((t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  counts = [];
  unsubscribe = subscribeToLoading(n => counts.push(n));
  t.mock.method(globalThis, 'fetch', async () => Response.json({ ok: true }));
  globalThis.localStorage = { getItem: () => null };
});
afterEach(() => { unsubscribe(); assert.equal(counts.at(-1), 0); });
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
const hanging = signal => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
test('request timeout aborts fetch and clears loading', async t => {
  fetch.mock.mockImplementation((url, { signal }) => hanging(signal));
  const done = assert.rejects(api('/me'), /demorou demais/);
  t.mock.timers.tick(60000);
  await done;
  assert.deepEqual(counts, [0, 1, 0]);
});
test('deadline also covers a stalled JSON body', async t => {
  fetch.mock.mockImplementation(async (url, { signal }) => ({ ok: true, status: 200, json: () => hanging(signal) }));
  const done = assert.rejects(api('/me'), /demorou demais/);
  await flush();
  assert.equal(counts.at(-1), 1);
  t.mock.timers.tick(60000);
  await done;
});
test('failed reads retry and recover', async t => {
  fetch.mock.mockImplementationOnce(async () => { throw new TypeError('offline'); });
  const done = api('/me');
  await flush();
  t.mock.timers.tick(1500);
  assert.deepEqual(await done, { ok: true });
  assert.equal(fetch.mock.callCount(), 2);
});
test('failed writes are never replayed', async () => {
  fetch.mock.mockImplementation(async () => { throw new TypeError('offline'); });
  await assert.rejects(api('/auth/register', { method: 'POST' }), /conectar/);
  assert.equal(fetch.mock.callCount(), 1);
});
test('caller cancellation interrupts retry delay immediately', async () => {
  fetch.mock.mockImplementation(async () => { throw new TypeError('offline'); });
  const controller = new AbortController();
  const done = assert.rejects(api('/me', { signal: controller.signal }), { name: 'AbortError' });
  await flush();
  controller.abort();
  await done;
  assert.equal(fetch.mock.callCount(), 1);
});
test('concurrent requests retain loading until both finish', async () => {
  let resolve;
  fetch.mock.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const first = api('/me');
  await api('/rooms');
  assert.equal(counts.at(-1), 1);
  resolve(Response.json({ ok: true }));
  await first;
  assert.deepEqual(counts, [0, 1, 2, 1, 0]);
});
test('HTTP errors retain server messages without retrying', async () => {
  fetch.mock.mockImplementation(async () => Response.json({ error: 'Credenciais inválidas' }, { status: 401 }));
  await assert.rejects(api('/auth/login', { method: 'POST' }), /Credenciais inválidas/);
  assert.equal(fetch.mock.callCount(), 1);
});
test('empty responses and uploads complete', async () => {
  fetch.mock.mockImplementationOnce(async () => new Response(null, { status: 204 }));
  assert.equal(await api('/item', { method: 'DELETE' }), undefined);
  assert.deepEqual(await uploadFile(new Blob(['hello']), 'hello.txt'), { ok: true });
});
