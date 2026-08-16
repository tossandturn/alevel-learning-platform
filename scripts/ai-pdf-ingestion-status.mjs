import { listAiPdfIngestionCandidates, resolveAiPdfIngestionRoot } from '../server/aiPdfIngestionCandidates.js'

const listing = listAiPdfIngestionCandidates({
  root: resolveAiPdfIngestionRoot(process.env),
})

process.stdout.write(`${JSON.stringify(listing, null, 2)}\n`)
