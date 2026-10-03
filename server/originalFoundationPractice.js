import crypto from 'node:crypto'

import { routeById } from '../src/data/routeRegistry.js'
import { SYLLABUS_PRACTICE_ROUTE_IDS } from '../src/lib/syllabusPracticeRoutes.js'

export const ORIGINAL_FOUNDATION_SCHEMA_VERSION = 'stem-original-foundation-question-v1'
export const ORIGINAL_FOUNDATION_CATALOG_VERSION = 'v1'
export const ORIGINAL_FOUNDATION_SOURCE_KIND = 'original-foundation'
export const ORIGINAL_FOUNDATION_SOURCE_AUTHORITY = 'original-foundation-catalog'
export const ORIGINAL_FOUNDATION_DISPLAY_LABEL = '原创基础练习'
export const ORIGINAL_FOUNDATION_SUBMISSION_ENDPOINT = '/api/stem/original-foundation/submit'

const ORIGINAL_FOUNDATION_ROUTE_TOPIC_STATEMENTS = Object.freeze({
  'cie-0580-igcse-mathematics:0580-igcse-topic-01': 'Number work uses place value, arithmetic, proportional reasoning and representations such as fractions, percentages and standard form.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-02': 'Algebra represents relationships with symbols, while graphs show how one variable changes with another.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-03': 'Coordinate geometry connects algebra and shape through gradients, coordinates and equations of lines.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-04': 'Geometry uses defined properties, angle facts, congruence, similarity and constructions to reason about shapes.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-05': 'Mensuration calculates lengths, areas, surface areas and volumes using consistent units.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-06': 'Trigonometry relates angles and side lengths, with Pythagoras’ theorem supporting right-triangle calculations.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-07': 'Transformations describe changes of position or size, while vectors encode magnitude and direction.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-08': 'Probability measures uncertainty on a scale from 0 to 1 and combines outcomes using consistent event rules.',
  'cie-0580-igcse-mathematics:0580-igcse-topic-09': 'Statistics collects, represents and interprets data using suitable summaries, diagrams and measures of spread.',
})

const ORIGINAL_FOUNDATION_TOPIC_ID_STATEMENTS = Object.freeze({
  '9709-p1-topic-05': 'For all angles where they are defined, tan θ = sin θ / cos θ and sin² θ + cos² θ = 1.',
  '9709-p2-topic-03': 'The identities sec² θ = 1 + tan² θ and cosec² θ = 1 + cot² θ extend trigonometric simplification beyond sine and cosine.',
  '9709-p1-topic-07': 'A derivative gives the instantaneous gradient or rate of change, and stationary points occur where the first derivative is zero.',
  '9709-p2-topic-04': 'Products, quotients, implicit relations and parametric equations require differentiation rules beyond the basic power rule.',
  '9709-p1-topic-08': 'A definite integral represents signed accumulation and can calculate an area when the relevant function stays above the axis.',
  '9709-p2-topic-05': 'Integration of exponential, reciprocal and trigonometric forms extends reverse differentiation beyond powers of x.',
})

const ORIGINAL_FOUNDATION_QUESTION_SPECS = Object.freeze({
  'Further Pure Mathematics 1': Object.freeze({
    prompt: 'Which statement about a 2 × 2 matrix representing a plane transformation is correct?',
    correct: 'Its determinant is the signed area scale factor, and determinant zero means the transformation is singular.',
    distractors: Object.freeze(['Its determinant is always the sum of its four entries.', 'A matrix with non-zero determinant has no inverse.', 'Every 2 × 2 matrix maps all input vectors to the same output vector.']),
  }),
  'Further Mechanics': Object.freeze({
    prompt: 'Which statement correctly links resultant impulse and momentum?',
    correct: 'The resultant impulse over a time interval equals the change in momentum over that interval.',
    distractors: Object.freeze(['Resultant impulse equals momentum divided by elapsed time.', 'Zero resultant impulse requires both initial and final momentum to be zero.', 'Impulse is a scalar and therefore has no direction.']),
  }),
  'Further Probability and Statistics': Object.freeze({
    prompt: 'When is a statistic T an unbiased estimator of a population parameter θ?',
    correct: 'T is unbiased when its expected value satisfies E(T) = θ.',
    distractors: Object.freeze(['T is unbiased only when E(T) = 0.', 'T is unbiased when Var(T) = θ.', 'T is unbiased only when every sample gives T = θ exactly.']),
  }),
  'Further Pure Mathematics 2': Object.freeze({
    prompt: 'For z = r(cos θ + i sin θ) with r > 0, what does θ represent?',
    correct: 'θ is an argument of z, measured as an angle from the positive real axis.',
    distractors: Object.freeze(['θ is the modulus of z.', 'θ is always the imaginary part of z.', 'θ is the argument of the conjugate of z with the same sign in every quadrant.']),
  }),
  'Further Mechanics when selected for A Level completion': Object.freeze({
    prompt: 'Which statement correctly links resultant impulse and momentum?',
    correct: 'The resultant impulse over a time interval equals the change in momentum over that interval.',
    distractors: Object.freeze(['Resultant impulse equals momentum divided by elapsed time.', 'Zero resultant impulse requires both initial and final momentum to be zero.', 'Impulse is a scalar and therefore has no direction.']),
  }),
  'Further Probability and Statistics when selected for A Level completion': Object.freeze({
    prompt: 'When is a statistic T an unbiased estimator of a population parameter θ?',
    correct: 'T is unbiased when its expected value satisfies E(T) = θ.',
    distractors: Object.freeze(['T is unbiased only when E(T) = 0.', 'T is unbiased when Var(T) = θ.', 'T is unbiased only when every sample gives T = θ exactly.']),
  }),
})

