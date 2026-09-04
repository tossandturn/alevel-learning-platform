/*
 * Cambridge International AS & A Level Physics 9702, 2025-2027.
 *
 * This is the source syllabus taxonomy for the AS theory route. Practical
 * skills remain a separate assessment track and are intentionally excluded
 * from this Topic Drill list.
 */

export const CAMBRIDGE_9702_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '9702',
  syllabusVersion: '2025-2027',
  officialUrl: 'https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf',
  subjectContentPages: Object.freeze([16, 17, 18, 19, 20, 21, 22, 23, 24, 25]),
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'AS', track: 'theory', label: 'Multiple Choice' }),
    Object.freeze({ component: 2, stage: 'AS', track: 'theory', label: 'AS Level Structured Questions' }),
    Object.freeze({ component: 3, stage: 'AS', track: 'practical', label: 'Advanced Practical Skills' }),
  ]),
})

const ROUTE_ID = 'cie-9702-as-physics'

function point(topicId, sectionCode, outcomeNumber, officialText) {
  return Object.freeze({
    id: `physics-9702-point-${sectionCode.replace('.', '-')}-${String(outcomeNumber).padStart(2, '0')}`,
    topicId,
    sectionCode,
    outcomeNumber,
    officialText,
  })
}

function topic(code, name, order, page, sections) {
  const id = `physics-9702-topic-${String(code).padStart(2, '0')}`
  const points = sections.flatMap(([sectionCode, outcomes]) => outcomes.map((text, index) => point(id, sectionCode, index + 1, text)))
  return Object.freeze({
    id,
    routeId: ROUTE_ID,
    syllabusVersion: CAMBRIDGE_9702_SYLLABUS_SOURCE.syllabusVersion,
    code: String(code),
    name,
    order,
    officialPage: page,
    points: Object.freeze(points),
  })
}

