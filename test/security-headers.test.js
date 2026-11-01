import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from '../src/server.js';

// fetch() cannot set the Host header, so use http.request directly.
const request = (port, { method = 'GET', path = '/', host } = {}) => new Promise((resolve, reject) => {
  const req = http.request({ port, host: '127.0.0.1', method, path, headers: { host: host || `127.0.0.1:${port}` } }, res => {
    res.resume();
    res.on('end', () => resolve({ status: res.statusCode, headers: res.headers }));
  });
  req.on('error', reject);
  req.end();
});

const baseline = (headers, label) => {
  assert.equal(headers['x-content-type-options'], 'nosniff', label);
  assert.equal(headers['referrer-policy'], 'no-referrer', label);
  assert.equal(headers['cross-origin-opener-policy'], 'same-origin', label);
  assert.equal(headers['cross-origin-resource-policy'], 'same-origin', label);
  assert.match(headers['permissions-policy'], /camera=\(\)/, label);
};

test('every response carries the baseline security headers, including errors', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'scm-headers-'));
  const server = createServer({ libraryDir: directory, publicOrigin: 'https://scm.example.test' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    const page = await request(port);
    assert.equal(page.status, 200);
    baseline(page.headers, 'page');
    assert.match(page.headers['content-security-policy'], /form-action 'none'/);
    assert.match(page.headers['content-security-policy'], /frame-ancestors 'none'/);

    for (const [label, options, status] of [
      ['not found', { path: '/missing' }, 404],
      ['method not allowed', { method: 'POST' }, 405],
      ['foreign host', { host: 'evil.example' }, 403],
      ['api list', { path: '/api/library' }, 200],
      ['api unknown id', { path: '/api/library/' + 'a'.repeat(64) }, 404],
    ]) {
      const response = await request(port, options);
      assert.equal(response.status, status, label);
      baseline(response.headers, label);
    }

    const api = await request(port, { path: '/api/library' });
    assert.equal(api.headers['content-security-policy'], "default-src 'none'; frame-ancestors 'none'; sandbox");

    const local = await request(port);
    assert.equal(local.headers['strict-transport-security'], undefined, 'no HSTS on the plain local address');
    const publicRequest = await request(port, { host: 'scm.example.test' });
    assert.equal(publicRequest.status, 200);
    assert.match(publicRequest.headers['strict-transport-security'], /^max-age=\d+$/);
  } finally { await new Promise(resolve => server.close(resolve)); await rm(directory, { recursive: true, force: true }); }
});

test('HSTS is not sent when the public origin is plain HTTP', async () => {
  const server = createServer({ publicOrigin: 'http://192.0.2.10:4173' });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await request(server.address().port, { host: '192.0.2.10:4173' });
    assert.equal(response.status, 200);
    assert.equal(response.headers['strict-transport-security'], undefined);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
