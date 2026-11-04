export interface CodingActivity {
  id: string;
  type: 'code_writing' | 'web_project';
  lastDraft?: { value: string | Project };
  lastSubmission?: { value: string | Project };
  publicConfig: {
    language?: string;
    starterCode?: string;
    files?: Record<string, string>;
    samples?: { input: string; output: string }[];
  };
}
export interface Project {
  files: Record<string, string>;
  database?: string;
}
export interface ExecutionSample {
  output: string;
  expectedOutput: string;
  error?: string;
  matches: boolean;
}
export interface WorkspaceActions {
  run: (value: string) => Promise<{ samples: ExecutionSample[] }>;
  preview?: (value: Project, reset?: boolean) => Promise<{ url: string; database?: string }>;
  changed?: () => void;
}
