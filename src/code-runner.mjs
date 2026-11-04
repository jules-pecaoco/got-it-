import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { codeLimit, outputMatches, validateCodeConfig } from '../public/code-task.js';

const fail = (code, message, status = 503) => { throw Object.assign(new Error(message), { code, status }); };
export const runtimeImages = Object.freeze({
  javascript: 'docker.io/library/node@sha256:fe4f6d74e20370acb04ad889077d14d0f64a9c8ea6a42bc60cddf1e844699914',
  python: 'docker.io/library/python@sha256:7984cf56ceaddebe4fefeb75d64000b9f45d8b77b11a09b24524da6cdc3af0c8',
  php: 'docker.io/library/php@sha256:d8784155c4d37986be9ddd7a8950df7e78998cc48e35472cd69e2b9371424a65',
  sql: 'docker.io/library/python@sha256:7984cf56ceaddebe4fefeb75d64000b9f45d8b77b11a09b24524da6cdc3af0c8'
});
// Only public inputs and the student's source enter a container. Expected outputs,
// private reference solutions, credentials and host paths are never passed to it.
export const runtimeCommands = Object.freeze({
  javascript: ['node', '-e', `const fs=require('node:fs'),cp=require('node:child_process');const p=JSON.parse(fs.readFileSync(0,'utf8'));fs.writeFileSync('/tmp/main.js',p.code);const r=cp.spawnSync(process.execPath,['/tmp/main.js'],{input:p.input,encoding:'utf8',timeout:2500,maxBuffer:16384});process.stdout.write(r.stdout||'');process.stderr.write(r.stderr||'');process.exit(!r.error&&r.status===0?0:100);`],
  python: ['python', '-c', `import sys,json,subprocess\np=json.load(sys.stdin)\nopen('/tmp/main.py','w').write(p['code'])\ntry:\n r=subprocess.run([sys.executable,'-I','/tmp/main.py'],input=p['input'],text=True,timeout=2.5,capture_output=False)\n sys.exit(0 if r.returncode==0 else 100)\nexcept subprocess.TimeoutExpired:\n print('Execution exceeded the time limit.',file=sys.stderr)\n sys.exit(100)`],
  php: ['php', '-r', `$p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);file_put_contents('/tmp/main.php',$p['code']);$pipes=[];$child=proc_open(['php','/tmp/main.php'],[['pipe','r'],STDOUT,STDERR],$pipes);fwrite($pipes[0],$p['input']);fclose($pipes[0]);exit(proc_close($child)===0?0:100);`],
  sql: ['python', '-c', `import sys,json,sqlite3\np=json.load(sys.stdin)\ndb=sqlite3.connect(':memory:')\ndb.enable_load_extension(False)\ndb.executescript(p['input'])\nallowed={sqlite3.SQLITE_SELECT,sqlite3.SQLITE_READ,sqlite3.SQLITE_FUNCTION,sqlite3.SQLITE_RECURSIVE}\ndb.set_authorizer(lambda action,*args: sqlite3.SQLITE_OK if action in allowed and not (action==sqlite3.SQLITE_FUNCTION and args[1]=='load_extension') else sqlite3.SQLITE_DENY)\ntry:\n for row in db.execute(p['code']):\n  print('\\t'.join('NULL' if v is None else str(v) for v in row))\nexcept sqlite3.Error as e:\n print(str(e),file=sys.stderr)\n sys.exit(100)`]
});
const processRun = (args, input = '', timeoutMs = 6000) => new Promise((resolve, reject) => {
  const child = spawn('docker', args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], shell: false });
  const stdout = [], stderr = []; let length = 0, stopped = false;
  const timer = setTimeout(() => { stopped = true; child.kill(); }, timeoutMs);
  const collect = key => data => {
    length += data.length;
    if (length > 32768) { stopped = true; child.kill(); return; }
    (key === 'stdout' ? stdout : stderr).push(data);
  };
  child.stdout.on('data', collect('stdout')); child.stderr.on('data', collect('stderr'));
  child.stdin.on('error', () => {});
  child.once('error', error => { clearTimeout(timer); reject(error); });
  child.once('close', exitCode => { clearTimeout(timer); resolve({ stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8'), exitCode, stopped }); });
  child.stdin.end(input);
});
export function dockerArguments(language, name, jobId = null) {
  return ['run', '--rm', '--interactive', '--pull=never', '--name', name, '--network=none', '--read-only',
    ...(jobId ? ['--label', `gotit.job=${jobId}`] : []),
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--pids-limit=32', '--memory=128m', '--memory-swap=128m',
    '--cpus=0.5', '--user=65534:65534', '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=16m', '--env=HOME=/tmp',
    runtimeImages[language], ...runtimeCommands[language]];
}
let active = 0;
export async function executeCode(language, code, input, { processRunner = processRun, jobId = null } = {}) {
  if (!Object.hasOwn(runtimeImages, language) || typeof code !== 'string' || !code.trim() || code.length > codeLimit || typeof input !== 'string' || input.length > codeLimit)
    fail('INVALID_CODE', 'Choose a supported language and enter 1–16,000 characters of code.', 400);
  if (active >= 2) fail('CODE_RUNNER_BUSY', 'The code runner is busy. Try again shortly.', 429);
  active++;
  const name = `got-it-code-${randomUUID()}`;
  try {
    const result = await processRunner(dockerArguments(language, name, jobId), JSON.stringify({ code, input }));
    if (!result.stopped && ![0, 100, 137].includes(result.exitCode)) fail('CODE_RUNNER_UNAVAILABLE', 'The coding runtime is unavailable. Start Docker and install the coding images. Your attempt was not charged.');
    return { output: result.stdout, error: result.stopped ? 'Execution exceeded the time or output limit.' : result.stderr.slice(0, 16000),
      succeeded: !result.stopped && result.exitCode === 0 };
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EACCES') fail('CODE_RUNNER_UNAVAILABLE', 'The isolated code runner is unavailable. Your attempt was not charged.');
    throw error;
  } finally {
    // Killing the CLI alone does not stop a container. Always remove its process tree.
    try { await processRunner(['rm', '--force', name], '', 3000); } catch { /* Docker may be offline. */ }
    active--;
  }
}
export async function cleanupJobContainers(jobId, processRunner = processRun) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('Invalid coding job identifier.');
  const listed = await processRunner(['ps', '-aq', '--filter', `label=gotit.job=${jobId}`]);
  if (listed.exitCode !== 0 || listed.stopped) fail('CODE_RUNNER_UNAVAILABLE', 'Cannot recover interrupted coding containers. Restore Docker and retry.');
  for (const id of listed.stdout.trim().split(/\s+/).filter(Boolean)) {
    if (!/^[a-f0-9]{12,64}$/.test(id)) throw new Error('Unexpected container identifier.');
    const removed = await processRunner(['rm', '--force', id]);
    if (removed.exitCode !== 0) fail('CODE_RUNNER_UNAVAILABLE', 'Cannot remove an interrupted coding container. Restore Docker and retry.');
  }
}
export async function previewCode(config, code, runner = executeCode) {
  const errors = validateCodeConfig(config);
  if (errors.length) fail('INVALID_CODE_CONFIG', errors.join(' '), 422);
  const results = [];
  for (const sample of config.samples) {
    const execution = await runner(config.language, code, sample.input);
    results.push({ ...execution, input: sample.input, expectedOutput: sample.output,
      matches: execution.succeeded && outputMatches(execution.output, sample.output, config.comparison) });
  }
  return { samples: results };
}
export async function evaluateCode(activity, rule, submission, runner = executeCode) {
  const awarded = [];
  for (const test of rule.criteria) {
    const result = await runner(activity.publicConfig.language, submission?.value, test.answer.input);
    if (result.succeeded && outputMatches(result.output, test.answer.output, activity.publicConfig.comparison)) awarded.push({ id: test.id, points: test.points });
  }
  const all = awarded.length === rule.criteria.length;
  return { result: all ? 'correct' : awarded.length ? 'partially_correct' : 'incorrect', awarded,
    feedbackCode: all ? 'ALL_CRITERIA_MET' : awarded.length ? 'SOME_CRITERIA_MET' : 'TRY_AGAIN' };
}
export async function codingStatus() {
  try {
    const result = await processRun(['info', '--format', '{{.OSType}}'], '', 3000);
    if (result.exitCode !== 0 || result.stdout.trim() !== 'linux') return { available: false, languages: [], message: 'Start Docker with Linux containers to run coding questions.' };
    const languages = [];
    for (const [language, image] of Object.entries(runtimeImages)) {
      const checked = await processRun(['image', 'inspect', image, '--format', '{{.Id}}'], '', 3000);
      if (checked.exitCode === 0) languages.push(language);
    }
    return { available: languages.length === 4, languages, message: languages.length === 4 ? 'Coding runtimes ready.' : 'Install the missing coding runtime images.' };
  } catch { return { available: false, languages: [], message: 'Docker is required to run coding questions.' }; }
}
