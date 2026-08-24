/** Print the connection target without printing the password. Diagnostic only. */
import { assertTestDatabase } from './guard.mjs';
const db = assertTestDatabase();
const u = new URL(db);
console.log('protocol :', u.protocol);
console.log('username :', u.username);
console.log('password :', `${u.password.length} chars`);
console.log('host     :', u.hostname);
console.log('port     :', u.port || '(default)');
console.log('database :', u.pathname);
