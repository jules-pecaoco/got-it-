import { tokenizeCode } from './code-highlight.js';

const supported = new Set(['javascript', 'js', 'php', 'sql', 'python', 'py']);
const fence = /(^|\n)[ \t]*```([A-Za-z][\w+-]*)?[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*(?=\n|$)/g;

export function parsePrompt(raw) {
  const text = String(raw ?? '').replace(/\r\n?/g, '\n');
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(fence)) {
    const start = match.index + match[1].length;
    if (start > cursor) parts.push({ type: 'text', text: text.slice(cursor, start) });
    parts.push({ type: 'code', language: (match[2] || '').toLowerCase(), text: match[3] });
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) parts.push({ type: 'text', text: text.slice(cursor) });
  return parts;
}

export function renderPrompt(raw, className = '') {
  const container = document.createElement('div');
  container.className = `prompt-render ${className}`.trim();
  for (const part of parsePrompt(raw)) {
    if (part.type === 'text') {
      for (const paragraph of part.text.split(/\n\s*\n/)) {
        if (!paragraph.trim()) continue;
        const p = document.createElement('p');
        const text = paragraph.trim();
        const inline = /`([^`\n]+)`/g;
        let cursor = 0;
        for (const match of text.matchAll(inline)) {
          if (match.index > cursor) p.append(document.createTextNode(text.slice(cursor, match.index)));
          const code = document.createElement('code');
          code.className = 'prompt-inline-code';
          code.textContent = match[1];
          p.append(code);
          cursor = match.index + match[0].length;
        }
        if (cursor < text.length) p.append(document.createTextNode(text.slice(cursor)));
        container.append(p);
      }
      continue;
    }
    const pre = document.createElement('pre');
    pre.className = 'prompt-code';
    pre.setAttribute('aria-label', `${part.language || 'Code'} sample`);
    const code = document.createElement('code');
    if (supported.has(part.language)) {
      for (const token of tokenizeCode(part.text, part.language)) {
        if (!token.type) code.append(document.createTextNode(token.text));
        else {
          const span = document.createElement('span');
          span.className = `code-${token.type}`;
          span.textContent = token.text;
          code.append(span);
        }
      }
    } else code.textContent = part.text;
    pre.append(code);
    container.append(pre);
  }
  return container;
}
