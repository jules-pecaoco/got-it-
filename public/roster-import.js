const clean = value => String(value).replace(/<[^>]*>/g, '')
  .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (_, entity) => {
    const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
    if (entity[0] === '#') return String.fromCodePoint(entity[1].toLowerCase() === 'x'
      ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10));
    return named[entity.toLowerCase()];
  }).replace(/\s+/g, ' ').trim();

const toRoster = (rows, filename, sectionOverride) => {
  const expected = ['StudentName', 'Gender', 'YearLevel', 'ProgramShortName', 'SchoolID'];
  if (JSON.stringify(rows[0]) !== JSON.stringify(expected))
    throw new Error('Expected columns: StudentName, Gender, YearLevel, ProgramShortName, SchoolID.');
  while (rows.length > 1 && rows.at(-1).every(cell => !cell)) rows.pop();
  if (rows.length < 2 || rows.length > 501 || rows.slice(1).some(row => row.length !== 5 || !row[0] || !row[4]))
    throw new Error('The roster needs 1–500 complete student rows.');
  const section = sectionOverride.trim() || /-([A-Za-z0-9]+)\.(?:xls|csv)$/i.exec(filename)?.[1];
  if (!section || section.length > 40) throw new Error('Enter a section for this roster.');
  const roster = rows.slice(1).map(row => ({ candidateId: row[4], displayName: row[0],
    gender: row[1], yearLevel: row[2], programShortName: row[3], section }));
  if (roster.some(row => !/^[A-Za-z0-9-]{1,40}$/.test(row.candidateId)) ||
    new Set(roster.map(row => row.candidateId)).size !== roster.length)
    throw new Error('School IDs must be unique and use 1–40 letters, numbers, or hyphens.');
  return roster;
};

export function parseRosterHtml(source, filename, sectionOverride = '') {
  if (typeof source !== 'string' || source.length > 1_000_000 || !/\.(xls|htm|html)$/i.test(filename))
    throw new Error('Choose the roster .xls or its Excel sheet .htm file (1 MB maximum).');
  if (/Excel Workbook Frameset/i.test(source))
    throw new Error('Excel saved the data in a separate sheet. Select sheet001.htm inside the matching _files folder.');
  const table = /<table\b[^>]*>([\s\S]*?)<\/table>/i.exec(source)?.[1];
  if (!table) throw new Error('This Excel file points to a separate sheet. Select sheet001.htm inside its _files folder.');
  const rows = [...table.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map(match =>
    [...match[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map(cell => clean(cell[1])));
  return toRoster(rows, filename, sectionOverride);
}

export function parseRosterCsv(source, filename, sectionOverride = '') {
  if (typeof source !== 'string' || source.length > 1_000_000 || !/\.csv$/i.test(filename))
    throw new Error('Choose a CSV roster (1 MB maximum).');
  const rows = []; let row = [], cell = '', quoted = false, closedQuote = false;
  source = source.replace(/^\uFEFF/, '');
  for (let index = 0; index < source.length; index++) {
    const char = source[index];
    if (quoted) {
      if (char === '"' && source[index + 1] === '"') { cell += '"'; index++; }
      else if (char === '"') { quoted = false; closedQuote = true; }
      else cell += char;
    } else if (char === '"') {
      if (cell || closedQuote) throw new Error('Invalid CSV quoting.');
      quoted = true;
    } else if (char === ',' || char === '\n' || char === '\r') {
      row.push(cell.trim()); cell = ''; closedQuote = false;
      if (char !== ',') { rows.push(row); row = []; if (char === '\r' && source[index + 1] === '\n') index++; }
    } else {
      if (closedQuote && char !== ' ') throw new Error('Invalid CSV quoting.');
      cell += char;
    }
  }
  if (quoted) throw new Error('Unclosed quoted cell in CSV.');
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return toRoster(rows, filename, sectionOverride);
}

export const parseRoster = (source, filename, sectionOverride = '') =>
  /\.csv$/i.test(filename) ? parseRosterCsv(source, filename, sectionOverride)
    : parseRosterHtml(source, filename, sectionOverride);
