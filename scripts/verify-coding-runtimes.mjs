import assert from 'node:assert/strict';
import { executeCode, codingStatus } from '../src/code-runner.mjs';
const status = await codingStatus();
assert.equal(status.available, true, status.message);
const cases = [
  ['javascript', "const fs=require('node:fs'); const [a,b]=fs.readFileSync(0,'utf8').trim().split(/\\s+/).map(Number); console.log(a+b);", '2 3', '5'],
  ['python', 'a,b=map(int,input().split())\nprint(a+b)', '-4 0', '-4'],
  ['php', '<?php [$a,$b]=array_map("intval",explode(" ",trim(stream_get_contents(STDIN)))); echo $a+$b;', '10 7', '17'],
  ['sql', 'SELECT name, score FROM students WHERE score >= 80 ORDER BY score DESC;', "CREATE TABLE students(name TEXT, score INTEGER); INSERT INTO students VALUES ('Alex',90),('Sam',75),('Lee',85);", 'Alex\t90\nLee\t85']
];
for (const [language, code, input, expected] of cases) {
  const result = await executeCode(language, code, input);
  assert.equal(result.succeeded, true, `${language}: ${result.error}`);
  assert.equal(result.output.trim(), expected);
  console.log(`${language}: input-dependent output verified`);
}
for (const [language, code] of [['javascript', 'const = invalid;'], ['python', 'def invalid:'], ['php', '<?php syntax invalid;'], ['sql', 'DROP TABLE students;']]) {
  const result = await executeCode(language, code, language === 'sql' ? 'CREATE TABLE students(id INTEGER);' : '');
  assert.equal(result.succeeded, false);
  console.log(`${language}: invalid code rejected`);
}
const timeout = await executeCode('python', 'while True: pass', '');
assert.equal(timeout.succeeded, false);
const flood = await executeCode('javascript', "console.log('x'.repeat(100000));", '');
assert.equal(flood.succeeded, false);
const isolation = await executeCode('javascript', "const fs=require('node:fs'); console.log(process.getuid()); try { fs.writeFileSync('/blocked','x'); } catch(e) { console.log(e.code); }", '');
assert.equal(isolation.succeeded, true, isolation.error);
assert.match(isolation.output, /^65534\nEROFS/);
console.log('Time/output bounds, non-root execution, and read-only root verified.');
