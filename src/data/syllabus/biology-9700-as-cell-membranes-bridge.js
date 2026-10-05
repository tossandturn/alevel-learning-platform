import catalog from './biology-9700-as-cell-membranes-source.json' with { type: 'json' }

const points = Object.freeze(catalog.points.map((point) => Object.freeze({ ...point })))

export function attach9700AsCellMembranes(routeId, topics) {
  if (routeId !== catalog.routeId) return topics
  return topics.map((topic) => topic.id === catalog.topicId
    ? Object.freeze({
        ...topic,
        points,
        catalogStatus: catalog.status,
        sourceSyllabusVersion: catalog.syllabusVersion,
        sourceUrl: catalog.source.url,
      })
    : topic)
}
