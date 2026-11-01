import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectRows, validatePackage } from '../src/engine.mjs';

const folder = join(dirname(dirname(fileURLToPath(import.meta.url))), 'exam-packages', 'itp255-week13-draft');
const columns = [
  { id: 'id', label: 'Ticket' }, { id: 'name', label: 'Student' },
  { id: 'course', label: 'Course' }, { id: 'year', label: 'Year' },
  { id: 'campus', label: 'Campus' }, { id: 'status', label: 'Status' }
];
const names = [
  'Aira Cruz','Ben Ramos','Cleo Dizon','Dane Uy','Eli Santos','Faye Lim','Gio Tan','Hana Reyes',
  'Ivo Garcia','Jade Ong','Kai Flores','Lara Chan','Mara Valdez','Noel Sy','Olive Perez','Pia Yu',
  'Quin Bautista','Rae Mendoza','Seth Navarro','Tala Co','Uma Rivas','Vera Chua','Wes Aquino','Xena Abad',
  'Yana Robles','Zed Castillo','Ami Go','Bryn Lopez','Cian Torres','Drew Lee','Enzo Rivera','Fran Yao',
  'Gail Salazar','Hugo Villanueva','Ina Dominguez','Jiro Pineda','Kara Roxas','Liam Marquez','Mina Alonzo','Nico Velasco',
  'Orla Bautista','Pao Padilla','Rina Yap','Sami Manalo','Tino Diaz','Vale Medina','Wynn Soriano','Zia Tan'
];
const courses = ['BSIT', 'BSCS', 'BSBA'];
const statuses = ['Queued', 'Ready', 'Hold'];
const rows = names.map((name, index) => ({
  id: `Q${String(index + 1).padStart(2, '0')}`,
  name,
  course: courses[index % 3],
  year: String(((index * 3 + Math.floor(index / 3)) % 4) + 1),
  campus: Math.floor(index / 3) % 2 ? 'South' : 'North',
  status: statuses[(index + Math.floor(index / 6)) % 3]
}));
const apiReference = [
  { api: "new DataTable('#studentTable', options)", use: 'Create the table' },
  { api: 'paging, searching, ordering', use: 'Boolean options' },
  { api: 'pageLength, lengthMenu', use: 'Page size and available sizes' },
  { api: "order: [[index, 'asc'|'desc'], …]", use: 'Sort priority, left to right' },
  { api: "table.search('text').draw()", use: 'Search all columns' },
  { api: "table.column(index).search('text').draw()", use: 'Search one column' },
  { api: "table.order([[index, 'asc'|'desc'], …]).draw()", use: 'Change sort after creation' }
];
const config = { selector: '#studentTable', columns, pageLengths: [5, 7, 10, 14, 28], rows, apiReference };

const scaffoldCode =
  "// === CTF QUEUE RESTORATION SCRIPT ===\n" +
  "// Complete the implementation below from this scaffold.\n\n" +
  "const table = new DataTable('#studentTable', {\n" +
  "  // 1. Enable boolean flags: paging, searching, ordering\n" +
  "  paging: true,\n" +
  "  searching: true,\n" +
  "  ordering: true,\n\n" +
  "  // 2. Configure pageLength (7) and lengthMenu ([7, 14, 28])\n\n\n" +
  "  // 3. Set multi-column order (Year desc, Student asc) using zero-based column indexes\n\n" +
  "});\n\n" +
  "// 4. Global search for 'BSIT' and draw\n\n\n" +
  "// 5. Column-specific search targeting Campus (index 4) for 'South' and draw\n";

const codeConfig = { ...config, scaffold: scaffoldCode };

const inspection = {
  pageLength: 5,
  globalSearch: 'BSCS',
  columnSearch: { campus: 'North' },
  order: [{ column: 'year', direction: 'asc' }, { column: 'name', direction: 'desc' }],
  pageIndex: 0
};
const coded = {
  pageLength: 7,
  globalSearch: 'BSIT',
  columnSearch: { campus: 'South' },
  order: [{ column: 'year', direction: 'desc' }, { column: 'name', direction: 'asc' }],
  pageIndex: 0
};

const visible = state => inspectRows(config, state).visible.map(row => row.id);

