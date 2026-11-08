import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGeneratedPackage, buildApprovedPackage, proposeExam } from '../src/ai.mjs';
import { validatePackage } from '../src/engine.mjs';
import { expectedOutputDocument, validateWebRule } from '../public/web-project.js';
const source = {filename:'web-lesson.txt',content:'Use semantic HTML, CSS and JavaScript to build an accessible task list. PHP can process submitted forms and store tasks with PDO in SQLite.'};
const request = {title:'Web tasks',subject:'Web development',kind:'exam',questionMode:'coding',durationMinutes:40,missionCount:1,questionCount:1,source};
const question = kind => ({type:'web_project',projectKind:kind,prompt:'Build a task list. Add tasks through a labelled form and display them.',files:kind==='frontend'?{'index.html':'<h1>Tasks</h1><!-- TODO -->','style.css':'/* TODO */','script.js':'// TODO'}:{'index.php':'<?php // TODO: use PDO and render tasks.','style.css':'/* TODO */'}, ...(kind==='php-web'?{seedSql:"CREATE TABLE tasks(title TEXT); INSERT INTO tasks VALUES('Review');"}:{}),expectedHtml:'<style>h1{color:navy}</style><h1>Tasks</h1><ul><li>Review</li></ul>',rubric:['Working interactions and validation','Readable accessible output'],evidenceQuote:source.content,location:'Source'});

test('AI generates web problems with static output, starter files and a private manual rubric',async()=>{
  for(const kind of ['frontend','php-web']){
    const design={missions:[{title:'Tasks',activities:[question(kind)]}]};
    let prompt;
    const preview=await proposeExam({...request,programmingLanguage:kind},{apiKey:'test-key',fetcher:async(_url,options)=>{
      prompt=JSON.parse(options.body).contents[0].parts[0].text;
      return {ok:true,json:async()=>({candidates:[{content:{parts:[{text:JSON.stringify(design)}]}}]})};
    }});
    assert.equal(preview.missions[0].questions[0].ready,true);
    assert.match(prompt,/expectedHtml/);assert.match(prompt,/manual grading/);
    const result=buildApprovedPackage({...request,programmingLanguage:kind,missions:design.missions});
    assert.deepEqual(validatePackage(result.public,result.private),[]);
    const config=result.public.missions[0].activities[0].publicConfig;
    assert.equal(config.expectedHtml,question(kind).expectedHtml);
    assert.equal(config.rubric,undefined);
    assert.ok(Object.values(result.private.rules)[0].criteria.every(c=>c.answer.kind==='manual'));
    const wrong=question(kind);delete wrong.expectedHtml;
    assert.throws(()=>buildGeneratedPackage({...request,programmingLanguage:kind},{missions:[{title:'Tasks',activities:[wrong]}]}),/static expected output/);
  }
});

test('expected web output is bounded static content rendered with a restrictive policy',()=>{
  const cfg={files:{'index.html':'<h1>Starter</h1>'},expectedHtml:'<script>alert(1)</script>'};
  const rule={criteria:[{answer:{kind:'manual',description:'Review'}}]};
  assert.match(validateWebRule(cfg,rule).join(' '),/without scripts/);
  cfg.expectedHtml='x'.repeat(50001);assert.ok(validateWebRule(cfg,rule).length);
  const html=expectedOutputDocument('<h1>Expected</h1>');
  assert.match(html,/default-src 'none'/);assert.match(html,/img-src data:/);assert.match(html,/form-action 'none'/);
});
