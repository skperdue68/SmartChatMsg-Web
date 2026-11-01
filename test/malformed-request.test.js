import test from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { createServer } from '../src/server.js';

// Sends a raw HTTP/1.1 request line so the client does not normalise the target.
function raw(port, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(port, '127.0.0.1', () => socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nConnection: close\r\n\r\n`));
    let out = '';
    socket.on('data', chunk => out += chunk);
    socket.on('close', () => resolve(out.split('\r\n')[0]));
    socket.on('error', reject);
  });
}

test('malformed request targets get a 400 and do not crash the server', async () => {
  const server = createServer({});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  try {
    for (const target of ['//[', '//[::1', 'http://[']) assert.match(await raw(port, target), /^HTTP\/1\.1 400 /, target);
    // The same server must still answer normal requests afterwards.
    assert.match(await raw(port, '/'), /^HTTP\/1\.1 200 /);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
