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
assert.deepEqual(classifyLocalAP({ ...row, relativePath: 'AP Physics 1 2024/TB_InternationalExam2024MCQ.pdf', subject: 'ap_physics_1', documentRole: 'question_paper_or_booklet', firstTwoPagesText: 'AP Physics 1 Test Booklet International Exam 2024 MCQ' }, 2017, 2026), { course: 'physics-1', year: 2024, kind: 'qp', paper: 'MCQ', variant: 'standard' });
assert.deepEqual(classifyLocalAP({ ...row, relativePath: 'AP Physics 1 2024/SG_InternationalExam2024MCQ.pdf', subject: 'ap_physics_1', documentRole: 'mark_scheme_or_answer_key', firstTwoPagesText: 'AP Physics 1 Scoring Guide International Exam 2024 MCQ' }, 2017, 2026), { course: 'physics-1', year: 2024, kind: 'ms', paper: 'MCQ', variant: 'standard' });
assert.equal(classifyLocalAP({ ...row, relativePath: 'AP Physics 1 2012-2019/combined MCQ.pdf', subject: 'ap_physics_1', firstTwoPagesText: 'AP Physics 1 Multiple-Choice Questions 2019' }, 2017, 2026), null, 'multi-year bundles are not one paper');
const catalog = JSON.parse(fs.readFileSync(new URL('../server/catalogs/curriculum-papers.json', import.meta.url), 'utf8'));
assert.equal(new Set(catalog.papers.map(p => p.id)).size, catalog.papers.length);
assert.ok(catalog.papers.some(p => p.board === 'ap') && catalog.papers.some(p => p.board === 'ib'));
const mcq = catalog.papers.filter(p => p.board === 'ap' && p.paper === 'MCQ');
assert.ok(mcq.length >= 5, 'local AP Physics multiple-choice catalogue entries are present');
assert.ok(mcq.every(p => p.section === 'Multiple Choice' && p.practiceReady === false));
for (const paper of catalog.papers) {
  assert.equal(paper.practiceReady, false);
  assert.equal(paper.fullExam, false);
  assert.ok(paper.year >= catalog.sourceWindows[paper.board][0] && paper.year <= catalog.sourceWindows[paper.board][1]);
  if (paper.board === 'ap') assert.ok(['FRQ', 'Multiple Choice'].includes(paper.section));
  for (const file of [paper.questionPaper, paper.markScheme].filter(Boolean)) {
    assert.equal(file.rightsStatus, 'unverified');
    assert.match(file.relativePath, /^[a-f0-9]{64}\.pdf$/);
    if (file.sourceUrl) assert.equal(new URL(file.sourceUrl).hostname, 'apcentral.collegeboard.org');
  }
}
assert.doesNotMatch(JSON.stringify(catalog), /D:[\\/]|firstTwoPagesText|tdfile-prod|authorization|api[_-]?key/i);
console.log(`PASS curriculum builder headings, metadata provenance and ${catalog.papers.length} isolated paper identities`);