const ORIGINAL_FOUNDATION_STATEMENTS = Object.freeze({
  Algebra: 'Algebra uses symbols and equivalence-preserving operations to solve equations, inequalities and polynomial relationships.',
  'Alternating currents': 'An alternating current reverses direction periodically, and its root-mean-square value gives the equivalent heating effect of a direct current.',
  'Astronomy and cosmology': 'Cosmological redshift and the distance–recession relationship provide evidence that the Universe is expanding.',
  Calculus: 'Differentiation measures instantaneous change, while integration measures accumulation and reverses differentiation under suitable conditions.',
  Capacitance: 'Capacitance is charge stored per unit potential difference, expressed by C = Q / V.',
  'Complex numbers': 'A complex number has the form a + bi with i² = -1 and can be represented by a point on an Argand diagram.',
  'Continuous random variables': 'For a continuous random variable, probability is area under a probability-density curve and the total area is 1.',
  'Coordinate geometry': 'Coordinate geometry represents lines and curves algebraically so gradients, intersections and distances can be calculated.',
  'D.C. circuits': 'In a direct-current circuit, charge flow, potential difference and resistance are linked by conservation laws and component characteristics.',
  'Deformation of solids': 'Within the linear elastic region, stress is proportional to strain and their ratio is Young modulus.',
  'Differential equations': 'A differential equation relates a quantity to one or more of its derivatives and can model how a system changes.',
  Differentiation: 'The derivative of a function gives its instantaneous rate of change and the gradient of its tangent.',
  'Discrete random variables': 'A discrete random variable takes countable values whose probabilities add to 1.',
  Dynamics: 'Dynamics links motion to resultant force through Newton’s laws, including F = ma for constant mass.',
  'Electric fields': 'Electric field strength is force per unit positive test charge, E = F / Q.',
  Electricity: 'Electric current is rate of charge flow, while potential difference is energy transferred per unit charge.',
  'Electricity and magnetism': 'Electric currents create magnetic fields, and magnetic fields can exert forces on currents and moving charges.',
  'Energy, work and power': 'Work transfers energy, and power is the rate at which work is done or energy is transferred.',
  'Equations, inequalities and graphs': 'Solutions of equations can appear as roots or graph intersections, while inequalities describe regions of allowed values.',
  'Forces and equilibrium': 'A body is in translational equilibrium when the vector sum of all forces on it is zero.',
  'Forces, density and pressure': 'Density is mass per unit volume, while pressure is normal force per unit area.',
  Functions: 'A function maps each input in its domain to exactly one output; inverse functions reverse one-to-one mappings.',
  'Gravitational fields': 'Gravitational field strength is force per unit mass and points toward the attracting mass.',
  'Hypothesis tests': 'A hypothesis test compares a result with a null-hypothesis distribution using a stated significance level and tail.',
  'Ideal gases': 'For a fixed amount of ideal gas, pressure, volume and absolute temperature are related by pV = nRT.',
  'Indices, surds and logarithms': 'Index laws govern powers, surds keep irrational roots exact, and logarithms invert exponentiation.',
  Integration: 'Integration accumulates quantities and is the reverse of differentiation up to a constant for indefinite integrals.',
  Kinematics: 'Kinematics describes motion using displacement, velocity and acceleration without considering the forces causing it.',
  'Kinematics of motion in a straight line': 'For straight-line motion, velocity is the rate of change of displacement and acceleration is the rate of change of velocity.',
  'Linear combinations of random variables': 'Expectations combine linearly, while variances of independent variables add with squared scale factors.',
  'Magnetic fields': 'A magnetic field exerts a force on a moving charge or current when the motion is not parallel to the field.',
  'Medical physics': 'Medical imaging and treatment use interactions of radiation, ultrasound or magnetic fields with tissue under controlled exposure.',
  Momentum: 'Momentum is p = mv and total momentum is conserved in an isolated system.',
  'Motion in a circle': 'Uniform circular motion has centripetal acceleration directed toward the centre with magnitude v² / r.',
  'Motion, forces and energy': 'Changes in motion follow from resultant forces, while energy transfers account for work done in the system.',
  "Newton's laws of motion": 'A resultant force changes momentum, and interacting bodies exert equal and opposite forces on each other.',
  'Nuclear physics': 'Radioactive decay is random for an individual nucleus but follows a predictable exponential law for a large sample.',
  'Numerical solution of equations': 'An iterative numerical method approximates a root and must be checked for convergence and suitable accuracy.',
  Oscillations: 'In simple harmonic motion, acceleration is proportional to displacement and directed toward equilibrium.',
  'Particle physics': 'Matter particles are classified as quarks and leptons, and reactions must obey conservation laws.',
  'Physical quantities and units': 'A physical quantity is reported as a numerical value with a unit, and coherent SI units preserve equation consistency.',
  Probability: 'Probability assigns values from 0 to 1 to events and combines mutually exclusive or independent events with different rules.',
  Quadratics: 'For ax² + bx + c, the discriminant b² - 4ac determines the number of real roots.',
  'Quadratics and polynomials': 'Polynomial roots, factors and graph intersections are linked by the factor theorem and algebraic equivalence.',
  'Quantum physics': 'A photon has energy E = hf, showing that electromagnetic energy is exchanged in discrete quanta.',
  'Representation of data': 'A useful data representation matches the variable type and preserves information about centre, spread and possible outliers.',
  'Sampling and estimation': 'A statistic calculated from a sample estimates a population parameter and carries sampling uncertainty.',
  Series: 'A sequence lists terms in order, while a series is their sum; convergence determines whether an infinite sum approaches a finite value.',
  'Space physics': 'Orbital motion results from gravity providing the centripetal acceleration of an object moving around another body.',
  'Straight-line graphs': 'For y = mx + c, m is the gradient and c is the vertical intercept.',
  Superposition: 'When waves overlap, the resultant displacement is the vector sum of their individual displacements.',
  Temperature: 'Thermodynamic temperature is measured from absolute zero and is linked to the average kinetic energy of particles.',
  'The Poisson distribution': 'A Poisson model describes independent events occurring at a constant mean rate in a fixed interval.',
  'The normal distribution': 'A normal distribution is symmetric about its mean and is fully determined by its mean and variance.',
  'Thermal physics': 'Thermal behaviour depends on internal energy, temperature and energy transfer by heating or work.',
  Thermodynamics: 'The first law of thermodynamics relates change in internal energy to heating and work done.',
  Trigonometry: 'Trigonometric functions relate angles to ratios and coordinates, while identities support exact simplification and equation solving.',
  Vectors: 'A vector has magnitude and direction and combines component-wise according to vector addition.',
  Waves: 'Wave speed, frequency and wavelength are related by v = fλ.',
  'Work, energy and power': 'Work done equals energy transferred, and power is energy transferred per unit time.',
  'Factors of polynomials': 'The factor theorem states that (x - a) is a factor of f(x) exactly when f(a) = 0.',
  'Simultaneous equations': 'A solution of simultaneous equations must satisfy every equation in the system at the same time.',
  'Logarithmic and exponential functions': 'Logarithms invert exponentiation, so logarithm laws follow from the corresponding index laws.',
  'Circular measure': 'When an angle is measured in radians, arc length is s = rθ and sector area is one half r²θ.',
  'Permutations and combinations': 'Permutations count ordered arrangements, while combinations count selections for which order does not matter.',
  'Characteristics and classification': 'Classification groups organisms by shared characteristics and, in modern systems, their evolutionary relationships.',
  'Organisation of the organism': 'Cells form tissues, tissues form organs, and organs work together in organ systems.',
  'Movement in and out of cells': 'Diffusion is net particle movement down a concentration gradient, while osmosis concerns water across a partially permeable membrane.',
  'Biological molecules': 'Carbohydrates, lipids and proteins have different structures and distinct roles in living organisms.',
  Enzymes: 'An enzyme is a biological catalyst whose active site gives it specificity for particular substrates.',
  'Plant nutrition': 'Photosynthesis transfers light energy into chemical energy stored in organic molecules.',
  'Human nutrition': 'Digestion breaks large insoluble food molecules into small soluble molecules that can be absorbed.',
  Transport: 'Multicellular organisms use transport systems to move substances between exchange surfaces and cells.',
  'Diseases and immunity': 'Pathogens cause communicable disease, while immune responses identify and act against foreign antigens.',
  'Gas exchange': 'Efficient gas-exchange surfaces provide a large area, a short diffusion distance and maintained concentration gradients.',
  Respiration: 'Respiration is a set of reactions that releases usable energy from nutrients; aerobic respiration uses oxygen.',
  Excretion: 'Excretion removes toxic materials, metabolic waste and substances present in excess of requirements.',
  'Coordination and response': 'Coordinated responses link a stimulus detected by receptors to actions by effectors through nervous or hormonal signalling.',
  Reproduction: 'Reproduction produces new organisms and transfers genetic information to the next generation.',
  Inheritance: 'Inherited characteristics depend on alleles, which are alternative forms of genes carried on DNA.',
  'Variation and selection': 'Natural selection changes populations when heritable variants differ in survival and reproductive success.',
  'Organisms and their environment': 'Ecosystems contain interacting organisms and environments through which energy flows and nutrients cycle.',
  'Human influences on ecosystems': 'Human activity can alter habitats, biodiversity, food webs and biogeochemical cycles.',
  'Biotechnology and genetic modification': 'Biotechnology uses organisms, cells or enzymes, while genetic modification deliberately changes an organism’s DNA.',
  'Cell structure': 'Cell ultrastructure links specialised organelles to functions such as protein synthesis, respiration and intracellular transport.',
  'Cell membranes and transport': 'The fluid-mosaic membrane controls movement by diffusion, facilitated diffusion, osmosis and active transport.',
  'The mitotic cell cycle': 'Mitosis separates replicated chromosomes to produce genetically identical daughter nuclei.',
  'Nucleic acids and protein synthesis': 'DNA base sequences are transcribed into RNA and translated to determine amino-acid sequences in proteins.',
  'Transport in plants': 'Xylem carries water and mineral ions, while phloem translocates assimilates between sources and sinks.',
  'Transport in mammals': 'A closed double circulation uses the heart and vessels to maintain mass flow between exchange surfaces and tissues.',
  'Infectious diseases': 'Infectious diseases result from transmissible pathogens, so control depends on interrupting transmission and host infection.',
  Immunity: 'Specific immunity depends on lymphocyte recognition, clonal selection and the production of memory cells.',
  'Biology:AS practical skills': 'Reliable biological investigations control variables, use suitable repeats and record quantitative observations with appropriate precision.',
  'Energy and respiration': 'ATP couples energy-releasing reactions to energy-requiring cellular processes, and respiration regenerates ATP.',
  Photosynthesis: 'Photosynthesis uses light-dependent reactions and carbon fixation to build organic molecules.',
  Homeostasis: 'Homeostasis maintains internal conditions near set points, commonly through negative-feedback control.',
  'Control and coordination': 'Nervous and endocrine systems coordinate responses through electrical impulses and chemical messengers.',
  'Selection and evolution': 'Selection acting on heritable variation can change allele frequencies and drive evolutionary change.',
  'Classification, biodiversity and conservation': 'Classification describes relationships, biodiversity measures biological variety, and conservation aims to protect that variety.',
  'Genetic technology': 'Genetic technology manipulates and analyses DNA for applications such as gene cloning, sequencing and modified organisms.',
  'Biology:A2 planning, analysis and evaluation': 'A sound biological investigation links a testable hypothesis to controlled methods, justified analysis and evidence-based evaluation.',
  'Atomic structure': 'Atomic number is the proton number, while isotopes have the same proton number but different neutron numbers.',
  'Atoms, molecules and stoichiometry': 'Stoichiometric calculations use balanced equations and amount of substance in moles to relate reacting quantities.',
  'Chemical bonding': 'Ionic, covalent and metallic bonding arise from electrostatic attractions in different particle arrangements.',
  'States of matter': 'Particle spacing, motion and intermolecular forces explain changes of state and many physical properties.',
  'Chemical energetics': 'An enthalpy change records heat transferred at constant pressure for a reaction as written.',
  Electrochemistry: 'Electrochemistry connects redox reactions with electron transfer and electrode potentials.',
  Equilibria: 'Dynamic equilibrium occurs when forward and reverse reactions continue at equal rates in a closed system.',
  'Reaction kinetics': 'Reaction rate depends on effective collision frequency and the activation-energy barrier.',
  Periodicity: 'Periodic trends arise from recurring electronic structures and changing nuclear attraction across the Periodic Table.',
  'Group 2': 'Group 2 metals form 2+ ions, and their reactions and compound properties show systematic trends down the group.',
  'Group 17': 'Halogens form halide ions, and their oxidising power generally decreases down Group 17.',
  'Nitrogen and sulfur': 'Nitrogen and sulfur chemistry links oxidation states, industrial processes and environmental effects of their compounds.',
  'AS organic chemistry': 'Organic reactions can be organised by functional groups, reagents, conditions and reaction mechanisms.',
  'AS analytical techniques': 'Mass spectrometry and infrared spectroscopy provide complementary evidence about molecular mass and functional groups.',
  'Chemistry:AS practical skills': 'Reliable chemical investigations use calibrated measurements, controlled variables and appropriate treatment of uncertainty and hazards.',
  'A2 energetics': 'Energetic feasibility can be analysed using enthalpy, entropy and Gibbs free-energy changes.',
  'Transition elements': 'Transition elements show variable oxidation states and form complexes because of their partially filled d subshells.',
  'A2 organic chemistry': 'Multi-step organic synthesis requires compatible reaction pathways, mechanisms and purification or identification evidence.',
  'A2 analytical techniques': 'NMR, chromatography and complementary spectra can be combined to distinguish and identify organic structures.',
  'Chemistry:A2 planning, analysis and evaluation': 'A sound chemical investigation justifies apparatus, controls variables, treats uncertainty and evaluates limitations using the data.',
  'Basic economic ideas and resource allocation': 'Scarcity forces choices, so allocating a resource to one use creates an opportunity cost.',
  'The price system and the microeconomy': 'Market price and quantity are shaped by demand, supply and the incentives created by price changes.',
  'Government microeconomic intervention': 'Microeconomic intervention uses measures such as taxes, subsidies, regulation or price controls to address market outcomes.',
  'The macroeconomy': 'Macroeconomic performance is assessed with indicators such as growth, inflation, unemployment and the external balance.',
  'Government macroeconomic intervention': 'Fiscal, monetary and supply-side policies influence aggregate demand, productive capacity and macroeconomic objectives.',
  'International economic issues': 'Trade, exchange rates and international payments connect domestic choices with the global economy.',
})

