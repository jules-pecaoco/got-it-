// A bounded interpreter for the DataTables calls taught in the Week 13 lesson.
// It parses code as data. It never evaluates submitted JavaScript.
function tokens(source) {
  if (typeof source !== 'string' || source.length > 8000) throw new Error('Code must be 8,000 characters or fewer.');
  const out = []; let i = 0;
  while (i < source.length) {
    const rest = source.slice(i), whitespace = /^\s+/.exec(rest);
    if (whitespace) { i += whitespace[0].length; continue; }
    if (rest.startsWith('//')) { const end = source.indexOf('\n', i); i = end < 0 ? source.length : end + 1; continue; }
    if (rest.startsWith('/*')) { const end = source.indexOf('*/', i + 2); if (end < 0) throw new Error('Unclosed comment.'); i = end + 2; continue; }
    const char = source[i];
    if (char === '"' || char === "'") {
      const quote = char; let value = ''; i++;
      let closed = false;
      while (i < source.length) {
        const next = source[i++];
        if (next === quote) { closed = true; break; }
        if (next === '\\') {
          const escaped = source[i++];
          if (!escaped || !['\\', '"', "'", 'n', 't'].includes(escaped)) throw new Error('Unsupported string escape.');
          value += escaped === 'n' ? '\n' : escaped === 't' ? '\t' : escaped;
        } else value += next;
      }
      if (!closed) throw new Error('Unclosed string.');
      out.push({ type: 'string', value }); continue;
    }
    const number = /^\d+/.exec(rest);
    if (number) { out.push({ type: 'number', value: Number(number[0]) }); i += number[0].length; continue; }
    const identifier = /^[A-Za-z_$][\w$]*/.exec(rest);
    if (identifier) { out.push({ type: 'identifier', value: identifier[0] }); i += identifier[0].length; continue; }
    if ('{}[]().,:;='.includes(char)) { out.push({ type: char, value: char }); i++; continue; }
    throw new Error(`Unsupported character near position ${i + 1}.`);
  }
  if (out.length > 500) throw new Error('Code contains too many tokens.');
  out.push({ type: 'eof', value: '' });
  return out;
}

export function parseTableCode(source, fixture) {
  const stream = tokens(source); let pos = 0;
  const peek = () => stream[pos];
  const take = value => {
    const token = stream[pos++];
    if (value && token.value !== value) throw new Error(`Expected ${value} near token ${pos}.`);
    return token;
  };
  const typed = type => {
    const token = stream[pos++];
    if (token.type !== type) throw new Error(`Expected ${type} near token ${pos}.`);
    return token.value;
  };
  function literal() {
    if (peek().type === 'string') return typed('string');
    if (peek().type === 'number') return typed('number');
    if (peek().value === 'true' || peek().value === 'false') return take().value === 'true';
    if (peek().value === '[') {
      take('['); const items = [];
      while (peek().value !== ']') {
        items.push(literal());
        if (peek().value !== ']') take(',');
      }
      take(']'); return items;
    }
    throw new Error(`Expected a simple JavaScript value near token ${pos + 1}.`);
  }
  function object() {
    take('{'); const result = {};
    while (peek().value !== '}') {
      const key = peek().type === 'string' ? typed('string') : typed('identifier');
      if (Object.hasOwn(result, key)) throw new Error(`Duplicate option ${key}.`);
      take(':'); result[key] = literal();
      if (peek().value !== '}') take(',');
    }
    take('}'); return result;
  }
  const declaration = typed('identifier');
  if (!['const', 'let', 'var'].includes(declaration)) throw new Error('Start with a table declaration.');
  const variable = typed('identifier');
  take('='); take('new'); take('DataTable'); take('(');
  const selector = typed('string');
  if (selector !== (fixture.selector || '#studentTable')) throw new Error('Use the table selector in the reference.');
  take(','); const options = object(); take(')'); take(';');
  const allowed = new Set(['paging', 'searching', 'ordering', 'pageLength', 'lengthMenu', 'order']);
  for (const key of Object.keys(options)) if (!allowed.has(key)) throw new Error(`Unsupported option ${key}.`);
  for (const key of ['paging', 'searching', 'ordering']) if (options[key] !== undefined && typeof options[key] !== 'boolean') throw new Error(`${key} must be true or false.`);
  if (options.pageLength !== undefined && (!Number.isInteger(options.pageLength) || options.pageLength < 1)) throw new Error('pageLength must be positive.');
  if (options.lengthMenu !== undefined && (!Array.isArray(options.lengthMenu) || options.lengthMenu.some(x => !Number.isInteger(x) || x < 1))) throw new Error('lengthMenu must be an array of positive numbers.');
  const mapOrder = array => {
    if (!Array.isArray(array) || array.length < 1 || array.length > 2) throw new Error('order needs one or two column pairs.');
    const mapped = array.map(pair => {
      if (!Array.isArray(pair) || pair.length !== 2 || !Number.isInteger(pair[0]) || !['asc', 'desc'].includes(pair[1]) || !fixture.columns[pair[0]])
        throw new Error('Each order pair needs a valid column index and asc or desc.');
      return { column: fixture.columns[pair[0]].id, direction: pair[1] };
    });
    if (new Set(mapped.map(x => x.column)).size !== mapped.length) throw new Error('Sort columns must be distinct.');
    return mapped;
  };
  const state = {
    pageLength: options.pageLength ?? 10,
    lengthMenu: options.lengthMenu ?? [10, 25, 50],
    flags: { paging: options.paging ?? true, searching: options.searching ?? true, ordering: options.ordering ?? true },
    globalSearch: '', columnSearch: {}, order: mapOrder(options.order ?? [[0, 'asc']]), pageIndex: 0
  };
  function draw() { take('.'); take('draw'); take('('); take(')'); take(';'); }
  while (peek().type !== 'eof') {
    take(variable); take('.'); const method = typed('identifier');
    if (method === 'search') {
      take('('); state.globalSearch = typed('string'); take(')'); draw();
    } else if (method === 'column') {
      take('('); const index = typed('number'); take(')');
      if (!Number.isInteger(index) || !fixture.columns[index]) throw new Error('Column index is outside the reference table.');
      take('.'); take('search'); take('('); state.columnSearch[fixture.columns[index].id] = typed('string'); take(')'); draw();
    } else if (method === 'order') {
      take('('); state.order = mapOrder(literal()); take(')'); draw();
    } else throw new Error(`Unsupported table method ${method}.`);
  }
  return state;
}
