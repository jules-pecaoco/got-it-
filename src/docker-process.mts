import { spawn } from 'node:child_process';
export async function docker(args: string[], input = '', timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
    const chunks: Buffer[] = [];
    let bytes = 0,
      limited = false;
    const timer = setTimeout(() => {
      limited = true;
      child.kill();
    }, timeout);
    child.stdout.on('data', (data: Buffer) => {
      bytes += data.length;
      if (bytes > 2_000_000) {
        limited = true;
        child.kill();
      } else chunks.push(data);
    });
    // Runtime diagnostics can contain source; never print them in application logs.
    child.stderr.resume();
    child.stdin.on('error', () => {});
    child.once('error', () => {
      clearTimeout(timer);
      reject(unavailable());
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code || limited) reject(unavailable());
      else resolve(Buffer.concat(chunks).toString('utf8'));
    });
    child.stdin.end(input);
  });
}
function unavailable() {
  return Object.assign(
    new Error(
      'The Docker runtime could not complete this operation. Check Docker and the required runtime image on the execution host.',
    ),
    {
      code: 'WEB_RUNTIME_UNAVAILABLE',
      status: 503,
    },
  );
}
