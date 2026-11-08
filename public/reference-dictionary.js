// Guide content is fetched from the authenticated API, never bundled here.
export function searchReferences(guides, query = '', topic = '') {
  const terms = query.toLowerCase().trim().split(/\s+/).filter(Boolean);
  return guides
    .filter((guide) => !topic || guide.id === topic)
    .flatMap((guide) =>
      guide.entries
        .filter((entry) => {
          const text = `${guide.label} ${entry.title} ${entry.text} ${entry.code}`.toLowerCase();
          return terms.every((term) => text.includes(term));
        })
        .map((entry) => ({ ...entry, topic: guide.id, label: guide.label, note: guide.note })),
    );
}
export function renderReferenceResults(target, guides, query = '', topic = '') {
  target.replaceChildren();
  const results = searchReferences(guides, query, topic);
  let previous = '';
  for (const entry of results) {
    if (previous !== entry.topic) {
      const heading = document.createElement('h3');
      heading.textContent = entry.label;
      const note = document.createElement('p');
      note.className = 'small';
      note.textContent = entry.note;
      target.append(heading, note);
      previous = entry.topic;
    }
    const details = document.createElement('details');
    details.className = 'reference-entry';
    details.open = !!query.trim();
    const summary = document.createElement('summary');
    summary.textContent = entry.title;
    const text = document.createElement('p');
    text.textContent = entry.text;
    const pre = document.createElement('pre'),
      code = document.createElement('code');
    code.textContent = entry.code;
    pre.append(code);
    details.append(summary, text, pre);
    target.append(details);
  }
  return results.length;
}
export function createReferenceDictionary(trigger, dialog, request) {
  const search = dialog.querySelector('[data-reference-search]');
  const topic = dialog.querySelector('[data-reference-topic]');
  const status = dialog.querySelector('[data-reference-status]');
  const results = dialog.querySelector('[data-reference-results]');
  let guides = null,
    key = '',
    generation = 0;
  const render = () => {
    const count = renderReferenceResults(results, guides || [], search.value, topic.value);
    status.textContent = count ? `${count} reference entries` : 'No matching entries. Try another term.';
  };
  trigger.addEventListener('click', async () => {
    const current = generation;
    dialog.showModal();
    search.focus();
    if (guides) {
      render();
      return;
    }
    status.textContent = 'Loading reference guides…';
    try {
      const response = await request('/api/me/reference-guides', { silent: true });
      if (current !== generation) return;
      guides = response.guides;
      topic.replaceChildren(
        new Option('All allowed guides', ''),
        ...guides.map((guide) => new Option(guide.label, guide.id)),
      );
      render();
    } catch (error) {
      if (current === generation) status.textContent = error.message;
    }
  });
  dialog.querySelector('[data-reference-close]').addEventListener('click', () => dialog.close());
  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      dialog.close();
    }
  });
  dialog.addEventListener('close', () => {
    if (!trigger.hidden && !trigger.classList.contains('hidden')) trigger.focus();
  });
  search.addEventListener('input', render);
  topic.addEventListener('change', render);
  return {
    configure(ids, context) {
      const next = context + ':' + ids.join(',');
      trigger.classList.toggle('hidden', !ids.length);
      if (key === next) return;
      key = next;
      generation++;
      guides = null;
      search.value = '';
      topic.replaceChildren();
      results.replaceChildren();
      if (dialog.open) dialog.close();
    },
  };
}
