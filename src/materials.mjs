import { unzipSync, strFromU8 } from 'fflate';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';

const fail = (code, message, status = 400) => { throw Object.assign(new Error(message), { code, status }); };
const MAX_FILE_BYTES = 10_000_000;
const MAX_TEXT_CHARS = 250_000;
const MAX_PAGES = 200;
const validName = filename => typeof filename === 'string' && /^[^\\/<>:"|?*]{1,120}\.(txt|md|pdf|pptx)$/i.test(filename);

function decodeXml(text) {
  return text.replace(/&(#(?:x[0-9a-f]+|\d+)|amp|lt|gt|quot|apos);/gi, (all, value) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
    if (named[value]) return named[value];
    if (!value.startsWith('#')) return all;
    const point = value[1]?.toLowerCase() === 'x' ? Number.parseInt(value.slice(2), 16) : Number.parseInt(value.slice(1), 10);
    return Number.isInteger(point) && point >= 0 && point <= 0x10ffff ? String.fromCodePoint(point) : all;
  });
}

function extractSlideText(xml) {
  const paragraphs = [];
  for (const paragraph of xml.matchAll(/<a:p(?:\s[^>]*)?>[\s\S]*?<\/a:p>/g)) {
    const parts = [...paragraph[0].matchAll(/<a:t(?:\s[^>]*)?>([\s\S]*?)<\/a:t>/g)]
      .map(match => decodeXml(match[1]));
    const line = parts.join('').trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join('\n');
}

function pptxText(bytes) {
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) fail('INVALID_MATERIAL', 'This is not a valid PowerPoint .pptx file.', 422);
  let total = 0, slides = 0;
  let files;
  try {
    files = unzipSync(bytes, { filter(info) {
      if (!/^ppt\/slides\/slide\d+\.xml$/.test(info.name)) return false;
      slides++;
      total += info.originalSize;
      if (slides > MAX_PAGES || info.originalSize > 2_000_000 || total > 8_000_000)
        fail('MATERIAL_TOO_LARGE', 'The PowerPoint has too many slides or too much slide text.', 413);
      return true;
    } });
  } catch (error) {
    if (error.status) throw error;
    fail('INVALID_MATERIAL', 'Could not read this PowerPoint file.', 422);
  }
  const entries = Object.entries(files).map(([name, data]) => ({ number: Number(/slide(\d+)\.xml$/.exec(name)[1]), data }))
    .sort((a, b) => a.number - b.number);
  if (!entries.length) fail('INVALID_MATERIAL', 'No slides were found in this PowerPoint file.', 422);
  const content = entries.map(({ number, data }) => {
    const text = extractSlideText(strFromU8(data));
    return text ? `# Slide ${number}\n${text}` : '';
  }).filter(Boolean).join('\n\n');
  return { content, sections: entries.length, sectionLabel: 'slides' };
}

async function pdfText(bytes) {
  if (Buffer.from(bytes.subarray(0, 5)).toString() !== '%PDF-') fail('INVALID_MATERIAL', 'This is not a valid PDF file.', 422);
  let task;
  try {
    task = getDocument({ data: new Uint8Array(bytes), useSystemFonts: true, isEvalSupported: false });
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PAGES) fail('MATERIAL_TOO_LARGE', `PDFs are limited to ${MAX_PAGES} pages.`, 413);
    const pages = [];
    let totalChars = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number);
      const text = await page.getTextContent();
      const lines = text.items.map(item => item.str || '').filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (lines) {
        const section = `# Page ${number}\n${lines}`;
        totalChars += section.length + 2;
        pages.push(section);
      }
      page.cleanup();
      if (totalChars > MAX_TEXT_CHARS)
        fail('MATERIAL_TOO_LARGE', 'Extracted PDF text exceeds 250,000 characters.', 413);
    }
    return { content: pages.join('\n\n'), sections: pdf.numPages, sectionLabel: 'pages' };
  } catch (error) {
    if (error.status) throw error;
    fail('INVALID_MATERIAL', 'Could not extract text from this PDF. Check that it is readable and not password protected.', 422);
  } finally { if (task) await task.destroy().catch(() => {}); }
}

export async function extractMaterial({ filename, bytes }) {
  if (!validName(filename)) fail('UNSUPPORTED_SOURCE', 'Use a .txt, .md, .pdf or .pptx file. Save older .ppt files as .pptx.');
  if (!(bytes instanceof Uint8Array) || !bytes.length || bytes.length > MAX_FILE_BYTES)
    fail('MATERIAL_TOO_LARGE', 'Choose a file up to 10 MB.', 413);
  const extension = filename.split('.').at(-1).toLowerCase();
  let result;
  if (extension === 'pptx') result = pptxText(bytes);
  else if (extension === 'pdf') result = await pdfText(bytes);
  else {
    let content;
    try { content = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { fail('INVALID_MATERIAL', 'Text files must use UTF-8 encoding.', 422); }
    result = { content, sections: 1, sectionLabel: 'document' };
  }
  if (!result.content.trim()) fail('NO_EXTRACTABLE_TEXT', 'No selectable text was found. Scanned pages and slide images need OCR.', 422);
  if (result.content.length > MAX_TEXT_CHARS) fail('MATERIAL_TOO_LARGE', 'Extracted text exceeds 250,000 characters.', 413);
  return { filename, ...result };
}
