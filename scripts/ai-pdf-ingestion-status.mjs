import { listAiPdfIngestionCandidates, resolveAiPdfIngestionRoot } from '../server/aiPdfIngestionCandidates.js'
import { resolveLibraryRoot } from '../server/pdfLibrary.js'

const listing = listAiPdfIngestionCandidates({
  root: resolveAiPdfIngestionRoot(process.env),
  libraryRoot: resolveLibraryRoot({ env: process.env, cwd: process.cwd() }),
})

process.stdout.write(`${JSON.stringify(listing, null, 2)}\n`)
