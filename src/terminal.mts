import { randomUUID } from 'node:crypto';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { docker } from './docker-process.mts';
import { runtimeImages } from './code-runner.mjs';

export interface TerminalState {
  id: string;
  status: 'starting' | 'running' | 'finished' | 'stopped' | 'failed';
  output: string;
  error: string;
  inputClosed: boolean;
}
interface Runtime {
  write(value: string): void;
  end(): void;
  stop(): Promise<void>;
}
type Launch = (
  language: string,
  code: string,
  id: string,
  output: (text: string) => void,
  exit: (success: boolean) => void,
) => Promise<Runtime>;
const failure = (code: string, message: string, status = 400) =>
  Object.assign(new Error(message), { code, message, status });

async function launch(
  language: string,
  code: string,
  id: string,
  output: (text: string) => void,
  exit: (success: boolean) => void,
): Promise<Runtime> {
  const name = 'gotit-terminal-' + id;
  const extensions: Record<string, string> = { python: 'py', javascript: 'js', php: 'php' };
  const file = '/tmp/solution.' + extensions[language];
  let child: ChildProcessWithoutNullStreams | undefined;
  let stopping: Promise<void> | undefined;
  const stop = () => {
    stopping ??= (async () => {
      child?.kill();
      try {
        await docker(['rm', '--force', name], '', 3000);
      } catch {
        /* Already removed or Docker unavailable. */
      }
    })();
    return stopping;
  };
  try {
    await docker([
      'run',
      '-d',
      '--rm',
      '--pull=never',
      '--name',
      name,
      '--label',
      'gotit.terminal=true',
      '--network=none',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--memory=128m',
      '--memory-swap=128m',
      '--cpus=0.5',
      '--pids-limit=32',
      '--ulimit',
      'cpu=5:5',
      '--user=65534:65534',
      '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m',
      '--env=HOME=/tmp',
      runtimeImages[language as keyof typeof runtimeImages],
      'sh',
      '-c',
      'sleep 125',
    ]);
    const installers: Record<string, string[]> = {
      python: ['python', '-c', "import sys;open('/tmp/solution.py','w').write(sys.stdin.read())"],
      javascript: [
        'node',
        '-e',
        "require('node:fs').writeFileSync('/tmp/solution.js',require('node:fs').readFileSync(0))",
      ],
      php: ['php', '-r', "file_put_contents('/tmp/solution.php',stream_get_contents(STDIN));"],
    };
    await docker(['exec', '-i', name, ...installers[language]], code);
    const commands: Record<string, string[]> = {
      python: ['python', '-u', '-I', file],
      javascript: ['node', file],
      php: ['php', '-d', 'output_buffering=0', '-d', 'implicit_flush=1', file],
    };
    child = spawn('docker', ['exec', '-i', name, ...commands[language]], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false,
    });
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', output);
    child.stderr.on('data', output);
    child.stdin.on('error', () => {});
    child.once('error', () => exit(false));
    child.once('close', (code) => exit(code === 0));
    return {
      write: (value) => {
        child!.stdin.write(value);
      },
      end: () => {
        child!.stdin.end();
      },
      stop,
    };
  } catch {
    await stop();
    throw failure(
      'TERMINAL_UNAVAILABLE',
      'The code terminal is unavailable. Start the execution host and try again.',
      503,
    );
  }
}
interface Entry {
  owner: string;
  state: TerminalState;
  runtime?: Runtime;
  ended: number;
  bytes: number;
  inputBytes: number;
  timer?: ReturnType<typeof setTimeout>;
}
export class TerminalManager {
  private entries = new Map<string, Entry>();
  private closed = false;
  constructor(
    private launcher: Launch = launch,
    private capacity = Number(process.env.TERMINAL_CAPACITY || 8),
    private lifetime = 120000,
  ) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 80)
      throw new Error('TERMINAL_CAPACITY must be from 1 to 80.');
  }
  private owned(owner: string, id: string) {
    const item = this.entries.get(id);
    if (!item || item.owner !== owner) throw failure('TERMINAL_NOT_FOUND', 'Terminal run not found.', 404);
    return item;
  }
  private snapshot(item: Entry): TerminalState {
    return { ...item.state };
  }
  private finish(item: Entry, status: TerminalState['status'], error = '') {
    if (!['starting', 'running'].includes(item.state.status)) return;
    item.state.status = status;
    item.state.error = error;
    item.ended = Date.now();
    clearTimeout(item.timer);
    void item.runtime?.stop();
  }
  async open(owner: string, language: string, code: string) {
    if (this.closed) throw failure('TERMINAL_UNAVAILABLE', 'Terminal is shutting down.', 503);
    if (
      !['python', 'javascript', 'php'].includes(language) ||
      typeof code !== 'string' ||
      !code.trim() ||
      code.length > 16000
    )
      throw failure('INVALID_CODE', 'Enter code for Python, JavaScript or PHP, up to 16,000 characters.');
    for (const [id, item] of this.entries)
      if (item.ended && (item.owner === owner || Date.now() - item.ended > 60000)) this.entries.delete(id);
    const active = [...this.entries.values()].filter((item) =>
      ['starting', 'running'].includes(item.state.status),
    );
    if (active.some((item) => item.owner === owner))
      throw failure('TERMINAL_RUNNING', 'Stop your current terminal run first.', 409);
    if (active.length >= this.capacity || this.entries.size >= 200)
      throw failure('TERMINAL_BUSY', 'The terminals are busy. Try again shortly.', 429);
    const id = randomUUID();
    const item: Entry = {
      owner,
      state: { id, status: 'starting', output: '', error: '', inputClosed: false },
      ended: 0,
      bytes: 0,
      inputBytes: 0,
    };
    this.entries.set(id, item);
    item.timer = setTimeout(
      () => this.finish(item, 'stopped', 'Run ended after the time limit.'),
      this.lifetime,
    );
    item.timer.unref();
    try {
      item.runtime = await this.launcher(
        language,
        code,
        id,
        (text) => {
          if (!['starting', 'running'].includes(item.state.status)) return;
          item.bytes += Buffer.byteLength(text);
          if (item.bytes > 32768) {
            this.finish(item, 'stopped', 'Run exceeded the output limit.');
            return;
          }
          item.state.output += text;
        },
        (success) =>
          this.finish(item, success ? 'finished' : 'failed', success ? '' : 'Program exited with an error.'),
      );
      if (item.state.status === 'starting') item.state.status = 'running';
      else await item.runtime.stop();
      return this.snapshot(item);
    } catch (error) {
      this.finish(item, 'failed', 'Terminal could not start.');
      throw error;
    }
  }
  read(owner: string, id: string) {
    return this.snapshot(this.owned(owner, id));
  }
  write(owner: string, id: string, input: { line?: string; eof?: boolean }) {
    const item = this.owned(owner, id);
    if (item.state.status !== 'running' || item.state.inputClosed)
      throw failure('TERMINAL_ENDED', 'This run is no longer accepting input.', 409);
    if (input?.eof === true) {
      item.runtime!.end();
      item.state.inputClosed = true;
      return this.snapshot(item);
    }
    if (typeof input?.line !== 'string' || /[\r\n]/.test(input.line) || Buffer.byteLength(input.line) > 4096)
      throw failure('INVALID_INPUT', 'Enter one line up to 4 KB.');
    item.inputBytes += Buffer.byteLength(input.line) + 1;
    if (item.inputBytes > 16000)
      throw failure('INVALID_INPUT', 'This run has reached the 16 KB input limit.');
    const text = input.line + '\n';
    if (item.bytes + Buffer.byteLength(text) > 32768) {
      this.finish(item, 'stopped', 'Run exceeded the output limit.');
      return this.snapshot(item);
    }
    item.bytes += Buffer.byteLength(text);
    item.state.output += text;
    item.runtime!.write(text);
    return this.snapshot(item);
  }
  async stop(owner: string, id: string) {
    const item = this.owned(owner, id);
    this.finish(item, 'stopped');
    await item.runtime?.stop();
    return this.snapshot(item);
  }
  async close() {
    this.closed = true;
    await Promise.all([...this.entries.values()].map((item) => this.stop(item.owner, item.state.id)));
    this.entries.clear();
  }
}
