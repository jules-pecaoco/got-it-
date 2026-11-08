import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Store } from '../src/store.mjs';
import { asFaculty } from '../src/faculty-access.mjs';

function setup() {
  const store = new Store();
  const pub = JSON.parse(readFileSync(new URL('./fixtures/garden/public-exam.json',import.meta.url)));
  const priv = JSON.parse(readFileSync(new URL('./fixtures/garden/private-grading.json',import.meta.url)));
  const run = asFaculty('teacher-a',()=>{
    store.importDraft(pub,priv);store.publish(pub.examId,1);
    return store.createRun({examId:pub.examId,version:1,pin:'4242',name:'Original run',feedbackMode:'graded',opensAt:new Date(Date.now()-1000).toISOString(),closesAt:new Date(Date.now()+86400000).toISOString(),roster:[{candidateId:'A',displayName:'Fictional student',section:'A'}]});
  });
  return {store,run,pub};
}

test('faculty grades accept omitted, empty and short reasons, while preserving length limits',()=>{
  const {store,run}=setup();try {
    const joined=store.join({runId:run.id,candidateId:'A',pin:'4242'});store.finalize(joined.session.id);
    asFaculty('teacher-a',()=>{
      for(const reason of [undefined,'','x']) { const input={points:5,...(reason===undefined?{}:{reason})};const review=store.overrideQuestionScore(run.id,'A','garden-area',input);assert.equal(review.questions.find(q=>q.id==='garden-area').override.reason,reason||''); }
      assert.throws(()=>store.overrideQuestionScore(run.id,'A','garden-area',{points:5,reason:'x'.repeat(301)}),{code:'INVALID_SCORE'});
    });
  }finally{store.close();}
});

test('run editing and deletion enforce ownership and protect live attempts',()=>{
 const {store,run}=setup();try {
   asFaculty('teacher-a',()=>assert.equal(store.updateRun(run.id,{name:'Updated'}).name,'Updated'));
   asFaculty('teacher-b',()=>{assert.throws(()=>store.deleteRun(run.id));assert.throws(()=>store.updateRun(run.id,{name:'Forbidden'}));});
   const joined=store.join({runId:run.id,candidateId:'A',pin:'4242'});
   asFaculty('teacher-a',()=>{assert.throws(()=>store.deleteRun(run.id),{code:'ACTIVE_ATTEMPTS'});assert.throws(()=>store.updateRun(run.id,{closesAt:new Date(Date.now()+1000).toISOString()}),{code:'ACTIVE_ATTEMPTS'});});
   store.saveDraft(joined.session.id,'garden-area',{value:12,unit:'m2'});
   store.finalize(joined.session.id);
   asFaculty('teacher-a',()=>store.overrideQuestionScore(run.id,'A','garden-area',{points:6}));
   assert.ok(store.db.prepare('SELECT COUNT(*) n FROM submissions').get().n>0);
   asFaculty('teacher-a',()=>store.deleteRun(run.id));
   assert.equal(store.db.prepare('SELECT COUNT(*) n FROM sessions WHERE run_id=?').get(run.id).n,0);
   assert.equal(store.db.prepare('SELECT COUNT(*) n FROM exams').get().n,1);
   assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{store.close();}
});

test('deleting an activity version removes its runs and results atomically and preserves other versions',()=>{
 const {store,run,pub}=setup();try {
   asFaculty('teacher-a',()=>store.cloneExam(pub.examId,1));
   const joined=store.join({runId:run.id,candidateId:'A',pin:'4242'});
   asFaculty('teacher-a',()=>assert.throws(()=>store.deleteActivity(pub.examId,1),{code:'ACTIVE_ATTEMPTS'}));
   assert.equal(store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,1);
   store.finalize(joined.session.id);
   asFaculty('teacher-b',()=>assert.throws(()=>store.deleteActivity(pub.examId,1)));
   asFaculty('teacher-a',()=>{assert.equal(store.deleteActivity(pub.examId,1).deletedRuns,1);assert.equal(store.getExam(pub.examId,2).status,'draft');});
   assert.equal(store.db.prepare('SELECT COUNT(*) n FROM runs').get().n,0);
   assert.deepEqual(store.db.prepare('PRAGMA foreign_key_check').all(),[]);
 }finally{store.close();}
});
