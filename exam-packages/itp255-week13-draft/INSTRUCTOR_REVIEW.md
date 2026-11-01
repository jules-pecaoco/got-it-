# Campus Queue CTF · version 7

Five missions, 40 minutes, 100 points. The sequence moves from one global search to a campus filter, page 2 navigation, and two JavaScript builds from a scaffold. Each mission ends with a ticket flag. The final flag joins evidence from mission 3 and the last code preview.

Each question allows two retries after its first submission. Mission defaults deduct 1–3 points and 10–45 seconds per retry as difficulty rises. Flag questions override those defaults with a 1-point, 10-second deduction. The faculty dashboard can change these values in an editable copy. The first submission has no penalty.

| Mission | Work | Points |
|---|---|---:|
| Find a ticket | Global search and one sort | 10 |
| Campus filter | Search one column and sort by two fields | 15 |
| Second page | Filter, sort and inspect page 2 | 20 |
| Build the view | Write DataTables configuration and API calls | 25 |
| Final key | Rebuild a second view and combine two ticket IDs | 30 |

The 36 fictional tickets have six columns. The two code scaffolds give mission-specific `// TODO` steps for settings, ordering, global search, column search and redraw, without supplying values or code. The collapsible reference gives API forms and column indexes. The student preview uses the actual DataTables 3.1.4 controls from locally hosted assets. The code editor parses only the DataTables calls taught in the lesson; it does not run arbitrary JavaScript.

## Review

- Checked the original `Week_13-2.pptx` against the extracted text. Slides 5–9 cover paging and page positions; slides 10–14 cover global and column search with `.draw()`; slides 16–18 cover two-field ordering and the filter/sort/page sequence; slide 23 contains the configuration exercise.
- Checked all ticket lists and flags against server-computed filter, sort and page results. Page 2 receives page-position credit only when the candidate submits page 2.
- Tested both code solutions, arbitrary-code rejection, a full candidate run, source review, retry deductions, attempt caps and editable copies. The 24-test suite passes.
- Earlier published versions remain available for existing runs. Version 7 requires a new run with a roster and PIN.
