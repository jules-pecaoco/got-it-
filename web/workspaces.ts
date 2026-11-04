import { createApp } from 'vue';
import LogicWorkspace from './LogicWorkspace.vue';
import WebWorkspace from './WebWorkspace.vue';
import type { CodingActivity, WorkspaceActions } from './contracts.js';
import './workspaces.css';
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