const ORIGINAL_FOUNDATION_WITHIN_TOPIC_DISTRACTORS = Object.freeze({
  Number: ['Multiplying a number by zero leaves that number unchanged.', 'A percentage increase of p% is always undone by a decrease of p%.', 'Standard form requires the leading number to be at least 10.'],
  'Algebra and graphs': ['Adding the same value to one side only preserves an equation.', 'A vertical line always represents a single-valued function of x.', 'Expanding an expression changes the values it represents.'],
  'Coordinate geometry': ['Parallel non-vertical lines must have reciprocal gradients.', 'The gradient of a horizontal line is undefined.', 'Two distinct parallel lines have the same vertical intercept.'],
  Geometry: ['The angles of every quadrilateral sum to 180 degrees.', 'Congruent shapes may have different corresponding side lengths.', 'Similar shapes must have equal areas.'],
  Mensuration: ['Area is measured in linear units.', 'Doubling every length leaves volume unchanged.', 'A circle of radius r has circumference πr.'],
  Trigonometry: ['For every angle, sin² θ + cos² θ = 0.', 'tan θ is defined as cos θ divided by sin θ.', 'Sine, cosine and tangent all have period 360 degrees.'],
  'Transformations and vectors': ['A translation changes a shape’s size.', 'A rotation has no centre.', 'A vector records magnitude but never direction.'],
  Probability: ['A probability may be greater than 1 for a likely event.', 'Probabilities of all outcomes in a complete sample space sum to 0.', 'Independent events can never occur together.'],
  Statistics: ['The mean is unaffected by every extreme value.', 'A scatter diagram proves that one variable causes the other.', 'The range is found by adding the largest and smallest values.'],
  Functions: ['A function may assign several outputs to the same input.', 'Every function has an inverse on its original domain.', 'The domain is the set of output values only.'],
  'Quadratics and polynomials': ['A quadratic polynomial always has two distinct real roots.', 'If f(a) is non-zero, then x - a must be a factor of f(x).', 'Changing a polynomial into an equivalent factorised form changes its roots.'],
  'Equations, inequalities and graphs': ['Multiplying an inequality by a negative number keeps its direction unchanged.', 'Every pair of graphs intersects exactly once.', 'A root of f(x) occurs where its graph crosses the y-axis.'],
  'Indices, surds and logarithms': ['a^m multiplied by a^n equals a^(mn).', 'A surd is always a rational number.', 'log(ab) equals log(a) multiplied by log(b).'],
  'Factors of polynomials': ['x - a is a factor of f(x) whenever f(a) is non-zero.', 'A polynomial remainder can never be zero.', 'A cubic polynomial cannot have a linear factor.'],
  'Simultaneous equations': ['A valid solution needs to satisfy only one equation in the system.', 'Two distinct parallel lines have exactly one simultaneous solution.', 'Substitution may change one equation without preserving equivalence.'],
  'Logarithmic and exponential functions': ['A logarithm multiplies a number by its base.', 'log(a + b) always equals log a + log b.', 'An exponential function with positive base always takes negative values.'],
  'Straight-line graphs': ['In y = mx + c, c is the gradient.', 'Every vertical line has gradient zero.', 'Parallel lines must have different gradients.'],
  'Circular measure': ['One radian is exactly 180 degrees.', 'Arc length in radians is θ divided by r.', 'Sector area is always rθ.'],
  'Permutations and combinations': ['Combinations count arrangements where order matters.', 'nPr and nCr are equal for every n and r.', 'Choosing all n objects gives zero combinations.'],
  Series: ['A series is the list of terms before they are added.', 'Every infinite series has a finite sum.', 'A geometric sequence has a constant difference between terms.'],
  Vectors: ['Vectors can be added by adding their magnitudes only.', 'A zero vector has no defined components.', 'Parallel vectors must always point in opposite directions.'],
  Calculus: ['A derivative gives total accumulated area.', 'An indefinite integral never includes a constant.', 'Differentiation and integration cannot be inverse processes.'],
  'Motion, forces and energy': ['A moving object must have a non-zero resultant force.', 'Energy can be created whenever work is done.', 'An object with zero velocity must have zero acceleration.'],
  'Thermal physics': ['Temperature is the total internal energy stored in an object.', 'Heating always raises temperature even during a change of state.', 'Particles in a hotter body have lower average kinetic energy.'],
  Waves: ['Wave particles travel permanently with the wave from source to receiver.', 'Wave speed equals frequency divided by wavelength.', 'Frequency changes whenever a wave enters a new medium.'],
  'Electricity and magnetism': ['A stationary charge always experiences a magnetic force.', 'Conventional current flows from negative to positive outside a cell.', 'A current produces no magnetic field.'],
  'Nuclear physics': ['A particular unstable nucleus has a predictable exact decay time.', 'Half-life increases as a radioactive sample gets smaller.', 'Alpha radiation has greater penetration than gamma radiation.'],
  'Space physics': ['A stable circular orbit needs no acceleration.', 'Greater orbital speed always produces a smaller centripetal acceleration at fixed radius.', 'Gravity acts only on objects inside an atmosphere.'],
  'Physical quantities and units': ['A physical quantity is complete without a numerical value or unit.', 'Changing coherent units changes the physical law being measured.', 'All derived SI units are dimensionless.'],
  Kinematics: ['Kinematics determines motion only by calculating the forces causing it.', 'Velocity has magnitude but no direction.', 'Zero velocity always means zero acceleration.'],
  Dynamics: ['A constant non-zero resultant force produces constant velocity.', 'Newton’s second law states that force equals momentum.', 'Action and reaction forces act on the same body.'],
  'Forces, density and pressure': ['Density is volume divided by mass.', 'Pressure is force multiplied by area.', 'A body in equilibrium must have no forces acting on it.'],
  'Work, energy and power': ['Power is the total energy stored in an object.', 'Work is done whenever a force acts, even with no displacement.', 'Efficiency can be greater than 100 percent in an isolated system.'],
  'Deformation of solids': ['Young modulus is strain divided by stress.', 'Elastic deformation always remains after the force is removed.', 'The limit of proportionality means stress is zero.'],
  Superposition: ['Overlapping waves always cancel completely.', 'Resultant displacement is found by multiplying individual displacements.', 'Interference changes the frequency of each source wave.'],
  Electricity: ['Potential difference is charge transferred per unit energy.', 'Current is the amount of charge stored in a component.', 'Resistance has units of amperes.'],
  'D.C. circuits': ['Kirchhoff’s current law allows charge to disappear at a junction.', 'Components in series always have equal potential difference.', 'An ideal voltmeter has zero resistance.'],
  'Particle physics': ['Every hadron is an elementary lepton.', 'Quarks can be isolated individually under ordinary conditions.', 'Particle reactions need not conserve charge.'],
  'Motion in a circle': ['Centripetal acceleration points tangentially to the path.', 'At fixed speed, increasing radius increases v²/r.', 'Uniform circular motion has zero acceleration because speed is constant.'],
  'Gravitational fields': ['Gravitational field strength points away from a positive mass.', 'Gravitational force per unit charge defines field strength.', 'Gravity becomes repulsive between two ordinary masses.'],
  Temperature: ['Zero degrees Celsius is absolute zero.', 'Temperature measures the total number of particles in a body.', 'A higher thermodynamic temperature means lower average particle kinetic energy.'],
  'Ideal gases': ['Ideal-gas temperature may be inserted into pV = nRT in degrees Celsius.', 'At fixed temperature, increasing volume increases pressure.', 'Gas pressure is unrelated to molecular collisions.'],
  Thermodynamics: ['Internal energy can change only by heating, never by work.', 'The first law permits energy to be created inside a closed system.', 'An isothermal process always has zero energy transfer.'],
  Oscillations: ['In simple harmonic motion, acceleration points away from equilibrium.', 'The period of every oscillator increases with amplitude without exception.', 'At equilibrium in simple harmonic motion, speed is always zero.'],
  'Electric fields': ['Electric field strength is energy per unit mass.', 'The electric field direction is the force direction on a negative test charge.', 'Parallel field lines cross wherever the field is strongest.'],
  Capacitance: ['Capacitance is potential difference divided by charge.', 'A capacitor stores no energy when it carries charge.', 'Increasing plate separation always increases parallel-plate capacitance.'],
  'Magnetic fields': ['A charge at rest experiences the same magnetic force as a moving charge.', 'Magnetic force is greatest when motion is parallel to the field.', 'Magnetic field lines start on isolated magnetic monopoles.'],
  'Alternating currents': ['An alternating current keeps one direction but changes only magnitude.', 'The root-mean-square current is always twice the peak current.', 'A transformer operates with steady direct current in its primary coil.'],
  'Quantum physics': ['Photon energy decreases as frequency increases.', 'The photoelectric effect is explained by light transferring any arbitrarily small energy continuously.', 'All electrons emitted by light have identical kinetic energy regardless of frequency.'],
  'Medical physics': ['Ultrasound imaging uses ionising gamma photons.', 'Increasing absorbed radiation dose can never increase biological risk.', 'Magnetic-resonance imaging forms images using only X-ray absorption.'],
  'Astronomy and cosmology': ['Cosmological redshift shows distant galaxies are all moving toward Earth.', 'Hubble’s law states recession speed decreases with distance.', 'An expanding Universe requires galaxies to expand internally at the same rate.'],
  Quadratics: ['The discriminant b² - 4ac is always positive.', 'A repeated real root occurs when b² - 4ac is negative.', 'Completing the square changes the solutions of a quadratic.'],
  Differentiation: ['The derivative gives the total area under a curve.', 'Every stationary point is a maximum.', 'The derivative of x^n is n x^n.'],
  Integration: ['A definite integral is always positive.', 'An indefinite integral never needs a constant of integration.', 'Integration cannot recover a function from its derivative.'],
  Algebra: ['The modulus |x| is negative whenever x is negative.', 'A polynomial divided by a factor must leave a non-zero remainder.', 'Equivalent algebraic transformations change the solution set.'],
  'Numerical solution of equations': ['An iteration converges for every starting value.', 'A numerical root is exact after one step.', 'Convergence does not need to be checked when values appear stable.'],
  'Forces and equilibrium': ['Equilibrium requires every individual force to be zero.', 'A non-zero resultant force produces no acceleration.', 'Moments are irrelevant to rotational equilibrium.'],
  'Kinematics of motion in a straight line': ['Velocity is displacement multiplied by time.', 'Acceleration is the rate of change of position only.', 'The area under a velocity–time graph gives acceleration.'],
  Momentum: ['Momentum is mass divided by velocity.', 'Total momentum is conserved even when an external resultant force acts.', 'Impulse has no relation to change in momentum.'],
  "Newton's laws of motion": ['Action and reaction forces act on the same object.', 'A resultant force is required to maintain constant velocity.', 'Mass and acceleration are unrelated to resultant force.'],
  'Energy, work and power': ['Power is energy multiplied by time.', 'Work done is independent of displacement.', 'A machine can transfer more useful energy than its total input.'],
  'Representation of data': ['A pie chart is appropriate for every continuous distribution.', 'Changing class widths never affects frequency density.', 'A box plot shows every individual data value.'],
  'Discrete random variables': ['A discrete probability distribution may have probabilities summing to more than 1.', 'A discrete random variable must take every real value in an interval.', 'Expected value must be one of the possible observed values.'],
  'The normal distribution': ['A normal distribution is always skewed to the right.', 'Its mean and variance do not affect its shape or position.', 'Exactly half the observations must equal the mean.'],
  'Differential equations': ['A differential equation contains no derivatives.', 'Every differential equation has one solution without conditions.', 'Separating variables means adding both variables to the same side.'],
  'Complex numbers': ['The number i satisfies i² = 1.', 'A complex number cannot be plotted on a plane.', 'Every complex number has zero imaginary part.'],
  'The Poisson distribution': ['A Poisson process requires a rate that changes unpredictably within the interval.', 'Poisson events must occur in dependent pairs.', 'A Poisson random variable can take any negative integer value.'],
  'Linear combinations of random variables': ['Expectation is not linear for random variables.', 'For independent variables, variances combine using unsquared scale factors.', 'Adding a constant changes variance by the same constant.'],
  'Continuous random variables': ['A probability-density value is itself the probability at one exact point.', 'The total area under a probability-density curve may exceed 1.', 'A continuous random variable can take only integer values.'],
  'Sampling and estimation': ['A larger random sample always makes sampling uncertainty larger.', 'A sample statistic is the fixed population parameter itself.', 'A biased sampling method becomes unbiased merely by repeating it.'],
  'Hypothesis tests': ['The null hypothesis is accepted as certainly true whenever it is not rejected.', 'The significance level is chosen after seeing the result to guarantee rejection.', 'A two-tailed test places its whole critical region in one tail.'],
  'Characteristics and classification': ['Every organism belongs to the same kingdom because all cells share identical structures.', 'A binomial species name contains only one word.', 'Modern classification deliberately ignores evolutionary relationships.'],
  'Organisation of the organism': ['Organs combine to form cells.', 'A tissue is a group of unrelated organ systems.', 'Specialised cells cannot work together in a multicellular organism.'],
  'Movement in and out of cells': ['Diffusion is net movement from lower to higher concentration without an energy source.', 'Osmosis is the movement of solute through a fully permeable membrane.', 'Active transport can move substances only down their concentration gradient.'],
  'Biological molecules': ['Proteins are built from glycerol and fatty acids.', 'All carbohydrates must contain nitrogen.', 'Lipids dissolve freely in water because they are strongly polar.'],
  Enzymes: ['An enzyme is permanently consumed each time it catalyses a reaction.', 'Increasing temperature always increases enzyme activity without limit.', 'One enzyme active site binds every possible substrate equally well.'],
  'Plant nutrition': ['Green plants obtain glucose ready-made from the soil.', 'Carbon dioxide is produced rather than consumed during photosynthesis.', 'Chlorophyll prevents light energy from being absorbed.'],
  'Human nutrition': ['Bile is a digestive enzyme that hydrolyses proteins.', 'Most digested nutrients are absorbed through the stomach wall.', 'Humans digest cellulose completely with their own cellulase.'],
  Transport: ['Large multicellular organisms rely on diffusion alone across every internal distance.', 'Transport systems move substances only away from exchange surfaces.', 'Blood and plant vascular tissues have identical structures and contents.'],
  'Diseases and immunity': ['Antibiotics are effective against every viral infection.', 'Pathogens manufacture the antibodies that destroy them.', 'Vaccination works by causing the full disease with no immune memory.'],
  'Gas exchange': ['An efficient gas-exchange surface is thick and has a small area.', 'Ventilation removes every concentration gradient needed for diffusion.', 'Gas exchange requires active transport of all oxygen molecules.'],
  Respiration: ['Respiration occurs only in the lungs.', 'Anaerobic respiration releases more usable energy per glucose molecule than aerobic respiration.', 'Cells use respiration to destroy ATP without replacing it.'],
  Excretion: ['Excretion and egestion are the same removal process.', 'Carbon dioxide from respiration is not a metabolic waste product.', 'Kidneys remove only undigested food from the body.'],
  'Coordination and response': ['Effectors detect stimuli before receptors do.', 'Receptors carry out muscular and glandular responses.', 'Hormones travel only across synapses.'],
  Reproduction: ['Sexual reproduction always produces genetically identical offspring.', 'Gametes are normally diploid copies of body cells.', 'Asexual reproduction requires fusion of two gametes.'],
  Inheritance: ['Alleles are alternative forms of proteins rather than genes.', 'Environmental conditions can never influence phenotype.', 'Every mutation is harmful and immediately visible.'],
  'Variation and selection': ['Characteristics acquired during an individual’s lifetime are always inherited.', 'Individual organisms evolve their allele frequencies during one lifetime.', 'Natural selection gives every heritable variant equal reproductive success.'],
  'Organisms and their environment': ['Energy is recycled indefinitely through an ecosystem in the same way as mineral nutrients.', 'Decomposers create new energy rather than transferring chemical energy.', 'A population contains all species living in an ecosystem.'],
  'Human influences on ecosystems': ['Pollution always increases biodiversity.', 'Conservation requires removing every human activity from every habitat.', 'Deforestation has no effect on carbon storage or water cycling.'],
  'Biotechnology and genetic modification': ['Genetic modification changes an organism without altering DNA.', 'Enzymes and microorganisms have no role in biotechnology.', 'Every biotechnology process produces a genetically modified organism.'],
  'Cell structure': ['Ribosomes are membrane-bound organelles that release energy by respiration.', 'Mitochondria are the main site of protein translation.', 'Prokaryotic cells contain a nucleus surrounded by a nuclear envelope.'],
  'Cell membranes and transport': ['Cell-surface membranes allow every substance to cross at the same rate.', 'Active transport never requires metabolic energy.', 'Osmosis describes net movement of solute molecules through a membrane.'],
  'The mitotic cell cycle': ['Mitosis normally produces four genetically different haploid nuclei.', 'DNA replication occurs only after chromosome separation is complete.', 'Chromosome number is halved in every mitotic division.'],
  'Nucleic acids and protein synthesis': ['DNA uses uracil as one of its four bases.', 'A codon contains one nucleotide.', 'Translation copies DNA directly into DNA inside the nucleus.'],
  'Transport in plants': ['Xylem transports sucrose from sources to sinks.', 'Phloem vessels are dead hollow tubes used only for water movement.', 'Transpiration drives water from leaves down into roots.'],
  'Transport in mammals': ['All arteries carry deoxygenated blood.', 'Veins carry blood away from the heart.', 'Capillaries have thick multilayered walls to slow diffusion.'],
  'Infectious diseases': ['An infectious disease is always inherited genetically.', 'Antibiotics directly kill all viruses.', 'Interrupting transmission cannot reduce disease incidence.'],
  Immunity: ['Red blood cells make specific antibodies.', 'Memory cells make a secondary response slower than the primary response.', 'An antigen and an antibiotic are the same molecule.'],
  'AS practical skills': ['One uncontrolled reading is sufficient evidence for a reliable conclusion.', 'Measurements need no units when the apparatus is named.', 'An anomalous result should be deleted without investigation or justification.'],
  'Energy and respiration': ['ATP is a long-term genetic information store.', 'Glycolysis occurs only inside mitochondria and requires oxygen directly.', 'Aerobic respiration consumes ATP without regenerating it.'],
  Photosynthesis: ['Carbon dioxide is released as the carbon source for photosynthesis.', 'The light-independent reactions can proceed indefinitely without products from light-dependent reactions.', 'Chlorophyll reflects all useful wavelengths and absorbs no light energy.'],
  Homeostasis: ['Homeostasis keeps every internal variable perfectly constant with no fluctuation.', 'Negative feedback amplifies a deviation from the set point.', 'Effectors detect changes while receptors carry out the correction.'],
  'Control and coordination': ['Nerve impulses travel through blood plasma as hormones.', 'Endocrine responses are always faster and shorter-lived than nervous responses.', 'Hormones act equally on every cell whether or not it has the receptor.'],
  'Selection and evolution': ['Natural selection gives organisms the mutations they need.', 'Non-heritable changes alone alter allele frequencies across generations.', 'Evolution has a fixed goal chosen in advance.'],
  'Classification, biodiversity and conservation': ['Biodiversity refers only to the number of individuals of one species.', 'Conservation aims to reduce genetic and habitat diversity.', 'Classification provides no information about biological relationships.'],
  'Genetic technology': ['PCR amplifies proteins rather than DNA.', 'Restriction enzymes join DNA fragments together.', 'Plasmid vectors occur only in animal cells.'],
  'A2 planning, analysis and evaluation': ['A plan needs no hypothesis or identified variables.', 'Uncertainty should be ignored when results fit the prediction.', 'Evaluation means repeating the conclusion without considering limitations.'],
  'Atomic structure': ['Isotopes of an element have different proton numbers.', 'Electrons are found inside the nucleus with protons.', 'Mass number equals the number of electrons only.'],
  'Atoms, molecules and stoichiometry': ['Balanced-equation coefficients give reacting masses directly in grams.', 'One mole of every substance has the same mass.', 'The limiting reagent is always the reactant with the largest initial amount.'],
  'Chemical bonding': ['Ionic bonding consists of shared electron pairs between neutral atoms.', 'Covalent bonding transfers complete electrons to form a metal lattice.', 'Metallic bonding contains no mobile delocalised electrons.'],
  'States of matter': ['Gas particles are stationary and closely packed.', 'Boiling a molecular liquid breaks all covalent bonds within its molecules.', 'Gas pressure is unrelated to particle collisions with container walls.'],
  'Chemical energetics': ['Bond breaking releases energy while bond formation always absorbs it.', 'A catalyst changes the enthalpy difference between reactants and products.', 'Every exothermic reaction has a positive enthalpy change.'],
  Electrochemistry: ['Oxidation is gain of electrons.', 'Electrons travel through the electrolyte rather than the external circuit.', 'A standard electrode potential can be measured for one isolated half-cell with no reference electrode.'],
  Equilibria: ['At dynamic equilibrium, both forward and reverse reactions stop.', 'A catalyst changes the equilibrium constant at fixed temperature.', 'Changing concentration always changes Kc at the same temperature.'],
  'Reaction kinetics': ['A catalyst increases the activation energy.', 'Reaction order must equal the stoichiometric coefficient in every mechanism.', 'Lower temperature increases the fraction of collisions above activation energy.'],
  Periodicity: ['Periodic trends are unrelated to electron configuration.', 'Effective nuclear attraction always decreases across a period.', 'All elements in one period have identical chemical properties.'],
  'Group 2': ['Group 2 metals become less reactive down the group.', 'Group 2 atoms normally form 1+ ions.', 'The solubility of Group 2 hydroxides decreases down the group.'],
  'Group 17': ['Halogen oxidising power increases down Group 17.', 'Halide ions become weaker reducing agents down the group.', 'Chlorine displaces fluoride ions from aqueous fluoride.'],
  'Nitrogen and sulfur': ['The Haber process is favoured by very low pressure.', 'Nitrogen oxides and sulfur dioxide have no environmental effects.', 'The Contact process uses no equilibrium considerations or catalyst.'],
  'AS organic chemistry': ['Alkanes readily undergo electrophilic addition across a carbon–carbon double bond.', 'Members of a homologous series have unrelated functional groups.', 'Reaction conditions do not affect which organic product forms.'],
  'AS analytical techniques': ['Infrared spectroscopy directly gives the exact molecular mass only.', 'A mass spectrum identifies functional groups without ion masses.', 'Chromatographic retention contains no information about mixture components.'],
  'A2 energetics': ['A positive Gibbs free-energy change always indicates a spontaneous process under the stated conditions.', 'Hess cycles depend on the route taken between the same states.', 'Entropy can be treated as having no units or temperature dependence.'],
  'Transition elements': ['Every transition element forms only a 2+ ion.', 'Complex ions contain no ligands bonded to a central metal ion.', 'Partially filled d orbitals cannot influence colour or catalysis.'],
  'A2 organic chemistry': ['A nucleophile accepts an electron pair.', 'An electrophile donates an electron pair to an electron-rich centre.', 'Reagents and conditions have no role in multi-step synthesis selectivity.'],
  'A2 analytical techniques': ['NMR chemical shifts are independent of chemical environment.', 'All compounds have identical chromatographic retention times.', 'Combining spectra always provides less structural information than one spectrum.'],
  'Basic economic ideas and resource allocation': ['More money eliminates scarcity because wants become finite.', 'Opportunity cost is the total financial spending on every option.', 'Every point inside a production possibility curve is productively efficient.'],
  'The price system and the microeconomy': ['A demand curve must slope upward for every normal good.', 'A maximum price above equilibrium necessarily creates a shortage.', 'A market surplus causes price to rise until the surplus grows.'],
  'Government microeconomic intervention': ['An indirect tax shifts supply to the right by lowering firms’ costs.', 'A subsidy raises marginal cost and reduces supply.', 'A binding maximum price set above equilibrium creates excess demand.'],
  'The macroeconomy': ['A fall in the inflation rate means the general price level must be falling.', 'Gross domestic product measures income distribution and welfare perfectly.', 'Full employment requires the measured unemployment rate to be exactly zero.'],
  'Government macroeconomic intervention': ['Contractionary fiscal policy always raises aggregate demand.', 'A lower interest rate must reduce borrowing and investment.', 'Supply-side policies can affect only short-run aggregate demand.'],
  'International economic issues': ['A tariff necessarily lowers the domestic price of an import.', 'Currency appreciation always makes exports cheaper to foreign buyers.', 'The current-account balance and the government budget balance are the same measure.'],
})