const pub = {
  schemaVersion: '1.0',
  examId: 'itp255-week13-table-rescue',
  version: 1,
  title: 'Campus Queue CTF: Triage & Breach Recovery',
  subject: 'ITP255 · DataTables Security & Operations',
  description: 'Investigate queue anomalies, map column vectors, intercept compromised records, and author restoration code.',
  settings: {
    durationMinutes: 60,
    coreMaxPoints: 100,
    bonusMaxPoints: 0,
    shuffleOrderOnly: false
  },
  missions: [
    {
      id: 'm1-recon',
      title: 'Phase 1: Memory & Pagination Recon',
      story: 'Reconnaissance: An intruder tampered with table parameters. Deduce browser memory footprint and boundary page metrics before mounting a defense.',
      dependsOn: [],
      maxPoints: 15,
      activities: [
        {
          id: 'recon-client-mode',
          type: 'single_choice',
          prompt: 'Recon Briefing: The Campus Queue runs in DataTables client-side mode with all 48 records pre-loaded (Slide 6). What is the primary operational characteristic of this mode?',
          maxPoints: 5,
          gradingRuleId: 'rule-recon-client-mode',
          publicConfig: {
            options: [
              { id: 'client_mem', label: 'All records reside in browser memory; the browser computes page slices and search matches locally without querying PHP/SQL on each click.' },
              { id: 'server_fetch', label: 'The browser queries the database on every pagination click to retrieve only 5 rows across the network.' },
              { id: 'dom_strip', label: 'The browser permanently purges non-visible records from RAM upon first render.' }
            ]
          },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slide 6' }]
        },
        {
          id: 'recon-page-equation',
          type: 'numeric_entry',
          prompt: 'Viewport Boundary: The monitoring console restricts visible output to pageLength: 5. For the 48-ticket dataset, calculate the total page count (info.pages) reported by page.info() (Slides 5, 9).',
          maxPoints: 5,
          gradingRuleId: 'rule-recon-page-equation',
          publicConfig: { unitLabel: 'pages' },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slides 5, 9' }]
        },
        {
          id: 'recon-flag-zero-index',
          type: 'text_entry',
          prompt: 'Zero-Based Index Flag: In DataTables, info.page starts counting at index 0 (page 1 is index 0). What zero-based index number represents the final 10th page? Submit the index or flag (e.g. 9 or FLAG{9}).',
          maxPoints: 5,
          gradingRuleId: 'rule-recon-flag-zero-index',
          publicConfig: { placeholder: 'e.g. 9 or FLAG{9}' },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slide 9' }]
        }
      ]
    },
    {
      id: 'm2-vectors',
      title: 'Phase 2: Target Vectors & Column Offsets',
      story: 'Vector Analysis: Audit logs show the attacker injected API calls targeting columns by numeric zero-based offsets. Identify the targeted schema vectors.',
      dependsOn: ['m1-recon'],
      maxPoints: 15,
      activities: [
        {
          id: 'vector-column-match',
          type: 'matching',
          prompt: 'Match each zero-based column offset index to the exact field it targets in the Campus Queue reference table (Slide 14).',
          maxPoints: 6,
          gradingRuleId: 'rule-vector-column-match',
          publicConfig: {
            left: [
              { id: 'c0', label: 'Column Index 0' },
              { id: 'c2', label: 'Column Index 2' },
              { id: 'c4', label: 'Column Index 4' }
            ],
            right: [
              { id: 'ticket', label: 'Ticket ID' },
              { id: 'course', label: 'Course' },
              { id: 'campus', label: 'Campus' }
            ]
          },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slide 14' }]
        },
        {
          id: 'vector-pinpoint-campus',
          type: 'text_entry',
          prompt: 'Vector Pinpoint: The audit log records table.column(X).search("South").draw(). Which exact integer value of X isolates the Campus column?',
          maxPoints: 5,
          gradingRuleId: 'rule-vector-pinpoint-campus',
          publicConfig: { placeholder: 'Column index integer' },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slide 14' }]
        },
        {
          id: 'vector-draw-drawback',
          type: 'single_choice',
          prompt: 'API Pitfall: The attacker executed table.search("BSIT") but failed to chain .draw() (Slide 11). What was the visual effect on the client interface?',
          maxPoints: 4,
          gradingRuleId: 'rule-vector-draw-drawback',
          publicConfig: {
            options: [
              { id: 'no_redraw', label: 'The search filter was registered in memory, but visible rows on screen were not redrawn.' },
              { id: 'runtime_error', label: 'The browser threw an unhandled exception and crashed the table DOM.' },
              { id: 'auto_paint', label: 'DataTables automatically redrew the screen regardless of the missing call.' }
            ]
          },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slides 11, 13' }]
        }
      ]
    },
    {
      id: 'm3-pipeline',
      title: 'Phase 3: Execution Pipeline & Sort Priorities',
      story: 'Pipeline Forensics: Deconstruct the internal execution sequence and multi-key ordering rules used to scramble the queue display.',
      dependsOn: ['m2-vectors'],
      maxPoints: 10,
      activities: [
        {
          id: 'pipe-priority-tie',
          type: 'single_choice',
          prompt: 'Sort Tie-Breaker: When DataTables evaluates order: [[2, "asc"], [1, "desc"]], how does the sorting engine handle records that share the exact same Course (Index 2) (Slides 16, 17)?',
          maxPoints: 5,
          gradingRuleId: 'rule-pipe-priority-tie',
          publicConfig: {
            options: [
              { id: 'tie_student_desc', label: 'Course ties are resolved by sorting Student Name (Index 1) in descending alphabetical order.' },
              { id: 'tie_ticket_asc', label: 'Course ties ignore the second rule and immediately default to Ticket ID ascending.' },
              { id: 'tie_random', label: 'Course ties maintain indeterminate random positions.' }
            ]
          },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slides 16, 17' }]
        },
        {
          id: 'pipe-sequence-flow',
          type: 'sequencing',
          prompt: 'Pipeline Sequence: Put the 4 stages of the DataTables rendering engine in the correct order of execution from first to last (Slide 18).',
          maxPoints: 5,
          gradingRuleId: 'rule-pipe-sequence-flow',
          publicConfig: {
            items: [
              { id: 'load', label: '1. Complete dataset loaded in memory' },
              { id: 'filter', label: '2. Search criteria filters matching rows' },
              { id: 'sort', label: '3. Multi-column ordering sorts the matches' },
              { id: 'paginate', label: '4. Pagination slices visible page window' }
            ]
          },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slide 18' }]
        }
      ]
    },
    {
      id: 'm4-anomaly',
      title: 'Phase 4: Threat Hunting & Anomaly Triage',
      story: 'Active Triage: Use analytical cross-referencing on the 48-ticket dataset to locate suspect entries and determine the total scope of compromised tickets.',
      dependsOn: ['m3-pipeline'],
      maxPoints: 10,
      activities: [
        {
          id: 'anomaly-suspect-flag',
          type: 'text_entry',
          prompt: 'Suspect Flag Capture: Security flagged suspicious "Hold" entries for 2nd-year Computer Science (BSCS) students at South Campus. Inspecting the reference queue reveals exactly three matching students. If sorted alphabetically by student name, what is the Ticket ID of the FIRST suspect? (Submit ticket ID or flag, e.g. Q29 or FLAG{Q29}).',
          maxPoints: 5,
          gradingRuleId: 'rule-anomaly-suspect-flag',
          publicConfig: { placeholder: 'e.g. Q29 or FLAG{Q29}' },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slides 10, 14, 18' }]
        },
        {
          id: 'anomaly-hold-census',
          type: 'numeric_entry',
          prompt: 'Total Compromise Scope: Across the entire 48-ticket dataset in the reference table, how many total records are currently flagged with "Hold" status?',
          maxPoints: 5,
          gradingRuleId: 'rule-anomaly-hold-census',
          publicConfig: { unitLabel: 'tickets' },
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slide 5' }]
        }
      ]
    },
    {
      id: 'inspect',
      title: 'Phase 5: Queue Interception Console',
      story: 'Live Console Extraction: Intercept the critical senior computer science priority batch on North Campus. Configure the interactive console parameters to isolate and submit the exact 5-ticket dispatch slice.',
      dependsOn: ['m4-anomaly'],
      maxPoints: 20,
      activities: [
        {
          id: 'queue-inspection',
          type: 'data_inspection',
          prompt: 'Interception Challenge: An urgent graduation audit requires isolating North campus BSCS tickets. Configure the console: Display 5 rows per page. Search all columns for BSCS. Set the column filter on Campus to North. Apply a multi-key sort: Year ascending, then Student descending. Navigate to Page 1 and submit the intercepted batch.',
          publicConfig: config,
          maxPoints: 20,
          gradingRuleId: 'rule-inspection',
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slides 5, 9, 11, 13, 14, 17, 18, 23' }]
        }
      ]
    },
    {
      id: 'code',
      title: 'Phase 6: System Recovery Script (Scaffolded)',
      story: 'Final Exploit & Restoration: The queue UI crashed. Using the provided scaffold in the code editor, author the production DataTables JavaScript script to restore the South campus IT service queue.',
      dependsOn: ['inspect'],
      fixedLast: true,
      maxPoints: 30,
      activities: [
        {
          id: 'queue-code',
          type: 'datatable_code',
          prompt: 'Code Recovery Challenge: From the provided scaffold in the editor, write the complete JavaScript script for #studentTable. (1) Enable paging, searching, ordering. (2) Set pageLength to 7 and lengthMenu to [7, 14, 28]. (3) Configure initial multi-column sort: Year descending, then Student ascending. (4) Apply global search for BSIT and redraw. (5) Apply column search for Campus South using its zero-based index and redraw. Test in preview, then submit the code that produces the Page 1 recovery state.',
          publicConfig: codeConfig,
          maxPoints: 30,
          gradingRuleId: 'rule-code',
          sourceRefs: [{ file: 'Week_13-2_extracted.md', pageOrSlide: 'Slides 5, 7, 11, 13, 14, 17, 18, 23' }]
        }
      ]
    }
  ]
};

