import test from 'node:test';
import assert from 'node:assert/strict';
import { parseRoster, parseRosterHtml } from '../public/roster-import.js';

const source = `<div><table><tr><th>StudentName</th><th>Gender</th><th>YearLevel</th><th>ProgramShortName</th><th>SchoolID</th></tr>
<tr><td>ALVAREZ, ANA</td><td>F</td><td>3</td><td>BS Information Technology</td><td>2024-001</td></tr>
<tr><td>CRUZ, BEN &amp; JR.</td><td>M</td><td>3</td><td>BS Information Technology</td><td>2024-002</td></tr></table></div>`;

test('HTML-as-XLS roster uses school IDs and rejects missing or duplicate IDs', () => {
  const roster = parseRosterHtml(source, 'ITP25533Z-K32.xls');
  assert.deepEqual(roster.map(row => row.candidateId), ['2024-001', '2024-002']);
  assert.equal(roster[1].displayName, 'CRUZ, BEN & JR.');
  assert.equal(roster[0].section, 'K32');
  assert.equal(roster[0].gender, 'F');
  assert.equal(roster[0].yearLevel, '3');
  assert.equal(roster[0].programShortName, 'BS Information Technology');
  assert.equal('secret' in roster[0], false);
  assert.throws(() => parseRosterHtml(source, 'roster.xlsx'), /\.xls/);
  assert.throws(() => parseRosterHtml(source.replace('<th>SchoolID</th>', ''), 'ITP25533Z-K32.xls'), /Expected columns/);
  assert.throws(() => parseRosterHtml(source.replace('2024-002', '2024-001'), 'ITP25533Z-K32.xls'), /unique/);
  assert.equal(parseRosterHtml(source.replace('</table>', '<tr><td></td><td></td><td></td><td></td><td></td></tr></table>'), 'sheet001.htm', 'K32').length, 2);
  assert.throws(() => parseRosterHtml('<html><link href="roster_files/sheet001.htm"></html>', 'roster.xls'), /Select sheet001.htm/);
});

test('CSV upload accepts Excel UTF-8 export with quoted names and school IDs', () => {
  const csv = '\uFEFFStudentName,Gender,YearLevel,ProgramShortName,SchoolID\r\n' +
    '"ALVAREZ, ANA",F,3,BS Information Technology,2024-001\r\n' +
    '"CRUZ, BEN ""JR""",M,3,BS Information Technology,2024-002\r\n';
  const roster = parseRoster(csv, 'ITP25533Z-K32.csv');
  assert.deepEqual(roster.map(row => row.candidateId), ['2024-001', '2024-002']);
  assert.equal(roster[1].displayName, 'CRUZ, BEN "JR"');
  assert.equal(roster[0].section, 'K32');
  assert.equal(roster[1].programShortName, 'BS Information Technology');
  assert.throws(() => parseRoster(csv.replace('2024-002', '2024-001'), 'ITP25533Z-K32.csv'), /unique/);
  assert.throws(() => parseRoster(csv.replace(',SchoolID', ''), 'ITP25533Z-K32.csv'), /Expected columns/);
});
