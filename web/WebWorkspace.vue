<script setup lang="ts">
import CodeEditor from './CodeEditor.vue';
import { userErrorMessage } from '../public/user-messages.js';
import { computed, ref, onMounted, onUnmounted } from 'vue';
import { exportProject, importProject } from './project-archive.js';
import { validateProject, expectedOutputDocument } from '../public/web-project.js';
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
    error.value =
      'Choose a new file name, such as style.css. Use up to 20 files, and do not start names with a slash.';
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
    error.value = result.warning ?? '';
    consoleLines.value = [];
    url.value = result.url;
    if (reset) changed();
  } catch (cause) {
    error.value = userErrorMessage(cause, 'student');
  } finally {
    busy.value = false;
  }
}
async function download() {
  if (busy.value) return;
  busy.value = true;
  error.value = '';
  try {
    const latest = await props.actions.snapshot?.();
    if (latest?.database !== undefined) database.value = latest.database;
    const link = document.createElement('a');
    link.href = URL.createObjectURL(
      new Blob([exportProject(project()) as BlobPart], { type: 'application/zip' }),
    );
    link.download = `${props.activity.id}.zip`;
    link.click();
    URL.revokeObjectURL(link.href);
  } catch (cause) {
    error.value = userErrorMessage(cause, 'student');
  } finally {
    busy.value = false;
  }
}

async function upload(event: Event) {
  if (busy.value) return;
  busy.value = true;
  try {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 1600000)
      throw new Error('This project is too large to import. Choose a file smaller than 1.6 MB.');
    const value = file.name.endsWith('.zip')
      ? importProject(new Uint8Array(await file.arrayBuffer()))
      : (JSON.parse(await file.text()) as Project);
    const errors = validateProject(value);
    if (errors.length) throw new Error(errors.join(' '));
    await props.actions.discardPreview?.();
    files.value = value.files;
    database.value = value.database;
    active.value = Object.keys(value.files)[0];
    url.value = '';
    changed();
  } catch (cause) {
    error.value = userErrorMessage(cause, 'student');
  } finally {
    busy.value = false;
  }
}
defineExpose({ value: project });
</script>
<template>
  <section class="coding-workspace web-workspace">
    <details v-if="activity.publicConfig.expectedHtml">
      <summary>Example of the finished page</summary>
      <iframe
        :srcdoc="expectedOutputDocument(activity.publicConfig.expectedHtml)"
        title="Expected output reference"
        class="web-preview"
        sandbox=""
        referrerpolicy="no-referrer"
      ></iframe>
      <p>This example shows how your finished page should look. Use Run web preview to test your own work.</p>
    </details>
    <div class="button-row">
      <button type="button" :disabled="busy" @click="download">Download project ZIP</button
      ><label
        >Import project<input type="file" accept=".zip,.json" :disabled="busy" @change="upload"
      /></label>
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
    <section :aria-label="'Edit ' + active">
      <p class="file-editor-name">{{ active }}</p>
      <CodeEditor
        v-model="source"
        :language="active"
        :label="active"
        :document-key="active"
        :max-length="50000"
        @change="changed"
      />
    </section>
    <div class="button-row">
      <button type="button" :disabled="busy" @click="preview(false)">
        {{ busy ? 'Opening…' : 'Run web preview' }}</button
      ><button type="button" :disabled="busy" @click="preview(true)" v-if="activity.publicConfig.seedSql">
        Reset database and preview
      </button>
    </div>
    <p role="status">{{ error }}</p>
    <iframe
      v-if="url"
      ref="frame"
      :src="url"
      title="Your web application"
      class="web-preview"
      sandbox="allow-scripts allow-forms allow-same-origin"
      referrerpolicy="no-referrer"
    ></iframe>
    <details>
      <summary>JavaScript console</summary>
      <pre aria-label="Messages from your web page">{{ consoleLines.join('\n') || 'No messages.' }}</pre>
    </details>
    <p class="small">
      <span v-if="activity.publicConfig.seedSql"
        >Database: SQLite through PDO at /tmp/data/database.sqlite. </span
      >The preview closes after ten minutes. Your project files save as you work; check the save message
      before leaving this page.
    </p>
  </section>
</template>
