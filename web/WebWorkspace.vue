<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { exportProject, importProject } from './project-archive.js';
import { validateProject } from '../public/web-project.js';
import type { CodingActivity, Project, WorkspaceActions } from './contracts.js';
const props = defineProps<{ activity: CodingActivity; actions: WorkspaceActions }>();
const initial = (props.activity.lastDraft?.value ?? props.activity.lastSubmission?.value) as
  Project | undefined;
const files = ref<Record<string, string>>({ ...(initial?.files ?? props.activity.publicConfig.files) });
const database = ref(initial?.database),
  active = ref(Object.keys(files.value)[0] ?? 'index.php');
const source = computed({
  get: () => files.value[active.value] ?? '',
  set: (value: string) => {
    files.value[active.value] = value;
  },
});
const url = ref(''),
  busy = ref(false),
  error = ref(''),
  filename = ref('');
const frame = ref<HTMLIFrameElement>(),
  consoleLines = ref<string[]>([]);
function receiveConsole(event: MessageEvent) {
  if (
    !url.value ||
    event.origin !== new URL(url.value).origin ||
    event.source !== frame.value?.contentWindow ||
    event.data?.type !== 'gotit-preview-console'
  )
    return;
  consoleLines.value = [...consoleLines.value.slice(-99), String(event.data.text).slice(0, 2000)];
}
onMounted(() => window.addEventListener('message', receiveConsole));
onUnmounted(() => window.removeEventListener('message', receiveConsole));
const project = (): Project => ({
  files: { ...files.value },
  ...(database.value ? { database: database.value } : {}),
});
function changed() {
  props.actions.changed?.();
}
function addFile() {
  if (
    !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\.(php|html|css|js|json|txt)$/.test(filename.value) ||
    Object.keys(files.value).length >= 20 ||
    filename.value in files.value
  ) {
    error.value = 'Choose a new relative filename; maximum 20 files.';
    return;
  }
  files.value[filename.value] = '';
  active.value = filename.value;
  filename.value = '';
  changed();
}
async function preview(reset = false) {
  busy.value = true;
  error.value = '';
  try {
    const result = await props.actions.preview!(project(), reset);
    database.value = result.database;
    consoleLines.value = [];
    url.value = result.url;
    changed();
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
function download() {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(
    new Blob([exportProject(project()) as BlobPart], { type: 'application/zip' }),
  );
  link.download = `${props.activity.id}.zip`;
  link.click();
  URL.revokeObjectURL(link.href);
}
async function upload(event: Event) {
  try {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 1600000) throw new Error('Project exceeds 1.6 MB.');
    const value = file.name.endsWith('.zip')
      ? importProject(new Uint8Array(await file.arrayBuffer()))
      : (JSON.parse(await file.text()) as Project);
    const errors = validateProject(value);
    if (errors.length) throw new Error(errors.join(' '));
    files.value = value.files;
    database.value = value.database;
    active.value = Object.keys(value.files)[0];
    url.value = '';
    changed();
  } catch (cause) {
    error.value = (cause as Error).message;
  }
}
defineExpose({ value: project });
</script>
<template>
  <section class="coding-workspace">
    <div class="button-row">
      <button type="button" @click="download">Download project ZIP</button
      ><label>Import project<input type="file" accept=".zip,.json" @change="upload" /></label>
    </div>
    <div class="file-tabs" aria-label="Project files">
      <button
        v-for="name in Object.keys(files)"
        :key="name"
        type="button"
        :aria-pressed="name === active"
        @click="active = name"
      >
        {{ name }}
      </button>
    </div>
    <div class="button-row">
      <label
        >New file<input v-model="filename" placeholder="style.css" @keydown.enter.prevent="addFile" /></label
      ><button type="button" @click="addFile">Add file</button>
    </div>
    <label
      >{{ active
      }}<textarea v-model="source" rows="18" spellcheck="false" maxlength="50000" @input="changed"></textarea>
    </label>
    <div class="button-row">
      <button type="button" :disabled="busy" @click="preview(false)">
        {{ busy ? 'Opening…' : 'Run web preview' }}</button
      ><button type="button" :disabled="busy" @click="preview(true)">Reset database and preview</button>
    </div>
    <p role="status">{{ error }}</p>
    <iframe
      v-if="url"
      ref="frame"
      :src="url"
      title="Your PHP application"
      class="web-preview"
      sandbox="allow-scripts allow-forms allow-same-origin"
      referrerpolicy="no-referrer"
    ></iframe>
    <details>
      <summary>JavaScript console</summary>
      <pre aria-label="Preview console">{{ consoleLines.join('\n') || 'No messages.' }}</pre>
    </details>
    <p class="small">
      Database: SQLite through PDO at /tmp/data/database.sqlite. Preview expires after ten minutes. Save
      project checkpoints before leaving.
    </p>
  </section>
</template>
