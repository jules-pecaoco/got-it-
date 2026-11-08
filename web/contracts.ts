export interface CodingActivity {
  id: string;
  type: 'code_writing' | 'web_project';
  lastDraft?: { value: string | Project };
  lastSubmission?: { value: string | Project };
  publicConfig: {
    expectedHtml?: string;
    seedSql?: string;
    language?: string;
    starterCode?: string;
    files?: Record<string, string>;
    samples?: { input: string; output: string; transcript?: string }[];
  };
}
export interface Project {
  files: Record<string, string>;
  database?: string;
}
export interface ExecutionSample {
  output: string;
  input: string;
  error?: string;
  succeeded: boolean;
}
export interface WorkspaceActions {
  snapshot?: () => Promise<{ database?: string }>;
  discardPreview?: () => Promise<unknown>;
  terminalUnavailable?: boolean;
  run: (value: string, input?: string) => Promise<{ samples: ExecutionSample[] }>;
  preview?: (
    value: Project,
    reset?: boolean,
  ) => Promise<{ url: string; database?: string; warning?: string }>;
  changed?: () => void;
  terminal?: {
    open: (value: string) => Promise<import('../src/terminal.mts').TerminalState>;
    read: (id: string) => Promise<import('../src/terminal.mts').TerminalState>;
    write: (
      id: string,
      input: { line?: string; eof?: boolean },
    ) => Promise<import('../src/terminal.mts').TerminalState>;
    stop: (id: string) => Promise<import('../src/terminal.mts').TerminalState>;
  };
}
