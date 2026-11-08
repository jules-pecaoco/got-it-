// Independent loops prevent a slow active-preview checkpoint from holding the
// expiry clock. Each loop has at most one sweep in flight.
export function startSettlementTimers(settlement, { expiryMs = 1000, checkpointMs = 15000 } = {}) {
  const pending = new Set();
  function loop(action, interval, code) {
    let running = false;
    const timer = setInterval(() => {
      if (running) return;
      running = true;
      const work = Promise.resolve()
        .then(action)
        .catch((error) => {
          console.error(JSON.stringify({ code, message: error.message }));
        })
        .finally(() => {
          running = false;
          pending.delete(work);
        });
      pending.add(work);
    }, interval);
    timer.unref();
    return timer;
  }
  const expiry = loop(() => settlement.settleExpired(), expiryMs, 'EXPIRY_FAILED');
  const checkpoint = loop(() => settlement.checkpointActive(), checkpointMs, 'CHECKPOINT_FAILED');
  return {
    async stop() {
      clearInterval(expiry);
      clearInterval(checkpoint);
      await Promise.allSettled([...pending]);
    },
  };
}
