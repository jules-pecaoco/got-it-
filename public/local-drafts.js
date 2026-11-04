// Local copies contain answers, never credentials. Remove them after acknowledgement.
const prefix = 'gotit:draft:';
export function localDraft(sessionId, activityId, storage) {
  const key = `${prefix}${sessionId}:${activityId}`;
  return {
    read() {
      try {
        const target = storage ?? globalThis.localStorage;
        const value = JSON.parse(target.getItem(key));
        if (value?.at < Date.now() - 86400000) {
          target.removeItem(key);
          return null;
        }
        return value;
      } catch {
        return null;
      }
    },
    write(response, baseRevision) {
      try {
        (storage ?? globalThis.localStorage).setItem(
          key,
          JSON.stringify({ response, baseRevision, at: Date.now() }),
        );
        return true;
      } catch {
        return false;
      }
    },
    clear() {
      try {
        (storage ?? globalThis.localStorage).removeItem(key);
      } catch {
        /* Server copy remains available. */
      }
    },
  };
}
export function clearLocalDrafts(sessionId, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    for (const key of Object.keys(target))
      if (key.startsWith(`${prefix}${sessionId}:`)) target.removeItem(key);
  } catch {
    /* Optional storage. */
  }
}
