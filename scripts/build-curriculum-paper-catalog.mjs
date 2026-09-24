import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const AP_COURSES = [
  ['calculus-ab', 'AP Calculus AB', 'mathematics'],
  ['calculus-bc', 'AP Calculus BC', 'mathematics'],
  ['precalculus', 'AP Precalculus', 'mathematics'],
  ['statistics', 'AP Statistics', 'mathematics'],
  ['physics-1', 'AP Physics 1', 'physics'],
  ['physics-2', 'AP Physics 2', 'physics'],
  ['physics-c-em', 'AP Physics C: Electricity and Magnetism', 'physics'],
  ['physics-c-mechanics', 'AP Physics C: Mechanics', 'physics'],
].map(([id, label, subject]) => ({ id, label, subject, board: 'ap' }));
export const IB_COURSES = [
  { id: 'math-aa', label: 'IB Mathematics: Analysis and Approaches', subject: 'mathematics', board: 'ib' },
  { id: 'math-ai', label: 'IB Mathematics: Applications and Interpretation', subject: 'mathematics', board: 'ib' },
  { id: 'physics', label: 'IB Physics', subject: 'physics', board: 'ib' },
];

// Inspect the document heading, not its containing directory or the inventory's
// preliminary classification. Some Mechanics PDFs are stored in an E&M folder.
export function classifyLocalAP(row, yearStart, yearEnd) {
  if (row.extension !== '.pdf' || !String(row.pdfStatus).startsWith('ok') || row.needsVisualReview) return null;
  const text = String(row.firstTwoPagesText || '').replace(/[®™]/g, '').replace(/\s+/g, ' ').trim();
  const heading = text.slice(0, 800);
  if (/chief reader|scoring statistics|score distributions|sample student|scoring commentary|course (?:and exam description|overview)|practice\s*exam|progress check|question bank|topic questions|specimen/i.test(heading)) return null;
  const cover = heading.split(/©|copyright|college board/i)[0];
  const kind = /scoring guidelines/i.test(cover) ? 'ms' : /free[- ]response questions/i.test(cover) ? 'qp' : null;
  if (!kind) return null;
  const year = Number(row.year);
  if (!Number.isInteger(year) || year < yearStart || year > yearEnd || !new RegExp(`\\b${year}\\b`).test(heading)) return null;
  let course = null;
  if (/physics c\s*:\s*mechanics/i.test(cover)) course = 'physics-c-mechanics';
  else if (/physics c\s*:\s*electricity (?:and )?magnetism/i.test(cover)) course = 'physics-c-em';
  else if (/physics\s*1\b/i.test(cover)) course = 'physics-1';
  else if (/physics\s*2\b/i.test(cover)) course = 'physics-2';
  if (!course) return null;
  const set = cover.match(/\bset\s*([12])\b/i);
  return { course, year, kind, variant: set ? `set-${set[1]}` : 'standard' };
}

function fileMetadata(row, name, sourceUrl = null) {
  if (!/^[a-f0-9]{64}$/.test(row.sha256) || !(row.bytes > 0) || !(row.pages > 0)) throw new Error('Invalid source file evidence');
  return {
    id: `file-${row.sha256.slice(0, 32)}`, name, bytes: row.bytes, pages: row.pages,
    sha256: row.sha256, relativePath: `${row.sha256}.pdf`, sourceUrl,
    rightsStatus: 'unverified', integrityStatus: 'verified',
  };
}

