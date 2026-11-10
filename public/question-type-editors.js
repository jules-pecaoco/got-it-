const node = (tag, text, className = '') => {
  const element = document.createElement(tag);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};
const field = (parent, labelText, value = '', tag = 'input') => {
  const label = node('label', labelText),
    input = node(tag);
  input.value = value;
  if (tag === 'textarea') {
    input.rows = 5;
    input.spellcheck = false;
  }
  label.append(input);
  parent.append(label);
  return input;
};
export function createMatchingEditor(activity) {
  const element = node('section', undefined, 'stack'),
    entries = [];
  element.append(
    node(
      'p',
      'Enter each correct pair. Students will see the two lists separately, with the right-hand list rearranged.',
      'small',
    ),
  );
  const list = node('div', undefined, 'stack');
  element.append(list);
  const add = (pair) => {
    const row = node('div', undefined, 'matching-editor-row');
    const left = field(row, 'Left item', pair?.left || ''),
      right = field(row, 'Matching right item', pair?.right || '');
    const remove = node('button', 'Remove pair');
    remove.type = 'button';
    row.append(remove);
    const entry = { left, right };
    entries.push(entry);
    list.append(row);
    remove.addEventListener('click', () => {
      entries.splice(entries.indexOf(entry), 1);
      row.remove();
    });
  };
  for (const pair of Array.isArray(activity.pairs) ? activity.pairs : [{}, {}]) add(pair);
  const button = node('button', 'Add matching pair');
  button.type = 'button';
  element.append(button);
  button.addEventListener('click', () => {
    if (entries.length < 8) add();
  });
  return {
    element,
    value: () => ({
      pairs: entries.map(({ left, right }) => ({ left: left.value.trim(), right: right.value.trim() })),
    }),
  };
}
export function createTableQuestionEditor(activity) {
  const element = node('section', undefined, 'stack'),
    table = activity.table && typeof activity.table === 'object' ? { ...activity.table } : {},
    answer = activity.answer || {};
  table.columns = (Array.isArray(table.columns) ? table.columns : []).filter(
    (column) => column && typeof column.id === 'string',
  );
  table.rows = (Array.isArray(table.rows) ? table.rows : []).filter((row) => row && typeof row === 'object');
  element.append(
    node(
      'p',
      'Paste a table from a spreadsheet. Include an id column with a different value for every row. Use column names in filters and ordering.',
      'small',
    ),
  );
  const headers = (Array.isArray(table.columns) ? table.columns : []).map((column) => column.id);
  if (!headers.includes('id')) headers.unshift('id');
  const data = field(
    element,
    'Table data · tab-separated, with column names on the first row',
    table.rows?.length
      ? [
          headers.join('\t'),
          ...table.rows.map((row) => headers.map((key) => row[key] ?? '').join('\t')),
        ].join('\n')
      : 'id\tname\tcategory\nrow1\tAlex\tA\nrow2\tSam\tB\nrow3\tLee\tA\nrow4\tJo\tB\nrow5\tCam\tA\nrow6\tPat\tB',
    'textarea',
  );
  data.rows = 9;
  const lengths = field(
    element,
    'Rows-per-page choices · separate numbers with commas',
    (Array.isArray(table.pageLengths) ? table.pageLengths : [2, 5, 10]).join(', '),
  );
  const pageLength = field(element, 'Target rows per page', answer.pageLength ?? 2);
  pageLength.type = 'number';
  const page = field(element, 'Target page number · starts at 1', (answer.pageIndex ?? 0) + 1);
  page.type = 'number';
  const search = field(element, 'Target search · optional', answer.globalSearch || '');
  const filter = Object.entries(answer.columnSearch || {})[0] || ['', ''];
  const filterColumn = field(element, 'Filter column · optional for table inspection', filter[0]);
  const filterTerm = field(element, 'Filter text', filter[1]);
  const order = field(
    element,
    'Sort order · one column per line, e.g. name asc or score desc',
    (Array.isArray(answer.order)
      ? answer.order.filter((item) => item && typeof item === 'object')
      : [{ column: 'name', direction: 'asc' }]
    )
      .map((item) => `${item.column} ${item.direction}`)
      .join('\n'),
    'textarea',
  );
  const code = node('section', undefined, 'stack');
  element.append(code);
  const selector = field(code, 'Table selector', table.selector || '#studentTable');
  const scaffold = field(
    code,
    'DataTables starter code',
    table.scaffold || '// TODO: create the table, set its options, then apply the requested searches.',
    'textarea',
  );
  const menu = field(
    code,
    'Target page-size menu · comma-separated',
    (Array.isArray(answer.lengthMenu)
      ? answer.lengthMenu
      : Array.isArray(table.pageLengths)
        ? table.pageLengths
        : [2, 5, 10]
    ).join(', '),
  );
  const flags = {};
  for (const [key, label] of [
    ['paging', 'Enable paging'],
    ['searching', 'Enable searching'],
    ['ordering', 'Enable ordering'],
  ]) {
    const wrap = node('label', label, 'ai-approval'),
      input = node('input');
    input.type = 'checkbox';
    input.checked = answer.flags?.[key] ?? true;
    wrap.prepend(input);
    code.append(wrap);
    flags[key] = input;
  }
  const numbers = (value) => value.split(',').map((item) => Number(item.trim()));
  return {
    element,
    setType: (type) => {
      code.hidden = type !== 'datatable_code';
    },
    value: (type) => {
      const lines = data.value.replace(/\r/g, '').replace(/\n+$/, '').split('\n'),
        keys = lines
          .shift()
          .split('\t')
          .map((key) => key.trim());
      if (!keys.includes('id') || keys.some((key) => !key) || new Set(keys).size !== keys.length)
        throw new Error('Table headers must be unique and include id.');
      const rows = lines.map((line) => {
        const cells = line.split('\t');
        if (cells.length !== keys.length) throw new Error('Every table row must have one cell per column.');
        return Object.fromEntries(keys.map((key, index) => [key, cells[index]]));
      });
      const columns = keys
        .filter(
          (id) => id !== 'id' || !table.columns?.length || table.columns.some((column) => column.id === 'id'),
        )
        .map((id) => ({ id, label: table.columns?.find((column) => column.id === id)?.label || id }));
      return {
        table: {
          columns,
          rows,
          pageLengths: numbers(lengths.value),
          ...(type === 'datatable_code' ? { selector: selector.value, scaffold: scaffold.value } : {}),
        },
        answer: {
          pageLength: Number(pageLength.value),
          pageIndex: Number(page.value) - 1,
          globalSearch: search.value,
          columnSearch: filterColumn.value.trim() ? { [filterColumn.value.trim()]: filterTerm.value } : {},
          order: order.value
            .trim()
            .split(/\r?\n/)
            .map((line) => {
              const [column, direction] = line.trim().split(/\s+/);
              return { column, direction };
            }),
          ...(type === 'datatable_code'
            ? {
                flags: Object.fromEntries(Object.entries(flags).map(([key, input]) => [key, input.checked])),
                lengthMenu: numbers(menu.value),
              }
            : {}),
        },
      };
    },
  };
}