const OPTION_IDS = Object.freeze(['A', 'B', 'C', 'D'])

function fail(statusCode, code, message) {
  throw Object.assign(new Error(message), { statusCode, code })
}

function boundedText(value, maxLength = 2000) {
  const text = String(value || '').replace(/\s+/g, ' ').trim()
  return text.slice(0, maxLength)
}

function topicName(topic) {
  return boundedText(topic?.name || topic?.title, 240).replace(/^\d+(?:\.\d+)?\s+/, '')
}

function foundationStatement(route, topic) {
  const name = topicName(topic)
  const questionSpec = ORIGINAL_FOUNDATION_QUESTION_SPECS[name]
  if (questionSpec) return Object.freeze({ text: questionSpec.correct, basis: 'curated-foundation', syllabusPointId: null })
  const routeSpecific = ORIGINAL_FOUNDATION_ROUTE_TOPIC_STATEMENTS[`${route.routeId}:${topic.id}`]
  const topicSpecific = ORIGINAL_FOUNDATION_TOPIC_ID_STATEMENTS[topic.id]
  const subjectSpecific = ORIGINAL_FOUNDATION_STATEMENTS[`${route.subject}:${name}`]
  const shared = ORIGINAL_FOUNDATION_STATEMENTS[name]
  const text = boundedText(routeSpecific || topicSpecific || subjectSpecific || shared)
  if (text) return Object.freeze({ text, basis: 'curated-foundation', syllabusPointId: null })
  const officialPoint = (topic?.points || []).find((point) => boundedText(point?.officialText))
  if (officialPoint) return Object.freeze({
    text: boundedText(officialPoint.officialText),
    basis: 'syllabus-point',
    syllabusPointId: boundedText(officialPoint.id, 240),
  })
  throw new Error(`Missing curated original-foundation statement for ${route.routeId}/${topic.id} (${name}).`)
}

