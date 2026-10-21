const $ = (selector) => document.querySelector(selector);
const state = { user: null, tasks: [], users: [], search: '', status: 'all' };
const labels = { pending: 'Pendiente', in_progress: 'En proceso', completed: 'Completada', low: 'Baja', medium: 'Media', high: 'Alta', member: 'Miembro', admin: 'Administrador' };
const api = async (path, options = {}) => {
  const response = await fetch(`/api/${path}`, { credentials: 'same-origin', headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
  return data;
};
function escapeHtml(value = '') { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function toast(message, bad = false) { const el = $('#toast'); el.textContent = message; el.className = `toast show${bad ? ' bad' : ''}`; clearTimeout(toast.timer); toast.timer = setTimeout(() => el.className = 'toast', 2800); }
function setError(selector, message) { $(selector).textContent = message || ''; }
function show(view) { ['#login-view', '#bootstrap-view', '#app-view'].forEach(id => $(id).classList.toggle('hidden', id !== view)); }
function setUserChip() { const el = $('#user-chip'); if (!state.user) { el.classList.add('hidden'); return; } el.textContent = `${state.user.name} · ${labels[state.user.role]}`; el.classList.remove('hidden'); }
async function init() {
  $('#current-year').textContent = new Date().getFullYear();
  $('#login-form').addEventListener('submit', login);
  $('#bootstrap-form').addEventListener('submit', bootstrap);
  $('#logout-button').addEventListener('click', logout);
  $('#new-task-button').addEventListener('click', () => openTaskDialog());
  $('#new-user-button').addEventListener('click', () => openUserDialog());
  $('#task-form').addEventListener('submit', saveTask);
  $('#user-form').addEventListener('submit', saveUser);
  $('#search-input').addEventListener('input', e => { state.search = e.target.value.toLowerCase(); renderTasks(); });
  $('#status-filter').addEventListener('change', e => { state.status = e.target.value; renderTasks(); });
  document.querySelectorAll('[data-close]').forEach(button => button.addEventListener('click', () => $(`#${button.dataset.close}`).close()));
  $('#task-list').addEventListener('click', taskAction);
  $('#task-list').addEventListener('change', taskStatusChange);
  $('#user-list').addEventListener('click', userAction);
  try {
    const { hasAdmin } = await api('status');
    if (!hasAdmin) { show('#bootstrap-view'); return; }
    try { const data = await api('me'); state.user = data.user; await loadApp(); }
    catch { show('#login-view'); }
  } catch (e) { show('#login-view'); setError('#login-error', `${e.message} Comprueba las variables de entorno de Vercel.`); }
}
async function login(event) {
  event.preventDefault(); setError('#login-error', ''); const form = new FormData(event.currentTarget);
  try { const data = await api('login', { method: 'POST', body: JSON.stringify({ username: form.get('username'), password: form.get('password') }) }); state.user = data.user; event.currentTarget.reset(); await loadApp(); }
  catch (e) { setError('#login-error', e.message); }
}
async function bootstrap(event) {
  event.preventDefault(); setError('#bootstrap-error', ''); const form = new FormData(event.currentTarget);
  try { const data = await api('bootstrap', { method: 'POST', body: JSON.stringify({ name: form.get('name'), username: form.get('username'), password: form.get('password'), secret: form.get('secret') }) }); state.user = data.user; event.currentTarget.reset(); toast('Administrador principal creado.'); await loadApp(); }
  catch (e) { setError('#bootstrap-error', e.message); }
}
async function logout() { try { await api('logout', { method: 'POST', body: '{}' }); } catch {} state.user = null; state.tasks = []; state.users = []; setUserChip(); show('#login-view'); toast('Sesión cerrada.'); }
async function loadApp() {
  setUserChip(); show('#app-view'); $('#welcome-text').textContent = `Bienvenido, ${state.user.name}. Todas las tareas son visibles para el equipo.`;
  document.querySelectorAll('.admin-only').forEach(el => el.classList.toggle('hidden', state.user.role !== 'admin'));
  $('#admin-panel').classList.toggle('hidden', state.user.role !== 'admin');
  if (state.user.role === 'admin') await loadUsers(); else state.users = [];
  await loadTasks();
}
async function loadTasks() { try { const data = await api('tasks'); state.tasks = data.tasks; renderTasks(); renderStats(); } catch (e) { $('#task-list').innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; } }
async function loadUsers() { try { const data = await api('users'); state.users = data.users; renderUsers(); fillAssignees(); } catch (e) { $('#user-list').innerHTML = `<div class="empty-state">${escapeHtml(e.message)}</div>`; } }
function renderStats() { $('#stat-total').textContent = state.tasks.length; $('#stat-pending').textContent = state.tasks.filter(t => t.status === 'pending').length; $('#stat-progress').textContent = state.tasks.filter(t => t.status === 'in_progress').length; $('#stat-done').textContent = state.tasks.filter(t => t.status === 'completed').length; }
function userById(id) { return state.users.find(u => u.id === id); }
function renderTasks() {
  const users = state.users; const filtered = state.tasks.filter(task => (state.status === 'all' || task.status === state.status) && `${task.title} ${task.description} ${task.createdByName} ${userById(task.assigneeId)?.name || ''}`.toLowerCase().includes(state.search));
  $('#task-count').textContent = `${filtered.length} ${filtered.length === 1 ? 'tarea' : 'tareas'}`;
  if (!filtered.length) { $('#task-list').innerHTML = '<div class="empty-state">No hay tareas que coincidan con el filtro.</div>'; return; }
  $('#task-list').innerHTML = filtered.map(task => {
    const assignee = userById(task.assigneeId); const due = task.dueDate ? new Date(`${task.dueDate}T12:00:00`).toLocaleDateString('es-EC', { day: '2-digit', month: 'short', year: 'numeric' }) : 'Sin fecha límite';
    const actions = state.user.role === 'admin' ? `<button data-action="edit" data-id="${task.id}">Editar</button><button data-action="delete" data-id="${task.id}">Eliminar</button>` : '';
    const statusControl = `<select aria-label="Cambiar estado" data-status-id="${task.id}">${['pending','in_progress','completed'].map(s => `<option value="${s}" ${task.status === s ? 'selected' : ''}>${labels[s]}</option>`).join('')}</select>`;
    return `<article class="task-card"><div><div class="task-title-line"><h3>${escapeHtml(task.title)}</h3><span class="pill ${task.status}">${labels[task.status]}</span><span class="pill ${task.priority}">Prioridad ${labels[task.priority].toLowerCase()}</span></div>${task.description ? `<p class="task-desc">${escapeHtml(task.description)}</p>` : ''}<div class="task-meta"><span>Responsable: ${escapeHtml(assignee?.name || 'Sin asignar')}</span><span>Fecha: ${escapeHtml(due)}</span><span>Creada por: ${escapeHtml(task.createdByName)}</span></div></div><div class="task-actions">${statusControl}${actions}</div></article>`;
  }).join('');
}
function renderUsers() {
  $('#user-list').innerHTML = state.users.map(user => `<div class="user-row"><div><b>${escapeHtml(user.name)} ${user.id === state.user.id ? '(tú)' : ''}</b><small>@${escapeHtml(user.username)} · ${labels[user.role]} · ${user.active ? 'Activa' : 'Desactivada'}</small></div><div class="user-actions"><button data-user-action="edit" data-id="${user.id}">Gestionar</button>${user.id !== state.user.id ? `<button class="${user.active ? 'danger' : ''}" data-user-action="toggle" data-active="${user.active}" data-id="${user.id}">${user.active ? 'Desactivar' : 'Activar'}</button>` : ''}</div></div>`).join('') || '<div class="empty-state">Todavía no hay miembros.</div>';
}
function fillAssignees(selected = '') { const active = state.users.filter(u => u.active); $('#assignee-select').innerHTML = '<option value="">Sin asignar</option>' + active.map(u => `<option value="${u.id}" ${selected === u.id ? 'selected' : ''}>${escapeHtml(u.name)} (@${escapeHtml(u.username)})</option>`).join(''); }
function openTaskDialog(task = null) {
  const form = $('#task-form'); form.reset(); setError('#task-form-error', ''); form.elements.id.value = task?.id || ''; $('#task-dialog-title').textContent = task ? 'Editar tarea' : 'Nueva tarea';
  form.elements.title.value = task?.title || ''; form.elements.description.value = task?.description || ''; form.elements.priority.value = task?.priority || 'medium'; form.elements.status.value = task?.status || 'pending'; form.elements.dueDate.value = task?.dueDate || ''; fillAssignees(task?.assigneeId || ''); $('#task-dialog').showModal();
}
async function saveTask(event) {
  event.preventDefault(); setError('#task-form-error', ''); const f = new FormData(event.currentTarget); const id = f.get('id'); const body = { title: f.get('title'), description: f.get('description'), priority: f.get('priority'), status: f.get('status'), dueDate: f.get('dueDate'), assigneeId: f.get('assigneeId') };
  try { await api(id ? `tasks/${id}` : 'tasks', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); $('#task-dialog').close(); await loadTasks(); toast(id ? 'Tarea actualizada.' : 'Tarea creada.'); }
  catch (e) { setError('#task-form-error', e.message); }
}
async function taskAction(event) { const button = event.target.closest('button[data-action]'); if (!button) return; const task = state.tasks.find(t => t.id === button.dataset.id); if (!task) return; if (button.dataset.action === 'edit') openTaskDialog(task); if (button.dataset.action === 'delete' && confirm(`¿Eliminar la tarea «${task.title}»? Esta acción no se puede deshacer.`)) { try { await api(`tasks/${task.id}`, { method: 'DELETE' }); await loadTasks(); toast('Tarea eliminada.'); } catch (e) { toast(e.message, true); } } }
async function taskStatusChange(event) { const select = event.target.closest('select[data-status-id]'); if (!select) return; try { await api(`tasks/${select.dataset.statusId}`, { method: 'PATCH', body: JSON.stringify({ status: select.value }) }); await loadTasks(); toast('Estado actualizado.'); } catch (e) { toast(e.message, true); await loadTasks(); } }
function openUserDialog(user = null) {
  const form = $('#user-form'); form.reset(); setError('#user-form-error', ''); form.elements.id.value = user?.id || ''; $('#user-dialog-title').textContent = user ? `Gestionar @${user.username}` : 'Crear cuenta';
  form.elements.name.value = user?.name || ''; form.elements.username.value = user?.username || ''; form.elements.role.value = user?.role || 'member'; form.elements.password.value = '';
  form.elements.name.disabled = Boolean(user); form.elements.username.disabled = Boolean(user); form.elements.password.required = !user; form.elements.password.placeholder = user ? 'Dejar vacío para mantenerla' : 'Contraseña temporal'; $('#user-dialog').showModal();
}
async function saveUser(event) {
  event.preventDefault(); setError('#user-form-error', ''); const f = new FormData(event.currentTarget); const id = f.get('id'); const password = f.get('password');
  const body = id ? { role: f.get('role'), ...(password ? { password } : {}) } : { name: f.get('name'), username: f.get('username'), password, role: f.get('role') };
  try { await api(id ? `users/${id}` : 'users', { method: id ? 'PATCH' : 'POST', body: JSON.stringify(body) }); $('#user-dialog').close(); await loadUsers(); toast(id ? 'Cuenta actualizada.' : 'Cuenta creada.'); }
  catch (e) { setError('#user-form-error', e.message); }
}
async function userAction(event) {
  const button = event.target.closest('button[data-user-action]'); if (!button) return; const user = state.users.find(u => u.id === button.dataset.id); if (!user) return;
  if (button.dataset.userAction === 'edit') { openUserDialog(user); return; }
  if (button.dataset.userAction === 'toggle') { const active = button.dataset.active !== 'true'; if (!confirm(`${active ? '¿Activar' : '¿Desactivar'} la cuenta de @${user.username}?`)) return; try { await api(`users/${user.id}`, { method: 'PATCH', body: JSON.stringify({ active }) }); await loadUsers(); toast(active ? 'Cuenta activada.' : 'Cuenta desactivada.'); } catch (e) { toast(e.message, true); } }
}
init();
