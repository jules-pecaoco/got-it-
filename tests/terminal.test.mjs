import {createServer} from 'node:http';
import {terminalService} from '../src/terminal-client.mts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {TerminalManager} from '../src/terminal.mts';
function fixture(capacity=2,lifetime=120000){
 const runs=new Map();
 const manager=new TerminalManager(async(_language,_code,id,output,exit)=>{
  const entry={output,exit,lines:[],stopped:0};runs.set(id,entry);output('Name: ');
  return {write:value=>{entry.lines.push(value);output('Reply: '+value);},end:()=>exit(true),stop:async()=>{entry.stopped++;}};
 },capacity,lifetime);
 return {manager,runs};
}
test('terminal replies are owner-scoped, bounded, echoed and accept EOF',async()=>{
 const {manager,runs}=fixture();
 try{
  const run=await manager.open('student-a','python','input()');
  assert.equal(run.output,'Name: ');
  assert.throws(()=>manager.read('student-b',run.id),e=>e.status===404);
  assert.throws(()=>manager.write('student-b',run.id,{line:'secret'}),e=>e.status===404);
  await assert.rejects(()=>manager.stop('student-b',run.id),e=>e.status===404);
  assert.throws(()=>manager.write('student-a',run.id,{line:'two\nlines'}),e=>e.code==='INVALID_INPUT');
  assert.throws(()=>manager.write('student-a',run.id,{line:'x'.repeat(4097)}),e=>e.code==='INVALID_INPUT');
  const after=manager.write('student-a',run.id,{line:'Jules'});
  assert.match(after.output,/Name: Jules\nReply: Jules/);
  assert.deepEqual(runs.get(run.id).lines,['Jules\n']);
  const ended=manager.write('student-a',run.id,{eof:true});
  assert.equal(ended.inputClosed,true);assert.equal(ended.status,'finished');
  assert.throws(()=>manager.write('student-a',run.id,{line:'late'}),e=>e.status===409);
  const next=await manager.open('student-a','php','<?php echo 1;');
  assert.equal(next.status,'running');
  assert.throws(()=>manager.read('student-a',run.id),e=>e.status===404);
 }finally{await manager.close();}
});
test('terminal capacity, one run per owner, output bounds and expiry release runtime resources',async()=>{
 const {manager,runs}=fixture(1);
 try{
  const first=await manager.open('a','javascript','code');
  await assert.rejects(()=>manager.open('a','javascript','code'),e=>e.code==='TERMINAL_RUNNING');
  await assert.rejects(()=>manager.open('b','javascript','code'),e=>e.code==='TERMINAL_BUSY');
  runs.get(first.id).output('x'.repeat(32769));
  assert.equal(manager.read('a',first.id).status,'stopped');
  assert.match(manager.read('a',first.id).error,/output limit/);
  const second=await manager.open('b','python','code');
  await manager.stop('b',second.id);
  assert.ok(runs.get(first.id).stopped);assert.ok(runs.get(second.id).stopped);
  const expiry=fixture(1,10);
  try { const timed=await expiry.manager.open('timed','python','code');
    await new Promise(r=>setTimeout(r,40));
    assert.equal(expiry.manager.read('timed',timed.id).status,'stopped');
    assert.match(expiry.manager.read('timed',timed.id).error,/time limit/);
  } finally { await expiry.manager.close(); }
  await assert.rejects(()=>manager.open('x','sql','select 1'),e=>e.code==='INVALID_CODE');
 }finally{await manager.close();}
});
test('a terminal stopped during startup cleans up the runtime when launch completes',async()=>{
 let finish,stopped=0;
 const manager=new TerminalManager((_language,_code,_id,_output)=>new Promise(resolve=>{finish=()=>resolve({write(){},end(){},stop:async()=>{stopped++;}});}));
 const opening=manager.open('a','python','code');
 await manager.close();finish();
 const state=await opening;
 assert.equal(state.status,'stopped');assert.ok(stopped>0);
 await assert.rejects(()=>manager.open('a','python','code'),e=>e.code==='TERMINAL_UNAVAILABLE');
});

test('an outdated execution worker reports a restart requirement instead of a missing route',async()=>{
 const previous={origin:process.env.EXECUTION_ORIGIN,secret:process.env.EXECUTION_SECRET};
 const worker=createServer((_req,res)=>{res.writeHead(404,{'Content-Type':'application/json'});res.end(JSON.stringify({message:'Route not found.'}));});
 await new Promise(resolve=>worker.listen(0,'127.0.0.1',resolve));
 let client;
 try{
  process.env.EXECUTION_ORIGIN='http://127.0.0.1:'+worker.address().port;
  process.env.EXECUTION_SECRET='test-worker-secret-12345678901234567890';client=terminalService();
  await assert.rejects(()=>client.open('student','python','print(1)'),e=>e.code==='TERMINAL_UPDATE_REQUIRED'&&e.status===503&&/restart/.test(e.message));
 }finally{
  await client?.close();await new Promise(resolve=>worker.close(resolve));
  if(previous.origin===undefined)delete process.env.EXECUTION_ORIGIN;else process.env.EXECUTION_ORIGIN=previous.origin;
  if(previous.secret===undefined)delete process.env.EXECUTION_SECRET;else process.env.EXECUTION_SECRET=previous.secret;
 }
});
