// Faculty-only scaffolding and rubric. Never bundle or statically serve this file.
export function webTemplate(examId) {
  return {
    public: {
      schemaVersion: '1.0',
      examId,
      version: 1,
      title: 'PHP web application',
      subject: 'Plain PHP and SQLite',
      kind: 'activity',
      description: 'Build and preview a PHP application.',
      settings: { durationMinutes: 40, coreMaxPoints: 100, bonusMaxPoints: 0 },
      missions: [
        {
          id: 'web',
          title: 'PHP application',
          maxPoints: 100,
          activities: [
            {
              id: 'php-app',
              type: 'web_project',
              prompt: 'Build a PHP page that lists the tasks from SQLite. Complete the TODO in index.php.',
              maxPoints: 100,
              gradingRuleId: 'php-rubric',
              manualRationale: 'Faculty-authored PHP and database exercise.',
              publicConfig: {
                files: {
                  'index.php': `<?php\n$db = new PDO('sqlite:/tmp/data/database.sqlite');\n$db->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);\n$db->exec('PRAGMA foreign_keys=ON');\n?>\n<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><title>Tasks</title><link rel="stylesheet" href="style.css"></head>\n<body><h1>Tasks</h1>\n<?php // TODO: select tasks and render escaped titles. ?>\n</body></html>`,
                  'style.css': 'body { font-family: sans-serif; padding: 2rem; }',
                },
                seedSql:
                  "CREATE TABLE tasks(id INTEGER PRIMARY KEY, title TEXT NOT NULL); INSERT INTO tasks(title) VALUES('Prepare'),('Review');",
              },
            },
          ],
        },
      ],
    },
    private: {
      rules: {
        'php-rubric': {
          type: 'web_project',
          criteria: [
            {
              id: 'page',
              points: 30,
              answer: { kind: 'http', path: '/index.php', status: 200, contains: '<h1>Tasks</h1>' },
            },
            {
              id: 'records',
              points: 40,
              answer: { kind: 'http', path: '/index.php', status: 200, contains: 'Prepare' },
            },
            {
              id: 'quality',
              points: 30,
              answer: {
                kind: 'manual',
                description:
                  'Review SQL use, escaped output and readable presentation. Use Adjust score to record the final question total and reason.',
              },
            },
          ],
        },
      },
    },
  };
}
