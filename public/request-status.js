const activeRequests = new Map();
let nextRequestId = 0;
let hideTimer = null;

export function beginRequestStatus(label = 'Loading…') {
  const status = document.getElementById('request-status');
  const text = document.getElementById('request-status-text');
  if (!status || !text) return () => {};
  const id = ++nextRequestId;
  activeRequests.set(id, label);
  clearTimeout(hideTimer);
  text.textContent = activeRequests.size === 1 ? label : 'Working…';
  status.classList.remove('hidden');
  status.setAttribute('aria-busy', 'true');
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeRequests.delete(id);
    if (activeRequests.size) {
      text.textContent = activeRequests.size === 1 ? activeRequests.values().next().value : 'Working…';
      return;
    }
    hideTimer = window.setTimeout(() => {
      if (activeRequests.size) return;
      status.classList.add('hidden');
      status.setAttribute('aria-busy', 'false');
    }, 220);
  };
}