function stableNumber(value) {
  return crypto.createHash('sha256').update(String(value)).digest().readUInt32BE(0)
}

function orderedOptions(questionId, correctText, distractorTexts) {
  const texts = [...new Set([correctText, ...distractorTexts].map((text) => boundedText(text)).filter(Boolean))].slice(0, 4)
  if (texts.length < 3) throw new Error(`${questionId} needs at least three distinct options.`)
  return texts
    .map((text) => ({ text, order: stableNumber(`${questionId}\u0000${text}`) }))
    .sort((left, right) => left.order - right.order || left.text.localeCompare(right.text))
    .map((option, index) => Object.freeze({ id: OPTION_IDS[index], text: option.text }))
}

function routeCatalog(routeId) {
  const route = routeById(routeId)
  const topics = route?.syllabus?.topics || []
  if (!route || !topics.length) return []
  const foundations = topics.map((topic) => ({ topic, name: topicName(topic), ...foundationStatement(route, topic) }))
  return foundations.map((foundation) => {
    const id = `original-foundation:${routeId}:${foundation.topic.id}:v1`
    const questionSpec = ORIGINAL_FOUNDATION_QUESTION_SPECS[foundation.name]
    const curatedDistractors = questionSpec?.distractors || ORIGINAL_FOUNDATION_WITHIN_TOPIC_DISTRACTORS[foundation.name]
    if (!Array.isArray(curatedDistractors) || curatedDistractors.length !== 3) {
      throw new Error(`Missing three within-topic distractors for ${routeId}/${foundation.topic.id} (${foundation.name}).`)
    }
    const distractors = [...curatedDistractors]
    const options = orderedOptions(id, foundation.text, distractors)
    const correctOption = options.find((option) => option.text === foundation.text)
    if (!correctOption) throw new Error(`${id} lost its canonical answer during option ordering.`)
    return Object.freeze({
      schemaVersion: ORIGINAL_FOUNDATION_SCHEMA_VERSION,
      catalogVersion: ORIGINAL_FOUNDATION_CATALOG_VERSION,
      id,
      routeId,
      stage: route.stage,
      subject: route.subject,
      subjectCode: route.subjectCode,
      topicId: foundation.topic.id,
      topicName: foundation.name,
      sourceKind: ORIGINAL_FOUNDATION_SOURCE_KIND,
      sourceAuthority: ORIGINAL_FOUNDATION_SOURCE_AUTHORITY,
      displaySourceLabel: ORIGINAL_FOUNDATION_DISPLAY_LABEL,
      foundationBasis: foundation.basis,
      distractorBasis: 'curated-within-topic',
      syllabusPointId: foundation.syllabusPointId,
      prompt: questionSpec?.prompt || `Which statement about ${foundation.name} is correct?`,
      answerType: 'single-choice',
      options: Object.freeze(options),
      correctOptionId: correctOption.id,
      solution: Object.freeze({
        summary: `Correct answer: ${foundation.text}`,
        markPoints: Object.freeze([Object.freeze({
          id: `${id}:M1`,
          marks: 1,
          description: 'Select the scientifically or mathematically correct statement.',
        })]),
      }),
      maxScore: 1,
      scoreScope: 'original-learning-only',
      formalProgressEligible: false,
      countsTowardFormalGrade: false,
    })
  })
}

