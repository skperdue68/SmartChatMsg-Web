import { readFile, open, rename, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomBytes, randomUUID, scryptSync } from 'node:crypto';

// Administrator-only filesystem operation. Stop the web service before calling.
export async function resetLibraryPassword(directory, name, password) {
  if (typeof name !== 'string' || !name.trim()) throw Error('Provide the saved file name.');
  if (typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) throw Error('Use a nonempty password of at most 1024 bytes.');
  const id = createHash('sha256').update(name.trim().normalize('NFC').toLowerCase().normalize('NFC')).digest('hex');
  const path = resolve(directory, `${id}.scm`);
  const data = await readFile(path);
  const newline = data.indexOf(10);
  if (newline < 0) throw Error('Invalid library record.');
  const record = JSON.parse(data.subarray(0, newline).toString('utf8'));
  if (record.id !== id || typeof record.name !== 'string') throw Error('Invalid library record.');
  record.passwordSalt = randomBytes(16).toString('hex');
  record.passwordHash = scryptSync(password, record.passwordSalt, 64).toString('hex');
  const temporary = resolve(directory, `${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await open(temporary, 'wx', 0o600);
    await handle.writeFile(Buffer.concat([Buffer.from(JSON.stringify(record) + '\n'), data.subarray(newline + 1)]));
    await handle.sync(); await handle.close(); handle = null;
    await rename(temporary, path);
  } finally {
    if (handle) await handle.close();
    await unlink(temporary).catch(() => {});
  }
  return record.name;
}
