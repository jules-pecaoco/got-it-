import { randomUUID } from 'node:crypto';
import { docker } from './docker-process.mts';
import { runtimeImages } from './code-runner.mjs';
import { validateProject } from '../public/web-project.js';
import type { Project } from '../web/contracts.js';

const install = `$p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);foreach($p['files'] as $n=>$v){$f='/tmp/public/'.$n;@mkdir(dirname($f),0700,true);file_put_contents($f,$v);}if(isset($p['database'])){file_put_contents('/tmp/data/database.sqlite',base64_decode($p['database'],true));}elseif(!file_exists('/tmp/data/database.sqlite')){$db=new PDO('sqlite:/tmp/data/database.sqlite');$db->exec($p['seedSql']??'');}`;
const requestScript = `$p=json_decode(stream_get_contents(STDIN),true,512,JSON_THROW_ON_ERROR);$s=fsockopen('127.0.0.1',8080,$e,$m,2);stream_set_timeout($s,4);$b=$p['body']??'';$r=$p['method'].' '.$p['path']." HTTP/1.0\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/x-www-form-urlencoded\r\nContent-Length: ".strlen($b)."\r\n";if(!empty($p['cookie']))$r.='Cookie: '.$p['cookie']."\r\n";fwrite($s,$r."\r\n".$b);$raw=stream_get_contents($s,300000);fclose($s);$parts=explode("\r\n\r\n",$raw,2);echo json_encode(['headers'=>$parts[0],'body'=>base64_encode($parts[1]??'')]);`;
export interface WebResponse {
  status: number;
  headers: Record<string, string | string[]>;
  body: Buffer;
}

export class PhpWorkspace {
  readonly name = `gotit-web-${randomUUID()}`;
  private started = false;
  async start(project: Project, seedSql = '') {
    const errors = validateProject(project);
    if (errors.length)
      throw Object.assign(new Error(errors.join(' ')), { status: 422, code: 'INVALID_PROJECT' });
    try {
      this.started = true;
      await docker([
        'run',
        '-d',
        '--rm',
        '--pull=never',
        '--name',
        this.name,
        '--label',
        'gotit.web=true',
        '--network=none',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--memory=128m',
        '--memory-swap=128m',
        '--cpus=0.25',
        '--pids-limit=32',
        '--user=65534:65534',
        '--tmpfs=/tmp:rw,nosuid,nodev,noexec,size=32m',
        '--env=HOME=/tmp',
        runtimeImages.php,
        'sh',
        '-c',
        'mkdir -p /tmp/public /tmp/data && exec php -d display_errors=1 -d log_errors=0 -d expose_php=0 -d max_execution_time=4 -d upload_max_filesize=0 -d allow_url_fopen=0 -d open_basedir=/tmp -S 127.0.0.1:8080 -t /tmp/public',
      ]);
      await docker(['exec', '-i', this.name, 'php', '-r', install], JSON.stringify({ ...project, seedSql }));
    } catch (error) {
      await this.close();
      throw error;
    }
  }
  async request(method: string, path: string, body = '', cookie = ''): Promise<WebResponse> {
    if (
      !['GET', 'POST', 'HEAD'].includes(method) ||
      /[\r\n\0]/.test(path + cookie) ||
      !path.startsWith('/') ||
      path.startsWith('//')
    )
      throw Object.assign(new Error('Unsupported preview request.'), { status: 400 });
    const raw = JSON.parse(
      await docker(
        ['exec', '-i', this.name, 'php', '-r', requestScript],
        JSON.stringify({ method, path, body, cookie }),
      ),
    );
    const lines = String(raw.headers).split('\r\n');
    const status = Number(/^HTTP\/\d\.\d (\d+)/.exec(lines.shift() ?? '')?.[1] ?? 502);
    const headers: Record<string, string | string[]> = {};
    for (const line of lines) {
      const index = line.indexOf(':');
      if (index < 0) continue;
      const key = line.slice(0, index).toLowerCase(),
        value = line.slice(index + 1).trim();
      if (key === 'set-cookie') headers[key] = [...((headers[key] as string[]) ?? []), value];
      else if (['content-type', 'location'].includes(key)) headers[key] = value;
    }
    return { status, headers, body: Buffer.from(raw.body, 'base64') };
  }
  async snapshot(): Promise<string> {
    return docker([
      'exec',
      this.name,
      'php',
      '-r',
      `$f='/tmp/data/database.sqlite';$db=new PDO('sqlite:'.$f);$db->exec('PRAGMA wal_checkpoint(TRUNCATE)');if(filesize($f)>1000000)exit(1);echo base64_encode(file_get_contents($f));`,
    ]);
  }
  async close() {
    if (this.started) {
      this.started = false;
      await docker(['rm', '--force', this.name]).catch(() => {});
    }
  }
}
