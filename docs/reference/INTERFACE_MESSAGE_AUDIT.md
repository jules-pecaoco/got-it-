# Interface message audit

Scope: student, faculty and proctor pages; code and project editors; shared request notices; errors returned to those pages; saved-answer review and completion.

## Resolved findings

| Finding | Change |
| --- | --- |
| Review showed “0 without a server-saved answer · 0 with pending changes” even when everything was saved. | Show “All your answers are saved. You can finish when you are ready.” Only show counts that need attention. |
| Completion repeated pre-submission rules about saved drafts and remaining retries. | Show the actual answer count, whether processing or faculty grading is needed, and when the score will appear. |
| An open review dialog could remain visible after time expired. | Close it when rendering the completion screen, and prevent saving notices from replacing completion messages. |
| Saved and submitted were mixed together. | Distinguish writing, saving online, saving only on the device, submission and completion. Explain what to do when saving fails. |
| Extra tries could be mistaken for total submissions; zero deductions cluttered messages. | State total submissions allowed, explain that deductions start after the first submission, and omit deductions that do not apply. |
| Error codes and hosting terms appeared in user notices. | Shared role-aware messages explain the problem and next action. Original codes, status and technical messages remain available to the code; API contracts and logs remain unchanged. |
| A message translated twice could turn an incorrect-password error into an expired-sign-in error. | Preserve the original message internally and make translation repeatable. |
| Faculty table settings and errors exposed raw field names and zero-based row/page numbers. | Label settings in ordinary language, show row and page numbers starting at 1, and retain enough detail to edit the question. |
| Proctor counts include saved answers, not only submitted answers. | Label them “Answers saved” and explain that they include answers still being worked on. |
| “Connection stale” could be mistaken for proof that a student was offline. | Say no connection update was received for over 45 seconds and advise checking with the student. |
| Creation guidance claimed every upload went to Google, even when Groq was selected. | State that teaching material goes to the AI service faculty chooses. |
| Class scheduling/access used several names for the same thing. | Use “Assign to a class”, “Activity code”, “Activity PIN”, and “Activity settings and access” across the role pages and shared details. |
| Errors could disappear before a person finished reading them. | Action errors stay visible until replaced by a new message. |

## Message rules for future changes

1. Say what happened, then give a concrete next action when one is needed.
2. Describe the person's task rather than storage, jobs, containers, hashes or request protocols.
3. Distinguish an answer saved online from changes saved only on the device, and distinguish both from submission.
4. Never promise that a changed answer will count when the student has used all tries. Do not hide applicable point or time deductions.
5. Do not show a warning about zero problems. Match singular/plural wording to the count.
6. Use the same names on buttons, instructions and shared access details.
7. Keep actual program output, compiler errors, question content and subject-specific reference material intact. They are assessment content, not application status messages.
8. A disconnected monitor is an observation about updates, not proof of student misconduct or an offline device.

## Verification

Message-state tests cover saved/unanswered/unsaved review, completion and pending processing, total tries, zero deductions, role-specific sign-in/recovery errors, preserved machine codes, and readable table settings. Browser checks used a fictional in-memory assessment to confirm automatic saving, the all-saved review, final submission, faculty status and proctor monitoring. No real student work or grades were changed.

The full-suite expiry/result-publication failure reported earlier is independent of this wording work. Retain it as an outstanding check if it still reproduces.
