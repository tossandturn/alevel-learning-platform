import assert from 'node:assert/strict';
import fs from 'node:fs';
import { classifyLocalAP } from './build-curriculum-paper-catalog.mjs';
const row = { extension: '.pdf', pdfStatus: 'ok', needsVisualReview: false, year: 2024, subject: 'ap_physics_c_electricity_magnetism', firstTwoPagesText: 'AP® Physics C: Mechanics Scoring Guidelines Set 1 2024 © 2024 College Board' };
assert.deepEqual(classifyLocalAP(row, 2017, 2026), { course: 'physics-c-mechanics', year: 2024, kind: 'ms', variant: 'set-1' });
for (const text of ['Chief Reader Report on Student Responses: 2024 AP Physics C: Mechanics Free-Response Questions', '2024 AP Physics 1 Sample Student Responses and Scoring Commentary', 'AP Physics C: Mechanics Practice Exam From the 2024 Administration', '2024 AP Physics 1 Scoring Statistics Free-Response Questions']) {
  assert.equal(classifyLocalAP({ ...row, firstTwoPagesText: text }, 2017, 2026), null);
}
assert.equal(classifyLocalAP({ ...row, needsVisualReview: true }, 2017, 2026), null);
assert.equal(classifyLocalAP({ ...row, year: 2016 }, 2017, 2026), null);
assert.deepEqual(classifyLocalAP({ ...row, firstTwoPagesText: '2024 AP Physics 1: Algebra-Based Free-Response Questions © 2024 College Board' }, 2017, 2026), { course: 'physics-1', year: 2024, kind: 'qp', variant: 'standard' });
const catalog = JSON.parse(fs.readFileSync(new URL('../server/catalogs/curriculum-papers.json', import.meta.url), 'utf8'));
assert.equal(new Set(catalog.papers.map(p => p.id)).size, catalog.papers.length);
assert.ok(catalog.papers.some(p => p.board === 'ap') && catalog.papers.some(p => p.board === 'ib'));
for (const paper of catalog.papers) {
  assert.equal(paper.practiceReady, false);
  assert.equal(paper.fullExam, false);
  assert.ok(paper.year >= catalog.sourceWindows[paper.board][0] && paper.year <= catalog.sourceWindows[paper.board][1]);
  if (paper.board === 'ap') assert.equal(paper.section, 'FRQ');
  for (const file of [paper.questionPaper, paper.markScheme].filter(Boolean)) {
    assert.equal(file.rightsStatus, 'unverified');
    assert.match(file.relativePath, /^[a-f0-9]{64}\.pdf$/);
    if (file.sourceUrl) assert.equal(new URL(file.sourceUrl).hostname, 'apcentral.collegeboard.org');
  }
}
assert.doesNotMatch(JSON.stringify(catalog), /D:[\\/]|firstTwoPagesText|tdfile-prod|authorization|api[_-]?key/i);
console.log(`PASS curriculum builder headings, metadata provenance and ${catalog.papers.length} isolated paper identities`);
