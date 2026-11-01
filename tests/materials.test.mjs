import test from 'node:test';
import assert from 'node:assert/strict';
import { zipSync, strToU8 } from 'fflate';
import { extractMaterial } from '../src/materials.mjs';

function samplePdf(text) {
  const stream = `BT /F1 18 Tf 50 700 Td (${text}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, body] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) pdf += `${String(offset).padStart(10, '0')} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

test('PowerPoint extraction keeps slide labels and readable text', async () => {
  const bytes = zipSync({
    'ppt/slides/slide2.xml': strToU8('<p:sld><a:p><a:r><a:t>Search &amp; sort</a:t></a:r></a:p></p:sld>'),
    'ppt/slides/slide1.xml': strToU8('<p:sld><a:p><a:r><a:t>First slide</a:t></a:r></a:p></p:sld>'),
    'ppt/media/large.png': new Uint8Array(100)
  });
  const result = await extractMaterial({ filename: 'lesson.pptx', bytes });
  assert.equal(result.sections, 2);
  assert.match(result.content, /^# Slide 1\nFirst slide\n\n# Slide 2\nSearch & sort$/);
});

test('PDF extraction keeps page labels and rejects image-only pages', async () => {
  const result = await extractMaterial({ filename: 'lesson.pdf', bytes: samplePdf('Search before paging') });
  assert.equal(result.sections, 1);
  assert.match(result.content, /^# Page 1\nSearch before paging$/);
  await assert.rejects(extractMaterial({ filename: 'lesson.pdf', bytes: samplePdf('') }), /No selectable text/);
});

test('legacy PowerPoint and invalid binary files receive a clear error', async () => {
  await assert.rejects(extractMaterial({ filename: 'old.ppt', bytes: strToU8('legacy') }), /Save older \.ppt files as \.pptx/);
  await assert.rejects(extractMaterial({ filename: 'broken.pptx', bytes: strToU8('not a ZIP') }), /not a valid PowerPoint/);
});
