import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { resetLibraryPassword } from '../src/library-password-reset.js';

const args = process.argv.slice(2);
if (args.length !== 1 || ['--help', '-h'].includes(args[0])) {
  console.log('Usage: npm run library:reset-password -- "Saved configuration name"\nStop scm-web first. Uses LIBRARY_DIR from .env, or data/shared-library.');
  process.exit(args.length === 1 ? 0 : 1);
}
if (!process.stdin.isTTY) {
  console.error('Run this command in an interactive terminal. Passwords are not accepted as command arguments.');
  process.exit(1);
}
let muted = false;
const output = new Writable({write(chunk, encoding, callback) { if (!muted) process.stdout.write(chunk, encoding); callback(); }});
const rl = createInterface({input: process.stdin, output, terminal: true});
try {
  process.stdout.write('New password: '); muted = true;
  const password = await rl.question(''); muted = false; process.stdout.write('\nConfirm password: '); muted = true;
  const confirmation = await rl.question(''); muted = false; process.stdout.write('\n');
  if (password !== confirmation) throw Error('Passwords do not match; nothing changed.');
  const name = await resetLibraryPassword(process.env.LIBRARY_DIR || 'data/shared-library', args[0], password);
  console.log(`Password reset for “${name}”. Start scm-web again.`);
} catch (error) {
  muted = false;
  console.error(error.code === 'ENOENT' ? 'Saved file not found. Check its name and LIBRARY_DIR.' : error.message);
  process.exitCode = 1;
} finally { rl.close(); }