export const CAMBRIDGE_9702_AS_TOPICS = Object.freeze([
  topic(1, 'Physical quantities and units', 1, 16, [
    ['1.1', [
      'understand that all physical quantities consist of a numerical magnitude and a unit',
      'make reasonable estimates of physical quantities included within the syllabus',
    ]],
    ['1.2', [
      'recall the SI base quantities and their units: mass (kg), length (m), time (s), current (A) and temperature (K)',
      'express derived units as products or quotients of SI base units and use derived units for quantities listed in this syllabus as appropriate',
      'use SI base units to check the homogeneity of physical equations',
      'recall and use prefixes and their symbols to indicate decimal submultiples or multiples of base and derived units',
    ]],
    ['1.3', [
      'understand and explain the effects of systematic errors, including zero errors, and random errors in measurements',
      'understand the distinction between precision and accuracy',
      'assess the uncertainty in a derived quantity by simple addition of absolute or percentage uncertainties',
    ]],
    ['1.4', [
      'understand the difference between scalar and vector quantities and give examples from the syllabus',
      'add and subtract coplanar vectors',
      'represent a vector as two perpendicular components',
    ]],
  ]),
  topic(2, 'Kinematics', 2, 17, [
    ['2.1', [
      'define and use distance, displacement, speed, velocity and acceleration',
      'use graphical methods to represent distance, displacement, speed, velocity and acceleration',
      'determine displacement from the area under a velocity-time graph',
      'determine velocity using the gradient of a displacement-time graph',
      'determine acceleration using the gradient of a velocity-time graph',
      'derive, from the definitions of velocity and acceleration, equations that represent uniformly accelerated motion in a straight line',
      'solve problems using equations for uniformly accelerated motion in a straight line, including bodies falling in a uniform gravitational field without air resistance',
      'describe an experiment to determine the acceleration of free fall using a falling object',
      'describe and explain motion due to a uniform velocity in one direction and a uniform acceleration in a perpendicular direction',
    ]],
  ]),
  topic(3, 'Dynamics', 3, 17, [
    ['3.1', [
      'understand that mass is the property of an object that resists change in motion',
      'recall F = ma and solve problems using it, understanding that acceleration and resultant force are always in the same direction',
      'define and use linear momentum as the product of mass and velocity',
      'define and use force as rate of change of momentum',
      'state and apply each of Newton’s laws of motion',
      'describe and use the concept of weight as the effect of a gravitational field on a mass and recall that weight equals mass times acceleration of free fall',
    ]],
    ['3.2', [
      'show a qualitative understanding of frictional forces and viscous or drag forces, including air resistance',
      'describe and explain qualitatively the motion of objects in a uniform gravitational field with air resistance',
      'understand that objects moving against a resistive force may reach a terminal, constant velocity',
    ]],
    ['3.3', [
      'state the principle of conservation of momentum',
      'apply conservation of momentum to simple problems, including elastic and inelastic interactions in one and two dimensions',
      'recall that for an elastic collision total kinetic energy is conserved and relative speed of approach equals relative speed of separation',
      'understand that momentum of a system is always conserved in interactions while some kinetic energy may change',
    ]],
  ]),
  topic(4, 'Forces, density and pressure', 4, 18, [
    ['4.1', [
      'understand that the weight of an object may be taken as acting at a single point called its centre of gravity',
      'define and apply the moment of a force',
      'understand that a couple is a pair of forces that acts to produce rotation only',
      'define and apply the torque of a couple',
    ]],
    ['4.2', [
      'state and apply the principle of moments',
      'understand that when there is no resultant force and no resultant torque a system is in equilibrium',
      'use a vector triangle to represent coplanar forces in equilibrium',
    ]],
    ['4.3', [
      'define and use density',
      'define and use pressure',
      'derive, from the definitions of pressure and density, the equation Δp = ρgΔh for hydrostatic pressure',
      'use the equation Δp = ρgΔh',
      'understand that upthrust on an object in a fluid is due to a difference in hydrostatic pressure',
      'calculate upthrust using F = ρgV (Archimedes’ principle)',
    ]],
  ]),
  topic(5, 'Work, energy and power', 5, 19, [
    ['5.1', [
      'understand the concept of work and recall and use work done = force × displacement in the direction of the force',
      'recall and apply the principle of conservation of energy',
      'recall and understand that efficiency is useful energy output divided by total energy input',
      'use the concept of efficiency to solve problems',
      'define power as work done per unit time',
      'solve problems using P = W/t',
      'derive P = Fv and use it to solve problems',
    ]],
    ['5.2', [
      'derive, using W = Fs, the formula ΔEp = mgΔh for gravitational potential energy changes in a uniform gravitational field',
      'recall and use ΔEp = mgΔh for gravitational potential energy changes in a uniform gravitational field',
      'derive, using the equations of motion, the formula Ek = 1/2 mv² for kinetic energy',
      'recall and use Ek = 1/2 mv²',
    ]],
  ]),
  topic(6, 'Deformation of solids', 6, 20, [
    ['6.1', [
      'understand that deformation is caused by tensile or compressive forces and is assumed to be one-dimensional',
      'understand and use the terms load, extension, compression and limit of proportionality',
      'recall and use Hooke’s law',
      'recall and use the formula for spring constant k = F/x',
      'define and use stress, strain and the Young modulus',
      'describe an experiment to determine the Young modulus of a metal wire',
    ]],
    ['6.2', [
      'understand and use the terms elastic deformation, plastic deformation and elastic limit',
      'understand that the area under a force-extension graph represents work done',
      'determine elastic potential energy of a material deformed within its limit of proportionality from the area under the force-extension graph',
      'recall and use Ep = 1/2 Fx = 1/2 kx² for a material deformed within its limit of proportionality',
    ]],
  ]),
  topic(7, 'Waves', 7, 20, [
    ['7.1', [
      'describe wave motion as illustrated by vibration in ropes, springs and ripple tanks',
      'understand and use displacement, amplitude, phase difference, period, frequency, wavelength and speed',
      'understand the use of the time-base and y-gain of a CRO to determine frequency and amplitude',
      'derive, using definitions of speed, frequency and wavelength, the wave equation v = fλ',
      'recall and use v = fλ',
      'understand that energy is transferred by a progressive wave',
      'recall and use intensity = power/area and intensity proportional to amplitude squared for a progressive wave',
    ]],
    ['7.2', [
      'compare transverse and longitudinal waves',
      'analyse and interpret graphical representations of transverse and longitudinal waves',
    ]],
    ['7.3', [
      'understand that when a source of sound waves moves relative to a stationary observer the observed frequency differs from the source frequency',
      'use the expression for observed frequency when a source of sound waves moves relative to a stationary observer',
    ]],
    ['7.4', [
      'state that all electromagnetic waves are transverse and travel at the same speed c in free space',
      'recall the approximate wavelength ranges of the principal regions of the electromagnetic spectrum from radio waves to gamma rays',
      'recall that wavelengths in the range 400-700 nm in free space are visible to the human eye',
    ]],
    ['7.5', [
      'understand that polarisation is a phenomenon associated with transverse waves',
      'recall and use Malus’s law to calculate intensity after transmission through polarising filters',
    ]],
  ]),
  topic(8, 'Superposition', 8, 22, [
    ['8.1', [
      'explain and use the principle of superposition',
      'show an understanding of experiments demonstrating stationary waves using microwaves, stretched strings and air columns',
      'explain formation of a stationary wave graphically and identify nodes and antinodes',
      'understand how wavelength may be determined from positions of nodes or antinodes',
    ]],
    ['8.2', [
      'explain the meaning of diffraction',
      'show an understanding of experiments demonstrating diffraction, including the qualitative effect of gap width relative to wavelength',
    ]],
    ['8.3', [
      'understand the terms interference and coherence',
      'show an understanding of experiments demonstrating two-source interference using water waves, sound, light and microwaves',
      'understand the conditions required for two-source interference fringes to be observed',
      'recall and use λ = ax/D for double-slit interference using light',
    ]],
    ['8.4', [
      'recall and use d sin θ = nλ',
      'describe the use of a diffraction grating to determine the wavelength of light',
    ]],
  ]),
  topic(9, 'Electricity', 9, 23, [
    ['9.1', [
      'understand that electric current is a flow of charge carriers',
      'understand that charge on charge carriers is quantised',
      'recall and use Q = It',
      'use I = Anvq for a current-carrying conductor',
    ]],
    ['9.2', [
      'define potential difference across a component as energy transferred per unit charge',
      'recall and use V = W/Q',
      'recall and use P = VI, P = I²R and P = V²/R',
    ]],
    ['9.3', [
      'define resistance',
      'recall and use V = IR',
      'sketch I-V characteristics of a metallic conductor at constant temperature, a semiconductor diode and a filament lamp',
      'explain why resistance of a filament lamp increases as current increases because temperature increases',
      'state Ohm’s law',
      'recall and use R = ρL/A',
      'understand that resistance of an LDR decreases as light intensity increases',
      'understand that resistance of a thermistor decreases as temperature increases',
    ]],
  ]),
  topic(10, 'D.C. circuits', 10, 24, [
    ['10.1', [
      'recall and use the circuit symbols shown in the syllabus',
      'draw and interpret circuit diagrams containing the syllabus circuit symbols',
      'define and use the electromotive force of a source as energy transferred per unit charge in driving charge around a complete circuit',
      'distinguish between e.m.f. and potential difference in terms of energy considerations',
      'understand the effects of internal resistance of a source of e.m.f. on terminal potential difference',
    ]],
    ['10.2', [
      'recall Kirchhoff’s first law and understand that it follows from conservation of charge',
      'recall Kirchhoff’s second law and understand that it follows from conservation of energy',
      'derive, using Kirchhoff’s laws, a formula for combined resistance of two or more resistors in series',
      'use the formula for combined resistance of resistors in series',
      'derive, using Kirchhoff’s laws, a formula for combined resistance of two or more resistors in parallel',
      'use the formula for combined resistance of resistors in parallel',
      'use Kirchhoff’s laws to solve simple circuit problems',
    ]],
    ['10.3', [
      'understand the principle of a potential divider circuit',
      'recall and use the principle of a potentiometer as a means of comparing potential differences',
      'understand the use of a galvanometer in null methods',
      'explain the use of thermistors and light-dependent resistors in potential dividers',
    ]],
  ]),
  topic(11, 'Particle physics', 11, 25, [
    ['11.1', [
      'infer from alpha-particle scattering the existence and small size of the nucleus',
      'describe a simple model for the nuclear atom including protons, neutrons and orbital electrons',
      'distinguish between nucleon number and proton number',
      'understand that isotopes are forms of the same element with different numbers of neutrons',
      'understand and use the notation for the representation of nuclides',
      'understand that nucleon number and charge are conserved in nuclear processes',
      'describe the composition, mass and charge of alpha, beta-minus, beta-plus and gamma radiations',
      'understand that an antiparticle has the same mass but opposite charge and that a positron is the antiparticle of an electron',
      'state that electron antineutrinos are produced during beta-minus decay and electron neutrinos during beta-plus decay',
      'understand that alpha particles have discrete energies but beta particles have a continuous range because neutrinos are emitted',
      'represent alpha and beta decay by a radioactive decay equation',
      'use the unified atomic mass unit as a unit of mass',
    ]],
    ['11.2', [
      'understand that a quark is a fundamental particle and that there are six flavours: up, down, strange, charm, top and bottom',
      'recall and use the charge of each quark flavour and understand that the antiquark has opposite charge',
      'recall that protons and neutrons are not fundamental and describe them in terms of quark composition',
      'understand that a hadron may be a baryon of three quarks or a meson of one quark and one antiquark',
      'describe changes to quark composition during beta-minus and beta-plus decay',
      'recall that electrons and neutrinos are fundamental particles called leptons',
    ]],
  ]),
])

export const CAMBRIDGE_9702_AS_SYLLABUS = Object.freeze({
  ...CAMBRIDGE_9702_SYLLABUS_SOURCE,
  routeId: ROUTE_ID,
  topics: CAMBRIDGE_9702_AS_TOPICS,
  points: Object.freeze(CAMBRIDGE_9702_AS_TOPICS.flatMap((item) => item.points)),
})
