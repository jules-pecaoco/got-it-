import assert from 'node:assert/strict';
import { PhpWorkspace } from '../src/php-workspace.mts';
import { createPreviewService } from '../src/web-preview.mts';
const files = { 'index.php': `<?php
session_start();
$db=new PDO('sqlite:/tmp/data/database.sqlite');
$db->setAttribute(PDO::ATTR_ERRMODE,PDO::ERRMODE_EXCEPTION);
if($_SERVER['REQUEST_METHOD']==='POST'){$q=$db->prepare('INSERT INTO tasks(title) VALUES(?)');$q->execute([$_POST['title']??'']);}
header('Content-Type: text/html; charset=utf-8');
echo '<h1>Tasks</h1>';
foreach($db->query('SELECT title FROM tasks ORDER BY id') as $row)echo '<p>'.htmlspecialchars($row['title'],ENT_QUOTES,'UTF-8').'</p>';
echo '<form method="post"><input name="title"><button>Add</button></form>';
`, 'style.css': 'body { color: navy; }', 'boundary.php': `<?php echo @file_get_contents('/etc/passwd')===false?'blocked':'escaped';` };
const seed = "CREATE TABLE tasks(id INTEGER PRIMARY KEY,title TEXT NOT NULL); INSERT INTO tasks(title) VALUES('Prepare');";
let workspace = new PhpWorkspace();
try {
  await workspace.start({ files }, seed);
  const first = await workspace.request('GET', '/index.php');
  assert.equal(first.status, 200); assert.match(first.body.toString(), /Prepare/);
  const response = await workspace.request('POST', '/index.php', 'title=Review');
  assert.match(response.body.toString(), /Review/);
  assert.match((await workspace.request('GET', '/style.css')).body.toString(), /navy/);
  assert.equal((await workspace.request('GET', '/boundary.php')).body.toString(), 'blocked');
  const database = await workspace.snapshot(); assert.ok(database.length > 0);
  await workspace.close(); workspace = new PhpWorkspace(); await workspace.start({ files, database }, seed);
  assert.match((await workspace.request('GET', '/index.php')).body.toString(), /Review/);
  await workspace.close(); workspace = new PhpWorkspace(); await workspace.start({ files }, seed);
  assert.doesNotMatch((await workspace.request('GET', '/index.php')).body.toString(), /<p>Review<\/p>/);
  console.log('PASS: real PHP HTTP, SQLite CRUD, static assets, filesystem boundary, database recovery and reset.');
} finally { await workspace.close(); }

let allowed = true;
const previews = createPreviewService('http://127.0.0.1:3311', () => allowed, 'http://127.0.0.1:3309');
await new Promise<void>(resolve => previews.server.listen(3311, '127.0.0.1', resolve));
try {
  const preview = await previews.open('fictional-session', 'project', { files }, seed);
  const response = await fetch(preview.url);
  assert.equal(response.status, 200); const body = await response.text();
  assert.match(body, /gotit-preview-console/); assert.match(body, /Prepare/);
  assert.match(response.headers.get('content-security-policy') || '', /frame-src 'none'/);
  assert.ok((response.headers.get('set-cookie') || '').includes(new URL(preview.url).pathname));
  assert.equal((await fetch('http://127.0.0.1:3311/api/instructor/session')).status, 404);
  allowed = false; assert.equal((await fetch(preview.url)).status, 404);
  console.log('PASS: cross-origin preview proxy, console bridge, cookie scoping and expired-access rejection.');
} finally { await previews.close(); }