const CATALOG = Object.freeze(SYLLABUS_PRACTICE_ROUTE_IDS.flatMap(routeCatalog))
const CATALOG_BY_KEY = new Map(CATALOG.map((entry) => [`${entry.routeId}\u0000${entry.topicId}`, entry]))

function publicAnswerContract(entry) {
  return Object.freeze({
    schemaVersion: 'stem-original-foundation-answer-contract-v1',
    id: `${entry.id}:answer:v1`,
    responseType: 'single-choice',
    submissionEndpoint: ORIGINAL_FOUNDATION_SUBMISSION_ENDPOINT,
    maxScore: entry.maxScore,
    scoreScope: entry.scoreScope,
    reveal: 'after-submission',
  })
}

export function originalFoundationCatalogEntries() {
  return CATALOG
}

export function originalFoundationQuestion(routeId, topicId) {
  return CATALOG_BY_KEY.get(`${String(routeId || '')}\u0000${String(topicId || '')}`) || null
}

export function publicOriginalFoundationQuestion(routeId, topicId) {
  const entry = originalFoundationQuestion(routeId, topicId)
  if (!entry) return null
  return Object.freeze({
    schemaVersion: entry.schemaVersion,
    catalogVersion: entry.catalogVersion,
    id: entry.id,
    routeId: entry.routeId,
    stage: entry.stage,
    subject: entry.subject,
    subjectCode: entry.subjectCode,
    topicId: entry.topicId,
    topicName: entry.topicName,
    sourceKind: entry.sourceKind,
    sourceAuthority: entry.sourceAuthority,
    displaySourceLabel: entry.displaySourceLabel,
    foundationBasis: entry.foundationBasis,
    prompt: entry.prompt,
    answerType: entry.answerType,
    options: entry.options,
    responseContract: Object.freeze({ kind: 'single-choice', optionIds: Object.freeze(entry.options.map((option) => option.id)) }),
    answerContract: publicAnswerContract(entry),
    formalProgressEligible: false,
    countsTowardFormalGrade: false,
  })
}

