<script setup lang="ts">
import { ref } from 'vue';
import type { CodingActivity, WorkspaceActions, ExecutionSample } from './contracts.js';
const props = defineProps<{ activity: CodingActivity; actions: WorkspaceActions }>();
const value = ref(
  String(
    props.activity.lastDraft?.value ??
      props.activity.lastSubmission?.value ??
      props.activity.publicConfig.starterCode ??
      '',
  ),
);
const samples = ref<ExecutionSample[]>([]),
  busy = ref(false),
  error = ref('');
const extensions: Record<string, string> = { php: 'php', python: 'py', javascript: 'js', sql: 'sql' };
const extension = extensions[props.activity.publicConfig.language ?? ''] ?? 'txt';
function download() {
  const url = URL.createObjectURL(new Blob([value.value], { type: 'text/plain;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${props.activity.id}.${extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
async function upload(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0];
  if (!file) return;
  if (file.size > 16000 || !file.name.endsWith(`.${extension}`)) {
    error.value = `Choose a .${extension} file up to 16 KB.`;
    return;
  }
  value.value = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
  props.actions.changed?.();
}
async function run() {
  busy.value = true;
  error.value = '';
  try {
    samples.value = (await props.actions.run(value.value)).samples;
  } catch (cause) {
    error.value = (cause as Error).message;
  } finally {
    busy.value = false;
  }
}
defineExpose({ value: () => value.value });
</script>
<template>
  <section class="coding-workspace">
    <div class="button-row">
      <strong>{{ activity.publicConfig.language }}</strong
      ><button type="button" @click="download">Download code</button
      ><label>Import solution<input type="file" :accept="`.${extension}`" @change="upload" /></label>
    </div>
    <details>
      <summary>Sample inputs and expected outputs</summary>
      <section v-for="(sample, i) in activity.publicConfig.samples" :key="i">
        <h4>Example {{ i + 1 }}</h4>
        <pre>{{ sample.input }}</pre>
        <pre>{{ sample.output }}</pre>
      </section>
    </details>
    <textarea
      v-model="value"
      :aria-label="`${activity.publicConfig.language} solution`"
      rows="18"
      spellcheck="false"
      maxlength="16000"
      @input="actions.changed?.()"
    ></textarea>
    <button type="button" :disabled="busy" @click="run">{{ busy ? 'Running…' : 'Run sample tests' }}</button>
    <div role="status">
      <p v-if="error">{{ error }}</p>
      <section v-for="(sample, i) in samples" :key="i">
        <h4>Example {{ i + 1 }}: {{ sample.matches ? 'Passed' : 'Output differs' }}</h4>
        <p>Your output</p>
        <pre>{{ sample.output || '(empty)' }}</pre>
        <p>Expected output</p>
        <pre>{{ sample.expectedOutput }}</pre>
        <pre v-if="sample.error">{{ sample.error }}</pre>
      </section>
    </div>
  </section>
</template>
