import { inspectRows } from './engine.mjs';

const invalid = message => { throw Object.assign(new Error(message), { code: 'AI_INVALID_DRAFT', status: 422 }); };
export function buildTableQuestion(item) {
  const table = item.table, target = item.answer;
  if (!table || !target || !Array.isArray(table.columns) || table.columns.length < 2 || table.columns.length > 8 ||
    table.columns.some(column => typeof column?.id !== 'string' || !column.id || typeof column.label !== 'string' || !column.label) ||
    new Set(table.columns.map(column => column.id)).size !== table.columns.length ||
    !Array.isArray(table.rows) || table.rows.length < 6 || table.rows.length > 40 ||
    table.rows.some(row => !row || typeof row.id !== 'string' || !row.id || table.columns.some(column =>
      !['string', 'number', 'boolean'].includes(typeof row[column.id]) && row[column.id] !== null)) ||
    new Set(table.rows.map(row => row.id)).size !== table.rows.length) invalid('Table questions need 2–8 unique columns and 6–40 complete rows with unique string IDs.');
  if (!Array.isArray(table.pageLengths) || !table.pageLengths.length || table.pageLengths.length > 5 ||
    table.pageLengths.some(value => !Number.isInteger(value) || value < 1 || value > 100) ||
    !table.pageLengths.includes(target.pageLength) || !Number.isInteger(target.pageIndex ?? 0) || (target.pageIndex ?? 0) < 0 ||
    typeof target.globalSearch !== 'string' || target.globalSearch.length > 100 ||
    !Array.isArray(target.order) || target.order.length < 1 || target.order.length > 2 ||
    target.order.some(order => !table.columns.some(column => column.id === order?.column) || !['asc', 'desc'].includes(order.direction)) ||
    new Set(target.order.map(order => order.column)).size !== target.order.length) invalid('Table target needs an allowed page size, page index, search text, and one or two distinct sort columns.');
  const filters = Object.entries(target.columnSearch ?? {});
  if (filters.length > 1 || filters.some(([column, term]) => !table.columns.some(item => item.id === column) || typeof term !== 'string' || term.length > 100)) invalid('Use at most one valid column filter.');
  const code = item.type === 'datatable_code';
  if (code && (filters.length !== 1 || (target.pageIndex ?? 0) !== 0 ||
    !/^#[A-Za-z][\w-]*$/.test(table.selector ?? '') || typeof table.scaffold !== 'string' || table.scaffold.length > 8000 ||
    !target.flags || ['paging', 'searching', 'ordering'].some(key => typeof target.flags[key] !== 'boolean') ||
    !Array.isArray(target.lengthMenu) || !target.lengthMenu.includes(target.pageLength) ||
    target.lengthMenu.some(length => !table.pageLengths.includes(length)))) invalid('DataTables coding needs a selector, scaffold, three boolean flags, a valid length menu, one column filter, and page index zero.');
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
