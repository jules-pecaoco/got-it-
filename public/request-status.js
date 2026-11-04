const activeRequests = new Map();
let nextRequestId = 0;
let hideTimer = null;

function updateStatusText(text) {
  text.textContent = [...new Set(activeRequests.values())].join(' · ');
}

export function beginRequestStatus(label) {
  const status = document.getElementById('request-status');
  const text = document.getElementById('request-status-text');
  if (!status || !text) return () => {};
  const id = ++nextRequestId;
  activeRequests.set(id, label);
  clearTimeout(hideTimer);
  updateStatusText(text);
  status.classList.remove('hidden');
  status.setAttribute('aria-busy', 'true');
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    activeRequests.delete(id);
    if (activeRequests.size) {
      updateStatusText(text);
      return;
    }
    hideTimer = window.setTimeout(() => {
      if (activeRequests.size) return;
      status.classList.add('hidden');
      status.setAttribute('aria-busy', 'false');
    }, 220);
  };
}
