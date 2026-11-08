const requested = new WeakSet();

// Windows child.kill() terminates the process without running JS signal handlers.
// An inherited IPC channel lets both platforms use the application's drain path.
export function requestChildShutdown(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null || requested.has(child)) return;
  requested.add(child);
  const timeout = setTimeout(() => child.kill(), 45000);
  timeout.unref();
  child.once('exit', () => clearTimeout(timeout));
  if (child.connected)
    child.send({ type: 'gotit:shutdown' }, (error) => {
      if (error) child.kill();
    });
  else child.kill();
}
