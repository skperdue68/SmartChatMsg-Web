import { mkdir, open, readdir, readFile, link, unlink, rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID, randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { readEventBundle } from '../public/portable.js';
import { parseSavedVariables } from './lua-data.js';
import { accounts, requireCurrentScheduleFormat, validateCommandNamesForAddon } from './model.js';

export const MAX_LUA_BYTES = 20 * 1024 * 1024;
export class LibraryError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}
const scrypt=promisify(scryptCallback);
const publicMetadata=({passwordHash,passwordSalt,...record})=>({...record,kind:record.kind||'configuration',protected:Boolean(passwordHash)});
const validId = id => /^[a-f0-9]{64}$/.test(id);
export function createLibraryStore(directory) {
  const location = resolve(directory);
  const pending=new Map();
  async function exclusive(id,action){const prior=pending.get(id)||Promise.resolve();let release;const gate=new Promise(resolve=>release=resolve);pending.set(id,gate);await prior;try{return await action();}finally{release();if(pending.get(id)===gate)pending.delete(id);}}
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
        files.push(publicMetadata(await metadata(resolve(location, entry))));
      }
      return files.sort((a, b) => (b.updatedAt||b.createdAt).localeCompare(a.updatedAt||a.createdAt) || a.id.localeCompare(b.id));
    },
    async save(name, lua, {overwrite=false,password='',kind='configuration'}={}) {
      if(typeof overwrite!=='boolean')throw new LibraryError(400, 'Overwrite must be true or false.');
      if(!['configuration','export'].includes(kind))throw new LibraryError(400,'Choose a full configuration or event export.');
      if(typeof password!=='string'||Buffer.byteLength(password)>1024)throw new LibraryError(400,'Password must be text of at most 1024 bytes.');
      if (typeof name !== 'string') throw new LibraryError(400, 'Provide a friendly name.');
      name = name.trim().normalize('NFC');
      if (!name || [...name].length > 120 || /\p{Cc}/u.test(name)) throw new LibraryError(400, 'Use a name of 1–120 characters without control characters.');
      if (typeof lua !== 'string') throw new LibraryError(400, 'Provide SavedVariables Lua text.');
      const bytes = Buffer.byteLength(lua, 'utf8');
      if (bytes > MAX_LUA_BYTES) throw new LibraryError(413, 'SavedVariables must be at most 20 MiB.');
      if(kind==='export'){
        try { lua=JSON.stringify(readEventBundle(JSON.parse(lua))); }
        catch(error){throw new LibraryError(400,'Invalid event export: '+error.message);}
      }else{
        try { if (!accounts(parseSavedVariables(lua)).length) throw Error('No accounts'); }
        catch { throw new LibraryError(400, 'Provide valid SmartChatMsg SavedVariables containing an account.'); }
        try { validateCommandNamesForAddon(requireCurrentScheduleFormat(parseSavedVariables(lua))); } catch(error) { throw new LibraryError(400,error.message); }
      }
      const id = createHash('sha256').update(name.toLowerCase().normalize('NFC')).digest('hex');
      return exclusive(id,async()=>{
      let existing;
      try { existing=await metadata(filename(id)); }catch(error){if(error.code!=='ENOENT')throw error;}
      if(existing&&!overwrite)throw new LibraryError(409,'That name already exists; choose a unique name or confirm overwrite.');
      if(existing&&(existing.kind||'configuration')!==kind)throw new LibraryError(400,'That name belongs to a different file type. Choose another name.');
      if(existing?.passwordHash){
        const hash=await scrypt(password,existing.passwordSalt,64);
        if(!timingSafeEqual(hash,Buffer.from(existing.passwordHash,'hex')))throw new LibraryError(403,'Incorrect overwrite password.');
      }
      const file={id,name,kind,createdAt:existing?.createdAt||new Date().toISOString(),bytes:Buffer.byteLength(lua)};
      if(existing)file.updatedAt=new Date().toISOString();
      if(existing?.passwordHash){file.passwordHash=existing.passwordHash;file.passwordSalt=existing.passwordSalt;}
      else if(password){file.passwordSalt=randomBytes(16).toString('hex');file.passwordHash=(await scrypt(password,file.passwordSalt,64)).toString('hex');}
      await mkdir(location, { recursive: true });
      const temporary = resolve(location, `${randomUUID()}.tmp`);
      let handle;
      try {
        handle = await open(temporary, 'wx');
        await handle.writeFile(JSON.stringify(file) + '\n' + lua, 'utf8');
        await handle.sync();
        await handle.close(); handle = null;
        try { if(overwrite)await rename(temporary,filename(id));else await link(temporary, filename(id)); }
        catch (error) { if (error.code === 'EEXIST') throw new LibraryError(409, 'That name already exists; choose a unique name.'); throw error; }
        return publicMetadata(file);
      } finally { if (handle) await handle.close(); await unlink(temporary).catch(() => {}); }
      });
    },
    async describe(id) {if(!validId(id))throw new LibraryError(404,'Shared file not found.');try{return publicMetadata(await metadata(filename(id)));}catch(error){if(error.code==='ENOENT')throw new LibraryError(404,'Shared file not found.');throw error;}},
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
