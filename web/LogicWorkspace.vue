<script setup lang="ts">
import CodeEditor from './CodeEditor.vue';
import { userErrorMessage } from '../public/user-messages.js';
import { computed, nextTick, onUnmounted, ref, watch } from 'vue';
import type { CodingActivity, WorkspaceActions, ExecutionSample } from './contracts.js';
import type { TerminalState } from '../src/terminal.mts';
const compactMedia = window.matchMedia('(max-width: 850px)');
const compactScreen = ref(compactMedia.matches);
const updateCompact = () => {
  compactScreen.value = compactMedia.matches;
};
compactMedia.addEventListener('change', updateCompact);
onUnmounted(() => compactMedia.removeEventListener('change', updateCompact));
const props = defineProps<{ activity: CodingActivity; actions: WorkspaceActions }>();
const value = ref(
  String(
    props.activity.lastDraft?.value ??
      props.activity.lastSubmission?.value ??
      props.activity.publicConfig.starterCode ??
      '',
  ),
);
const error = ref('');
const input = ref(props.activity.publicConfig.samples?.[0]?.input ?? '');
const samples = ref<ExecutionSample[]>([]);
const busy = ref(false);
const terminal = ref<TerminalState>();
const terminalInput = ref('');
const sending = ref(false);
const terminalOutput = ref<HTMLElement>();
const replyInput = ref<HTMLInputElement>();
const interactive = computed(
  () => !!props.actions.terminal && props.activity.publicConfig.language !== 'sql',
);
const running = computed(() => terminal.value?.status === 'running' || terminal.value?.status === 'starting');
let poll: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let disposed = false,
  stoppedWhileOpening = false;
