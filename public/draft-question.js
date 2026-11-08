// Convert stored questions into the model used by the faculty form editor.
export function editableQuestion(activity, rule) {
  const config = activity.publicConfig || {};
  const criteria = rule.criteria || [];
  const first = criteria[0]?.answer;
  const item = { type: activity.type, prompt: activity.prompt };
  const option = (id) => config.options?.find((value) => value.id === id)?.label ?? id;
  switch (activity.type) {
    case 'single_choice':
    case 'multiple_choice':
      item.options = config.options.map((value) => value.label);
      item.answer = Array.isArray(first) ? first.map(option) : option(first);
      break;
    case 'sequencing':
      item.options = config.items.map((value) => value.label);
      item.answer = first.map((id) => config.items.find((value) => value.id === id)?.label ?? id);
      break;
    case 'true_false':
    case 'text_entry':
    case 'numeric_entry':
      item.answer = first;
      break;
    case 'matching':
      item.pairs = criteria.map(({ answer }) => ({
        left: config.left.find((value) => value.id === answer.left)?.label ?? answer.left,
        right: config.right.find((value) => value.id === answer.right)?.label ?? answer.right,
      }));
      break;
    case 'code_writing':
      Object.assign(item, config, { referenceCode: rule.referenceCode || '' });
      if (criteria.every((value) => value.answer.kind === 'manual'))
        item.rubric = criteria.map((value) => value.answer.description);
      else item.tests = criteria.map((value) => value.answer);
      break;
    case 'web_project':
      Object.assign(item, {
        projectKind:
          config.seedSql || Object.keys(config.files).some((name) => name.endsWith('.php'))
            ? 'php-web'
            : 'frontend',
        files: config.files,
        expectedHtml: config.expectedHtml || '',
        seedSql: config.seedSql || '',
        rubric: criteria
          .filter((value) => value.answer.kind === 'manual')
          .map((value) => value.answer.description),
      });
      // Existing HTTP checks are retained by the server when editing legacy projects.
      if (!item.rubric.length)
        item.rubric = ['Review the submitted project against the problem requirements.'];
      break;
    case 'data_inspection':
    case 'datatable_code': {
      item.table = {
        columns: config.columns,
        rows: config.rows,
        pageLengths: config.pageLengths,
        selector: config.selector,
        scaffold: config.scaffold,
      };
      const values = Object.fromEntries(criteria.map((value) => [value.answer.kind, value.answer.value]));
      item.answer = {
        pageLength: values.page_length,
        pageIndex: values.page_index ?? 0,
        globalSearch: values.global_search || '',
        columnSearch: values.column_search
          ? { [values.column_search.column]: values.column_search.term }
          : {},
        order: values.order,
        flags: values.flags,
        lengthMenu: values.length_menu,
      };
      break;
    }
    default:
      throw new Error('This question type cannot be edited.');
  }
  return item;
}
