export const syntaxLanguages = Object.freeze([
  ['javascript', 'JavaScript'],
  ['php', 'PHP'],
  ['sql', 'SQL'],
  ['python', 'Python']
]);

const words = text => new Set(text.split(' '));
const grammars = {
  javascript: {
    pattern: /(?<comment>\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(?<string>"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?|`(?:\\.|[^`\\])*`?)|(?<number>\b\d+(?:\.\d+)?\b)|(?<word>[A-Za-z_$][\w$]*)/g,
    keywords: words('const let var new return true false null undefined if else for while function class async await import export default this'),
    names: words('DataTable pageLength lengthMenu paging ordering searching page len search column order draw')
  },
  php: {
    pattern: /(?<comment>\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(?<string>"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|(?<tag><\?(?:php|=)?|\?>)|(?<number>\b\d+(?:\.\d+)?\b)|(?<word>\$?[A-Za-z_][\w]*)/gi,
    keywords: words('echo print function class public private protected static new return if else elseif foreach for while as true false null use namespace require include'),
    names: words('array count empty isset strlen substr')
  },
  sql: {
    pattern: /(?<comment>--[^\n]*|#[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|(?<string>'(?:''|[^'])*'?|"(?:""|[^"])*"?|`(?:``|[^`])*`?)|(?<number>\b\d+(?:\.\d+)?\b)|(?<word>[A-Za-z_][\w]*)/gi,
    keywords: words('SELECT FROM WHERE JOIN INNER LEFT RIGHT FULL ON AS AND OR NOT NULL IS IN LIKE BETWEEN GROUP BY HAVING ORDER ASC DESC LIMIT OFFSET DISTINCT INSERT INTO VALUES UPDATE SET DELETE CREATE TABLE ALTER DROP UNION ALL CASE WHEN THEN ELSE END'),
    names: words('COUNT SUM AVG MIN MAX COALESCE LOWER UPPER')
  },
  python: {
    pattern: /(?<string>"""[\s\S]*?(?:"""|$)|'''[\s\S]*?(?:'''|$)|"(?:\\.|[^"\\])*"?|'(?:\\.|[^'\\])*'?)|(?<comment>#[^\n]*)|(?<number>\b\d+(?:\.\d+)?\b)|(?<word>[A-Za-z_][\w]*)/g,
    keywords: words('def class import from return if elif else for while in is not and or True False None async await lambda with as try except finally pass raise yield break continue'),
    names: words('print len range str int float list dict set tuple enumerate zip self')
  }
};

export function normalizeSyntax(language) {
  const alias = { js: 'javascript', py: 'python' }[String(language ?? '').toLowerCase()];
  const name = alias || String(language ?? '').toLowerCase();
  return Object.hasOwn(grammars, name) ? name : 'javascript';
}

export function tokenizeCode(source, language = 'javascript') {
  const text = String(source ?? '');
  const syntax = normalizeSyntax(language);
  const grammar = grammars[syntax];
  const parts = [];
  let cursor = 0;
  for (const match of text.matchAll(grammar.pattern)) {
    if (match.index > cursor) parts.push({ text: text.slice(cursor, match.index), type: null });
    const group = Object.keys(match.groups).find(key => match.groups[key] !== undefined);
    const value = match[0];
    const lookup = syntax === 'sql' ? value.toUpperCase() : syntax === 'php' ? value.toLowerCase() : value;
    const type = group === 'word'
      ? grammar.keywords.has(lookup) ? 'keyword'
        : grammar.names.has(lookup) ? 'api'
          : syntax === 'php' && value.startsWith('$') ? 'variable' : null
      : group === 'tag' ? 'keyword' : group;
    parts.push({ text: value, type });
    cursor = match.index + value.length;
  }
  if (cursor < text.length) parts.push({ text: text.slice(cursor), type: null });
  return parts;
}
