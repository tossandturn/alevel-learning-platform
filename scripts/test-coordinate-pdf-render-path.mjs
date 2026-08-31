import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { renderedPagePath } from '../server/coordinatePdfImages.js'

const outputDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'stem-coordinate-render-path-'))
try {
  fs.writeFileSync(path.join(outputDirectory, 'page-04.jpg'), Buffer.from('page-04'))
  fs.writeFileSync(path.join(outputDirectory, 'crop-004.jpg'), Buffer.from('crop-004'))
  fs.writeFileSync(path.join(outputDirectory, 'page-05.jpg'), Buffer.from('wrong-page'))

  assert.equal(
    path.basename(renderedPagePath(outputDirectory, 4)),
    'page-04.jpg',
    'renderer must resolve Poppler zero-padded page output to the requested numeric page',
  )
  assert.equal(
    path.basename(renderedPagePath(outputDirectory, 4, 'crop')),
    'crop-004.jpg',
    'renderer must apply the same numeric matching to cropped output',
  )
  assert.equal(renderedPagePath(outputDirectory, 6), null, 'renderer must not select an unrelated page')
  console.log('Coordinate PDF rendered-page path regression passed.')
} finally {
  fs.rmSync(outputDirectory, { recursive: true, force: true })
}