export function buildCatalog({ ap, apLocal, ib, generatedAt, currentYear }) {
  if (!Number.isInteger(currentYear) || !generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error('Explicit live date required');
  const latestAp = Math.min(currentYear, Math.max(...ap.records.map(r => Number(r.year))));
  const latestIb = Math.min(currentYear, Math.max(...ib.records.map(r => Number(r.year))));
  const audit = { excluded: [], conflicts: [], duplicateFiles: 0, sourceWindows: { ap: [latestAp - 9, latestAp], ib: [latestIb - 9, latestIb] } };
  const apGroups = new Map();
  const usedHash = new Set();
  function addAp(row, meta, origin, sourceUrl) {
    const courseInfo = AP_COURSES.find(c => c.id === meta.course);
    if (!courseInfo) throw new Error('Unknown AP course');
    const key = `ap-${meta.course}-${meta.year}-frq-${meta.variant}`;
    const group = apGroups.get(key) || {
      id: key, board: 'ap', course: meta.course, courseLabel: courseInfo.label,
      subject: courseInfo.subject, level: '', year: meta.year, session: 'Annual',
      paper: 'FRQ', variant: meta.variant, title: `${courseInfo.label} ${meta.year} FRQ${meta.variant === 'standard' ? '' : ` ${meta.variant}`}`,
      section: 'FRQ', fullExam: false, practiceReady: false, pairStatus: 'missing',
      questionPaper: null, markScheme: null,
    };
    const slot = meta.kind === 'qp' ? 'questionPaper' : 'markScheme';
    if (group[slot]) {
      if (group[slot].sha256 === row.sha256) audit.duplicateFiles++;
      else audit.conflicts.push({ key, kind: meta.kind, kept: group[slot].sha256, excluded: row.sha256, origin });
      return;
    }
    if (usedHash.has(row.sha256)) { audit.duplicateFiles++; return; }
    group[slot] = fileMetadata(row, `${key}-${meta.kind}.pdf`, sourceUrl);
    usedHash.add(row.sha256);
    apGroups.set(key, group);
  }
  // Primary-source, cover-verified AP downloads take priority over duplicates.
  for (const row of ap.records) {
    if (row.status !== 'verified' || !['year', 'course', 'kind'].every(key => row.coverChecks?.[key] === true) || !['qp', 'ms'].includes(row.kind) || !['standard', 'set-1', 'set-2'].includes(row.variant) || row.section !== 'FRQ' || row.fullExam !== false || row.year < latestAp - 9 || row.year > latestAp) continue;
    addAp(row, row, 'official-public', row.sourceUrl);
  }
  for (const row of apLocal.files) {
    const meta = classifyLocalAP(row, latestAp - 9, latestAp);
    if (!meta) { audit.excluded.push({ sha256: row.sha256, reason: 'Not a cover-verified recent FRQ or scoring guideline' }); continue; }
    addAp({ ...row, pages: row.pageCount }, meta, 'user-local', null);
  }
  const papers = [];
  for (const group of apGroups.values()) {
    if (!group.questionPaper) { audit.excluded.push({ id: group.id, reason: 'Mark scheme without question paper' }); continue; }
    group.pairStatus = group.markScheme ? (audit.conflicts.some(c => c.key === group.id) ? 'candidate' : 'verified') : 'missing';
    papers.push(group);
  }
  const ibGroups = new Map();
  for (const row of ib.records) {
    if (row.status !== 'downloaded' || row.year < latestIb - 9 || row.year > latestIb) continue;
    if (!IB_COURSES.some(c => c.id === row.courseBucket) || !['HL', 'SL'].includes(row.level) || !['qp', 'ms'].includes(row.kind) || !row.filenamePaperCode) throw new Error('Invalid IB source scope');
    const key = row.pairCandidateKey;
    const group = ibGroups.get(key) || {};
    if (group[row.kind]) throw new Error(`Ambiguous IB candidate group ${key}`);
    group[row.kind] = row;
    ibGroups.set(key, group);
  }
  for (const [key, { qp, ms }] of ibGroups) {
    if (!qp) { audit.excluded.push({ key, reason: 'IB mark scheme without QP' }); continue; }
    const courseInfo = IB_COURSES.find(c => c.id === qp.courseBucket);
    const paper = `P${qp.filenamePaperCode.toUpperCase()}`;
    const variant = qp.filenameVariant || 'unspecified';
    const id = `ib-${qp.courseBucket}-${qp.level.toLowerCase()}-${qp.year}-${qp.session.toLowerCase()}-${paper.toLowerCase()}-${variant.toLowerCase()}-${qp.id}`;
    const safeName = `IB_${qp.courseBucket}_${qp.level}_${qp.year}_${qp.session}_${paper}_${variant}`;
    if (ms && ['courseBucket', 'level', 'year', 'session', 'filenamePaperCode', 'filenameVariant'].some(field => qp[field] !== ms[field])) throw new Error(`IB pair scope mismatch: ${key}`);
    const verified = ms && qp.coverDocumentCode && qp.coverDocumentCode.replace(/M$/, '') === String(ms.coverDocumentCode).replace(/M$/, '') && ['year', 'subject', 'level', 'kind'].every(field => qp.coverChecks?.[field] === true && ms.coverChecks?.[field] === true);
    papers.push({
      id, board: 'ib', course: qp.courseBucket, courseLabel: courseInfo.label, subject: courseInfo.subject,
      level: qp.level, year: qp.year, session: qp.session, paper, variant,
      title: `${courseInfo.label} ${qp.level} ${qp.year} ${qp.session} ${paper} ${variant}`,
      section: paper, fullExam: false, practiceReady: false,
      pairStatus: ms ? (verified ? 'verified' : 'candidate') : 'missing',
      questionPaper: fileMetadata(qp, `${safeName}_QP.pdf`),
      markScheme: ms ? fileMetadata(ms, `${safeName}_MS.pdf`) : null,
      syllabusVersion: qp.courseBucket === 'physics' ? (qp.year >= 2025 ? 'first-assessment-2025' : 'legacy-through-2024') : 'first-assessment-2021',
      provenance: { sourceSite: qp.sourceSite, sourceId: qp.id, sourceName: qp.sourceName, variantAuthority: 'source-filename-not-canonical-zone', coverDocumentCode: qp.coverDocumentCode || null },
    });
  }
  papers.sort((a, b) => a.board.localeCompare(b.board) || a.course.localeCompare(b.course) || b.year - a.year || a.id.localeCompare(b.id));
  if (new Set(papers.map(p => p.id)).size !== papers.length) throw new Error('Duplicate paper identities');
  const catalog = { schemaVersion: 'curriculum-paper-source-v1', generatedAt, sourceWindows: audit.sourceWindows, courses: [...AP_COURSES, ...IB_COURSES], papers };
  return { catalog, audit };
}

// No paper text, user folder path, credentials or third-party PDF URL is copied
// into the public metadata artifact. Original assets remain read-only.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [sourceRoot, outputPath, generatedAt, currentYear] = process.argv.slice(2);
  if (!sourceRoot || !outputPath) throw new Error('Usage: node script SOURCE_ROOT OUTPUT LIVE_ISO_DATE LIVE_YEAR');
  const read = relative => JSON.parse(fs.readFileSync(path.join(sourceRoot, relative), 'utf8'));
  const result = buildCatalog({ ap: read('ap-sources.json'), apLocal: read('ap-local/inventory.json'), ib: read('ibmaster/inventory.json'), generatedAt, currentYear: Number(currentYear) });
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(result.catalog, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(sourceRoot, 'curriculum-catalog-audit.json'), `${JSON.stringify(result.audit, null, 2)}\n`, 'utf8');
  console.log(JSON.stringify({ papers: result.catalog.papers.length, ap: result.catalog.papers.filter(p => p.board === 'ap').length, ib: result.catalog.papers.filter(p => p.board === 'ib').length, pairsVerified: result.catalog.papers.filter(p => p.pairStatus === 'verified').length, conflicts: result.audit.conflicts.length, duplicates: result.audit.duplicateFiles, sourceWindows: result.audit.sourceWindows, sha256: crypto.createHash('sha256').update(fs.readFileSync(outputPath)).digest('hex') }));
}
