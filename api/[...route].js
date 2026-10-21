import { list, put, get, del } from '@vercel/blob';
import { randomBytes, scryptSync, timingSafeEqual, createHmac } from 'node:crypto';

const COOKIE = 'kronix_session';
const MAX_BODY = 30_000;
const json = (res, status, data) => { res.statusCode = status; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'no-store'); res.end(JSON.stringify(data)); };
const fail = (res, status, message) => json(res, status, { error: message });
const safeUser = ({ passwordHash, passwordSalt, ...user }) => user;
function hashPassword(password, salt = randomBytes(16).toString('hex')) { return { passwordSalt: salt, passwordHash: scryptSync(password, salt, 64).toString('hex') }; }
function verifyPassword(password, user) {
  try { const actual = scryptSync(password, user.passwordSalt, 64); const expected = Buffer.from(user.passwordHash, 'hex'); return actual.length === expected.length && timingSafeEqual(actual, expected); } catch { return false; }
}
function sign(value) { return createHmac('sha256', process.env.SESSION_SECRET || '').update(value).digest('base64url'); }
function makeCookie(user) {
  const payload = Buffer.from(JSON.stringify({ id: user.id, exp: Date.now() + 1000 * 60 * 60 * 24 * 7 })).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
function readCookie(req) {
  const raw = req.headers.cookie || '';
  const part = raw.split(';').map(x => x.trim()).find(x => x.startsWith(`${COOKIE}=`));
  if (!part) return null;
  const value = decodeURIComponent(part.slice(COOKIE.length + 1));
  const [payload, sig] = value.split('.'); if (!payload || !sig) return null;
  const expected = Buffer.from(sign(payload)); const actual = Buffer.from(sig);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try { const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString()); return parsed.exp > Date.now() ? parsed : null; } catch { return null; }
}
async function readBody(req) {
  let raw = ''; for await (const chunk of req) { raw += chunk; if (raw.length > MAX_BODY) throw new Error('La solicitud es demasiado grande.'); }
  if (!raw) return {}; try { return JSON.parse(raw); } catch { throw new Error('JSON no válido.'); }
}
async function readRecord(pathname) {
  try { const result = await get(pathname, { access: 'private' }); if (!result) return null; return await new Response(result.stream).json(); }
  catch (e) { if (String(e?.message || '').includes('not found') || e?.status === 404) return null; throw e; }
}
async function allRecords(prefix) {
  const result = await list({ prefix, limit: 1000 });
  const rows = await Promise.all(result.blobs.map(async blob => { try { return await readRecord(blob.pathname); } catch { return null; } }));
  return rows.filter(Boolean);
}
async function saveRecord(pathname, record) {
  await put(pathname, JSON.stringify(record), { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json; charset=utf-8' });
}
function validPassword(p) { return typeof p === 'string' && p.length >= 10 && p.length <= 200; }
function validName(s) { return typeof s === 'string' && s.trim().length >= 2 && s.trim().length <= 60; }
function validUserName(s) { return typeof s === 'string' && /^[a-zA-Z0-9_.-]{3,24}$/.test(s); }
function newId() { return randomBytes(12).toString('hex'); }

export default async function handler(req, res) {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'");
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }
  if (!process.env.BLOB_READ_WRITE_TOKEN || !process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) return fail(res, 503, 'Falta configurar BLOB_READ_WRITE_TOKEN o SESSION_SECRET en Vercel.');
  const route = Array.isArray(req.query.route) ? req.query.route.join('/') : String(req.query.route || '');
  try {
    if (route === 'status' && req.method === 'GET') { const users = await allRecords('users/'); return json(res, 200, { hasAdmin: users.some(u => u.role === 'admin' && u.active) }); }
    if (route === 'bootstrap' && req.method === 'POST') {
      const body = await readBody(req);
      const suppliedSecret = Buffer.from(String(body.secret || '')); const configuredSecret = Buffer.from(process.env.BOOTSTRAP_SECRET || 'not-configured'); if (!process.env.BOOTSTRAP_SECRET || suppliedSecret.length !== configuredSecret.length || !timingSafeEqual(suppliedSecret, configuredSecret)) return fail(res, 403, 'Clave inicial incorrecta.');
      const users = await allRecords('users/');
      if (users.some(u => u.role === 'admin' && u.active)) return fail(res, 409, 'Ya existe un administrador. Usa el panel para crear cuentas.');
      if (!validUserName(body.username) || !validPassword(body.password) || !validName(body.name)) return fail(res, 400, 'Nombre, usuario o contraseña no válidos. Usa una contraseña de al menos 10 caracteres.');
      if (users.some(u => u.username.toLowerCase() === body.username.toLowerCase())) return fail(res, 409, 'Ese usuario ya existe.');
      const id = newId(); const now = new Date().toISOString();
      const user = { id, username: body.username, name: body.name.trim(), role: 'admin', active: true, createdAt: now, ...hashPassword(body.password) };
      await saveRecord(`users/${id}.json`, user);
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeCookie(user))}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
      return json(res, 201, { user: safeUser(user) });
    }
    if (route === 'login' && req.method === 'POST') {
      const body = await readBody(req); if (typeof body.username !== 'string' || typeof body.password !== 'string') return fail(res, 400, 'Introduce usuario y contraseña.');
      const users = await allRecords('users/'); const user = users.find(u => u.username.toLowerCase() === body.username.toLowerCase());
      if (!user || !user.active || !verifyPassword(body.password, user)) return fail(res, 401, 'Usuario o contraseña incorrectos.');
      res.setHeader('Set-Cookie', `${COOKIE}=${encodeURIComponent(makeCookie(user))}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=604800`);
      return json(res, 200, { user: safeUser(user) });
    }
    if (route === 'logout' && req.method === 'POST') { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`); return json(res, 200, { ok: true }); }
    const session = readCookie(req);
    if (!session) return fail(res, 401, 'Inicia sesión para continuar.');
    const current = await readRecord(`users/${session.id}.json`);
    if (!current || !current.active) { res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0`); return fail(res, 401, 'La cuenta no está activa.'); }
    if (route === 'me' && req.method === 'GET') return json(res, 200, { user: safeUser(current) });
    const isAdmin = current.role === 'admin';
    if (route === 'users' && req.method === 'GET') {
      if (!isAdmin) return fail(res, 403, 'Solo administradores pueden gestionar cuentas.');
      return json(res, 200, { users: (await allRecords('users/')).map(safeUser).sort((a,b) => a.username.localeCompare(b.username)) });
    }
    if (route === 'users' && req.method === 'POST') {
      if (!isAdmin) return fail(res, 403, 'Solo administradores pueden crear cuentas.');
      const body = await readBody(req); if (!validUserName(body.username) || !validName(body.name) || !validPassword(body.password) || !['member','admin'].includes(body.role)) return fail(res, 400, 'Datos no válidos. Usuario: 3-24 caracteres; contraseña: mínimo 10.');
      const users = await allRecords('users/'); if (users.some(u => u.username.toLowerCase() === body.username.toLowerCase())) return fail(res, 409, 'Ese usuario ya existe.');
      const id = newId(); const user = { id, username: body.username, name: body.name.trim(), role: body.role, active: true, createdAt: new Date().toISOString(), ...hashPassword(body.password) };
      await saveRecord(`users/${id}.json`, user); return json(res, 201, { user: safeUser(user) });
    }
    if (route.startsWith('users/') && req.method === 'PATCH') {
      if (!isAdmin) return fail(res, 403, 'Solo administradores pueden modificar cuentas.');
      const id = route.split('/')[1]; const user = await readRecord(`users/${id}.json`); if (!user) return fail(res, 404, 'Cuenta no encontrada.');
      const body = await readBody(req); if (id === current.id && body.active === false) return fail(res, 400, 'No puedes desactivar tu propia cuenta.');
      const willLoseAdmin = user.role === 'admin' && user.active && (body.active === false || body.role === 'member');
      if (willLoseAdmin) { const activeAdmins = (await allRecords('users/')).filter(u => u.role === 'admin' && u.active); if (activeAdmins.length <= 1) return fail(res, 400, 'Debe quedar al menos un administrador activo.'); }
      if (body.active !== undefined) user.active = Boolean(body.active);
      if (body.role !== undefined) { if (!['admin','member'].includes(body.role)) return fail(res, 400, 'Rol no válido.'); user.role = body.role; }
      if (body.password !== undefined) { if (!validPassword(body.password)) return fail(res, 400, 'La contraseña debe tener al menos 10 caracteres.'); Object.assign(user, hashPassword(body.password)); }
      await saveRecord(`users/${id}.json`, user); return json(res, 200, { user: safeUser(user) });
    }
    if (route === 'tasks' && req.method === 'GET') return json(res, 200, { tasks: (await allRecords('tasks/')).sort((a,b) => String(a.dueDate || '9999').localeCompare(String(b.dueDate || '9999'))) });
    if (route === 'tasks' && req.method === 'POST') {
      const body = await readBody(req); if (!validName(body.title) || body.title.length > 120) return fail(res, 400, 'El título debe tener entre 2 y 120 caracteres.');
      const allowed = ['pending','in_progress','completed']; const priorities = ['low','medium','high'];
      if (body.status && !allowed.includes(body.status)) return fail(res, 400, 'Estado no válido.');
      if (body.priority && !priorities.includes(body.priority)) return fail(res, 400, 'Prioridad no válida.');
      const users = await allRecords('users/'); if (body.assigneeId && !users.some(u => u.id === body.assigneeId && u.active)) return fail(res, 400, 'Responsable no válido.');
      const now = new Date().toISOString(); const task = { id: newId(), title: body.title.trim(), description: String(body.description || '').slice(0, 2000), status: body.status || 'pending', priority: body.priority || 'medium', assigneeId: body.assigneeId || '', dueDate: String(body.dueDate || '').slice(0, 10), createdBy: current.id, createdByName: current.name, createdAt: now, updatedAt: now };
      await saveRecord(`tasks/${task.id}.json`, task); return json(res, 201, { task });
    }
    if (route.startsWith('tasks/') && (req.method === 'PATCH' || req.method === 'DELETE')) {
      const id = route.split('/')[1]; const task = await readRecord(`tasks/${id}.json`); if (!task) return fail(res, 404, 'Tarea no encontrada.');
      if (req.method === 'DELETE') { if (!isAdmin) return fail(res, 403, 'Solo administradores pueden eliminar tareas.'); await del(`tasks/${id}.json`, { access: 'private' }); return json(res, 200, { ok: true }); }
      const body = await readBody(req); const allowed = ['pending','in_progress','completed']; const priorities = ['low','medium','high'];
      if (!isAdmin && body.status === undefined) return fail(res, 403, 'Los miembros solo pueden cambiar el estado de las tareas.');
      if (body.status !== undefined) { if (!allowed.includes(body.status)) return fail(res, 400, 'Estado no válido.'); task.status = body.status; }
      if (isAdmin) {
        if (body.title !== undefined) { if (!validName(body.title) || body.title.length > 120) return fail(res, 400, 'Título no válido.'); task.title = body.title.trim(); }
        if (body.description !== undefined) task.description = String(body.description).slice(0,2000);
        if (body.priority !== undefined) { if (!priorities.includes(body.priority)) return fail(res, 400, 'Prioridad no válida.'); task.priority = body.priority; }
        if (body.dueDate !== undefined) task.dueDate = String(body.dueDate).slice(0,10);
        if (body.assigneeId !== undefined) { const users = await allRecords('users/'); if (body.assigneeId && !users.some(u => u.id === body.assigneeId && u.active)) return fail(res, 400, 'Responsable no válido.'); task.assigneeId = body.assigneeId; }
      }
      task.updatedAt = new Date().toISOString(); await saveRecord(`tasks/${id}.json`, task); return json(res, 200, { task });
    }
    return fail(res, 404, 'Ruta no encontrada.');
  } catch (error) {
    console.error('Kronix API error:', error);
    if (error?.message === 'JSON no válido.' || error?.message === 'La solicitud es demasiado grande.') return fail(res, 400, error.message);
    return fail(res, 500, 'Error interno. Revisa los registros de funciones en Vercel.');
  }
}
