// Remove credentials left by older versions. New browser sessions use HttpOnly cookies.
export function clearLegacyCredentials() {
  try {
    for (const key of ['instructorToken', 'candidateToken', 'proctorToken']) sessionStorage.removeItem(key);
  } catch { /* Storage may be disabled. */ }
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith('gotItRunAccess:')) localStorage.removeItem(key);
  } catch { /* Storage may be disabled. */ }
}

export function createRunAccessStore() {
  const entries = new Map();
  return {
    get: runId => entries.get(runId) ?? null,
    set(runId, details) { entries.set(runId, { ...details }); return true; },
    clear() { entries.clear(); }
  };
}

const sessionIds = new Map();
export function randomId() {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export function browserSessionHeaders(role) {
  let id = sessionIds.get(role);
  if (!id) {
    try { id = sessionStorage.getItem(`gotit:browser:${role}`); } catch { /* Optional storage. */ }
    if (!/^[a-f0-9-]{36}$/.test(id ?? '')) id = randomId();
    try { sessionStorage.setItem(`gotit:browser:${role}`, id); } catch { /* Keep this tab usable. */ }
    sessionIds.set(role, id);
  }
  // This identifier selects a tab's HttpOnly cookie; it is not an access token.
  return { 'X-Session-Mode': 'cookie', 'X-Session-Id': id };
}

clearLegacyCredentials();