export function originalFoundationQuestionGroup(routeId, topicId, { components = [] } = {}) {
  const question = publicOriginalFoundationQuestion(routeId, topicId)
  if (!question) return null
  const partId = `${question.id}:part-1`
  const bindingSignature = `original:${crypto.createHash('sha256').update(JSON.stringify([
    question.id,
    question.catalogVersion,
    question.prompt,
    question.options,
  ])).digest('hex')}`
  const sourceBindingProvenance = Object.freeze({
    schemaVersion: 'stem-original-foundation-binding-v1',
    sourceQuestionId: question.id,
    questionPartId: partId,
    bindingSignature,
    reviewVersion: question.catalogVersion,
  })
  return Object.freeze({
    id: question.id,
    questionGroupId: question.id,
    routeId: question.routeId,
    stage: question.stage,
    subjectCode: question.subjectCode,
    paperComponent: null,
    componentScope: Object.freeze([...new Set((Array.isArray(components) ? components : [components]).map(Number).filter(Number.isInteger))]),
    questionNumber: null,
    totalMarks: 1,
    prompt: question.prompt,
    parts: Object.freeze([Object.freeze({
      partId,
      sourceQuestionId: question.id,
      questionGroupId: question.id,
      label: '',
      displayLabel: ORIGINAL_FOUNDATION_DISPLAY_LABEL,
      marks: 1,
      promptFragment: question.prompt,
      answerArea: Object.freeze({ type: 'multiple-choice' }),
      options: question.options,
      sourceBindingProvenance,
      aiAssistedMarkingAvailable: false,
      serverDeterministicScoringAvailable: true,
      sourceKind: ORIGINAL_FOUNDATION_SOURCE_KIND,
      sourceAuthority: ORIGINAL_FOUNDATION_SOURCE_AUTHORITY,
      displaySourceLabel: ORIGINAL_FOUNDATION_DISPLAY_LABEL,
      originalQuestionId: question.id,
      originalCatalogVersion: question.catalogVersion,
    })]),
    reviewStatus: 'original-authored',
    studyOnly: true,
    studentStudyEligible: true,
    formalProgressEligible: false,
    syllabusMapping: Object.freeze({
      schemaVersion: 'original-foundation-syllabus-mapping-v1',
      questionGroupId: question.id,
      primaryTopicId: question.topicId,
      secondaryTopicIds: Object.freeze([]),
      topicIds: Object.freeze([question.topicId]),
      syllabusPointIds: Object.freeze([]),
      mappingMethod: 'original-authoring',
      reviewStatus: 'original-authored',
    }),
    sourceKind: ORIGINAL_FOUNDATION_SOURCE_KIND,
    sourceAuthority: ORIGINAL_FOUNDATION_SOURCE_AUTHORITY,
    displaySourceLabel: ORIGINAL_FOUNDATION_DISPLAY_LABEL,
    originalQuestion: question,
    answerContract: question.answerContract,
  })
}

