import { createApp, h, ref } from 'vue';
import CodeEditor from './CodeEditor.vue';
import LogicWorkspace from './LogicWorkspace.vue';
import WebWorkspace from './WebWorkspace.vue';
import type { CodingActivity, WorkspaceActions } from './contracts.js';
import './workspaces.css';
export function mountTableEditor(
  target: HTMLElement,
  initialValue: string,
  questionId: string,
  changed: () => void,
) {
  const value = ref(initialValue);
  const app = createApp({
    render: () =>
      h(CodeEditor, {
        modelValue: value.value,
        language: 'javascript',
        label: 'DataTables JavaScript',
        documentKey: questionId,
        maxLength: 8000,
        'onUpdate:modelValue': (code: string) => {
          value.value = code;
        },
        onChange: changed,
      }),
  });
  app.mount(target);
  return { value: () => value.value, unmount: () => app.unmount() };
}
export function mountLogic(target: HTMLElement, activity: CodingActivity, actions: WorkspaceActions) {
  const app = createApp(LogicWorkspace, { activity, actions });
  const instance = app.mount(target) as unknown as { value: () => string };
  return { value: instance.value, unmount: () => app.unmount() };
}
export function mountWeb(target: HTMLElement, activity: CodingActivity, actions: WorkspaceActions) {
  const app = createApp(WebWorkspace, { activity, actions });
  const instance = app.mount(target) as unknown as { value: () => import('./contracts.js').Project };
  return { value: instance.value, unmount: () => app.unmount() };
}
