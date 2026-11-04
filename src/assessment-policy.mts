export type FeedbackMode = 'graded' | 'practice';
export interface ReleaseRun {
  feedback_mode: FeedbackMode;
}
export interface ReleaseAttempt {
  results_published_at?: string | null;
  status: string;
  deadline_at: string;
}
export function resultsReleased(run: ReleaseRun, attempt?: ReleaseAttempt): boolean {
  return (
    run.feedback_mode === 'practice' ||
    Boolean(
      attempt?.results_published_at &&
      (attempt.status !== 'in_progress' || Date.now() >= Date.parse(attempt.deadline_at)),
    )
  );
}