const criterion = (id, points, kind, value) => ({ id, points, answer: { kind, value } });
const priv = {
  rules: {
    'rule-recon-client-mode': {
      type: 'single_choice',
      criteria: [{ id: 'c-client-mode', points: 5, answer: 'client_mem' }]
    },
    'rule-recon-page-equation': {
      type: 'numeric_entry',
      criteria: [{ id: 'c-page-equation', points: 5, answer: { value: 10, tolerance: 0, unit: 'pages' } }]
    },
    'rule-recon-flag-zero-index': {
      type: 'text_entry',
      criteria: [{ id: 'c-zero-flag', points: 5, answer: ['9', 'index 9', 'flag{9}', 'flag{index_9}'] }]
    },
    'rule-vector-column-match': {
      type: 'matching',
      criteria: [
        { id: 'c-col-c0', points: 2, answer: { left: 'c0', right: 'ticket' } },
        { id: 'c-col-c2', points: 2, answer: { left: 'c2', right: 'course' } },
        { id: 'c-col-c4', points: 2, answer: { left: 'c4', right: 'campus' } }
      ]
    },
    'rule-vector-pinpoint-campus': {
      type: 'text_entry',
      criteria: [{ id: 'c-campus-index', points: 5, answer: ['4', 'index 4', 'flag{4}'] }]
    },
    'rule-vector-draw-drawback': {
      type: 'single_choice',
      criteria: [{ id: 'c-draw-drawback', points: 4, answer: 'no_redraw' }]
    },
    'rule-pipe-priority-tie': {
      type: 'single_choice',
      criteria: [{ id: 'c-priority-tie', points: 5, answer: 'tie_student_desc' }]
    },
    'rule-pipe-sequence-flow': {
      type: 'sequencing',
      criteria: [{ id: 'c-pipe-flow', points: 5, answer: ['load', 'filter', 'sort', 'paginate'] }]
    },
    'rule-anomaly-suspect-flag': {
      type: 'text_entry',
      criteria: [{ id: 'c-suspect-flag', points: 5, answer: ['q29', 'flag{q29}'] }]
    },
    'rule-anomaly-hold-census': {
      type: 'numeric_entry',
      criteria: [{ id: 'c-hold-census', points: 5, answer: { value: 16, tolerance: 0, unit: 'tickets' } }]
    },
    'rule-inspection': {
      type: 'data_inspection',
      criteria: [
        criterion('inspect-length', 3, 'page_length', 5),
        criterion('inspect-global', 3, 'global_search', 'BSCS'),
        criterion('inspect-column', 4, 'column_search', { column: 'campus', term: 'North' }),
        criterion('inspect-order', 4, 'order', inspection.order),
        criterion('inspect-rows', 6, 'visible_ids', visible(inspection))
      ]
    },
    'rule-code': {
      type: 'datatable_code',
      criteria: [
        criterion('code-flags', 4, 'flags', { paging: true, searching: true, ordering: true }),
        criterion('code-length', 4, 'page_length', 7),
        criterion('code-menu', 4, 'length_menu', [7, 14, 28]),
        criterion('code-global', 4, 'global_search', 'BSIT'),
        criterion('code-column', 5, 'column_search', { column: 'campus', term: 'South' }),
        criterion('code-order', 4, 'order', coded.order),
        criterion('code-rows', 5, 'visible_ids', visible(coded))
      ]
    }
  }
};

const errors = validatePackage(pub, priv);
if (errors.length) throw new Error(errors.join('\n'));

writeFileSync(join(folder, 'public-exam.json'), JSON.stringify(pub, null, 2) + '\n');
writeFileSync(join(folder, 'private-grading.json'), JSON.stringify(priv, null, 2) + '\n');
console.log('Successfully built Week 13 CTF exam with 6 missions and 100 points.');
