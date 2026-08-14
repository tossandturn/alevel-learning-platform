/*
 * Syllabus-aligned teaching content for Topic pages.
 *
 * This module is intentionally separate from the verified question catalog.
 * Nothing here is presented as an official past-paper question or counted in
 * the practice inventory.
 */

const DEFAULT_SOURCE_NOTE = 'Syllabus-aligned study guide; not an official past-paper question.'

function freezeContent(content) {
  return Object.freeze({
    overview: content.overview,
    learningObjectives: Object.freeze([...content.learningObjectives]),
    keyIdeas: Object.freeze(content.keyIdeas.map((item) => Object.freeze({ term: item.term, explanation: item.explanation }))),
    commonMistakes: Object.freeze([...content.commonMistakes]),
    workedExample: Object.freeze({ prompt: content.workedExample.prompt, method: content.workedExample.method }),
    examChecklist: Object.freeze([...content.examChecklist]),
    sourceNote: content.sourceNote || DEFAULT_SOURCE_NOTE,
  })
}

function genericContent(topic) {
  const name = String(topic?.name || 'this topic')
  const themes = topic?.themes || []
  const firstTheme = themes[0] || 'the central idea'
  const secondTheme = themes[1] || 'the supporting method'
  return freezeContent({
    overview: `Build a clear model of ${name}, then practise choosing and explaining the method before you use a calculator or formula sheet.`,
    learningObjectives: [
      `Define the important terms in ${name} and connect them to ${firstTheme}.`,
      `Choose a suitable representation or method for ${secondTheme}.`,
      'Show enough working for another person to follow and check the final result.',
    ],
    keyIdeas: [
      { term: 'Model', explanation: 'State what the symbols, quantities, or variables represent before substituting values.' },
      { term: 'Method', explanation: 'Use the relationship that matches the evidence in the question, not the first familiar formula.' },
      { term: 'Check', explanation: 'Review units, sign, scale, rounding, and whether the result answers the exact command word.' },
    ],
    commonMistakes: [
      'Starting calculations before identifying the given information and the required quantity.',
      'Dropping units, conditions, or significant figures from the final answer.',
      'Giving a number without a brief explanation when the question asks for reasoning or interpretation.',
    ],
    workedExample: {
      prompt: `Original worked example: explain how you would approach a new ${name} problem without using a past-paper question.`,
      method: `1. List the known and unknown quantities. 2. Sketch or organise the information. 3. Select the relationship. 4. Substitute with units. 5. Check the result against the context.`,
    },
    examChecklist: [
      'Underline the command word and identify the mark-bearing steps.',
      'Keep intermediate values unrounded until the final line.',
      'State a conclusion with units, direction, or context where needed.',
    ],
  })
}

