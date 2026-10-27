import { mkdir, open, readdir, readFile, link, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { parseSavedVariables } from './lua-data.js';
import { accounts, requireCurrentScheduleFormat } from './model.js';

export const MAX_LUA_BYTES = 20 * 1024 * 1024;
export class LibraryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const validId = id => /^[a-f0-9]{64}$/.test(id);
export function createLibraryStore(directory) {
  const location = resolve(directory);
  const filename = id => resolve(location, `${id}.scm`);
  async function metadata(path) {
    const handle = await open(path, 'r');
    try {
      const buffer = Buffer.alloc(4096);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
      const newline = buffer.subarray(0, bytesRead).indexOf(10);
      if (newline < 0) throw Error('Invalid library record');
      const value = JSON.parse(buffer.subarray(0, newline).toString('utf8'));
      if (!validId(value.id) || typeof value.name !== 'string' || typeof value.createdAt !== 'string' || !Number.isInteger(value.bytes)) throw Error('Invalid library record');
      return value;
    } finally { await handle.close(); }
  }
  return {
    async list() {
      let entries;
      try { entries = await readdir(location); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const files = [];
      for (const entry of entries) {
        if (!/^[a-f0-9]{64}\.scm$/.test(entry)) continue;
        files.push(await metadata(resolve(location, entry)));
      }
      return files.sort((a, b) => b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id));
    },
    async save(name, lua) {
      if (typeof name !== 'string') throw new LibraryError(400, 'Provide a friendly name.');
      name = name.trim().normalize('NFC');
      if (!name || [...name].length > 120 || /\p{Cc}/u.test(name)) throw new LibraryError(400, 'Use a name of 1–120 characters without control characters.');
      if (typeof lua !== 'string') throw new LibraryError(400, 'Provide SavedVariables Lua text.');
      const bytes = Buffer.byteLength(lua, 'utf8');
      if (bytes > MAX_LUA_BYTES) throw new LibraryError(413, 'SavedVariables must be at most 20 MiB.');
      try { if (!accounts(parseSavedVariables(lua)).length) throw Error('No accounts'); }
      catch { throw new LibraryError(400, 'Provide valid SmartChatMsg SavedVariables containing an account.'); }
      try { requireCurrentScheduleFormat(parseSavedVariables(lua)); } catch(error) { throw new LibraryError(400,error.message); }
      const id = createHash('sha256').update(name.toLowerCase().normalize('NFC')).digest('hex');
      const file = { id, name, createdAt: new Date().toISOString(), bytes };
      await mkdir(location, { recursive: true });
      const temporary = resolve(location, `${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, 'wx');
        await handle.writeFile(JSON.stringify(file) + '\n' + lua, 'utf8');
        await handle.sync();
        await handle.close(); handle = null;
        try { await link(temporary, filename(id)); }
        catch (error) { if (error.code === 'EEXIST') throw new LibraryError(409, 'That name already exists; choose a unique name.'); throw error; }
        return file;
      } finally { if (handle) await handle.close(); await unlink(temporary).catch(() => {}); }
    },
    async load(id) {
      if (!validId(id)) throw new LibraryError(404, 'Shared file not found.');
      let data;
      try { data = await readFile(filename(id)); }
      catch (error) { if (error.code === 'ENOENT') throw new LibraryError(404, 'Shared file not found.'); throw error; }
      const newline = data.indexOf(10);
      if (newline < 0) throw Error('Invalid library record');
      return data.subarray(newline + 1);
    },
  };
}
