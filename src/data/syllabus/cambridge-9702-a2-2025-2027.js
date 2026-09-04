/*
 * Cambridge International AS & A Level Physics 9702, 2025-2027.
 *
 * This is the official A Level subject-content taxonomy used for Paper 4
 * ingestion. Paper 5 practical skills are a separate assessment track and
 * are intentionally excluded from this topic-drill taxonomy.
 */

export const CAMBRIDGE_9702_A2_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '9702',
  syllabusVersion: '2025-2027',
  officialUrl: 'https://www.cambridgeinternational.org/Images/664565-2025-2027-syllabus.pdf',
  subjectContentPages: Object.freeze([26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39]),
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 4, stage: 'A2', track: 'theory', label: 'A Level Structured Questions' }),
    Object.freeze({ component: 5, stage: 'A2', track: 'practical', label: 'Planning, Analysis and Evaluation' }),
  ]),
})

const ROUTE_ID = 'cie-9702-a2-physics'

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
    stage: 'A2',
    component: 'A2 P4',
    syllabusVersion: CAMBRIDGE_9702_A2_SYLLABUS_SOURCE.syllabusVersion,
    code: String(code),
    name,
    order,
    officialPage: page,
    points: Object.freeze(points),
  })
}

export const CAMBRIDGE_9702_A2_TOPICS = Object.freeze([
  topic(12, 'Motion in a circle', 12, 26, [
    ['12.1', [
      'define the radian and express angular displacement in radians',
      'understand and use the concept of angular speed',
      'recall and use ω = 2π / T and v = rω',
    ]],
    ['12.2', [
      'understand that a force of constant magnitude that is always perpendicular to the direction of motion causes centripetal acceleration',
      'understand that centripetal acceleration causes circular motion with a constant angular speed',
      'recall and use a = rω² and a = v² / r',
      'recall and use F = mrω² and F = mv² / r',
    ]],
  ]),
  topic(13, 'Gravitational fields', 13, 26, [
    ['13.1', [
      'understand that a gravitational field is an example of a field of force and define gravitational field as force per unit mass',
      'represent a gravitational field by means of field lines',
    ]],
    ['13.2', [
      'understand that, for a point outside a uniform sphere, the mass of the sphere may be considered to be a point mass at its centre',
      'recall and use Newton’s law of gravitation F = Gm₁m₂ / r² for the force between two point masses',
      'analyse circular orbits in gravitational fields by relating the gravitational force to the centripetal acceleration it causes',
      'understand that a satellite in a geostationary orbit remains at the same point above the Earth’s surface, with an orbital period of 24 hours, orbiting from west to east, directly above the Equator',
    ]],
    ['13.3', [
      'derive, from Newton’s law of gravitation and the definition of gravitational field, the equation g = GM / r² for the gravitational field strength due to a point mass',
      'recall and use g = GM / r²',
      'understand why g is approximately constant for small changes in height near the Earth’s surface',
    ]],
    ['13.4', [
      'define gravitational potential at a point as the work done per unit mass in bringing a small test mass from infinity to the point',
      'use ϕ = −GM / r for the gravitational potential in the field due to a point mass',
      'understand how the concept of gravitational potential leads to the gravitational potential energy of two point masses and use Eₚ = −GMm / r',
    ]],
  ]),
  topic(14, 'Temperature', 14, 27, [
    ['14.1', [
      'understand that (thermal) energy is transferred from a region of higher temperature to a region of lower temperature',
      'understand that regions of equal temperature are in thermal equilibrium',
    ]],
    ['14.2', [
      'understand that a physical property that varies with temperature may be used for the measurement of temperature and state examples of such properties, including the density of a liquid, volume of a gas at constant pressure, resistance of a metal, e.m.f. of a thermocouple',
      'understand that the scale of thermodynamic temperature does not depend on the property of any particular substance',
      'convert temperatures between kelvin and degrees Celsius and recall that T / K = θ / °C + 273.15',
      'understand that the lowest possible temperature is zero kelvin on the thermodynamic temperature scale and that this is known as absolute zero',
    ]],
    ['14.3', [
      'define and use specific heat capacity',
      'define and use specific latent heat and distinguish between specific latent heat of fusion and specific latent heat of vaporisation',
    ]],
  ]),
  topic(15, 'Ideal gases', 15, 28, [
    ['15.1', [
      'understand that amount of substance is an SI base quantity with the base unit mol',
      'use molar quantities where one mole of any substance is the amount containing a number of particles of that substance equal to the Avogadro constant Nₐ',
    ]],
    ['15.2', [
      'understand that a gas obeying pV ∝ T, where T is the thermodynamic temperature, is known as an ideal gas',
      'recall and use the equation of state for an ideal gas expressed as pV = nRT, where n = amount of substance (number of moles) and as pV = NkT, where N = number of molecules',
      'recall that the Boltzmann constant k is given by k = R / Nₐ',
    ]],
    ['15.3', [
      'state the basic assumptions of the kinetic theory of gases',
      'explain how molecular movement causes the pressure exerted by a gas and derive and use the relationship pV = ⅓Nm⟨c²⟩, where ⟨c²⟩ is the mean-square speed',
      'understand that the root-mean-square speed cᵣ.ₘ.ₛ. is given by √⟨c²⟩',
      'compare pV = ⅓Nm⟨c²⟩ with pV = NkT to deduce that the average translational kinetic energy of a molecule is 3/2 kT, and recall and use this expression',
    ]],
  ]),
  topic(16, 'Thermodynamics', 16, 29, [
    ['16.1', [
      'understand that internal energy is determined by the state of the system and that it can be expressed as the sum of a random distribution of kinetic and potential energies associated with the molecules of a system',
      'relate a rise in temperature of an object to an increase in its internal energy',
    ]],
    ['16.2', [
      'recall and use W = pΔV for the work done when the volume of a gas changes at constant pressure and understand the difference between the work done by the gas and the work done on the gas',
      'recall and use the first law of thermodynamics ΔU = q + W expressed in terms of the increase in internal energy, the heating of the system (energy transferred to the system by heating) and the work done on the system',
    ]],
  ]),
  topic(17, 'Oscillations', 17, 29, [
    ['17.1', [
      'understand and use the terms displacement, amplitude, period, frequency, angular frequency and phase difference in the context of oscillations, and express the period in terms of both frequency and angular frequency',
      'understand that simple harmonic motion occurs when acceleration is proportional to displacement from a fixed point and in the opposite direction',
      'use a = −ω²x and recall and use, as a solution to this equation, x = x₀ sin ωt',
      'use the equations v = v₀ cos ωt and v = ±ω√(x₀² − x²)',
      'analyse and interpret graphical representations of the variations of displacement, velocity and acceleration for simple harmonic motion',
    ]],
    ['17.2', [
      'describe the interchange between kinetic and potential energy during simple harmonic motion',
      'recall and use E = ½mω²x₀² for the total energy of a system undergoing simple harmonic motion',
    ]],
    ['17.3', [
      'understand that a resistive force acting on an oscillating system causes damping',
      'understand and use the terms light, critical and heavy damping and sketch displacement–time graphs illustrating these types of damping',
      'understand that resonance involves a maximum amplitude of oscillations and that this occurs when an oscillating system is forced to oscillate at its natural frequency',
    ]],
  ]),
  topic(18, 'Electric fields', 18, 30, [
    ['18.1', [
      'understand that an electric field is an example of a field of force and define electric field as force per unit positive charge',
      'recall and use F = qE for the force on a charge in an electric field',
      'represent an electric field by means of field lines',
    ]],
    ['18.2', [
      'recall and use E = ΔV / Δd to calculate the field strength of the uniform field between charged parallel plates',
      'describe the effect of a uniform electric field on the motion of charged particles',
    ]],
    ['18.3', [
      'understand that, for a point outside a spherical conductor, the charge on the sphere may be considered to be a point charge at its centre',
      'recall and use Coulomb’s law F = Q₁Q₂ / (4πε₀r²) for the force between two point charges in free space',
    ]],
    ['18.4', [
      'recall and use E = Q / (4πε₀r²) for the electric field strength due to a point charge in free space',
    ]],
    ['18.5', [
      'define electric potential at a point as the work done per unit positive charge in bringing a small test charge from infinity to the point',
      'recall and use the fact that the electric field at a point is equal to the negative of potential gradient at that point',
      'use V = Q / (4πε₀r) for the electric potential in the field due to a point charge',
      'understand how the concept of electric potential leads to the electric potential energy of two point charges and use Eₚ = Qq / (4πε₀r)',
    ]],
  ]),
  topic(19, 'Capacitance', 19, 31, [
    ['19.1', [
      'define capacitance, as applied to both isolated spherical conductors and to parallel plate capacitors',
      'recall and use C = Q / V',
      'derive, using C = Q / V, formulae for the combined capacitance of capacitors in series and in parallel',
      'use the capacitance formulae for capacitors in series and in parallel',
    ]],
    ['19.2', [
      'determine the electric potential energy stored in a capacitor from the area under the potential–charge graph',
      'recall and use W = ½QV = ½CV²',
    ]],
    ['19.3', [
      'analyse graphs of the variation with time of potential difference, charge and current for a capacitor discharging through a resistor',
      'recall and use τ = RC for the time constant for a capacitor discharging through a resistor',
      'use equations of the form x = x₀e⁻⁽ᵗ⧸ᴿᶜ⁾ where x could represent current, charge or potential difference',
    ]],
  ]),
  topic(20, 'Magnetic fields', 20, 32, [
    ['20.1', [
      'understand that a magnetic field is an example of a field of force produced either by moving charges or by permanent magnets',
      'represent a magnetic field by field lines',
    ]],
    ['20.2', [
      'understand that a force might act on a current-carrying conductor placed in a magnetic field',
      'recall and use the equation F = BIL sin θ, with directions as interpreted by Fleming’s left-hand rule',
      'define magnetic flux density as the force acting per unit current per unit length on a wire placed at right-angles to the magnetic field',
    ]],
    ['20.3', [
      'determine the direction of the force on a charge moving in a magnetic field',
      'recall and use F = BQv sin θ',
      'understand the origin of the Hall voltage and derive and use the expression Vᴴ = BI / (ntq), where t = thickness',
      'understand the use of a Hall probe to measure magnetic flux density',
      'describe the motion of a charged particle moving in a uniform magnetic field perpendicular to the direction of motion of the particle',
      'explain how electric and magnetic fields can be used in velocity selection',
    ]],
    ['20.4', [
      'sketch magnetic field patterns due to the currents in a long straight wire, a flat circular coil and a long solenoid',
      'understand that the magnetic field due to the current in a solenoid is increased by a ferrous core',
      'explain the origin of the forces between current-carrying conductors and determine the direction of the forces',
    ]],
    ['20.5', [
      'define magnetic flux as the product of the magnetic flux density and the cross-sectional area perpendicular to the direction of the magnetic flux density',
      'recall and use Φ = BA',
      'understand and use the concept of magnetic flux linkage',
      'understand and explain experiments that demonstrate that a changing magnetic flux can induce an e.m.f. in a circuit, that the induced e.m.f. is in such a direction as to oppose the change producing it, and the factors affecting the magnitude of the induced e.m.f.',
      'recall and use Faraday’s and Lenz’s laws of electromagnetic induction',
    ]],
  ]),
  topic(21, 'Alternating currents', 21, 34, [
    ['21.1', [
      'understand and use the terms period, frequency and peak value as applied to an alternating current or voltage',
      'use equations of the form x = x₀ sin ωt representing a sinusoidally alternating current or voltage',
      'recall and use the fact that the mean power in a resistive load is half the maximum power for a sinusoidal alternating current',
      'distinguish between root-mean-square (r.m.s.) and peak values and recall and use Iᵣ.ₘ.ₛ. = I₀ / √2 and Vᵣ.ₘ.ₛ. = V₀ / √2 for a sinusoidal alternating current',
    ]],
    ['21.2', [
      'distinguish graphically between half-wave and full-wave rectification',
      'explain the use of a single diode for the half-wave rectification of an alternating current',
      'explain the use of four diodes (bridge rectifier) for the full-wave rectification of an alternating current',
      'analyse the effect of a single capacitor in smoothing, including the effect of the values of capacitance and the load resistance',
    ]],
  ]),
  topic(22, 'Quantum physics', 22, 34, [
    ['22.1', [
      'understand that electromagnetic radiation has a particulate nature',
      'understand that a photon is a quantum of electromagnetic energy',
      'recall and use E = hf',
      'use the electronvolt (eV) as a unit of energy',
      'understand that a photon has momentum and that the momentum is given by p = E / c',
    ]],
    ['22.2', [
      'understand that photoelectrons may be emitted from a metal surface when it is illuminated by electromagnetic radiation',
      'understand and use the terms threshold frequency and threshold wavelength',
      'explain photoelectric emission in terms of photon energy and work function energy',
      'recall and use hf = Φ + ½mvₘₐₓ²',
      'explain why the maximum kinetic energy of photoelectrons is independent of intensity, whereas the photoelectric current is proportional to intensity',
    ]],
    ['22.3', [
      'understand that the photoelectric effect provides evidence for a particulate nature of electromagnetic radiation while phenomena such as interference and diffraction provide evidence for a wave nature',
      'describe and interpret qualitatively the evidence provided by electron diffraction for the wave nature of particles',
      'understand the de Broglie wavelength as the wavelength associated with a moving particle',
      'recall and use λ = h / p',
    ]],
    ['22.4', [
      'understand that there are discrete electron energy levels in isolated atoms (e.g. atomic hydrogen)',
      'understand the appearance and formation of emission and absorption line spectra',
      'recall and use hf = E₁ − E₂',
    ]],
  ]),
  topic(23, 'Nuclear physics', 23, 36, [
    ['23.1', [
      'understand the equivalence between energy and mass as represented by E = mc² and recall and use this equation',
      'represent simple nuclear reactions by nuclear equations, such as ¹⁴₇N + ⁴₂He → ¹⁷₈O + ¹₁H',
      'define and use the terms mass defect and binding energy',
      'sketch the variation of binding energy per nucleon with nucleon number',
      'explain what is meant by nuclear fusion and nuclear fission',
      'explain the relevance of binding energy per nucleon to nuclear reactions, including nuclear fusion and nuclear fission',
      'calculate the energy released in nuclear reactions using E = c²Δm',
    ]],
    ['23.2', [
      'understand that fluctuations in count rate provide evidence for the random nature of radioactive decay',
      'understand that radioactive decay is both spontaneous and random',
      'define activity and decay constant, and recall and use A = λN',
      'define half-life',
      'use λ = 0.693 / t₁⧸₂',
      'understand the exponential nature of radioactive decay, and sketch and use the relationship x = x₀e⁻λᵗ, where x could be activity, number of undecayed nuclei or received count rate',
    ]],
  ]),
  topic(24, 'Medical physics', 24, 37, [
    ['24.1', [
      'understand that a piezo-electric crystal changes shape when a p.d. is applied across it and that the crystal generates an e.m.f. when its shape changes',
      'understand how ultrasound waves are generated and detected by a piezoelectric transducer',
      'understand how the reflection of pulses of ultrasound at boundaries between tissues can be used to obtain diagnostic information about internal structures',
      'define the specific acoustic impedance of a medium as Z = ρc, where c is the speed of sound in the medium',
      'use Iᴿ / I₀ = (Z₁ − Z₂)² / (Z₁ + Z₂)² for the intensity reflection coefficient of a boundary between two media',
      'recall and use I = I₀e⁻μˣ for the attenuation of ultrasound in matter',
    ]],
    ['24.2', [
      'explain that X-rays are produced by electron bombardment of a metal target and calculate the minimum wavelength of X-rays produced from the accelerating p.d.',
      'understand the use of X-rays in imaging internal body structures, including an understanding of the term contrast in X-ray imaging',
      'recall and use I = I₀e⁻μˣ for the attenuation of X-rays in matter',
      'understand that computed tomography (CT) scanning produces a 3D image of an internal structure by first combining multiple X-ray images taken in the same section from different angles to obtain a 2D image of the section, then repeating this process along an axis and combining 2D images of multiple sections',
    ]],
    ['24.3', [
      'understand that a tracer is a substance containing radioactive nuclei that can be introduced into the body and is then absorbed by the tissue being studied',
      'recall that a tracer that decays by β⁺ decay is used in positron emission tomography (PET scanning)',
      'understand that annihilation occurs when a particle interacts with its antiparticle and that mass–energy and momentum are conserved in the process',
      'explain that, in PET scanning, positrons emitted by the decay of the tracer annihilate when they interact with electrons in the tissue, producing a pair of gamma-ray photons travelling in opposite directions',
      'calculate the energy of the gamma-ray photons emitted during the annihilation of an electron–positron pair',
      'understand that the gamma-ray photons from an annihilation event travel outside the body and can be detected, and an image of the tracer concentration in the tissue can be created by processing the arrival times of the gamma-ray photons',
    ]],
  ]),
  topic(25, 'Astronomy and cosmology', 25, 38, [
    ['25.1', [
      'understand the term luminosity as the total power of radiation emitted by a star',
      'recall and use the inverse square law for radiant flux intensity F in terms of the luminosity L of the source F = L / (4πd²)',
      'understand that an object of known luminosity is called a standard candle',
      'understand the use of standard candles to determine distances to galaxies',
    ]],
    ['25.2', [
      'recall and use Wien’s displacement law λₘₐₓ ∝ 1 / T to estimate the peak surface temperature of a star',
      'use the Stefan–Boltzmann law L = 4πσr²T⁴',
      'use Wien’s displacement law and the Stefan–Boltzmann law to estimate the radius of a star',
    ]],
    ['25.3', [
      'understand that the lines in the emission and absorption spectra from distant objects show an increase in wavelength from their known values',
      'use Δλ / λ ≈ Δf / f ≈ v / c for the redshift of electromagnetic radiation from a source moving relative to an observer',
      'explain why redshift leads to the idea that the Universe is expanding',
      'recall and use Hubble’s law v ≈ H₀d and explain how this leads to the Big Bang theory (candidates will only be required to use SI units)',
    ]],
  ]),
])

export const CAMBRIDGE_9702_A2_SYLLABUS = Object.freeze({
  ...CAMBRIDGE_9702_A2_SYLLABUS_SOURCE,
  routeId: ROUTE_ID,
  topics: CAMBRIDGE_9702_A2_TOPICS,
  points: Object.freeze(CAMBRIDGE_9702_A2_TOPICS.flatMap((item) => item.points)),
})
