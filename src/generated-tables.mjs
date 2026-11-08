import { inspectRows } from './engine.mjs';

const invalid = message => { throw Object.assign(new Error(message), { code: 'AI_INVALID_DRAFT', status: 422 }); };
export function buildTableQuestion(item) {
  const table = item.table, target = item.answer;
  if (!table || typeof table !== 'object') invalid('table: provide the table columns, rows and pageLengths.');
  if (!target || typeof target !== 'object' || Array.isArray(target)) invalid('answer: provide the target table settings as an object.');
  if (!Array.isArray(table.columns) || table.columns.length < 2 || table.columns.length > 8)
    invalid(`table.columns: expected 2–8 columns; received ${Array.isArray(table.columns) ? table.columns.length : 'no column array'}.`);
  const columnIds = new Set();
  for (const [index, column] of table.columns.entries()) {
    if (typeof column?.id !== 'string' || !column.id.trim() || typeof column.label !== 'string' || !column.label.trim())
      invalid(`table.columns[${index}]: each column needs a nonempty string id and label.`);
    if (columnIds.has(column.id)) invalid(`table.columns[${index}].id: duplicate column ID "${column.id}".`);
    columnIds.add(column.id);
  }
  if (!Array.isArray(table.rows) || table.rows.length < 6 || table.rows.length > 40)
    invalid(`table.rows: expected 6–40 rows; received ${Array.isArray(table.rows) ? table.rows.length : 'no row array'}.`);
  const rowIds = new Set();
  for (const [index, row] of table.rows.entries()) {
    if (!row || typeof row.id !== 'string' || !row.id.trim()) invalid(`table.rows[${index}].id: provide a nonempty unique string ID, such as "row-${index + 1}".`);
    if (rowIds.has(row.id)) invalid(`table.rows[${index}].id: duplicate row ID "${row.id}".`);
    rowIds.add(row.id);
    for (const column of table.columns) if (!Object.hasOwn(row, column.id) ||
        (!['string', 'number', 'boolean'].includes(typeof row[column.id]) && row[column.id] !== null) ||
        (typeof row[column.id] === 'number' && !Number.isFinite(row[column.id])))
      invalid(`table.rows[${index}].${column.id}: provide a string, finite number, boolean or null cell.`);
  }
  if (!Array.isArray(table.pageLengths) || !table.pageLengths.length || table.pageLengths.length > 5 ||
      table.pageLengths.some(value => !Number.isInteger(value) || value < 1 || value > 100))
    invalid('table.pageLengths: provide 1–5 integer page sizes from 1 to 100.');
  if (!table.pageLengths.includes(target.pageLength)) invalid('answer.pageLength: choose one of table.pageLengths.');
  if (!Number.isInteger(target.pageIndex ?? 0) || (target.pageIndex ?? 0) < 0) invalid('answer.pageIndex: use a nonnegative integer, starting at zero.');
  if (typeof target.globalSearch !== 'string' || target.globalSearch.length > 100) invalid('answer.globalSearch: provide a string of up to 100 characters; use "" for no search.');
  if (!Array.isArray(target.order) || target.order.length < 1 || target.order.length > 2)
    invalid('answer.order: provide one or two {column, direction} objects, for example [{"column":"name","direction":"asc"}].');
  for (const [index, order] of target.order.entries()) {
    if (!order || !columnIds.has(order.column) || !['asc', 'desc'].includes(order.direction))
      invalid(`answer.order[${index}]: use an existing column ID and direction "asc" or "desc"; a direction string alone is invalid.`);
  }
  if (new Set(target.order.map(order => order.column)).size !== target.order.length) invalid('answer.order: sort columns must be distinct.');
  if (target.columnSearch != null && (typeof target.columnSearch !== 'object' || Array.isArray(target.columnSearch)))
    invalid('answer.columnSearch: use an object mapping a column ID to search text, or {} for no filter.');
  const filters = Object.entries(target.columnSearch ?? {});
  if (filters.length > 1 || filters.some(([column, term]) => !table.columns.some(item => item.id === column) || typeof term !== 'string' || term.length > 100)) invalid('Use at most one valid column filter.');
  const code = item.type === 'datatable_code';
  if (code) {
    if (filters.length !== 1) invalid('answer.columnSearch: DataTables coding requires exactly one column filter.');
    if ((target.pageIndex ?? 0) !== 0) invalid('answer.pageIndex: DataTables coding requires page zero.');
    if (!/^#[A-Za-z][\w-]*$/.test(table.selector ?? '')) invalid('table.selector: provide a simple table ID selector, such as "#studentTable".');
    if (typeof table.scaffold !== 'string' || table.scaffold.length > 8000) invalid('table.scaffold: provide starter JavaScript of up to 8,000 characters.');
    if (!target.flags || ['paging', 'searching', 'ordering'].some(key => typeof target.flags[key] !== 'boolean'))
      invalid('answer.flags: provide boolean paging, searching and ordering values; null is invalid.');
    if (!Array.isArray(target.lengthMenu) || !target.lengthMenu.includes(target.pageLength) ||
        target.lengthMenu.some(length => !table.pageLengths.includes(length)))
      invalid('answer.lengthMenu: use allowed page sizes and include answer.pageLength.');
  }
  const config = { columns: table.columns.map(({ id, label }) => ({ id, label })), rows: table.rows.map(row =>
    Object.fromEntries(['id', ...table.columns.map(column => column.id)].map(key => [key, row[key]]))), pageLengths: [...table.pageLengths],
    ...(code ? { selector: table.selector, scaffold: table.scaffold, apiReference: [
      { api: 'new DataTable(selector, options)', use: 'Create the table with paging, searching, ordering, pageLength, lengthMenu, and order.' },
      { api: "table.search('text').draw()", use: 'Search all columns.' },
      { api: "table.column(index).search('text').draw()", use: 'Filter one column, using its zero-based index.' },
      { api: "table.order([[index, 'asc']]).draw()", use: 'Set the primary order; add another pair for a tie-breaker.' }
    ] } : {}) };
  const visible = inspectRows(config, { ...target, pageIndex: target.pageIndex ?? 0, columnSearch: target.columnSearch ?? {} }).visible.map(row => row.id);
  if (!visible.length) invalid('The requested table view must contain at least one visible row.');
  const values = [
    ...(code ? [['flags', Object.fromEntries(['paging', 'searching', 'ordering'].map(key => [key, target.flags[key]]))]] : []),
    ['page_length', target.pageLength],
    ...(code ? [['length_menu', target.lengthMenu]] : [['page_index', target.pageIndex ?? 0]]),
    ['global_search', target.globalSearch],
    ...(filters.length ? [['column_search', { column: filters[0][0], term: filters[0][1] }]] : []),
    ['order', target.order.map(({ column, direction }) => ({ column, direction }))], ['visible_ids', visible]
  ];
  return { config, answers: values.map(([kind, value]) => ({ kind, value })) };
}