function familyContent(topic, family) {
  const name = String(topic?.name || 'this topic')
  const themes = topic?.themes || []
  const themeList = themes.length ? themes : ['definitions', 'method selection', 'interpretation']
  const [firstTheme, secondTheme, thirdTheme] = themeList
  const familyCopy = {
    physics: {
      overview: `Build a physical model for ${name}: identify the quantities, draw the situation, choose the relationship, and explain what the result means.`,
      objectives: [`Define and use the quantities in ${firstTheme}.`, `Connect ${secondTheme} to a diagram, graph, or equation.`, `Explain the assumptions behind a calculation about ${thirdTheme || name}.`, 'Use units, signs, scale and limiting cases to check the result.'],
      ideas: [
        { term: 'Model first', explanation: 'Translate the situation into a labelled diagram, graph or force/energy model before selecting an equation.' },
        { term: 'Evidence', explanation: 'Use the given data and the shape of a graph to justify the relationship, not just to produce a number.' },
        { term: 'Physical check', explanation: 'Test units, direction, order of magnitude and whether the result is physically possible.' },
      ],
      mistakes: ['Choosing a familiar formula before checking its conditions.', 'Leaving a diagram, direction or sign convention implicit.', 'Reporting a number without units or without interpreting it in the physical situation.'],
      example: `For a new ${name} problem, list the known quantities, sketch the system, state the governing relationship, substitute with units, and explain the final result.`,
      exampleMethod: 'The method earns credit because the model, equation, substitution and check are visible; it is not a past-paper question.',
      checklist: ['Define the positive direction or reference state.', 'Label axes, vectors, pathways or boundaries.', 'Keep units through the working and check the final scale.'],
    },
    mathematics: {
      overview: `Learn the structure of ${name}, then practise moving between representations: exact algebra, diagrams, graphs, tables and a written conclusion.`,
      objectives: [`Use correct notation and definitions for ${firstTheme}.`, `Choose an efficient method for ${secondTheme}.`, `Show transformations or logical steps clearly enough to earn method marks.`, `Check the answer using substitution, a graph, an estimate or a limiting case.`],
      ideas: [
        { term: 'Representation', explanation: 'A formula, graph, diagram or table can reveal a different part of the same mathematical structure.' },
        { term: 'Exact form', explanation: 'Keep fractions, surds, pi or symbolic parameters exact until the question asks for a decimal.' },
        { term: 'Domain and conditions', explanation: 'Record restrictions, valid intervals and assumptions that limit the answer.' },
      ],
      mistakes: ['Rounding too early and losing accuracy in later steps.', 'Giving roots or solutions that violate the original domain.', 'Skipping the line that explains why a theorem, identity or method applies.'],
      example: `Take an original ${name} problem and write a method plan before calculating: identify the structure, choose the representation, perform the transformation, then verify.`,
      exampleMethod: 'A complete solution should show the method choice, the key algebraic or geometric step, and a final statement that answers the command.',
      checklist: ['Write the exact form before decimal approximation.', 'State the interval, units or domain with the answer.', 'Use a second representation to check an unfamiliar result.'],
    },
    chemistry: {
      overview: `Connect particle-level explanations, equations and observations in ${name}. A strong answer names the species, conditions and evidence rather than only stating a result.`,
      objectives: [`Recall the vocabulary and patterns in ${firstTheme}.`, `Use equations, structures or data to explain ${secondTheme}.`, `Relate observations to particles, bonding, energetics or equilibrium where relevant.`, 'Use conditions and units precisely in quantitative work.'],
      ideas: [
        { term: 'Particle explanation', explanation: 'Explain macroscopic observations using atoms, ions, molecules, electrons, collisions or intermolecular forces.' },
        { term: 'Conditions', explanation: 'Temperature, pressure, concentration, catalyst and solvent can change what a result means.' },
        { term: 'Evidence', explanation: 'Colour, precipitate, gas, pH, spectra and numerical data must be interpreted, not merely listed.' },
      ],
      mistakes: ['Writing an unbalanced equation or omitting state symbols when they matter.', 'Confusing a rate change with an equilibrium-position change.', 'Describing an observation without explaining the chemical cause.'],
      example: `For a new ${name} data question, identify the species and conditions first, write the relevant equation or relationship, then connect the evidence to the particle model.`,
      exampleMethod: 'Keep the macroscopic observation, symbolic representation and particle explanation in the same chain of reasoning.',
      checklist: ['Balance equations and label conditions.', 'Track significant figures and units in calculations.', 'Explain observations with particles or bonding.'],
    },
    biology: {
      overview: `Study ${name} by linking structure, process and consequence. Use precise biological vocabulary, then apply it to data, unfamiliar organisms or experimental evidence.`,
      objectives: [`Define the key structures and terms in ${firstTheme}.`, `Explain the sequence or mechanism behind ${secondTheme}.`, `Interpret data using a biological claim supported by evidence.`, 'Evaluate a method, variable or limitation when practical work is involved.'],
      ideas: [
        { term: 'Structure and function', explanation: 'A biological structure is best explained by linking its features to the job it performs.' },
        { term: 'Process', explanation: 'Write a sequence with named substances, locations and conditions rather than a vague description.' },
        { term: 'Evidence', explanation: 'Use data values, trends and anomalies to support a conclusion, then state its limits.' },
      ],
      mistakes: ['Using everyday language instead of precise biological terms.', 'Describing a trend without quoting data or comparing groups.', 'Claiming causation when the investigation only shows correlation.'],
      example: `For a new ${name} experiment, identify the independent, dependent and controlled variables, predict the biological mechanism, and explain how the data would support it.`,
      exampleMethod: 'A strong answer moves from named structure or process to evidence and then to a justified conclusion.',
      checklist: ['Name locations, molecules and stages precisely.', 'Quote comparative data in conclusions.', 'Separate observation, explanation and evaluation.'],
    },
    economics: {
      overview: `Build an economic chain for ${name}: define the concept, show the mechanism, apply it to the context, and evaluate the likely outcome.`,
      objectives: [`Define the central terms in ${firstTheme}.`, `Explain the cause-and-effect chain for ${secondTheme}.`, `Use a diagram, data or contextual example to support the analysis.`, 'Evaluate assumptions, time period, stakeholders and possible counter-effects.'],
      ideas: [
        { term: 'Definition', explanation: 'Start with a precise definition so the rest of the answer uses the concept consistently.' },
        { term: 'Chain of analysis', explanation: 'Each link should explain why one change leads to the next, not simply list consequences.' },
        { term: 'Evaluation', explanation: 'Compare conditions, groups, time periods or policy trade-offs before reaching a conclusion.' },
      ],
      mistakes: ['Writing a diagram without explaining the movement or welfare effect.', 'Making a generic claim that does not use the context or data.', 'Adding evaluation as a final sentence instead of weighing it through the argument.'],
      example: `For a new ${name} policy question, define the issue, draw the relevant relationship, explain the transmission mechanism, then weigh short-run and long-run effects.`,
      exampleMethod: 'Use definition -> diagram/data -> chain of analysis -> evaluation -> conditional judgement.',
      checklist: ['Label diagrams and state the direction of change.', 'Use the context or data in every developed paragraph.', 'Make the final judgement conditional and justified.'],
    },
    competition: {
      overview: `Competition questions in ${name} reward flexible representation and insight. Build a small model, test simple cases, and look for invariants before committing to a long calculation.`,
      objectives: [`Translate ${firstTheme} into a precise mathematical or physical statement.`, `Try small cases or a diagram to reveal the structure of ${secondTheme}.`, `Explain why the pattern continues rather than only reporting it.`, 'Present a concise proof or argument with no hidden case.'],
      ideas: [
        { term: 'Invariant', explanation: 'Look for a quantity, parity, symmetry or relationship that remains unchanged under the allowed move.' },
        { term: 'Case control', explanation: 'Organise cases so they are complete and non-overlapping.' },
        { term: 'Proof check', explanation: 'Test boundary cases and make sure every implication is reversible when required.' },
      ],
      mistakes: ['Assuming a pattern from a few examples without proving it.', 'Missing a boundary or symmetry case.', 'Using a calculation that gives the answer but does not explain why it must be true.'],
      example: `Take an original ${name} challenge and begin with the smallest non-trivial cases. Record the pattern, identify an invariant, and write the argument that closes all cases.`,
      exampleMethod: 'Exploration is useful for discovery; the final response must contain a complete, readable argument.',
      checklist: ['State the object, move or condition precisely.', 'Check the smallest and largest relevant cases.', 'Separate conjecture from proof.'],
    },
    admissions: {
      overview: `Admissions practice for ${name} combines speed with reliable reasoning. Build a compact representation, eliminate impossible options, and verify the result before moving on.`,
      objectives: [`Recognise the core skill in ${firstTheme} quickly.`, `Translate ${secondTheme} into a short calculation, diagram or logical chain.`, `Use estimation and option structure to reject impossible results.`, 'Balance speed with a final sign, unit and plausibility check.'],
      ideas: [
        { term: 'Translation', explanation: 'Convert dense wording into symbols, a table, a sketch or a sequence of constraints.' },
        { term: 'Elimination', explanation: 'Use bounds, units, parity, scale or contradiction to remove options before full calculation.' },
        { term: 'Verification', explanation: 'A quick independent check protects against a rushed arithmetic or interpretation error.' },
      ],
      mistakes: ['Over-solving a question that can be bounded or simplified.', 'Ignoring units, scale or wording because the options look familiar.', 'Spending too long on one route without recording a viable fallback.'],
      example: `For a new ${name} item, spend the first few seconds translating the conditions, then choose the shortest valid route and perform one independent check.`,
      exampleMethod: 'Use structure first, calculation second, verification third; the worked example is original study guidance, not an admissions source item.',
      checklist: ['Estimate before calculating exactly.', 'Use options and constraints intelligently.', 'Move on with a marked return point if the method is not converging.'],
    },
  }
  const copy = familyCopy[family] || familyCopy.physics
  return freezeContent({
    overview: copy.overview,
    learningObjectives: copy.objectives,
    keyIdeas: copy.ideas,
    commonMistakes: copy.mistakes,
    workedExample: { prompt: copy.example, method: copy.exampleMethod },
    examChecklist: copy.checklist,
  })
}

