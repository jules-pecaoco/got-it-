// Shared table behavior for authoring, browser previews and private grading.
// Inspection keeps its original whole-cell search and natural sorting contract.
// DataTables uses explicit primitive-text types, rather than browser-dependent
// date, HTML or locale type detection. Cells must be displayed as text.
export const tableCellText = (value) => String(value ?? '');
const inspectionText = (value) =>
  tableCellText(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en');
const foldSearchText = (value) =>
  tableCellText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
const searchText = (value) => foldSearchText(tableCellText(value).replace(/[\r\n\u2028]/g, ' '));
const formattedNumeric = /['\u00A0,$£€¥%\u2009\u202F\u20BD\u20a9\u20BArfkɃΞ]/gi;
const numericText = (value) => tableCellText(value).replace(formattedNumeric, '');
const emptyNumeric = (value) => value === '' || value === '-';

export function datatableColumnTypes(config) {
  return new Map(
    (config.columns ?? []).map((column) => {
      const values = (config.rows ?? []).map((row) => tableCellText(row[column.id]));
      const numeric =
        values.some((value) => !emptyNumeric(value)) &&
        values.every(
          (value) =>
            emptyNumeric(value) ||
            (!Number.isNaN(parseFloat(numericText(value))) && Number.isFinite(Number(numericText(value)))),
        );
      return [column.id, numeric ? 'numeric' : 'string'];
    }),
  );
}

export function compareTableCells(left, right, type = 'string') {
  const key = (value) =>
    type === 'numeric'
      ? emptyNumeric(tableCellText(value))
        ? -Infinity
        : Number(numericText(value))
      : tableCellText(value).toLowerCase();
  const a = key(left),
    b = key(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

// Match the supported DataTables smart-search syntax literally: words can occur
// in any column, quoted phrases stay together, and !term excludes a substring.
// Two spaces separate columns, as in the library's row search cache.
export function datatableSearchMatches(cells, term) {
  const text = cells.map(searchText).join('  ');
  const tokens = foldSearchText(term).match(/!?["\u201C][^"\u201D]+["\u201D]|[^ ]+/g) ?? [];
  return tokens.every((token) => {
    const excluded = token.startsWith('!');
    if (excluded) token = token.slice(1);
    if ((token.startsWith('"') && token.endsWith('"')) || (token.startsWith('“') && token.endsWith('”')))
      token = token.slice(1, -1);
    token = token.replace(/"/g, '');
    // The pinned smart-search rule ignores single-character negations.
    return excluded ? token.length < 2 || !text.includes(token) : text.includes(token);
  });
}

export function filterTableRows(config, state, { mode = 'inspection' } = {}) {
  const columns = new Set((config.columns ?? []).map((column) => column.id));
  let rows = [...(config.rows ?? [])];
  if (state?.flags?.searching === false) return rows;
  if (mode === 'datatable') {
    if (state?.globalSearch)
      rows = rows.filter((row) =>
        datatableSearchMatches(
          [...columns].map((column) => row[column]),
          state.globalSearch,
        ),
      );
    for (const [column, term] of Object.entries(state?.columnSearch ?? {})) {
      if (columns.has(column) && term)
        rows = rows.filter((row) => datatableSearchMatches([row[column]], term));
    }
  } else {
    const search = inspectionText(state?.globalSearch);
    if (search)
      rows = rows.filter((row) =>
        [...columns].some((column) => inspectionText(row[column]).includes(search)),
      );
    for (const [column, term] of Object.entries(state?.columnSearch ?? {})) {
      if (columns.has(column) && inspectionText(term))
        rows = rows.filter((row) => inspectionText(row[column]).includes(inspectionText(term)));
    }
  }
  return rows;
}

export function inspectRows(config, state, { mode = 'inspection' } = {}) {
  const columns = new Set((config.columns ?? []).map((column) => column.id));
  const order = Array.isArray(state?.order) ? state.order : [];
  const rows = filterTableRows(config, state, { mode });
  const types = mode === 'datatable' ? datatableColumnTypes(config) : null;
  rows.sort((left, right) => {
    for (const item of state?.flags?.ordering === false ? [] : order) {
      if (!columns.has(item.column) || !['asc', 'desc'].includes(item.direction)) continue;
      const sign = item.direction === 'desc' ? -1 : 1;
      const compared = types
        ? compareTableCells(left[item.column], right[item.column], types.get(item.column))
        : tableCellText(left[item.column]).localeCompare(tableCellText(right[item.column]), 'en', {
            numeric: true,
          });
      if (compared) return compared * sign;
    }
    return 0;
  });
  const pageLength = Number.isInteger(state?.pageLength) && state.pageLength > 0 ? state.pageLength : 1;
  const pageIndex = Number.isInteger(state?.pageIndex) && state.pageIndex >= 0 ? state.pageIndex : 0;
  return {
    filteredCount: rows.length,
    visible:
      state?.flags?.paging === false
        ? rows
        : rows.slice(pageIndex * pageLength, (pageIndex + 1) * pageLength),
  };
}
