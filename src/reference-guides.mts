import { referenceTopics } from '../public/reference-topics.js';
export interface ReferenceEntry {
  title: string;
  text: string;
  code: string;
}
export interface ReferenceGuide {
  id: string;
  label: string;
  note: string;
  entries: ReferenceEntry[];
}
const entry = (title: string, text: string, code: string): ReferenceEntry => ({ title, text, code });
const content: Record<string, { note: string; entries: ReferenceEntry[] }> = {
  bootstrap5: {
    note: 'Bootstrap 5.3 classes require its stylesheet. Components such as modals also need the Bootstrap JavaScript bundle; this guide does not install those assets.',
    entries: [
      entry(
        'Containers',
        'Use a container to organize page content. A fluid container spans the available width.',
        '<div class="container">Page content</div>\n<div class="container-fluid">Full-width content</div>',
      ),
      entry(
        'Responsive grid',
        'Rows contain columns. The grid has 12 columns; md classes apply from the medium breakpoint upward.',
        '<div class="row g-3">\n  <div class="col-12 col-md-6">First column</div>\n  <div class="col-12 col-md-6">Second column</div>\n</div>',
      ),
      entry(
        'Spacing',
        'm controls margin and p controls padding. t/b/s/e select a side; x/y select an axis.',
        '<div class="mt-3 px-2 py-4">Spaced content</div>',
      ),
      entry(
        'Flex utilities',
        'Combine flex display, alignment and gap utilities to arrange items.',
        '<div class="d-flex align-items-center justify-content-between gap-2">\n  <span>Heading</span><button class="btn btn-primary">Action</button>\n</div>',
      ),
      entry(
        'Buttons',
        'Apply btn and a variant class. Use type="button" for actions that should not submit a form.',
        '<button type="button" class="btn btn-primary">Continue</button>\n<button type="button" class="btn btn-outline-secondary">Cancel</button>',
      ),
      entry(
        'Form controls',
        'Keep visible labels associated with inputs. Use form-control for text fields and form-select for selects.',
        '<label for="city" class="form-label">City</label>\n<input id="city" class="form-control" name="city">\n<select class="form-select" aria-label="Region"><option>North</option></select>',
      ),
      entry(
        'Cards',
        'A card body groups a title and related content.',
        '<div class="card"><div class="card-body">\n  <h2 class="card-title">Details</h2>\n  <p class="card-text">Description</p>\n</div></div>',
      ),
      entry(
        'Responsive images and tables',
        'img-fluid scales images within their parent. Wrap wide tables in table-responsive.',
        '<img src="photo.png" class="img-fluid" alt="Building">\n<div class="table-responsive"><table class="table table-striped">...</table></div>',
      ),
    ],
  },
  sql: {
    note: 'Examples use SQLite and assume the illustrated tables exist. The SQL console accepts a read-only SELECT/WITH query; schema and sample data belong in its database setup input. PHP web apps can also change data.',
    entries: [
      entry(
        'SELECT columns',
        'Select the columns to return from an existing table.',
        'SELECT title, published_year FROM books;',
      ),
      entry(
        'WHERE and parameters',
        'Filter rows using conditions. Bind user values through the application database API instead of concatenating SQL.',
        'SELECT title FROM books\nWHERE published_year >= ? AND available = 1;',
      ),
      entry(
        'ORDER BY and LIMIT',
        'Sort results explicitly when order matters. LIMIT caps the number of returned rows.',
        'SELECT title FROM books\nORDER BY title ASC\nLIMIT 5;',
      ),
      entry(
        'NULL and LIKE',
        'Use IS NULL for missing values. In LIKE patterns, % matches any sequence and _ matches one character.',
        "SELECT title FROM books\nWHERE author_id IS NULL OR title LIKE 'A%';",
      ),
      entry(
        'COUNT, SUM and GROUP BY',
        'Aggregate functions summarize rows. GROUP BY creates groups; HAVING filters grouped results.',
        'SELECT genre, COUNT(*) AS total\nFROM books\nGROUP BY genre HAVING COUNT(*) >= 2;',
      ),
      entry(
        'JOIN related tables',
        'Join using matching key columns. LEFT JOIN also keeps unmatched rows from the left table.',
        'SELECT b.title, a.name\nFROM books AS b\nLEFT JOIN authors AS a ON a.id = b.author_id;',
      ),
      entry(
        'CREATE TABLE and INSERT',
        'Define columns, then insert values. In SQLite, INTEGER PRIMARY KEY can generate row identifiers.',
        "CREATE TABLE notes(id INTEGER PRIMARY KEY, body TEXT NOT NULL);\nINSERT INTO notes(body) VALUES ('Read chapter');",
      ),
      entry(
        'UPDATE, DELETE and transactions',
        'Use WHERE to target rows. A transaction groups related changes; ROLLBACK cancels uncommitted work.',
        "BEGIN;\nUPDATE notes SET body = 'Revised note' WHERE id = 3;\nDELETE FROM notes WHERE id = 8;\nCOMMIT;",
      ),
    ],
  },
  python: {
    note: 'Python examples use ordinary scripts and the standard library. No main() wrapper is required.',
    entries: [
      entry(
        'input() and print()',
        'input returns text. Convert that text when a number is required. print writes output.',
        'name = input("Name: ")\nyear = int(input("Year: "))\nprint("Welcome", name)',
      ),
      entry(
        'int(), float() and str()',
        'Convert values explicitly. Invalid numeric text raises ValueError.',
        'count = int("7")\nweight = float("2.5")\nlabel = str(count)',
      ),
      entry(
        'Variables and operators',
        'Assign with =. Use == for equality, // for floor division and % for remainder.',
        'name = "Mira"\nremainder = 17 % 5\nmatched = name == "Mira"',
      ),
      entry(
        'if, elif and else',
        'Indent the statements belonging to each branch.',
        'if level > 5:\n    print("High")\nelif level == 5:\n    print("Middle")\nelse:\n    print("Low")',
      ),
      entry(
        'for, range() and while',
        'range stops before its ending value. while repeats as long as its condition is true.',
        'for index in range(3):\n    print(index)\nwhile remaining > 0:\n    remaining -= 1',
      ),
      entry(
        'Functions and return',
        'Parameters receive arguments. return sends a value to the caller; print displays one.',
        'def label_for(name):\n    return "Member: " + name\n\nprint(label_for("Mira"))',
      ),
      entry(
        'Lists and dictionaries',
        'Lists keep ordered values. Dictionaries associate keys with values.',
        'colors = ["blue", "green"]\ncolors.append("gold")\nprofile = {"name": "Mira"}\nprint(colors[0], profile["name"])',
      ),
      entry(
        'Strings, f-strings and exceptions',
        'strip removes surrounding whitespace; split separates text. An f-string formats values. Catch specific errors.',
        'text = "  north south  ".strip()\nwords = text.split()\nprint(f"Items: {len(words)}")\ntry:\n    number = int(input())\nexcept ValueError:\n    print("Enter a whole number")',
      ),
    ],
  },
  php: {
    note: 'Console examples use PHP CLI. $_POST and PDO examples apply to PHP web projects. Begin PHP files with <?php.',
    entries: [
      entry(
        'Variables and echo',
        'Variables begin with $. Use . to concatenate text; statements usually end with a semicolon.',
        '<?php\n$name = "Mira";\necho "Hello " . $name . "\\n";',
      ),
      entry(
        'Console input',
        'Print a prompt, read one line from STDIN and trim its line ending.',
        '<?php\necho "City: ";\n$city = trim(fgets(STDIN));\necho $city;',
      ),
      entry(
        'Numbers and comparison',
        'Cast values to a numeric type when appropriate. === compares both value and type.',
        '<?php\n$count = (int) "7";\n$weight = (float) "2.5";\n$valid = $count === 7;',
      ),
      entry(
        'Branches and loops',
        'Braces group statements. foreach visits each array element.',
        '<?php\nif ($count > 0) { echo "Available"; }\nforeach (["red", "blue"] as $color) {\n    echo $color . "\\n";\n}',
      ),
      entry(
        'Functions and arrays',
        'return sends a result to the caller. Arrays can use numeric or named keys.',
        '<?php\nfunction label_for($name) { return "Member: " . $name; }\n$profile = ["name" => "Mira"];\necho label_for($profile["name"]);',
      ),
      entry(
        'POST data and validation',
        'Check input before using it. The null-coalescing operator supplies a fallback for missing fields.',
        '<?php\n$city = trim($_POST["city"] ?? "");\nif ($city === "") { echo "City is required"; }',
      ),
      entry(
        'Escaping HTML output',
        'Use htmlspecialchars when placing user text in HTML. Escaping output is different from validating input.',
        '<?php\necho htmlspecialchars($city, ENT_QUOTES, "UTF-8");',
      ),
      entry(
        'PDO and prepared statements',
        'The web workspace uses SQLite at the path below. Bind values with placeholders. The table must already exist.',
        '<?php\n$db = new PDO("sqlite:/tmp/data/database.sqlite");\n$stmt = $db->prepare("INSERT INTO notes(body) VALUES (?)");\n$stmt->execute([$body]);\n$rows = $db->query("SELECT body FROM notes")->fetchAll(PDO::FETCH_ASSOC);',
      ),
    ],
  },
  javascript: {
    note: 'Browser examples use document and DOM APIs. Console exercises run Node.js, where document and browser prompt() are unavailable.',
    entries: [
      entry(
        'let, const and equality',
        'Use const for bindings that will not be reassigned. Use let when reassignment is needed; === checks strict equality.',
        'const name = "Mira";\nlet attempts = 0;\nattempts += 1;\nconsole.log(name === "Mira");',
      ),
      entry(
        'Numbers and strings',
        'Number converts numeric text. Template literals interpolate expressions.',
        'const count = Number("7");\nconst name = "Mira";\nconsole.log(`Member: ${name}`);',
      ),
      entry(
        'Conditions and loops',
        'Use blocks for branches and for...of to visit array values.',
        'if (count > 0) { console.log("Available"); }\nfor (const color of ["red", "blue"]) {\n  console.log(color);\n}',
      ),
      entry(
        'Functions and return',
        'Declare a function or use an arrow function. return provides a value to its caller.',
        'function labelFor(name) {\n  return "Member: " + name;\n}\nconst double = value => value * 2;',
      ),
      entry(
        'Arrays and objects',
        'push appends to an array. map transforms values; filter selects values. Objects store named properties.',
        'const values = [1, 2, 3];\nconst larger = values.filter(value => value > 1);\nconst profile = { name: "Mira" };',
      ),
      entry(
        'Browser DOM and textContent',
        'Select elements in a web page. Set textContent for plain text rather than inserting untrusted HTML.',
        'const heading = document.querySelector("h1");\nheading.textContent = "Welcome";',
      ),
      entry(
        'Browser events and forms',
        'Listen for an event. preventDefault stops a form from navigating; it does not validate its data.',
        'document.querySelector("form").addEventListener("submit", event => {\n  event.preventDefault();\n  const value = document.querySelector("input").value.trim();\n});',
      ),
      entry(
        'Node.js terminal input',
        'readline can ask a question. End input sends EOF if the process keeps waiting on its input stream.',
        'const rl = require("node:readline").createInterface({ input: process.stdin, output: process.stdout });\nrl.question("City: ", city => {\n  console.log(city);\n  rl.close();\n});',
      ),
    ],
  },
  html: {
    note: 'HTML describes structure and meaning. These snippets are displayed as text; they do not run inside this guide.',
    entries: [
      entry(
        'Document structure',
        'Set the document language, character encoding and viewport. Place visible content in body.',
        '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Page</title></head>\n<body><main>Content</main></body>\n</html>',
      ),
      entry(
        'Headings and paragraphs',
        'Use headings to organize content, not merely to change text size.',
        '<h1>Page title</h1>\n<h2>Section title</h2>\n<p>A short paragraph.</p>',
      ),
      entry(
        'Links and images',
        'href sets a link destination. Give informative images meaningful alternative text.',
        '<a href="details.html">View details</a>\n<img src="building.png" alt="School entrance">',
      ),
      entry(
        'Lists',
        'Use ul for unordered items and ol when sequence matters.',
        '<ul><li>Blue</li><li>Green</li></ul>\n<ol><li>Prepare</li><li>Review</li></ol>',
      ),
      entry(
        'Forms, labels and inputs',
        'Match a label for value with the input id. The name identifies a field in submitted form data.',
        '<form method="post">\n  <label for="city">City</label>\n  <input id="city" name="city" required>\n  <button type="submit">Save</button>\n</form>',
      ),
      entry(
        'Button types and input types',
        'A button inside a form defaults to submit. Use type="button" for other actions. Choose input types for the requested value.',
        '<button type="button">Show details</button>\n<input type="email" name="email">\n<input type="number" name="count" min="1">',
      ),
      entry(
        'Tables and semantic sections',
        'Use table headers for column labels. main, nav, section and footer communicate page structure.',
        '<table>\n  <caption>Colors</caption>\n  <tr><th scope="col">Name</th></tr>\n  <tr><td>Blue</td></tr>\n</table>',
      ),
      entry(
        'Stylesheets and deferred scripts',
        'A stylesheet link loads CSS. A deferred external script runs after HTML parsing.',
        '<link rel="stylesheet" href="style.css">\n<script src="script.js" defer></script>',
      ),
    ],
  },
  css: {
    note: 'CSS selectors choose elements; declarations control presentation. Examples assume matching HTML elements exist.',
    entries: [
      entry(
        'Selectors and declarations',
        'A type selector matches a tag, a class selector uses a dot, and an ID selector uses #.',
        'p { color: navy; }\n.notice { padding: 1rem; }\n#banner { font-weight: bold; }',
      ),
      entry(
        'Box model',
        'Margin is outside the border; padding is inside it. border-box includes padding and borders in the declared width.',
        '* { box-sizing: border-box; }\n.panel { margin: 1rem; padding: 1rem; border: 1px solid #777; }',
      ),
      entry(
        'Flexbox',
        'Flexbox lays out items along a primary axis. gap creates space between them.',
        '.toolbar { display: flex; gap: 1rem; align-items: center; flex-wrap: wrap; }',
      ),
      entry(
        'Grid',
        'Grid lays out content in rows and columns. minmax allows a track to shrink while keeping equal fractions.',
        '.cards { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 1rem; }',
      ),
      entry(
        'Responsive sizes',
        'max-width limits growth. A fluid width and auto height keep images inside their container.',
        '.content { max-width: 60rem; margin-inline: auto; padding: 1rem; }\nimg { max-width: 100%; height: auto; }',
      ),
      entry(
        'Media queries',
        'Apply rules only when the viewport matches the condition.',
        '@media (max-width: 600px) {\n  .cards { grid-template-columns: 1fr; }\n}',
      ),
      entry(
        'Focus and hover',
        'Keep a visible keyboard focus indicator. Hover alone does not cover keyboard interaction.',
        'button:hover { background: #eee; }\nbutton:focus-visible { outline: 3px solid navy; outline-offset: 2px; }',
      ),
      entry(
        'Cascade and custom properties',
        'The cascade resolves competing declarations. Custom properties are read with var().',
        ':root { --accent: #146b56; }\n.notice { color: var(--accent); }',
      ),
    ],
  },
};
export function referenceGuides(ids: string[]): ReferenceGuide[] {
  return referenceTopics
    .filter((topic) => ids.includes(topic.id))
    .map((topic) => ({ ...topic, ...content[topic.id] }));
}
