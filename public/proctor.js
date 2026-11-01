const $ = id => document.getElementById(id);
const state = { token: sessionStorage.getItem('proctorToken'), view: null, loading: false, timer: null };
const labels = { registered: 'Not started', in_progress: 'In progress', submitted: 'Submitted', expired: 'Time ended' };
const node = (tag, className, content) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (content !== undefined) element.textContent = String(content);
  return element;
};
const timeText = value => value ? new Date(value).toLocaleString() : '—';
const message = value => { $('notice').textContent = value || ''; };

async function request(path, { method = 'GET', data } = {}) {
  const headers = {};
  if (state.token) headers.Authorization = `Bearer ${state.token}`;
  if (data !== undefined) headers['Content-Type'] = 'application/json';
  const response = await fetch(path, { method, headers, body: data === undefined ? undefined : JSON.stringify(data) });
  const result = await response.json();
  if (!response.ok) throw Object.assign(new Error(result.message), { status: response.status });
  return result.data;
}

function showLogin() {
  $('proctor-login-panel').classList.remove('hidden');
  $('proctor-dashboard').classList.add('hidden');
  $('proctor-logout').classList.add('hidden');
  $('proctor-code').value = '';
  state.view = null;
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function showDashboard() {
  $('proctor-login-panel').classList.add('hidden');
  $('proctor-dashboard').classList.remove('hidden');
  $('proctor-logout').classList.remove('hidden');
  if (!state.timer) state.timer = setInterval(() => {
    updateClocks();
    if (!document.hidden && Date.now() - state.lastRefresh >= 15000) loadRun();
  }, 1000);
}

function updateClocks() {
  for (const cell of document.querySelectorAll('[data-deadline]')) {
    const seconds = Math.max(0, Math.ceil((Date.parse(cell.dataset.deadline) - Date.now()) / 1000));
    cell.textContent = seconds ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Time ended';
  }
}

function renderRows() {
  const view = state.view;
  if (!view) return;
  const term = $('proctor-search').value.trim().toLowerCase();
  const filter = $('proctor-filter').value;
  const rows = view.rows.filter(row => (filter === 'all' || row.status === filter) &&
    (!term || `${row.displayName} ${row.candidateId} ${row.section}`.toLowerCase().includes(term)));
  $('proctor-match-count').textContent = `${rows.length} of ${view.rows.length} students`;
  const target = $('proctor-rows');
  target.replaceChildren();
  for (const row of rows) {
    const tr = node('tr');
    const student = node('td');
    student.append(node('strong', '', row.displayName), node('small', '', row.candidateId));
    tr.append(student, node('td', '', row.section));
    const status = node('td');
    status.append(node('span', `proctor-status proctor-status-${row.status}`, labels[row.status] || row.status));
    tr.append(status, node('td', '', `${row.answeredCount} / ${view.questionCount}`),
      node('td', '', timeText(row.lastSubmissionAt)));
    const remaining = node('td', '', '—');
    if (row.status === 'in_progress' && row.deadlineAt) remaining.dataset.deadline = row.deadlineAt;
    tr.append(remaining);
    target.append(tr);
  }
  if (!rows.length) {
    const tr = node('tr'), td = node('td', 'proctor-empty', view.rows.length ? 'No students match this filter.' : 'No students in this run.');
    td.colSpan = 6;
    tr.append(td);
    target.append(tr);
  }
  updateClocks();
}

function renderRun() {
  const view = state.view;
  $('proctor-run-name').textContent = view.name;
  $('proctor-run-meta').textContent = `${view.name === view.activityTitle ? '' : `${view.activityTitle} · `}v${view.version}${view.className ? ` · ${view.className}` : ''} · Closes ${timeText(view.closesAt)}`;
  $('proctor-update').textContent = `Updated ${timeText(view.updatedAt)} · refreshes every 15 seconds`;
  const counts = $('proctor-counts');
  counts.replaceChildren();
  for (const key of ['registered', 'in_progress', 'submitted', 'expired']) {
    const card = node('div', 'proctor-count');
    card.append(node('strong', '', view.counts[key]), node('span', '', labels[key]));
    counts.append(card);
  }
  renderRows();
}

async function loadRun() {
  if (state.loading || !state.token) return;
  state.loading = true;
  state.lastRefresh = Date.now();
  $('proctor-refresh').disabled = true;
  try {
    state.view = await request('/api/proctor/run');
    renderRun();
    showDashboard();
    message('');
  } catch (error) {
    if (error.status === 401) {
      state.token = null;
      sessionStorage.removeItem('proctorToken');
      showLogin();
      message('Proctor access ended. Sign in with a current code.');
    } else {
      message(`Could not refresh the run: ${error.message}`);
    }
  } finally {
    state.loading = false;
    $('proctor-refresh').disabled = false;
  }
}

$('proctor-login').addEventListener('submit', async event => {
  event.preventDefault();
  const button = $('proctor-login').querySelector('button[type="submit"]');
  button.disabled = true;
  message('');
  try {
    const joined = await request('/api/auth/proctor/join', { method: 'POST',
      data: { runId: $('proctor-run-id').value.trim(), code: $('proctor-code').value } });
    state.token = joined.token;
    sessionStorage.setItem('proctorToken', joined.token);
    await loadRun();
  } catch (error) { message(error.message); }
  finally { button.disabled = false; }
});

$('proctor-refresh').addEventListener('click', loadRun);
$('proctor-search').addEventListener('input', renderRows);
$('proctor-filter').addEventListener('change', renderRows);
$('proctor-logout').addEventListener('click', async () => {
  try { await request('/api/proctor/logout', { method: 'POST' }); } catch { /* clear local session */ }
  state.token = null;
  sessionStorage.removeItem('proctorToken');
  showLogin();
  message('Signed out.');
});

const runFromLink = new URLSearchParams(location.search).get('run');
if (runFromLink && /^[a-f0-9-]{36}$/.test(runFromLink)) $('proctor-run-id').value = runFromLink;
try {
  const config = await request('/api/config');
  document.title = `${config.platformLabel} · Proctor`;
  $('platform-label').textContent = config.platformLabel;
  $('platform-tagline').textContent = config.platformTagline || 'Gotta Catch Ed All';
} catch { /* use default label */ }
if (state.token) await loadRun();
else showLogin();
