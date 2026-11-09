const questions = 200;
const questionsPerGroup = 4;
export const assessmentLimits = Object.freeze({
  questions,
  questionsPerGroup,
  groups: Math.ceil(questions / questionsPerGroup),
  generationBatchQuestions: 20,
  proposalBytes: 16_000_000,
});
