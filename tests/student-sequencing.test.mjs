import assert from 'node:assert/strict';
import { Store } from '../src/store.mjs';
const store = new Store(':memory:');
try {
  const pub = {schemaVersion:'1.0',examId:'audit-sequence',version:1,title:'Sequence audit',subject:'Synthetic',kind:'quiz',settings:{durationMinutes:30,coreMaxPoints:10,bonusMaxPoints:0},missions:[{id:'order',title:'Order',maxPoints:10,activities:[{id:'sequence',type:'sequencing',prompt:'Place all three steps in order.',manualRationale:'Fictional audit item.',maxPoints:10,gradingRuleId:'sequence-rule',publicConfig:{items:[{id:'a',label:'First'},{id:'b',label:'Second'},{id:'c',label:'Third'}]}}]}]};
  const priv = {rules:{'sequence-rule':{type:'sequencing',criteria:[{id:'order',points:10,answer:['a','b','c']}]}}};
  store.importDraft(pub,priv);
  const validation = store.validate(pub.examId,1);
  if (validation.length) throw new Error(validation.join(' '));
  store.publish(pub.examId,1);
  const run = store.createRun({examId:pub.examId,version:1,pin:'4242',feedbackMode:'graded',opensAt:new Date(Date.now()-1000).toISOString(),closesAt:new Date(Date.now()+3600000).toISOString(),roster:[{candidateId:'AUDIT-SEQ',displayName:'Synthetic Student',section:'Audit'}]});
  const {session} = store.join({runId:run.id,candidateId:'AUDIT-SEQ',pin:'4242'});
  const saved = store.saveDraft(session.id,'sequence',{value:['a','','']});
  const before = store.sessionView(session.id);
  const finalized = store.finalize(session.id);
  const submitted = store.db.prepare('SELECT response_json,result FROM submissions WHERE session_id=?').all(session.id);
  assert.equal(saved.gradable, false);
  assert.deepEqual(before.savedAnswers, []);
  assert.equal(submitted.length, 0);
} finally { store.close(); }
