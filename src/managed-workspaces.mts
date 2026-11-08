import { createHash } from 'node:crypto';
import { hostname } from 'node:os';
import { fileURLToPath } from 'node:url';
import { docker } from './docker-process.mts';

export const workspaceLifetimeSeconds = 720;
export const workspaceCapacity = 80;
export function workspaceOwner() {
  return createHash('sha256')
    .update(
      process.env.EXECUTION_INSTANCE_ID || `${hostname()}:${fileURLToPath(new URL('..', import.meta.url))}`,
    )
    .digest('hex')
    .slice(0, 24);
}
type Docker = typeof docker;
let launching: Promise<unknown> = Promise.resolve();

// Count actual containers, including those left by a killed API/worker. Only expired
// containers belonging to this installation may be removed during reconciliation.
export async function reconcileWorkspaces(run: Docker = docker, now = Date.now()) {
  const listed = await run([
    'ps',
    '-a',
    '--filter',
    'label=gotit.web=true',
    '--filter',
    `label=gotit.owner=${workspaceOwner()}`,
    '--format',
    '{{.Names}}|{{.Label "gotit.expires"}}',
  ]);
  let active = 0;
  for (const line of listed.trim().split('\n').filter(Boolean)) {
    const [name, expires] = line.trim().split('|');
    if (!/^gotit-web-[a-f0-9-]{36}$/.test(name) || !/^\d{13}$/.test(expires || ''))
      throw new Error('Unexpected managed workspace metadata; inspect execution host.');
    if (Number(expires) <= now) await run(['rm', '--force', name]);
    else active++;
  }
  return active;
}
export function startManagedWorkspace(
  name: string,
  args: string[],
  lifetime = workspaceLifetimeSeconds,
  run: Docker = docker,
) {
  if (!Number.isInteger(lifetime) || lifetime < 2 || lifetime > 3600)
    throw new Error('Invalid workspace lifetime.');
  const work = launching.then(async () => {
    if ((await reconcileWorkspaces(run)) >= workspaceCapacity)
      throw Object.assign(new Error('All preview environments are busy. Retry shortly.'), {
        code: 'WEB_CAPACITY',
        status: 503,
      });
    return run([
      'run',
      '-d',
      '--rm',
      '--pull=never',
      '--name',
      name,
      '--label',
      'gotit.web=true',
      '--label',
      `gotit.owner=${workspaceOwner()}`,
      '--label',
      `gotit.expires=${Date.now() + lifetime * 1000}`,
      ...args,
    ]);
  });
  launching = work.catch(() => {});
  return work;
}

// PID 1 owns the deadline independently of the Node process or Docker CLI.
export function phpSupervisor(lifetime: number) {
  return `$p=proc_open(['php','-d','display_errors=1','-d','log_errors=0','-d','expose_php=0','-d','max_execution_time=4','-d','upload_max_filesize=0','-d','allow_url_fopen=0','-d','open_basedir=/tmp','-S','127.0.0.1:8080','-t','/tmp/public'],[STDIN,STDOUT,STDERR],$pipes);if(!is_resource($p))exit(1);$end=microtime(true)+${lifetime};do{usleep(100000);$s=proc_get_status($p);if(!$s['running'])exit($s['exitcode']);}while(microtime(true)<$end);proc_terminate($p,9);proc_close($p);`;
}
