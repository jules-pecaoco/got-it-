export function answerText(activity, rule) {
  const config = activity.publicConfig || {};
  const criteria = rule.criteria || [];
  const first = criteria[0]?.answer;
  const option = id => config.options?.find(item => item.id === id)?.label ?? String(id);
  if (activity.type === 'web_project') return criteria.map(item => `${item.points} points: ${item.answer.kind === 'manual' ? item.answer.description : `${item.answer.method || 'GET'} ${item.answer.path} → ${item.answer.status}, contains ${item.answer.contains}`}`).join('\n');
  if (activity.type === 'code_writing') return `Language: ${config.language}\n\nReference solution:\n${rule.referenceCode}\n\n` +
    criteria.map((test, index) => `Test ${index + 1} (${test.points} points)\nInput:\n${test.answer.input}\nExpected output:\n${test.answer.output}`).join('\n\n');
  if (activity.type === 'single_choice') return option(first);
  if (activity.type === 'multiple_choice') return first.map(option).join(', ');
  if (activity.type === 'true_false') return first ? 'True' : 'False';
  if (activity.type === 'text_entry') return first.join(' · ');
  if (activity.type === 'numeric_entry') return `${first.value}${first.unit ? ` ${first.unit}` : ''}`;
  if (activity.type === 'matching') return criteria.map(item => {
    const left = config.left?.find(value => value.id === item.answer.left)?.label ?? item.answer.left;
    const right = config.right?.find(value => value.id === item.answer.right)?.label ?? item.answer.right;
    return `${left}: ${right}`;
  }).join('\n');
  if (activity.type === 'sequencing') return first.map(id => config.items?.find(item => item.id === id)?.label ?? id).join(' → ');
  if (activity.type === 'data_inspection' || activity.type === 'datatable_code') {
    const values = Object.fromEntries(criteria.map(item => [item.answer.kind, item.answer.value]));
    const label = id => config.columns.find(column => column.id === id)?.label ?? id;
    const lines = [
      `Rows per page: ${values.page_length}`,
      ...(values.length_menu ? [`Length menu: ${values.length_menu.join(', ')}`] : []),
      `Page: ${(values.page_index ?? 0) + 1}`,
      `Global search: ${values.global_search || '(none)'}`,
      ...(values.column_search ? [`Column search: ${label(values.column_search.column)} = ${values.column_search.term}`] : []),
      `Order: ${values.order.map(item => `${label(item.column)} ${item.direction}`).join(', then ')}`,
      `Visible tickets: ${values.visible_ids.join(', ')}`
    ];
    if (activity.type === 'datatable_code') {
      const index = id => config.columns.findIndex(column => column.id === id);
      lines.push('', 'One valid script:',
        `const table = new DataTable(${JSON.stringify(config.selector)}, {`,
        `  paging: ${values.flags.paging}, searching: ${values.flags.searching}, ordering: ${values.flags.ordering},`,
        `  pageLength: ${values.page_length}, lengthMenu: [${values.length_menu.join(', ')}],`,
        `  order: [${values.order.map(item => `[${index(item.column)}, '${item.direction}']`).join(', ')}]`,
        '});',
        `table.search(${JSON.stringify(values.global_search)}).draw();`,
        ...(values.column_search ? [`table.column(${index(values.column_search.column)}).search(${JSON.stringify(values.column_search.term)}).draw();`] : []));
    }
    return lines.join('\n');
  }
  return JSON.stringify(first);
}
