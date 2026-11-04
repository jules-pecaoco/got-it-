import { icon } from './icons.js';

export function installPasswordToggles(root = document) {
  for (const field of root.querySelectorAll('input[type="password"]')) {
    if (field.dataset.passwordToggle) continue;
    field.dataset.passwordToggle = 'true';

    const label = field.labels?.[0]?.textContent.trim() || 'password';
    const wrapper = document.createElement('span');
    wrapper.className = 'password-field';
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'password-toggle';
    toggle.setAttribute('aria-controls', field.id);
    toggle.setAttribute('aria-pressed', 'false');
    toggle.setAttribute('aria-label', `Show ${label}`);
    toggle.title = `Show ${label}`;
    toggle.append(icon('eye'));

    field.before(wrapper);
    wrapper.append(field, toggle);
    toggle.addEventListener('click', () => {
      const visible = field.type === 'password';
      field.type = visible ? 'text' : 'password';
      toggle.setAttribute('aria-pressed', String(visible));
      toggle.setAttribute('aria-label', `${visible ? 'Hide' : 'Show'} ${label}`);
      toggle.title = `${visible ? 'Hide' : 'Show'} ${label}`;
      toggle.replaceChildren(icon(visible ? 'eyeOff' : 'eye'));
      field.focus({ preventScroll: true });
    });
  }
}