function topicFamily(topic) {
  const subjectId = String(topic?.subjectId || '').toLowerCase()
  const stage = String(topic?.stage || '').toLowerCase()
  if (subjectId.includes('chemistry')) return 'chemistry'
  if (subjectId.includes('biology')) return 'biology'
  if (subjectId.includes('economics')) return 'economics'
  if (stage === 'competition' || ['bpho', 'amc12'].some((token) => subjectId.includes(token))) return 'competition'
  if (stage === 'admissions' || ['esat', 'tmua'].some((token) => subjectId.includes(token))) return 'admissions'
  if (subjectId.includes('math')) return 'mathematics'
  if (subjectId.includes('physics')) return 'physics'
  return 'default'
}

const CONTENT = new Map([
  ['physics-9702-topic-01', freezeContent({
    overview: 'Create a reliable language for physics: SI units, prefixes, vectors, uncertainty and the difference between a measured quantity and a calculated result.',
    learningObjectives: ['Convert prefixes and compound units without losing powers of ten.', 'Separate scalar and vector quantities and represent vectors clearly.', 'Combine measurements and quote uncertainty with sensible precision.'],
    keyIdeas: [
      { term: 'SI base unit', explanation: 'The agreed unit used to build derived units, such as metre, kilogram, second and ampere.' },
      { term: 'Vector', explanation: 'A quantity with magnitude and direction; diagrams and signs carry information.' },
      { term: 'Percentage uncertainty', explanation: 'A relative measure of measurement uncertainty, commonly calculated as absolute uncertainty divided by measured value times 100.' },
    ],
    commonMistakes: ['Mixing centimetres or hours into an SI calculation.', 'Treating a negative sign as an error instead of a direction.', 'Quoting more precision than the instrument supports.'],
    workedExample: { prompt: 'A length is 2.40 m with an uncertainty of 0.03 m. Outline the percentage-uncertainty calculation.', method: 'Use (0.03 / 2.40) x 100, then report the percentage to a precision supported by the data.' },
    examChecklist: ['Write the unit beside every measured quantity.', 'Show vector direction or sign in the diagram.', 'Match uncertainty precision to the instrument resolution.'],
  })],
  ['physics-9702-topic-02', freezeContent({
    overview: 'Kinematics describes how position changes with time. Build the chain displacement -> velocity -> acceleration, then read the same information from equations and graphs.',
    learningObjectives: ['Distinguish distance from displacement and speed from velocity.', 'Select constant-acceleration equations only when the conditions fit.', 'Interpret gradient and area on displacement-time, velocity-time and acceleration-time graphs.'],
    keyIdeas: [
      { term: 'Velocity', explanation: 'Rate of change of displacement; the gradient of a displacement-time graph.' },
      { term: 'Acceleration', explanation: 'Rate of change of velocity; the gradient of a velocity-time graph.' },
      { term: 'Area under a graph', explanation: 'For a velocity-time graph, signed area gives displacement; for acceleration-time, it gives change in velocity.' },
    ],
    commonMistakes: ['Using distance when the question requires displacement.', 'Reading graph height when the question asks for a gradient or area.', 'Applying SUVAT when acceleration is not constant.'],
    workedExample: { prompt: 'A particle starts at 4 m/s and accelerates uniformly at 3 m/s^2 for 5 s. Plan the calculation of its final velocity and displacement.', method: 'Identify u, a and t; use v = u + at for final velocity, then s = ut + 1/2 at^2 for displacement. Keep signs consistent.' },
    examChecklist: ['Define the positive direction.', 'Label graph axes and units.', 'Check that the graph interpretation and equation give compatible results.'],
  })],
  ['physics-9702-topic-03', freezeContent({
    overview: 'Dynamics links motion to interaction. Use free-body diagrams, Newton’s laws and momentum ideas to make the force model visible before calculating.',
    learningObjectives: ['Draw and label forces acting on a body.', 'Resolve forces and apply Newton’s second law in a chosen direction.', 'Use momentum conservation when external resultant impulse is negligible.'],
    keyIdeas: [
      { term: 'Resultant force', explanation: 'The vector sum of all forces on an object; it determines acceleration through F = ma.' },
      { term: 'Newton’s third law', explanation: 'Interaction forces are equal in magnitude, opposite in direction and act on different objects.' },
      { term: 'Impulse', explanation: 'Change in momentum; the area under a force-time graph.' },
    ],
    commonMistakes: ['Putting action-reaction pairs on the same free-body diagram.', 'Ignoring friction, tension or normal reaction without stating an assumption.', 'Conserving kinetic energy in an inelastic collision.'],
    workedExample: { prompt: 'A block is pulled across a rough horizontal surface. Set up the force model before finding its acceleration.', method: 'Draw weight, normal reaction, pulling force and friction. Resolve horizontally, then use resultant force = mass x acceleration.' },
    examChecklist: ['Draw the body boundary and every external force.', 'State assumptions such as light string or negligible air resistance.', 'Use momentum before energy when the collision is not elastic.'],
  })],
  ['physics-9702-topic-04', freezeContent({
    overview: 'Forces, density and pressure explain how loads are distributed and how fluids respond. Connect diagrams, moments and material properties to the correct scale of the problem.',
    learningObjectives: ['Calculate density and pressure with correct units.', 'Use moments about a point to test equilibrium.', 'Explain how pressure changes with depth and contact area.'],
    keyIdeas: [
      { term: 'Moment', explanation: 'Force multiplied by the perpendicular distance from the pivot.' },
      { term: 'Pressure', explanation: 'Normal force per unit area; in a fluid it increases with depth because of the weight above.' },
      { term: 'Density', explanation: 'Mass per unit volume, useful for identifying materials and modelling buoyancy.' },
    ],
    commonMistakes: ['Using the sloping distance instead of perpendicular distance for a moment.', 'Confusing pressure with force.', 'Mixing cm^3 and m^3 in density calculations.'],
    workedExample: { prompt: 'A force acts on a beam at an angle. Explain what distance belongs in the moment calculation.', method: 'Use the shortest perpendicular distance from the pivot to the force line of action, not simply the distance to the contact point.' },
    examChecklist: ['Mark the pivot and line of action.', 'Use absolute pressure or pressure difference as requested.', 'Convert volume before substituting.'],
  })],
  ['physics-9702-topic-05', freezeContent({
    overview: 'Work, energy and power provide a bookkeeping method for motion and systems. Track transfers, not just formulas, and state where energy is dissipated.',
    learningObjectives: ['Relate work done to force, displacement and energy transfer.', 'Use conservation of energy with useful and wasted pathways.', 'Distinguish power from energy and interpret efficiency.'],
    keyIdeas: [
      { term: 'Work done', explanation: 'Energy transferred by a force through a displacement in the force direction.' },
      { term: 'Power', explanation: 'Rate of energy transfer or work done per unit time.' },
      { term: 'Efficiency', explanation: 'Useful output energy or power divided by total input, expressed as a fraction or percentage.' },
    ],
    commonMistakes: ['Reporting power in joules rather than watts.', 'Assuming mechanical energy is conserved when friction is present.', 'Using force times distance when the force is not parallel to displacement.'],
    workedExample: { prompt: 'A motor lifts a load through a height in a measured time. Plan an efficiency calculation.', method: 'Find useful gain in gravitational potential energy, divide by input energy or power, and state the percentage with the operating conditions.' },
    examChecklist: ['Draw an energy-transfer chain.', 'Keep time in seconds for power.', 'Name the dissipated pathway rather than hiding it in a calculation.'],
  })],
  ['physics-9702-topic-07', freezeContent({
    overview: 'Waves transfer energy and information without transferring matter overall. Read wave diagrams quantitatively and describe observations using phase, frequency, wavelength and speed.',
    learningObjectives: ['Use v = f lambda and identify the quantity represented by a graph.', 'Distinguish transverse and longitudinal motion.', 'Explain refraction, diffraction and polarisation using wavefront or phase ideas.'],
    keyIdeas: [
      { term: 'Phase difference', explanation: 'The fraction of a cycle separating two oscillations; it can be expressed as an angle or fraction of wavelength.' },
      { term: 'Diffraction', explanation: 'Spreading of waves after an aperture or around an obstacle, strongest when aperture size is comparable with wavelength.' },
      { term: 'Polarisation', explanation: 'Restriction of transverse oscillations to one direction.' },
    ],
    commonMistakes: ['Confusing amplitude with wavelength.', 'Describing diffraction as reflection.', 'Using frequency change to explain refraction when the source frequency is fixed.'],
    workedExample: { prompt: 'A wave has frequency 250 Hz and wavelength 1.2 m. Explain the first calculation and one physical check.', method: 'Use v = f lambda to obtain 300 m/s, then check that the magnitude is plausible for the stated medium.' },
    examChecklist: ['Label one full cycle on a diagram.', 'State whether frequency, wavelength or speed changes.', 'Link the observation to aperture size or phase difference.'],
  })],
])

export function topicLearningContent(topic) {
  const id = String(topic?.id || '')
  if (CONTENT.has(id)) return CONTENT.get(id)
  return familyContent(topic, topicFamily(topic)) || genericContent(topic)
}

export function topicLearningContentStatus(topic) {
  const content = topicLearningContent(topic)
  return {
    ...content,
    hasOriginalGuide: !String(content.sourceNote).startsWith('Syllabus-aligned'),
  }
}

export const topicLearningContentSourceNote = DEFAULT_SOURCE_NOTE
