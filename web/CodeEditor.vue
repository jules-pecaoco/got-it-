<script setup lang="ts">
import { onMounted, onUnmounted, ref, watch } from 'vue';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import {
  EditorView,
  drawSelection,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import {
  bracketMatching,
  defaultHighlightStyle,
  indentOnInput,
  indentUnit,
  syntaxHighlighting,
} from '@codemirror/language';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { html } from '@codemirror/lang-html';
import { css } from '@codemirror/lang-css';
import { sql, SQLite } from '@codemirror/lang-sql';
import { php } from '@codemirror/lang-php';

const props = defineProps<{
  modelValue: string;
  language: string;
  label: string;
  documentKey: string;
  maxLength: number;
}>();
const emit = defineEmits<{ 'update:modelValue': [value: string]; change: [] }>();
const host = ref<HTMLDivElement>();
const highlighted = ref(false);
const limitMessage = ref('');
const language = new Compartment(),
  attributes = new Compartment();
const documents = new Map<string, EditorState>();
let view: EditorView | undefined,
  currentKey = props.documentKey,
  currentLanguage = props.language,
  currentLabel = props.label;
function languageMode(): Extension {
  const name = props.language.toLowerCase().split('.').pop();
  const modes: Record<string, () => Extension> = {
    python,
    py: python,
    javascript,
    js: javascript,
    html,
    htm: html,
    css,
    sql: () => sql({ dialect: SQLite }),
    php,
  };
  return [modes[name || '']?.() || [], indentUnit.of(name === 'python' || name === 'py' ? '    ' : '  ')];
}
function editorAttributes() {
  return EditorView.contentAttributes.of({
    'aria-label': props.label,
    'aria-multiline': 'true',
    spellcheck: 'false',
  });
}
function createState() {
  const nonce =
    document.querySelector<HTMLMetaElement>('meta[name="expected-output-style-nonce"]')?.content || '';
  return EditorState.create({
    doc: props.modelValue,
    extensions: [
      EditorView.cspNonce.of(nonce),
      lineNumbers(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      highlightSpecialChars(),
      history(),
      drawSelection(),
      indentOnInput(),
      bracketMatching(),
      syntaxHighlighting(defaultHighlightStyle),
      EditorView.lineWrapping,
      keymap.of([indentWithTab, ...defaultKeymap, ...historyKeymap]),
      language.of(languageMode()),
      attributes.of(editorAttributes()),
      EditorState.transactionFilter.of((transaction) => {
        if (transaction.docChanged && transaction.newDoc.length > props.maxLength) {
          queueMicrotask(() => {
            limitMessage.value = `Use at most ${props.maxLength.toLocaleString()} characters.`;
          });
          return [];
        }
        return transaction;
      }),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged) return;
        limitMessage.value = '';
        emit('update:modelValue', update.state.doc.toString());
        emit('change');
      }),
    ],
  });
}
onMounted(() => {
  // Older app processes may serve new assets before their CSP nonce support is loaded.
  // Keep an ordinary editor usable until that process is restarted.
  if (!document.querySelector('meta[name="expected-output-style-nonce"]')) return;
  view = new EditorView({ state: createState(), parent: host.value });
  highlighted.value = true;
});
watch(
  () => [props.documentKey, props.modelValue, props.language, props.label],
  () => {
    if (!view) return;
    const switched = currentKey !== props.documentKey;
    if (switched) {
      documents.set(currentKey, view.state);
      currentKey = props.documentKey;
      const saved = documents.get(currentKey);
      view.setState(saved?.doc.toString() === props.modelValue ? saved : createState());
    } else if (view.state.doc.toString() !== props.modelValue) {
      view.setState(createState());
    }
    if (switched || currentLanguage !== props.language || currentLabel !== props.label) {
      view.dispatch({
        effects: [language.reconfigure(languageMode()), attributes.reconfigure(editorAttributes())],
      });
      currentLanguage = props.language;
      currentLabel = props.label;
    }
  },
);
onUnmounted(() => {
  view?.destroy();
  documents.clear();
});
function plainInput(event: Event) {
  emit('update:modelValue', (event.target as HTMLTextAreaElement).value);
  emit('change');
}
</script>
<template>
  <div class="source-editor">
    <div ref="host" class="code-editor-host"></div>
    <textarea
      v-if="!highlighted"
      :value="modelValue"
      :aria-label="label"
      :maxlength="maxLength"
      rows="18"
      spellcheck="false"
      @input="plainInput"
    ></textarea>
    <p v-if="highlighted" class="small editor-keyboard-help">
      Tab indents. Press Escape, then Tab to move focus.
    </p>
    <p v-if="limitMessage" class="small" role="status">{{ limitMessage }}</p>
  </div>
</template>