async function refreshTerminal() {
  if (!terminal.value || disposed || !props.actions.terminal) return;
  const current = generation;
  try {
    const result = await props.actions.terminal.read(terminal.value.id);
    if (disposed || current !== generation) return;
    terminal.value = result;
    if (running.value) poll = setTimeout(refreshTerminal, 350);
  } catch (cause) {
    if (disposed || current !== generation) return;
    error.value = userErrorMessage(cause, 'student');
    await stop();
  }
}
async function stop() {
  generation++;
  stoppedWhileOpening = true;
  clearTimeout(poll);
  if (terminal.value && props.actions.terminal) {
    try {
      terminal.value = await props.actions.terminal.stop(terminal.value.id);
    } catch (cause) {
      error.value = userErrorMessage(cause, 'student');
    }
  }
}
async function sendInput(eof = false) {
  if (!terminal.value || !props.actions.terminal || sending.value) return;
  sending.value = true;
  const current = ++generation;
  clearTimeout(poll);
  try {
    const result = await props.actions.terminal.write(
      terminal.value.id,
      eof ? { eof: true } : { line: terminalInput.value },
    );
    if (disposed || current !== generation) return;
    terminal.value = result;
    terminalInput.value = '';
  } catch (cause) {
    error.value = userErrorMessage(cause, 'student');
  } finally {
    sending.value = false;
    if (!disposed && current === generation && running.value) poll = setTimeout(refreshTerminal, 350);
    await nextTick();
    replyInput.value?.focus();
  }
}
watch(
  () => terminal.value?.output,
  async () => {
    await nextTick();
    if (terminalOutput.value) terminalOutput.value.scrollTop = terminalOutput.value.scrollHeight;
  },
);
onUnmounted(() => {
  generation++;
  disposed = true;
  stoppedWhileOpening = true;
  clearTimeout(poll);
  if (terminal.value && props.actions.terminal)
    void props.actions.terminal.stop(terminal.value.id).catch(() => {});
});
async function run() {
  if (!interactive.value) return runBatch();
  busy.value = true;
  error.value = '';
  terminalInput.value = '';
  stoppedWhileOpening = false;
  generation++;
  clearTimeout(poll);
  try {
    const result = await props.actions.terminal!.open(value.value);
    if (disposed || stoppedWhileOpening) {
      await props.actions.terminal!.stop(result.id);
      return;
    }
    terminal.value = result;
    if (running.value) poll = setTimeout(refreshTerminal, 350);
    await nextTick();
    replyInput.value?.focus();
  } catch (cause) {
    error.value = userErrorMessage(cause, 'student');
  } finally {
    busy.value = false;
  }
}
async function runBatch() {
  busy.value = true;
  error.value = '';
  samples.value = [];
  try {
    samples.value = (await props.actions.run(value.value, input.value)).samples;
  } catch (cause) {
    error.value = userErrorMessage(cause, 'student');
  } finally {
    busy.value = false;
  }
}
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
defineExpose({ value: () => value.value });
</script>
<template>
  <section class="coding-workspace">
    <details class="sample-runs" aria-label="Sample runs">
      <summary>Sample inputs and expected outputs</summary>
      <section v-for="(sample, i) in activity.publicConfig.samples" :key="i" class="coding-sample">
        <h4>Sample {{ i + 1 }}</h4>
        <div v-if="sample.transcript">
          <p>Sample run · includes typed input</p>
          <pre>{{ sample.transcript }}</pre>
        </div>
        <div v-else class="sample-run-values">
          <div>
            <p>{{ activity.publicConfig.language === 'sql' ? 'Database setup' : 'Sample input' }}</p>
            <pre>{{ sample.input || '(no input)' }}</pre>
          </div>
          <div>
            <p>Expected output</p>
            <pre>{{ sample.output || '(empty output)' }}</pre>
          </div>
        </div>
      </section>
    </details>
    <CodeEditor
      v-model="value"
      :language="activity.publicConfig.language || ''"
      :label="(activity.publicConfig.language || '') + ' solution'"
      :document-key="activity.id"
      :max-length="16000"
      @change="actions.changed?.()"
    />
    <div class="button-row">
      <strong>{{ activity.publicConfig.language }}</strong
      ><button type="button" @click="download">Download code</button
      ><label>Import solution<input type="file" :accept="`.${extension}`" @change="upload" /></label>
    </div>
    <p>
      Write your solution in the editor above. Select Run code to test it, then Submit answer when you are
      ready.
    </p>

    <label v-if="!interactive"
      >Input for your run<textarea
        class="run-input"
        v-model="input"
        rows="4"
        maxlength="16000"
        spellcheck="false"
      ></textarea>
    </label>
    <div class="button-row">
      <button type="button" :disabled="busy || running || actions.terminalUnavailable" @click="run">
        {{ busy ? 'Starting…' : 'Run code' }}
      </button>
      <button v-if="interactive && (busy || running)" type="button" @click="stop">Stop</button>
    </div>
    <p v-if="actions.terminalUnavailable" role="status">
      Code running is not ready. You can keep writing your answer. Ask your instructor for help before trying
      to run it.
    </p>
    <section v-if="interactive" class="terminal-panel" aria-label="Code terminal">
      <h3>Program output</h3>
      <pre ref="terminalOutput" class="terminal-output" tabindex="0" aria-label="Terminal output">{{
        terminal?.output ||
        (busy
          ? 'Starting program…'
          : running
            ? 'Program running…'
            : terminal
              ? '(no output)'
              : 'Run your code to begin.')
      }}</pre>
      <div class="terminal-input-row">
        <label
          >Your reply to the program<input
            ref="replyInput"
            v-model="terminalInput"
            maxlength="4096"
            autocomplete="off"
            spellcheck="false"
            :disabled="!running || terminal?.inputClosed || sending"
            @keydown.enter.prevent="sendInput(false)"
        /></label>
        <button
          type="button"
          :disabled="!running || terminal?.inputClosed || sending"
          @click="sendInput(false)"
        >
          Send
        </button>
        <button
          type="button"
          :disabled="!running || terminal?.inputClosed || sending"
          @click="sendInput(true)"
        >
          End input
        </button>
      </div>
      <p v-if="running">
        When your program asks for input, type a reply and press Enter. Select End input when you have nothing
        more to send.
      </p>
      <p v-else-if="terminal" role="status">
        {{
          terminal.status === 'finished'
            ? 'Program finished.'
            : terminal.status === 'stopped'
              ? 'Program stopped.'
              : 'The program stopped because of an error. Read the message above and check your code.'
        }}
      </p>
      <p v-if="terminal?.error" role="status">{{ terminal.error }}</p>
    </section>
    <div v-else role="status">
      <section v-for="(sample, i) in samples" :key="i">
        <h4>Output</h4>
        <pre>{{ sample.output || '(empty)' }}</pre>
        <pre v-if="sample.error">{{ sample.error }}</pre>
      </section>
    </div>
    <p>
      Run code lets you test your work. It does not submit your answer or change your score. Select Submit
      answer when you are ready.
    </p>
    <p v-if="error" role="status">{{ error }}</p>
  </section>
</template>