export function originalFoundationQuestionGroupsForRoute(routeId, topicIds, { components = [] } = {}) {
  const requestedTopicIds = topicIds === undefined
    ? (routeById(routeId)?.syllabus?.topics || []).map((topic) => topic.id)
    : (Array.isArray(topicIds) ? topicIds : [topicIds])
  return [...new Set(requestedTopicIds.map((topicId) => String(topicId || '')).filter(Boolean))]
    .map((topicId) => originalFoundationQuestionGroup(routeId, topicId, { components }))
    .filter(Boolean)
}

export function decorateOriginalFoundationInventory(inventory) {
  const topics = (inventory?.topics || []).map((topic) => {
    const originalAvailable = originalFoundationQuestion(inventory.routeId, topic.id) ? 1 : 0
    const decorate = (chapterStudy = {}) => {
      const officialAvailable = Math.max(0, Number(chapterStudy.available) || 0)
      const available = officialAvailable + originalAvailable
      return Object.freeze({
        mode: 'chapter-study',
        available,
        officialAvailable,
        originalAvailable,
        startable: available > 0,
        fallbackKind: officialAvailable === 0 && originalAvailable > 0 ? ORIGINAL_FOUNDATION_SOURCE_KIND : null,
      })
    }
    return {
      ...topic,
      chapterStudy: decorate(topic.chapterStudy),
      componentCounts: Object.fromEntries(Object.entries(topic.componentCounts || {}).map(([component, counts]) => [component, {
        ...counts,
        chapterStudy: decorate(counts.chapterStudy),
      }])),
    }
  })
  const gapTopicIds = topics.filter((topic) => topic.chapterStudy.officialAvailable === 0).map((topic) => topic.id)
  return {
    ...inventory,
    topics,
    chapterStudy: Object.freeze({
      mode: 'chapter-study',
      catalogVersion: ORIGINAL_FOUNDATION_CATALOG_VERSION,
      topicCount: topics.length,
      startableTopicCount: topics.filter((topic) => topic.chapterStudy.startable).length,
      gapTopicIds: Object.freeze(gapTopicIds),
    }),
  }
}

export function scoreOriginalFoundationResponse(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['routeId', 'syllabusTopicId', 'questionId', 'response'].includes(key))) {
    fail(400, 'original_foundation_response_invalid', 'The original foundation submission has unsupported fields.')
  }
  const { routeId, syllabusTopicId, questionId, response } = input
  const entry = originalFoundationQuestion(routeId, syllabusTopicId)
  if (!entry || entry.id !== String(questionId || '')) {
    fail(404, 'original_foundation_question_not_found', 'This original foundation question is not available for the selected chapter.')
  }
  if (!response || typeof response !== 'object' || Array.isArray(response)
    || Object.keys(response).some((key) => key !== 'selectedOptionId')) {
    fail(400, 'original_foundation_response_invalid', 'A single selectedOptionId is required.')
  }
  const selectedOptionId = boundedText(response.selectedOptionId, 8).toUpperCase()
  if (!entry.options.some((option) => option.id === selectedOptionId)) {
    fail(400, 'original_foundation_response_invalid', 'selectedOptionId must identify one of this question’s options.')
  }
  const correct = selectedOptionId === entry.correctOptionId
  return Object.freeze({
    schemaVersion: 'stem-original-foundation-result-v1',
    routeId: entry.routeId,
    syllabusTopicId: entry.topicId,
    questionId: entry.id,
    sourceKind: entry.sourceKind,
    displaySourceLabel: entry.displaySourceLabel,
    submitted: true,
    selectedOptionId,
    correct,
    score: correct ? 1 : 0,
    maxScore: entry.maxScore,
    scoreScope: entry.scoreScope,
    formalProgressEligible: false,
    countsTowardFormalGrade: false,
    correctOptionId: entry.correctOptionId,
    solution: Object.freeze({
      summary: entry.solution.summary,
      markPoints: Object.freeze(entry.solution.markPoints.map((point) => Object.freeze({
        id: point.id,
        awarded: correct,
        marks: correct ? point.marks : 0,
        maxMarks: point.marks,
        reason: correct ? point.description : `The selected statement does not match ${entry.topicName}.`,
      }))),
    }),
  })
}
