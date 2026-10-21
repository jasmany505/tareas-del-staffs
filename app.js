import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const $ = (id) => document.getElementById(id);
const statusLabels = { pending: 'Pendiente', submitted: 'En revisión', approved: 'Aprobada', rejected: 'Rechazada' };
const priorityLabels = { normal: 'Prioridad normal', alta: 'Prioridad alta', urgente: 'Urgente' };
let supabase = null, currentUser = null, profile = null, tasks = [], staffOptions = [], activeTask = null, toastTimer = null;

function showToast(message) {
  const el = $('toast'); el.textContent = message; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 3600);
}
function safeText(value='') {
  return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function dateText(value) {
  if (!value) return 'Sin fecha límite';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? 'Fecha no válida' : new Intl.DateTimeFormat('es-EC', { dateStyle:'medium', timeStyle:'short' }).format(d);
}
function isOwner() { return profile?.role === 'owner'; }
function setBusy(button, busy, label='Procesando…') {
  if (!button) return;
  if (busy) { button.dataset.oldText = button.textContent; button.textContent = label; button.disabled = true; }
  else { button.textContent = button.dataset.oldText || button.textContent; button.disabled = false; }
}
function showLoginError(message) { $('login-error').textContent = message || ''; }
function setLoggedInView(on) {
  $('login-view').classList.toggle('hidden', on);
  $('app-view').classList.toggle('hidden', !on);
  $('user-area').classList.toggle('hidden', !on);
}
async function loadProfile(user) {
  const { data, error } = await supabase.from('profiles').select('id, display_name, role, active').eq('id', user.id).maybeSingle();
  if (error) throw error;
  if (!data || !data.active) throw new Error('Tu cuenta no está activada. Contacta con un Owner.');
  return data;
}
async function enterApp(session) {
  currentUser = session.user;
  try {
    profile = await loadProfile(currentUser);
    $('user-label').textContent = profile.display_name || currentUser.email;
    $('welcome-title').textContent = `Hola, ${profile.display_name || 'staff'}`;
    $('role-badge').textContent = isOwner() ? 'OWNER' : 'STAFF';
    $('owner-tools').classList.toggle('hidden', !isOwner());
    $('owner-users').classList.toggle('hidden', !isOwner());
    $('tasks-heading').textContent = isOwner() ? 'Todas las tareas' : 'Mis tareas';
    setLoggedInView(true);
    await Promise.all([loadTasks(), loadHistory(), isOwner() ? loadStaffOptions() : Promise.resolve()]);
  } catch (e) {
    await supabase.auth.signOut();
    currentUser = profile = null; setLoggedInView(false);
    showLoginError(e.message || 'No se pudo cargar tu perfil.');
  }
}
async function login(e) {
  e.preventDefault(); showLoginError();
  const btn = $('login-btn'); setBusy(btn, true, 'Entrando…');
  const { error } = await supabase.auth.signInWithPassword({ email: $('email').value.trim(), password: $('password').value });
  setBusy(btn, false);
  if (error) { showLoginError('No se pudo iniciar sesión. Comprueba tus datos o contacta con un Owner.'); return; }
  const { data: { session } } = await supabase.auth.getSession();
  if (session) await enterApp(session);
}
async function logout() {
  await supabase.auth.signOut();
  currentUser = profile = null; tasks = [];
  setLoggedInView(false); $('login-form').reset(); showLoginError();
}
async function createUser(e) {
  e.preventDefault();
  if (!isOwner()) return;
  const btn = $('user-form').querySelector('button[type=submit]');
  const message = $('user-message'); message.textContent = '';
  const password = $('new-user-password').value;
  if (password.length < 12) { message.textContent = 'La contraseña debe tener al menos 12 caracteres.'; return; }
  setBusy(btn, true, 'Creando cuenta…');
  const { data, error } = await supabase.functions.invoke('create-staff', {
    body: {
      email: $('new-user-email').value.trim(),
      password,
      display_name: $('new-user-name').value.trim(),
      role: $('new-user-role').value
    }
  });
  setBusy(btn, false);
  if (error || data?.error) {
    message.textContent = data?.error || 'No se pudo crear la cuenta. Comprueba que la función create-staff está desplegada.';
    return;
  }
  $('user-form').reset();
  message.textContent = `Cuenta creada para ${data.user.display_name} (${data.user.role}).`;
  showToast('Cuenta creada correctamente.');
  await loadStaffOptions();
}
async function loadTasks() {
  $('tasks-list').innerHTML = '<div class="empty-state">Cargando tareas…</div>';
  let query = supabase.from('tasks').select('id,title,description,assignee_id,created_by,due_at,priority,status,created_at,updated_at,profiles!tasks_assignee_id_fkey(display_name)').order('created_at', { ascending:false });
  if (!isOwner()) query = query.eq('assignee_id', currentUser.id);
  const { data, error } = await query;
  if (error) { $('tasks-list').innerHTML = '<div class="empty-state">No se pudieron cargar las tareas. Revisa la configuración de Supabase.</div>'; return; }
  tasks = data || []; renderTasks();
}
function renderTasks() {
  const filter = $('status-filter').value;
  const visible = tasks.filter(t => filter === 'all' || t.status === filter);
  $('stat-total').textContent = tasks.length;
  $('stat-pending').textContent = tasks.filter(t => t.status === 'pending' || t.status === 'rejected').length;
  $('stat-review').textContent = tasks.filter(t => t.status === 'submitted').length;
  $('stat-done').textContent = tasks.filter(t => t.status === 'approved').length;
  if (!visible.length) { $('tasks-list').innerHTML = '<div class="empty-state">No hay tareas para mostrar con este filtro.</div>'; return; }
  $('tasks-list').innerHTML = visible.map(t => {
    const late = t.due_at && new Date(t.due_at) < new Date() && !['approved'].includes(t.status);
    const assignee = t.profiles?.display_name || 'Staff';
    let action = '';
    if (!isOwner() && ['pending','rejected'].includes(t.status)) action = `<button class="small-button" data-action="submit" data-id="${t.id}">${t.status==='rejected'?'Volver a entregar':'Subir evidencia'}</button>`;
    if (isOwner() && t.status === 'submitted') action = `<button class="small-button" data-action="review" data-id="${t.id}">Revisar entrega</button>`;
    if (isOwner()) action += `<button class="small-button" data-action="delete" data-id="${t.id}">Eliminar tarea</button>`;
    const due = t.due_at ? `${late ? '⚠ Atrasada · ' : 'Vence · '}${dateText(t.due_at)}` : 'Sin fecha límite';
    return `<article class="task-card"><div><div class="task-topline"><h3>${safeText(t.title)}</h3><span class="status ${t.status}">${safeText(statusLabels[t.status]||t.status)}</span></div><p>${safeText(t.description)}</p><div class="task-meta"><span>◷ ${safeText(due)}</span><span>Prioridad: <b class="priority ${t.priority}">${safeText(priorityLabels[t.priority]||t.priority)}</b></span>${isOwner()?`<span>Asignada a: ${safeText(assignee)}</span>`:''}</div></div><div class="task-actions">${action || (t.status==='submitted'?'<span class="muted">Esperando revisión</span>':t.status==='approved'?'<span class="muted">Trabajo aprobado ✓</span>':'<span class="muted">Sin acciones</span>')}</div></article>`;
  }).join('');
}
async function loadStaffOptions() {
  const { data, error } = await supabase.from('profiles').select('id,display_name,role').eq('active', true).order('display_name');
  if (error) { $('task-assignee').innerHTML = '<option value="">No se pudo cargar</option>'; return; }
  staffOptions = data || [];
  $('task-assignee').innerHTML = '<option value="">Selecciona un miembro del equipo</option>' + staffOptions.map(s => `<option value="${s.id}">${safeText(s.display_name)}${s.role==='owner'?' (Owner)':''}</option>`).join('');
}
async function createTask(e) {
  e.preventDefault();
  if (!isOwner()) return;
  const btn = $('task-form').querySelector('button[type=submit]'); setBusy(btn,true,'Creando…');
  const dueRaw = $('task-due').value;
  const due = dueRaw ? new Date(dueRaw).toISOString() : null;
  const payload = { title:$('task-title').value.trim(), description:$('task-description').value.trim(), assignee_id:$('task-assignee').value, due_at:due, priority:$('task-priority').value, created_by:currentUser.id };
  const { error } = await supabase.from('tasks').insert(payload);
  setBusy(btn,false);
  if (error) { $('task-message').textContent = 'Error al crear la tarea. Revisa los campos y permisos.'; return; }
  $('task-form').reset(); $('task-message').textContent = 'Tarea creada correctamente.';
  await loadTasks(); await loadHistory(); showToast('Tarea creada.');
  notifyDiscord('task_created', { title:payload.title, assignee:staffOptions.find(s=>s.id===payload.assignee_id)?.display_name || 'Staff', due_at:due }).catch(()=>{});
}
async function notifyDiscord(event, payload) {
  // La función Edge valida el JWT y usa el webhook guardado como secreto del servidor.
  const { data, error } = await supabase.functions.invoke('discord-notify', { body:{ event, ...payload } });
  if (error) console.warn('Discord notification unavailable:', error.message);
  return data;
}
function openSubmission(task) {
  activeTask = task;
  $('dialog-task-id').value = task.id;
  $('dialog-title').textContent = task.title;
  $('dialog-description').textContent = task.description;
  $('submission-note').value = '';
  $('evidence-file').value = '';
  $('submission-message').textContent = '';
  const feedback = $('previous-feedback');
  feedback.classList.toggle('hidden', !(task.status === 'rejected'));
  feedback.textContent = task.status === 'rejected' ? 'La entrega anterior fue rechazada. Revisa el historial y las observaciones del Owner antes de volver a subirla.' : '';
  $('submission-dialog').showModal();
}
async function submitEvidence(e) {
  e.preventDefault();
  const task = tasks.find(t => t.id === $('dialog-task-id').value);
  const file = $('evidence-file').files?.[0];
  if (!task || !file) return;
  if (!['image/jpeg','image/png','image/webp','image/gif'].includes(file.type)) { $('submission-message').textContent = 'El archivo debe ser una imagen JPG, PNG, WEBP o GIF.'; return; }
  if (file.size > 8*1024*1024) { $('submission-message').textContent = 'La imagen supera el límite de 8 MB.'; return; }
  const btn = $('submit-evidence-btn'); setBusy(btn,true,'Subiendo imagen…');
  const ext = ({'image/jpeg':'jpg','image/png':'png','image/webp':'webp','image/gif':'gif'})[file.type];
  const path = `${currentUser.id}/${task.id}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from('task-evidence').upload(path,file,{ contentType:file.type, upsert:false });
  if (upload.error) { setBusy(btn,false); $('submission-message').textContent = 'No se pudo subir la imagen. Comprueba el bucket privado y sus políticas.'; return; }
  const { error } = await supabase.from('task_submissions').insert({ task_id:task.id, staff_id:currentUser.id, evidence_path:path, note:$('submission-note').value.trim() });
  if (error) {
    await supabase.storage.from('task-evidence').remove([path]);
    setBusy(btn,false); $('submission-message').textContent = 'No se pudo registrar la entrega. Inténtalo otra vez.'; return;
  }
  setBusy(btn,false); $('submission-dialog').close(); showToast('Evidencia enviada a revisión.');
  await Promise.all([loadTasks(),loadHistory()]);
  notifyDiscord('submission_created',{ task_title:task.title, staff_name:profile.display_name }).catch(()=>{});
}
async function loadHistory() {
  const { data, error } = await supabase.from('task_submissions').select('id,task_id,staff_id,evidence_path,note,review_status,review_note,created_at,reviewed_at,tasks(title),staff:profiles!task_submissions_staff_id_fkey(display_name)').order('created_at',{ascending:false}).limit(50);
  if (error) { $('history-list').innerHTML = '<p class="muted">No se pudo cargar el historial.</p>'; return; }
  if (!data?.length) { $('history-list').innerHTML = '<p class="muted">Todavía no hay entregas registradas.</p>'; return; }
  $('history-list').innerHTML = data.map(s => {
    const name = s.tasks?.title || 'Tarea';
    const staff = s.staff?.display_name || 'Staff';
    const status = s.review_status === 'approved' ? 'Aprobada' : s.review_status === 'rejected' ? 'Rechazada' : 'En revisión';
    const review = s.review_note ? `<p>Observación del Owner: ${safeText(s.review_note)}</p>` : '';
    const canReview = isOwner() && s.review_status === 'submitted';
    return `<article class="history-item"><div><b>${safeText(name)}</b><p>${isOwner()?`${safeText(staff)} · `:''}${safeText(dateText(s.created_at))} · ${safeText(status)}</p>${s.note?`<p>Comentario: ${safeText(s.note)}</p>`:''}${review}</div><div class="task-actions"><button class="small-button" data-action="image" data-path="${safeText(s.evidence_path)}">Ver imagen</button>${canReview?`<button class="small-button" data-action="review-submission" data-id="${s.id}" data-task="${s.task_id}">Aceptar / rechazar</button>`:''}</div></article>`;
  }).join('');
}
async function viewEvidence(path) {
  const { data, error } = await supabase.storage.from('task-evidence').createSignedUrl(path,60);
  if (error || !data?.signedUrl) { showToast('No se pudo abrir la imagen. Comprueba los permisos.'); return; }
  window.open(data.signedUrl,'_blank','noopener,noreferrer');
}
async function reviewSubmission(submissionId, taskId) {
  if (!isOwner()) return;
  const action = prompt('Escribe A para aprobar o R para rechazar esta entrega:');
  if (!action) return;
  const choice = action.trim().toLowerCase();
  if (!['a','aprobar','r','rechazar'].includes(choice)) { showToast('Opción no válida.'); return; }
  let reviewNote = '';
  if (['r','rechazar'].includes(choice)) {
    reviewNote = prompt('Indica el motivo del rechazo (obligatorio):')?.trim() || '';
    if (!reviewNote) { showToast('Para rechazar debes escribir un motivo.'); return; }
  }
  const status = ['a','aprobar'].includes(choice) ? 'approved':'rejected';
  const { error } = await supabase.from('task_submissions').update({review_status:status,review_note:reviewNote,reviewed_by:currentUser.id,reviewed_at:new Date().toISOString()}).eq('id',submissionId);
  if (error) { showToast('No se pudo guardar la revisión.'); return; }
  // La política/trigger de SQL sincroniza el estado de la tarea con la entrega revisada.
  await Promise.all([loadTasks(),loadHistory()]);
  showToast(status==='approved'?'Entrega aprobada.':'Entrega rechazada.');
  const task = tasks.find(t=>t.id===taskId);
  notifyDiscord('submission_reviewed',{task_title:task?.title||'Tarea',result:status,review_note:reviewNote}).catch(()=>{});
}
async function deleteTask(id) {
  if (!isOwner() || !confirm('¿Eliminar esta tarea y sus registros de entrega? Esta acción no se puede deshacer.')) return;
  const { error } = await supabase.from('tasks').delete().eq('id',id);
  if (error) { showToast('No se pudo eliminar la tarea.'); return; }
  await Promise.all([loadTasks(),loadHistory()]); showToast('Tarea eliminada.');
}
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-action]'); if (!btn) return;
  const { action, id, path, task } = btn.dataset;
  if (action === 'submit') { const t=tasks.find(x=>x.id===id); if(t) openSubmission(t); }
  if (action === 'review') {
    const t=tasks.find(x=>x.id===id);
    const {data,error}=await supabase.from('task_submissions').select('id').eq('task_id',id).eq('review_status','submitted').order('created_at',{ascending:false}).limit(1).maybeSingle();
    if(error||!data){showToast('No se encontró una entrega pendiente.');return;} await reviewSubmission(data.id,id);
  }
  if (action === 'review-submission') await reviewSubmission(id,task);
  if (action === 'image') await viewEvidence(path);
  if (action === 'delete') await deleteTask(id);
});
$('login-form').addEventListener('submit', login);
$('logout-btn').addEventListener('click', logout);
$('task-form').addEventListener('submit', createTask);
$('user-form').addEventListener('submit', createUser);
$('submission-form').addEventListener('submit', submitEvidence);
$('close-dialog').addEventListener('click', ()=>$('submission-dialog').close());
$('status-filter').addEventListener('change',renderTasks);
$('submission-dialog').addEventListener('click',e=>{if(e.target===$('submission-dialog'))$('submission-dialog').close();});

async function init() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY || SUPABASE_URL.includes('TU-PROYECTO') || SUPABASE_ANON_KEY.includes('PEGA_AQUI')) {
    showLoginError('Falta configurar src/config.js con la URL y la clave pública (anon/publishable) de Supabase.');
    $('login-btn').disabled = true; return;
  }
  supabase = window.supabase.createClient(SUPABASE_URL,SUPABASE_ANON_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
  const {data:{session}}=await supabase.auth.getSession();
  if(session) await enterApp(session);
  supabase.auth.onAuthStateChange((_event,session)=>{
    if(session && !profile) setTimeout(()=>enterApp(session),0);
    if(!session){currentUser=profile=null;setLoggedInView(false);}
  });
}
init();
