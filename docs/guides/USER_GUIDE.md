# Use Got It!

[Documentation contents](../README.md) · Need setup? [Run locally](RUN_LOCALLY.md)

Use this page for the day-to-day workflow. Faculty prepare and grade; students complete their own attempt; proctors monitor a run without seeing answers or grades.

## Faculty: prepare an activity

1. Open **Classes** and create or import a roster. Check the school IDs before using it in a run.
2. Open **Activities → Create activity**. Choose the assessment type, difficulty, duration, question count and teaching material.
3. Generate up to 200 questions. Generation saves completed batches as it goes. Select **Resume generation** after a pause. Read each question and answer, review any quality flags, then edit and approve the questions you want to keep. Treat source-match percentages as advisory estimates.
4. Save the draft. Use **Rules and guides** to set the timer, retry costs and allowed reference guides.
5. Open **Review and publish**, resolve validation errors, and publish when ready.

The current Faculty creation screen uses AI generation and form-based review. It does not offer the former fixed starter picker, JSON import or raw package editor. The developer API still accepts package imports; see [API](../reference/API.md).

To revise a saved draft, open **Activities → Continue draft → Review and publish → Edit question**. Change the prompt, points, answer, samples, starter files or rubric as appropriate. Save the question before publishing. Editing a published activity creates an editable copy; existing runs retain their original version.

## Faculty: run a class

1. Select the published activity and choose **Assign to a class**.
2. Select the class, opening/closing times, PIN and feedback mode. Optional question shuffling happens within each section or mission.
3. Copy the student link and access details. The PIN disappears from the Faculty page on refresh or logout; it can be reset, not recovered from its stored hash.
4. If someone will proctor, issue a separate run-specific code in Results under **Activity settings and access**.

A run copies its class roster when created. Editing the class afterward changes future runs, not the roster of an existing run. For students on other computers, use the configured public HTTPS link rather than `127.0.0.1`.

## Students: answer and run code

Students join with the activity code, school ID and activity PIN. Drafts save while working and restore on refresh. Signing out does not finish the attempt or reset its timer. Rejoining preserves the original deadline and question order.

Console questions support Python, JavaScript, PHP and SQLite SQL. The editor includes highlighting, indentation, undo/redo and bracket matching. Tab indents; **Escape, then Tab** leaves the editor.

| Action                  | What it does                                                                 |
| ----------------------- | ---------------------------------------------------------------------------- |
| Run code                | Executes the current program and shows output/errors; does not award a grade |
| Terminal input          | Sends a line to an interactive Python, JavaScript or PHP program             |
| End input               | Tells the program you have no more input to send                                |
| Stop                    | Ends the current live run                                                    |
| Submit answer / Finish activity | Submits saved answers; if no tries remain, the last submitted answer is kept            |

Samples may show a human-readable dialogue such as `Price: 15` and `Total: 75`. The typed replies in that display are separate from the raw execution input and stdout. SQL uses database-setup input rather than an interactive terminal. Samples can be collapsed.

Web questions provide files, ZIP import/export, an isolated preview and a JavaScript console. A static expected-output view is a reference illustration; editing student code does not change it. PHP projects use SQLite, not MySQL. Use relative paths for project assets and forms.

**Reference guides** shows only the guides faculty allowed in the published version. Guides are disabled by default. Loaded guide content remains searchable during a disconnect; selecting Bootstrap references does not install Bootstrap in a student project.

## Faculty: grade and release results

Open **Results**, select the run and student, then review the submitted answers.

- Objective/table answers can have automatic points. Submitted console code requires faculty grading. Manual web rubrics also need faculty review.
- Use **Grade submission** to save a whole-number score within the question maximum. A grading reason is optional and limited to 300 characters. Saved changes are audited.
- **Check answer with AI** returns a suggested score and explanation. **Use suggestion in grading form** only fills the fields; **Save score** is still required. Faculty may change the suggestion or replace an earlier grade.
- Publish scores for a completed student or completed students in the run. Run closure alone does not release graded results. Pending grading jobs, failures and required manual review can block publication.

Practice mode gives immediate available feedback, but it does not turn console submissions into automatically graded answers. Graded mode withholds results until faculty publication. Extending or reopening an attempt clears early result publication.

For incidents, extend an active/expired attempt or reopen a submitted/expired attempt before the run closes. These actions need a reason and allow 1–120 additional minutes.

## Proctors: monitor a run

Open the Proctor workspace and enter the run and its separate access code. The dashboard shows participation, progress and remaining time. It does not show submitted answers, answer keys or grades. Replacing or revoking the code ends existing proctor access. The shared code does not identify individual staff members.

## Editing and deleting records

**Edit run** changes its name or closing time. A new closing time cannot cut short an active student's deadline. PIN reset stays under **Activity settings and access**.

**Delete run** permanently removes that run and its attempts/results while retaining the activity. **Delete activity** removes the selected version and its runs/results while retaining other versions. Confirmation is required in the UI. The server rejects deletion while attempts are active or grading jobs are pending. [Back up](../operations/BACKUP_AND_RECOVERY.md) before intentional record removal.

Paper copies are available in faculty review: a student sheet without answers or a separate answer key, using 8 × 13 inch portrait paper. Changing printed total points does not change online scoring.

## What optional AI sends out

Question drafting sends teaching material and instructions to the AI service and model selected by faculty. An explicitly requested answer check sends the question, grading reference and submitted answer/code; learner names/IDs are not added, and project database snapshots are excluded. Grading checks review code as text; they do not execute it.

The integration uses `GEMINI_API_KEY` and `GEMINI_MODEL`; Saved faculty AI settings choose the model for grade suggestions. Provider availability, quota and billing depend on the account. Faculty remains responsible for answers, rubrics and saved grades.


### Choosing a question-generation provider

In **AI settings**, choose **Google Gemini** or **Groq**, then select its model. Groq offers GPT-OSS 120B and GPT-OSS 20B. The selected provider/model is used for question generation, automatic repair, targeted regeneration and source-support checks. A quota, configuration or connection error never switches to another provider. Faculty can choose a different provider/model explicitly before retrying regeneration. Other questions and approvals remain intact. Saved previews restore the selected provider/model; old previews default to Gemini.

An administrator configures `GROQ_API_KEY` on the server to enable Groq. Gemini continues to use `GEMINI_API_KEY` and `GEMINI_MODEL`. Keys are never entered into the faculty form or returned by the availability endpoint. Restart the server after configuration changes. Groq uses its JSON-schema best-effort mode because the assessment schema includes flexible row fields; local validation and bounded repair still apply. Free-plan token quotas may require fewer questions or shorter teaching materials.

Student-answer grading suggestions also use the saved faculty AI settings.


### Shared AI settings

Open **AI settings** from the faculty navigation. Choose a service and model, then select **Save settings**. This choice is saved to your faculty account and applies to every new AI request: question generation, repair, regeneration, teaching-material checks and grading suggestions. Other faculty accounts have their own settings. Existing questions, approvals and saved grades are unchanged. Restoring a preview does not change your AI settings. Requests already running keep the model they started with. Providers never switch automatically. API keys remain managed by the administrator.
