import test from 'node:test';
import assert from 'node:assert/strict';
import {referenceGuides} from '../src/reference-guides.mts';
import {referenceTopics,validateReferenceSelection} from '../public/reference-topics.js';
import {searchReferences} from '../public/reference-dictionary.js';
import {parseTableCode} from '../public/table-code.js';
test('reference catalog includes every supported topic with original text and inert code examples',()=>{
 const guides=referenceGuides(referenceTopics.map(topic=>topic.id));
 assert.equal(guides.length,referenceTopics.length);
 for(const guide of guides){
  assert.ok(guide.note);assert.ok(guide.entries.length>=8);
  assert.equal(new Set(guide.entries.map(entry=>entry.title)).size,guide.entries.length);
  for(const entry of guide.entries) for(const field of ['title','text','code']) assert.equal(typeof entry[field],'string');
 }
 assert.equal(referenceGuides([]).length,0);
 assert.deepEqual(referenceGuides(['python','sql']).map(g=>g.id),['sql','python']);
 assert.deepEqual(referenceGuides(['unknown']),[]);
});
test('DataTables walkthrough uses syntax accepted by the student preview',()=>{
 const [guide]=referenceGuides(['datatables']);
 const example=guide.entries.find(entry=>entry.title.includes('Put the pieces together'));
 const state=parseTableCode(example.code,{selector:'#libraryTable',columns:['title','category','year'].map(id=>({id}))});
 assert.equal(state.pageLength,5);
 assert.equal(state.globalSearch,'ocean');
 assert.deepEqual(state.columnSearch,{category:'Science'});
 assert.deepEqual(state.order,[{column:'year',direction:'desc'},{column:'title',direction:'asc'}]);
});
test('reference selection rejects unsupported, duplicate and malformed guide choices',()=>{
 for(const value of [undefined,[],['python','html']])assert.deepEqual(validateReferenceSelection(value),[]);
 for(const value of [null,'python',['unknown'],['python','python'],[{}]])assert.ok(validateReferenceSelection(value).length);
});
test('reference search is case-insensitive, matches code and filters by allowed topic',()=>{
 const guides=referenceGuides(['sql','python','html']);
 assert.ok(searchReferences(guides,'JOIN','sql').some(e=>e.title==='JOIN related tables'));
 assert.ok(searchReferences(guides,'input print','python').length);
 assert.ok(searchReferences(guides,'<label','html').length);
 assert.equal(searchReferences(guides,'','php').length,0);
 assert.equal(searchReferences(guides,'unfindable-example').length,0);
 assert.ok(searchReferences(guides).every(e=>['sql','python','html'].includes(e.topic)));
});
