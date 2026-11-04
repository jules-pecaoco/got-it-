export function distributePaperPoints(activities, totalPoints) {
  if (!activities.length) return [];
  const weights = activities.map((activity) => Math.max(0, Number(activity.maxPoints) || 0));
  const weightTotal = weights.reduce((sum, value) => sum + value, 0) || activities.length;
  const shares = weights.map((weight, index) => {
    const exact =
      (totalPoints *
        (weightTotal === activities.length && weights.every((value) => value === 0) ? 1 : weight)) /
      weightTotal;
    return { points: Math.max(1, Math.floor(exact)), remainder: exact - Math.floor(exact), index };
  });
  let difference = totalPoints - shares.reduce((sum, share) => sum + share.points, 0);
  if (difference > 0) {
    const order = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index);
    for (let i = 0; i < difference; i++) order[i % order.length].points++;
  } else if (difference < 0) {
    const order = [...shares].sort((a, b) => a.remainder - b.remainder || b.index - a.index);
    while (difference < 0) {
      const share = order.find((item) => item.points > 1);
      if (!share) break;
      share.points--;
      difference++;
    }
  }
  return shares.map((share) => share.points);
}

export function appendPaperInput(doc, card, activity, config) {
  const paragraph = (text, className = '') => {
    const p = doc.createElement('p');
    p.className = className;
    p.textContent = text;
    card.append(p);
    return p;
  };
  const table = (columns, rows, className = 'paper-dataset') => {
    const wrap = doc.createElement('div');
    wrap.className = className;
    const tableEl = doc.createElement('table');
    const head = doc.createElement('thead'),
      headRow = doc.createElement('tr');
    for (const column of columns) {
      const th = doc.createElement('th');
      th.textContent = column.label;
      headRow.append(th);
    }
    head.append(headRow);
    tableEl.append(head);
    const body = doc.createElement('tbody');
    for (const row of rows) {
      const tr = doc.createElement('tr');
      for (const column of columns) {
        const td = doc.createElement('td');
        td.textContent = String(row[column.id] ?? '');
        tr.append(td);
      }
      body.append(tr);
    }
    tableEl.append(body);
    wrap.append(tableEl);
    card.append(wrap);
  };
  const lines = (count) => {
    const area = doc.createElement('div');
    area.className = 'paper-response';
    for (let i = 0; i < count; i++) {
      const line = doc.createElement('div');
      line.className = 'write-line';
      area.append(line);
    }
    card.append(area);
  };
  if (
    activity.type === 'single_choice' ||
    activity.type === 'multiple_choice' ||
    activity.type === 'true_false'
  ) {
    const choices =
      activity.type === 'true_false' ? [{ label: 'True' }, { label: 'False' }] : config.options || [];
    const list = doc.createElement('ol');
    list.className = 'paper-options';
    for (const choice of choices) {
      const item = doc.createElement('li');
      item.textContent = `☐ ${choice.label}`;
      list.append(item);
    }
    card.append(list);
  } else if (activity.type === 'code_writing') {
    paragraph(`Write a ${config.language} solution.`);
    for (const [index, sample] of config.samples.entries()) {
      paragraph(`Example ${index + 1} — ${config.language === 'sql' ? 'Database setup' : 'Input'}`);
      const input = doc.createElement('pre');
      input.textContent = sample.input || '(no input)';
      card.append(input);
      paragraph('Expected output');
      const output = doc.createElement('pre');
      output.textContent = sample.output || '(empty output)';
      card.append(output);
    }
    if (config.starterCode) {
      paragraph('Starter code');
      const pre = doc.createElement('pre');
      pre.textContent = config.starterCode;
      card.append(pre);
    }
    lines(14);
  } else if (activity.type === 'matching') {
    paragraph(`Match each item to one choice: ${(config.right || []).map((item) => item.label).join(' · ')}`);
    for (const item of config.left || [])
      paragraph(`${item.label}  __________________________________________`);
  } else if (activity.type === 'sequencing') {
    paragraph(`Put these steps in order: ${(config.items || []).map((item) => item.label).join(' · ')}`);
    for (let i = 0; i < (config.items || []).length; i++)
      paragraph(`Step ${i + 1}: __________________________________________`);
  } else if (activity.type === 'data_inspection' || activity.type === 'datatable_code') {
    if (config.columns?.length && config.rows?.length) {
      if (activity.type === 'datatable_code') {
        table(
          [
            { id: 'index', label: 'Column index' },
            { id: 'label', label: 'Field' },
          ],
          config.columns.map((column, index) => ({ index, label: column.label })),
          'paper-dataset',
        );
      }
      table(config.columns, config.rows);
    }
    if (activity.type === 'datatable_code') {
      if (config.scaffold) {
        paragraph('Code scaffold');
        const scaffold = doc.createElement('pre');
        scaffold.textContent = config.scaffold;
        card.append(scaffold);
      }
      if (config.apiReference?.length)
        paragraph(`Reference: ${config.apiReference.map((item) => `${item.api} — ${item.use}`).join(' · ')}`);
      paragraph('Write your completed code below.');
      const area = doc.createElement('div');
      area.className = 'paper-response';
      for (let i = 0; i < 14; i++) {
        const line = doc.createElement('div');
        line.className = 'write-line code-line';
        area.append(line);
      }
      card.append(area);
    } else {
      const requestedRows = Number(/show\s+(\d+)\s+rows per page/i.exec(activity.prompt || '')?.[1]) || 5;
      const blankRows = Math.min(8, Math.max(1, requestedRows));
      paragraph('Table settings');
      paragraph(
        'Rows per page: ______   Page: ______   Search: __________________   Column filter: __________________',
      );
      paragraph('Primary order: __________________   Secondary order: __________________');
      table(
        config.columns,
        Array.from({ length: blankRows }, () => ({})),
        'paper-blank-table',
      );
    }
  } else {
    paragraph(activity.type === 'numeric_entry' ? 'Answer and unit:' : 'Answer:');
    lines(activity.type === 'text_entry' ? 2 : 3);
  }
}
