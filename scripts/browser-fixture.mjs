// Fictional, memory-only rehearsal. Never opens the configured classroom database.
process.env.NODE_ENV = 'test'; process.env.DATA_FILE = ':memory:'; process.env.DEMO_MODE = '1';
process.env.INSTRUCTOR_PASSWORD = 'demo-instructor'; process.env.PUBLIC_ORIGIN = 'http://127.0.0.1:3309'; process.env.PREVIEW_ORIGIN = 'http://127.0.0.1:3310';
const { server, store, webPreviews } = await import('../src/server.mjs');
const { webTemplate } = await import('../src/web-template.mjs');
const { buildGeneratedPackage } = await import('../src/ai.mjs');
const source = { filename: 'lesson.md', content: 'Read two integers and print their sum. Handle zero and negative numbers. Test the program with different inputs and preserve readable output.' };
const logic = buildGeneratedPackage({ title: 'Logic rehearsal', subject: 'Programming', kind: 'activity', durationMinutes: 30, questionMode: 'coding', programmingLanguage: 'python', questionCount: 1, source }, {
  missions: [{ title: 'Sum', activities: [{ type: 'code_writing', language: 'python', prompt: 'Read two integers and print their sum.', starterCode: '# TODO: add the numbers', samples: [{ input: '2 3', output: '5' }], comparison: { mode: 'whitespace' }, referenceCode: 'a,b=map(int,input().split());print(a+b)', tests: [{ input: '2 3', output: '5' }, { input: '-2 0', output: '-2' }], evidenceQuote: 'Read two integers and print their sum.', location: 'Source' }] }]
});
store.codeRunner = async (_language, _code, input) => ({ succeeded: true, output: String(input.split(' ').map(Number).reduce((a, b) => a + b)), error: '' });
for (const [name, value] of [['logic', logic], ['web', webTemplate('web-rehearsal')]]) {
  store.importDraft(value.public, value.private);
  if (name === 'logic') store.addSource(value.public.examId, value.public.version, source);
  store.publish(value.public.examId, value.public.version);
  const run = store.createRun({ examId: value.public.examId, version: value.public.version, pin: '4242', opensAt: new Date(Date.now() - 1000).toISOString(), closesAt: new Date(Date.now() + 3600000).toISOString(), roster: [{ candidateId: 'QA-001', displayName: 'Fictional Student', section: 'QA' }] });
  console.log(`${name}: http://127.0.0.1:3309/app/student?run=${run.id}`);
}
server.listen(3309, '127.0.0.1');
webPreviews.server.listen(3310, '127.0.0.1');
async function stop() { await webPreviews.close(); server.close(() => { store.close(); process.exit(0); }); }
process.stdin.on('data', data => { if (data.toString().trim() === 'stop') void stop(); });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { void stop(); });
