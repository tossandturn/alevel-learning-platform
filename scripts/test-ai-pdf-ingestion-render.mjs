import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import {
  buildCropCommand,
  buildCropManifest,
  buildRenderArgs,
  imageSha256,
  resolvePopplerExecutable,
} from './ai-pdf-ingestion/render.mjs'

const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'ai-pdf-render-'))

try {
  assert.equal(
    resolvePopplerExecutable('pdftoppm', {
      env: { PDFTOPPM_BIN: 'D:\\tools\\pdftoppm.exe' },
      existsSync: () => false,
    }),
    'D:\\tools\\pdftoppm.exe',
  )
  assert.equal(
    resolvePopplerExecutable('pdftocairo', {
      env: { PDFTOCAIRO_BIN: 'D:\\tools\\pdftocairo.exe' },
      existsSync: () => false,
    }),
    'D:\\tools\\pdftocairo.exe',
  )
  assert.match(
    resolvePopplerExecutable('pdftoppm', { env: {}, existsSync: candidate => candidate.endsWith('pdftoppm.exe') }),
    process.platform === 'win32' ? /pdftoppm\.exe$/ : /^pdftoppm$/,
  )
  assert.equal(
    resolvePopplerExecutable('pdftocairo', { env: {}, existsSync: () => false }),
    process.platform === 'win32' ? 'pdftocairo.exe' : 'pdftocairo',
  )

  const fixturePdfPath = process.platform === 'win32'
    ? 'D:\\papers\\9702_s25_qp_13.pdf'
    : '/papers/9702_s25_qp_13.pdf'
  const fixtureOutputPrefix = process.platform === 'win32'
    ? 'D:\\renders\\qp'
    : '/renders/qp'
  assert.deepEqual(
    buildRenderArgs({
      pdfPath: fixturePdfPath,
      outputPrefix: fixtureOutputPrefix,
      dpi: 180,
    }),
    ['-jpeg', '-jpegopt', 'quality=82', '-r', '180', '--', fixturePdfPath, fixtureOutputPrefix],
  )
  assert.throws(() => buildRenderArgs({
    pdfPath: 'relative.pdf',
    outputPrefix: fixtureOutputPrefix,
    dpi: 180,
  }), RangeError)
  assert.throws(() => buildRenderArgs({
    pdfPath: fixturePdfPath,
    outputPrefix: fixtureOutputPrefix,
    dpi: 301,
  }), RangeError)

  const imagePath = path.join(temporaryRoot, 'fixture.jpg')
  const imageBytes = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01, 0x02])
  writeFileSync(imagePath, imageBytes)
  assert.equal(
    imageSha256(imagePath),
    createHash('sha256').update(imageBytes).digest('hex'),
  )

  const manifest = buildCropManifest({
    paperId: 'cie-9702-9702_s25_qp_13',
    questionId: 'cie-9702-9702_s25_qp_13:q9',
    sourcePdfPath: path.join(temporaryRoot, '9702_s25_qp_13.pdf'),
    sourcePdfSha256: 'a'.repeat(64),
    regions: [
      { page: 11, x0: 0.08, y0: 0.07, x1: 0.94, y1: 0.41 },
      { page: 11, x0: 0.08, y0: 0.07, x1: 0.94, y1: 0.41 },
      { page: 10, x0: 0.08, y0: 0.14, x1: 0.94, y1: 0.92 },
    ],
    pageSizes: {
      10: { width: 1530, height: 1980 },
      11: { width: 1530, height: 1980 },
    },
    outputRoot: path.join(temporaryRoot, 'output'),
  })
  const expectedDirectory = path.join(temporaryRoot, 'output', 'cie-9702-9702_s25_qp_13', 'ai-verified', 'cie-9702-9702_s25_qp_13%3Aq9')
  assert.equal(manifest.outputDirectory, expectedDirectory)
  assert.equal(manifest.sourcePdfSha256, 'a'.repeat(64))
  assert.equal(manifest.crops.length, 2)
  assert.deepEqual(manifest.crops.map(crop => crop.page), [10, 11])
  assert.deepEqual(manifest.crops[0].pageSize, { width: 1530, height: 1980 })
  assert.deepEqual(manifest.crops[0].pixelBounds, { x0: 116, y0: 269, x1: 1445, y1: 1830 })
  assert.ok(manifest.crops[0].normalizedRegion.x0 < 0.08, 'render crop must leave a safety margin before the source region')
  assert.ok(manifest.crops[0].normalizedRegion.x1 > 0.94, 'render crop must leave a safety margin after the source region')
  assert.equal(manifest.questionPdfPath, path.join(expectedDirectory, 'question.pdf'))
  const cropCommand = buildCropCommand(manifest, { pythonPath: 'py' })
  assert.equal(cropCommand.command, 'py')
  assert.deepEqual(cropCommand.args.slice(0, 2), [
    '-3.12',
    path.join(process.cwd(), 'scripts', 'ai-pdf-ingestion', 'crop_pdf.py'),
  ])
  const python3CropCommand = buildCropCommand(manifest, { pythonPath: 'python3' })
  assert.equal(python3CropCommand.command, 'python3')
  assert.equal(python3CropCommand.args[0], path.join(process.cwd(), 'scripts', 'ai-pdf-ingestion', 'crop_pdf.py'))
  assert.deepEqual(cropCommand.args.slice(2, 6), [
    '--input', manifest.sourcePdfPath,
    '--output', manifest.questionPdfPath,
  ])
  assert.equal(cropCommand.args.filter(argument => argument === '--region').length, 2)

  assert.throws(() => buildCropManifest({
    paperId: '..',
    questionId: 'q9',
    sourcePdfPath: path.join(temporaryRoot, 'paper.pdf'),
    sourcePdfSha256: 'a'.repeat(64),
    regions: [{ page: 1, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
    pageSizes: { 1: { width: 100, height: 100 } },
    outputRoot: path.join(temporaryRoot, 'output'),
  }), RangeError)
  assert.throws(() => buildCropManifest({
    paperId: 'paper',
    questionId: '../q9',
    sourcePdfPath: path.join(temporaryRoot, 'paper.pdf'),
    sourcePdfSha256: 'a'.repeat(64),
    regions: [{ page: 1, x0: 0.1, y0: 0.1, x1: 0.9, y1: 0.9 }],
    pageSizes: { 1: { width: 100, height: 100 } },
    outputRoot: path.join(temporaryRoot, 'output'),
  }), RangeError)

  assert.throws(() => buildCropManifest({
    paperId: 'paper',
    questionId: 'q9',
    sourcePdfPath: path.join(temporaryRoot, 'paper.pdf'),
    sourcePdfSha256: 'a'.repeat(64),
    regions: [{ page: 1, x0: 0.7, y0: 0.1, x1: 0.6, y1: 0.9 }],
    pageSizes: { 1: { width: 100, height: 100 } },
    outputRoot: path.join(temporaryRoot, 'output'),
  }), RangeError)

  const sourcePdf = path.join(temporaryRoot, 'source.pdf')
  const croppedPdf = path.join(temporaryRoot, 'output', 'paper', 'ai-verified', 'q1', 'question.pdf')
  const fixturePython = process.platform === 'win32'
    ? { command: 'py', args: ['-3.12'] }
    : { command: 'python3', args: [] }
  const createFixture = spawnSync(fixturePython.command, [
    ...fixturePython.args,
    '-c',
    'from pypdf import PdfWriter; import sys; writer = PdfWriter(); writer.add_blank_page(width=400, height=600); writer.write(sys.argv[1])',
    sourcePdf,
  ], { encoding: 'utf8' })
  assert.equal(createFixture.status, 0, createFixture.stderr)
  const integrationManifest = buildCropManifest({
    paperId: 'paper',
    questionId: 'q1',
    sourcePdfPath: sourcePdf,
    sourcePdfSha256: 'b'.repeat(64),
    regions: [{ page: 1, x0: 0.1, y0: 0.2, x1: 0.9, y1: 0.8 }],
    pageSizes: { 1: { width: 400, height: 600 } },
    outputRoot: path.join(temporaryRoot, 'output'),
  })
  const integrationCommand = buildCropCommand(integrationManifest)
  assert.equal(integrationCommand.command, fixturePython.command)
  assert.deepEqual(integrationCommand.args.slice(0, fixturePython.args.length), fixturePython.args)
  const cropResult = spawnSync(integrationCommand.command, integrationCommand.args, { encoding: 'utf8' })
  assert.equal(cropResult.status, 0, cropResult.stderr)
  assert.ok(existsSync(croppedPdf))
  const inspectResult = spawnSync(fixturePython.command, [
    ...fixturePython.args,
    '-c',
    'from pypdf import PdfReader; import sys; reader = PdfReader(sys.argv[1]); page = reader.pages[0]; print(len(reader.pages), float(page.mediabox.width), float(page.mediabox.height))',
    croppedPdf,
  ], { encoding: 'utf8' })
  assert.equal(inspectResult.status, 0, inspectResult.stderr)
  const croppedDimensions = inspectResult.stdout.trim().split(/\s+/).map(Number)
  assert.equal(croppedDimensions[0], 1)
  assert.ok(Math.abs(croppedDimensions[1] - 323.2) < 1e-6)
  assert.ok(Math.abs(croppedDimensions[2] - 364.8) < 1e-6)

  console.log(JSON.stringify({ status: 'passed', checks: 31 }))
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
