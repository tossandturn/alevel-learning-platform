import crypto from 'node:crypto'

import { routeById } from '../src/data/routeRegistry.js'
import { SYLLABUS_PRACTICE_ROUTE_IDS } from '../src/lib/syllabusPracticeRoutes.js'

export const ORIGINAL_FOUNDATION_SCHEMA_VERSION = 'stem-original-foundation-question-v1'
export const ORIGINAL_FOUNDATION_CATALOG_VERSION = 'v1'
export const ORIGINAL_FOUNDATION_V2_SCHEMA_VERSION = 'stem-original-foundation-question-v2'
export const ORIGINAL_FOUNDATION_V2_CATALOG_VERSION = 'v2'
export const ORIGINAL_FOUNDATION_SOURCE_KIND = 'original-foundation'
export const ORIGINAL_FOUNDATION_SOURCE_AUTHORITY = 'original-foundation-catalog'
export const ORIGINAL_FOUNDATION_DISPLAY_LABEL = '原创基础练习'
export const ORIGINAL_FOUNDATION_SUBMISSION_ENDPOINT = '/api/stem/original-foundation/submit'
export const ORIGINAL_FOUNDATION_ITEM_KINDS = Object.freeze(['concept', 'application', 'transfer'])

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

function applicationSpec(prompt, correct, distractors, explanation, nextStep) {
  return Object.freeze({
    prompt,
    correct,
    distractors: Object.freeze(distractors),
    explanation,
    nextStep,
  })
}

// Product-design basis for the v2 progression (questions remain original):
// Cambridge Skills Exercises pair topic-specific knowledge with application /
// interpretation and suggested answers:
// https://learning.cambridgeinternational.org/classroom/course/section.php?id=41672
// IES recommends retrieval quizzes, abstract-to-concrete connections, worked
// examples interleaved with problem solving, and deep explanatory prompts:
// https://ies.ed.gov/ncee/wwc/PracticeGuide/1
const V2_APPLICATION_SPECS = Object.freeze({
  Number: applicationSpec('A jacket costs $80 and its price rises by 25%. What is the new price?', '$100', ['$85', '$95', '$105'], 'A 25% increase is 0.25 × 80 = 20, so the new price is 80 + 20.', 'Practise converting a percentage change into a multiplier before calculating.'),
  'Algebra and graphs': applicationSpec('The graphs y = 2x + 1 and y = 7 intersect. What is the x-coordinate of the intersection?', '3', ['2', '4', '7'], 'At the intersection, 2x + 1 = 7, so 2x = 6 and x = 3.', 'Set the two expressions for y equal whenever two graphs intersect.'),
  'Coordinate geometry': applicationSpec('What is the gradient of the line through (2, 3) and (6, 11)?', '2', ['1/2', '4', '8'], 'Gradient = (11 - 3) / (6 - 2) = 8 / 4 = 2.', 'Write change in y over change in x in the same point order.'),
  Geometry: applicationSpec('Three angles of a quadrilateral are 70°, 95° and 110°. What is the fourth angle?', '85°', ['75°', '95°', '105°'], 'Interior angles of a quadrilateral total 360°, so the missing angle is 360 - 275 = 85°.', 'State the relevant angle total before subtracting known angles.'),
  Mensuration: applicationSpec('A cylinder has radius 3 cm and height 5 cm. What is its volume?', '45π cm³', ['15π cm³', '30π cm³', '90π cm³'], 'Cylinder volume is πr²h = π × 3² × 5 = 45π cm³.', 'Square the radius before multiplying by height.'),
  Trigonometry: applicationSpec('A right triangle has opposite side 6 and adjacent side 8. What is tan θ?', '3/4', ['4/3', '3/5', '5/4'], 'tan θ = opposite / adjacent = 6 / 8 = 3/4.', 'Label opposite and adjacent relative to the chosen angle before forming the ratio.'),
  'Transformations and vectors': applicationSpec('Point (2, -1) is translated by vector (3, 4). What is its image?', '(5, 3)', ['(-1, 3)', '(5, -5)', '(6, 3)'], 'Add vector components to the coordinates: (2 + 3, -1 + 4) = (5, 3).', 'Apply horizontal and vertical vector components separately.'),
  Probability: applicationSpec('A fair bag contains 3 red and 2 blue counters. One counter is chosen. What is P(red)?', '3/5', ['2/5', '1/3', '3/2'], 'There are 3 favourable outcomes among 5 equally likely counters.', 'Count favourable outcomes and divide by the total number of outcomes.'),
  Statistics: applicationSpec('The values are 2, 4, 4, 6 and 9. What is the median?', '4', ['5', '6', '9'], 'The ordered list has five values, so the middle third value is 4.', 'Order the data before locating the middle value.'),
  Functions: applicationSpec('For f(x) = 2x² - 3, what is f(2)?', '5', ['1', '7', '13'], 'Substitute x = 2: 2(2²) - 3 = 8 - 3 = 5.', 'Use brackets when substituting into powers.'),
  'Quadratics and polynomials': applicationSpec('For f(x) = x² - 5x + 6, which value is a root?', 'x = 2', ['x = 0', 'x = 1', 'x = 5'], 'f(x) factors as (x - 2)(x - 3), so x = 2 is a root.', 'Factorise or substitute each candidate to test whether f(x) = 0.'),
  'Equations, inequalities and graphs': applicationSpec('Solve -2x > 6.', 'x < -3', ['x > -3', 'x < 3', 'x > 3'], 'Dividing an inequality by -2 reverses its direction, giving x < -3.', 'Reverse the inequality sign whenever multiplying or dividing by a negative value.'),
  'Indices, surds and logarithms': applicationSpec('Simplify 2³ × 2⁵.', '2⁸', ['2¹⁵', '4⁸', '2²'], 'For the same base, add exponents: 3 + 5 = 8.', 'Check that the bases match before applying an index law.'),
  'Factors of polynomials': applicationSpec('Given f(x) = x³ - 4x² + x + 6 and f(2) = 0, which factor must f(x) have?', 'x - 2', ['x + 2', 'x - 6', '2x - 1'], 'The factor theorem gives x - a as a factor when f(a) = 0.', 'Match the tested root a to the factor x - a.'),
  'Simultaneous equations': applicationSpec('Solve x + y = 7 and x - y = 1. What is x?', '4', ['3', '6', '8'], 'Adding the equations gives 2x = 8, hence x = 4.', 'Choose elimination when coefficients cancel cleanly.'),
  'Logarithmic and exponential functions': applicationSpec('Solve 2ˣ = 16.', 'x = 4', ['x = 2', 'x = 8', 'x = 14'], 'Since 16 = 2⁴, the exponent is 4.', 'Express both sides with the same base when possible.'),
  'Straight-line graphs': applicationSpec('A line has gradient 3 and passes through (0, -2). What is its equation?', 'y = 3x - 2', ['y = -2x + 3', 'y = 3x + 2', 'y = x - 6'], 'In y = mx + c, m = 3 and the point at x = 0 gives c = -2.', 'Read the y-intercept from the value of y when x = 0.'),
  'Circular measure': applicationSpec('A sector has radius 4 m and angle 0.5 rad. What is its arc length?', '2 m', ['1 m', '4 m', '8 m'], 'Arc length s = rθ = 4 × 0.5 = 2 m.', 'Use radians directly in s = rθ.'),
  'Permutations and combinations': applicationSpec('How many ways can 2 students be chosen from 5 when order does not matter?', '10', ['7', '20', '25'], 'The count is 5C2 = 5! / (2!3!) = 10.', 'Use combinations when rearranging the chosen members does not create a new selection.'),
  Series: applicationSpec('An arithmetic sequence starts 5, 8, 11, ... What is its 10th term?', '32', ['27', '35', '50'], 'a₁₀ = 5 + 9 × 3 = 32.', 'For an arithmetic sequence use a + (n - 1)d.'),
  Vectors: applicationSpec('Vector a = (2, -1) and b = (3, 4). What is a + b?', '(5, 3)', ['(1, 5)', '(6, -4)', '(5, -5)'], 'Add corresponding components: (2 + 3, -1 + 4) = (5, 3).', 'Keep horizontal and vertical components aligned.'),
  Calculus: applicationSpec('For y = x³, what is dy/dx at x = 2?', '12', ['4', '6', '24'], 'dy/dx = 3x², so at x = 2 the gradient is 3 × 4 = 12.', 'Differentiate first, then substitute the required x-value.'),
  Quadratics: applicationSpec('How many distinct real roots does x² - 4x + 4 = 0 have?', '1', ['0', '2', '4'], 'The discriminant is (-4)² - 4(1)(4) = 0, so there is one repeated real root.', 'Use the sign of the discriminant to classify roots.'),
  Differentiation: applicationSpec('Differentiate y = 3x⁴ - 2x.', 'dy/dx = 12x³ - 2', ['dy/dx = 7x³', 'dy/dx = 12x⁴ - 2', 'dy/dx = 3x³ - 2'], 'Apply the power rule term by term.', 'Multiply by the old power and reduce the power by one.'),
  Integration: applicationSpec('Evaluate ∫₀² 2x dx.', '4', ['2', '6', '8'], 'An antiderivative is x²; evaluating from 0 to 2 gives 4.', 'Find an antiderivative before applying the limits.'),
  Algebra: applicationSpec('What is the remainder when x² + 3x + 5 is divided by x - 2?', '15', ['3', '7', '11'], 'By the remainder theorem, the remainder is f(2) = 4 + 6 + 5 = 15.', 'Substitute the root of the divisor into the polynomial.'),
  'Numerical solution of equations': applicationSpec('Newton iteration for f(x) uses xₙ₊₁ = xₙ - f(xₙ)/f′(xₙ). If f(2)=3 and f′(2)=6, what is x₁?', '1.5', ['0.5', '2.5', '5'], 'x₁ = 2 - 3/6 = 1.5.', 'Substitute the function and derivative values into the iteration carefully.'),
  'Forces and equilibrium': applicationSpec('A particle has horizontal forces 12 N right and 7 N left. What additional force gives equilibrium?', '5 N left', ['5 N right', '19 N left', '19 N right'], 'The existing resultant is 5 N right, so equilibrium needs 5 N left.', 'Find the current resultant before adding the balancing force.'),
  'Kinematics of motion in a straight line': applicationSpec('Velocity increases uniformly from 2 m/s to 8 m/s in 3 s. What is the displacement?', '15 m', ['10 m', '18 m', '30 m'], 'Displacement is the area under the velocity-time graph: average velocity 5 m/s × 3 s = 15 m.', 'For uniform acceleration use average velocity times time.'),
  Momentum: applicationSpec('A 2 kg object moves at 3 m/s. What is its momentum?', '6 kg m/s', ['1.5 kg m/s', '5 kg m/s', '9 kg m/s'], 'p = mv = 2 × 3 = 6 kg m/s.', 'Include direction when the problem gives vector directions.'),
  "Newton's laws of motion": applicationSpec('A resultant force of 12 N acts on a 3 kg mass. What is its acceleration?', '4 m/s²', ['0.25 m/s²', '9 m/s²', '36 m/s²'], 'From F = ma, a = 12 / 3 = 4 m/s².', 'Rearrange the force equation before inserting values.'),
  'Energy, work and power': applicationSpec('A motor transfers 600 J in 20 s. What is its power?', '30 W', ['12 W', '120 W', '12 000 W'], 'P = E/t = 600/20 = 30 W.', 'Power is a rate, so divide energy by time.'),
  'Representation of data': applicationSpec('A histogram class 10 ≤ x < 15 has frequency 20. What is its frequency density?', '4', ['2', '5', '100'], 'Class width is 5, so frequency density = 20 / 5 = 4.', 'Use frequency divided by class width for unequal-width histograms.'),
  'Discrete random variables': applicationSpec('X takes values 0 and 1 with probabilities 0.3 and 0.7. What is E(X)?', '0.7', ['0.3', '0.5', '1.0'], 'E(X) = 0(0.3) + 1(0.7) = 0.7.', 'Multiply each value by its probability and add.'),
  'The normal distribution': applicationSpec('For a normal distribution with mean 50, what is P(X < 50)?', '0.5', ['0', '0.25', '1'], 'A normal distribution is symmetric about its mean, so half the area lies below 50.', 'Use symmetry before standardising when the boundary is the mean.'),
  'Differential equations': applicationSpec('Which function satisfies dy/dx = 2x and y(0) = 3?', 'y = x² + 3', ['y = 2x + 3', 'y = x²', 'y = 2x² + 3'], 'Integrating 2x gives x² + C, and y(0)=3 gives C=3.', 'Integrate first, then apply the initial condition.'),
  'Complex numbers': applicationSpec('For z = 3 + 4i, what is |z|?', '5', ['1', '7', '25'], 'The modulus is √(3² + 4²) = 5.', 'Treat the real and imaginary parts as perpendicular components.'),
  'The Poisson distribution': applicationSpec('Calls arrive at mean 2 per minute under a Poisson model. What is P(X=0) in one minute?', 'e⁻²', ['2e⁻²', '1 - e⁻²', 'e²'], 'P(X=0)=e⁻²2⁰/0!=e⁻².', 'Substitute x=0 carefully into the Poisson probability formula.'),
  'Linear combinations of random variables': applicationSpec('Independent X and Y have variances 2 and 3. What is Var(2X + Y)?', '11', ['7', '10', '13'], 'Var(2X+Y)=2²Var(X)+Var(Y)=4×2+3=11.', 'Square coefficients when combining independent variances.'),
  'Continuous random variables': applicationSpec('A density is f(x)=2x for 0≤x≤1. What is P(X≤0.5)?', '0.25', ['0.5', '0.75', '1'], 'Integrate 2x from 0 to 0.5 to obtain x²|₀^0.5 = 0.25.', 'Probability is area under the density over the required interval.'),
  'Sampling and estimation': applicationSpec('A sample proportion is 0.40 from n=100. What is its estimated standard error?', '√(0.4×0.6/100)', ['0.4×0.6/100', '√(0.4/100)', '√(100/0.24)'], 'The estimated standard error is √[p̂(1-p̂)/n].', 'Identify the estimate and sample size before using the standard-error formula.'),
  'Hypothesis tests': applicationSpec('A two-sided test gives p = 0.03 at the 5% level. What is the decision?', 'Reject H₀', ['Accept H₀ as proven', 'Increase p to 0.05', 'Use a 50% level'], 'Since p < 0.05, the result lies in the rejection region.', 'Compare the p-value with the preselected significance level.'),
  'Further Pure Mathematics 1': applicationSpec('A plane transformation has matrix [[2,0],[0,3]]. What is its area scale factor?', '6', ['1', '5', '9'], 'The area scale factor is |det A| = |2×3 - 0| = 6.', 'Calculate the determinant and use its absolute value for area scale.'),
  'Further Mechanics': applicationSpec('A constant 5 N resultant force acts for 4 s. What is the impulse?', '20 N s', ['1.25 N s', '9 N s', '25 N s'], 'Impulse = Ft = 5 × 4 = 20 N s.', 'For constant force, multiply force by the time interval.'),
  'Further Probability and Statistics': applicationSpec('An estimator T has E(T)=θ and Var(T)=4/n. Which property is guaranteed?', 'T is unbiased for θ', ['T always equals θ', 'T has zero variance for every n', 'T is biased upward by 4/n'], 'Unbiasedness means the estimator’s expected value equals the target parameter.', 'Separate bias, variance and consistency when evaluating an estimator.'),
  'Further Pure Mathematics 2': applicationSpec('For z = 1 + i, which is a principal argument?', 'π/4', ['-π/4', 'π/2', '3π/4'], 'The point (1,1) lies in the first quadrant at angle π/4.', 'Use the signs of real and imaginary parts to choose the correct quadrant.'),
  'Further Mechanics when selected for A Level completion': applicationSpec('A constant 5 N resultant force acts for 4 s. What is the impulse?', '20 N s', ['1.25 N s', '9 N s', '25 N s'], 'Impulse = Ft = 5 × 4 = 20 N s.', 'For constant force, multiply force by the time interval.'),
  'Further Probability and Statistics when selected for A Level completion': applicationSpec('An estimator T has E(T)=θ and Var(T)=4/n. Which property is guaranteed?', 'T is unbiased for θ', ['T always equals θ', 'T has zero variance for every n', 'T is biased upward by 4/n'], 'Unbiasedness means the estimator’s expected value equals the target parameter.', 'Separate bias, variance and consistency when evaluating an estimator.'),
  'Motion, forces and energy': applicationSpec('A 4 kg trolley accelerates at 2 m/s². What resultant force acts on it?', '8 N', ['2 N', '6 N', '16 N'], 'F = ma = 4 × 2 = 8 N.', 'Identify mass and acceleration before applying Newton’s second law.'),
  'Thermal physics': applicationSpec('A pure substance is melting while it is heated at constant pressure. What happens to its temperature during the phase change?', 'It remains constant while internal energy increases.', ['It rises steadily with no energy change.', 'It falls because particles stop moving.', 'It becomes absolute zero.'], 'Energy supplied changes particle potential energy during melting rather than raising temperature.', 'Distinguish energy transfer from temperature change during a phase transition.'),
  Waves: applicationSpec('A wave has frequency 5 Hz and wavelength 2 m. What is its speed?', '10 m/s', ['2.5 m/s', '7 m/s', '20 m/s'], 'v = fλ = 5 × 2 = 10 m/s.', 'Check that frequency and wavelength use compatible SI units.'),
  'Electricity and magnetism': applicationSpec('A 2 A current flows through a straight wire for 3 s. How much charge passes?', '6 C', ['1.5 C', '5 C', '9 C'], 'Q = It = 2 × 3 = 6 C.', 'Use current as charge transferred per unit time.'),
  'Nuclear physics': applicationSpec('A sample has a half-life of 4 h. What fraction remains after 12 h?', '1/8', ['1/2', '1/3', '1/16'], 'Twelve hours is three half-lives, so the remaining fraction is (1/2)³ = 1/8.', 'Count complete half-lives before applying repeated halving.'),
  'Space physics': applicationSpec('A satellite moves in a circular orbit at constant speed. Which direction is its acceleration?', 'Toward the centre of the orbit', ['Along the tangent in the direction of motion', 'Away from the centre', 'There is no acceleration'], 'Circular motion requires centripetal acceleration toward the centre even when speed is constant.', 'Separate constant speed from constant velocity.'),
  'Physical quantities and units': applicationSpec('Which SI base-unit expression is equivalent to one newton?', 'kg m s⁻²', ['kg m² s⁻¹', 'kg s⁻²', 'm s⁻¹'], 'From F = ma, force has units kg × m s⁻².', 'Derive units from the defining equation instead of memorising them alone.'),
  Kinematics: applicationSpec('A car changes velocity from 4 m/s to 10 m/s in 3 s. What is its average acceleration?', '2 m/s²', ['3 m/s²', '4.7 m/s²', '18 m/s²'], 'a = Δv/Δt = (10 - 4)/3 = 2 m/s².', 'Use change in velocity, not final velocity alone.'),
  Dynamics: applicationSpec('A 10 kg object has forces 50 N right and 20 N left. What is its acceleration?', '3 m/s² right', ['7 m/s² right', '3 m/s² left', '0.3 m/s² right'], 'The resultant is 30 N right, so a = 30/10 = 3 m/s² right.', 'Find the vector resultant before dividing by mass.'),
  'Forces, density and pressure': applicationSpec('A force of 120 N acts normally on area 0.30 m². What pressure is produced?', '400 Pa', ['36 Pa', '120 Pa', '600 Pa'], 'p = F/A = 120/0.30 = 400 Pa.', 'Convert the area to square metres before dividing.'),
  'Work, energy and power': applicationSpec('A force of 15 N moves an object 4 m in its direction. How much work is done?', '60 J', ['3.75 J', '19 J', '225 J'], 'W = Fs = 15 × 4 = 60 J.', 'Use the component of force along the displacement.'),
  'Deformation of solids': applicationSpec('A wire has stress 2.0×10⁸ Pa and strain 1.0×10⁻³ in its linear region. What is Young modulus?', '2.0×10¹¹ Pa', ['2.0×10⁵ Pa', '2.0×10⁸ Pa', '2.0×10⁻¹¹ Pa'], 'E = stress/strain = 2.0×10⁸ / 1.0×10⁻³ = 2.0×10¹¹ Pa.', 'Divide stress by strain and track powers of ten.'),
  Superposition: applicationSpec('Two pulses overlap with displacements +3 cm and -1 cm. What is the resultant displacement?', '+2 cm', ['-4 cm', '+3 cm', '+4 cm'], 'Superposition adds signed displacements: 3 + (-1) = 2 cm.', 'Keep displacement signs when combining waves.'),
  Electricity: applicationSpec('A device transfers 24 J when 6 C passes through it. What is the potential difference?', '4 V', ['0.25 V', '18 V', '144 V'], 'V = W/Q = 24/6 = 4 V.', 'Potential difference is energy transferred per unit charge.'),
  'D.C. circuits': applicationSpec('Two resistors 3 Ω and 5 Ω are connected in series. What is their total resistance?', '8 Ω', ['1.875 Ω', '2 Ω', '15 Ω'], 'Series resistances add: 3 + 5 = 8 Ω.', 'First identify whether the components are in series or parallel.'),
  'Particle physics': applicationSpec('A particle reaction starts with total charge +1e. What total charge must the products have?', '+1e', ['-1e', '0', '+2e'], 'Electric charge is conserved in particle reactions.', 'Check each conserved quantum number separately.'),
  'Motion in a circle': applicationSpec('A car moves at 10 m/s around a circle of radius 20 m. What is its centripetal acceleration?', '5 m/s²', ['0.5 m/s²', '10 m/s²', '200 m/s²'], 'a = v²/r = 100/20 = 5 m/s².', 'Square the speed before dividing by radius.'),
  'Gravitational fields': applicationSpec('A 2 kg mass experiences gravitational force 18 N. What is the field strength?', '9 N/kg', ['4.5 N/kg', '16 N/kg', '36 N/kg'], 'g = F/m = 18/2 = 9 N/kg.', 'Use force per unit mass for gravitational field strength.'),
  Temperature: applicationSpec('What temperature is 27 °C on the kelvin scale to the nearest kelvin?', '300 K', ['246 K', '273 K', '327 K'], 'T/K = θ/°C + 273, so 27 + 273 = 300 K.', 'Convert Celsius to kelvin before using thermodynamic equations.'),
  'Ideal gases': applicationSpec('One mole of ideal gas is at 300 K in volume 0.024 m³. Using R=8.31, what pressure is closest?', '1.04×10⁵ Pa', ['1.04×10³ Pa', '5.98×10⁵ Pa', '9.97×10⁶ Pa'], 'p = nRT/V = 8.31×300/0.024 ≈ 1.04×10⁵ Pa.', 'Use kelvin and cubic metres in the ideal-gas equation.'),
  Thermodynamics: applicationSpec('A gas receives 500 J by heating and does 200 J of work. What is its increase in internal energy?', '300 J', ['200 J', '500 J', '700 J'], 'Using ΔU = Q - W, ΔU = 500 - 200 = 300 J.', 'Choose and state a consistent sign convention for work.'),
  Oscillations: applicationSpec('In SHM, ω = 4 rad/s and displacement x = 0.20 m. What is acceleration?', '-3.2 m/s²', ['-0.8 m/s²', '+0.8 m/s²', '+3.2 m/s²'], 'a = -ω²x = -16×0.20 = -3.2 m/s².', 'The negative sign shows acceleration toward equilibrium.'),
  'Electric fields': applicationSpec('A charge 2.0×10⁻⁶ C experiences force 0.010 N. What is the electric field strength?', '5.0×10³ N/C', ['2.0×10⁻⁸ N/C', '2.0×10⁻⁴ N/C', '2.0×10⁴ N/C'], 'E = F/Q = 0.010/(2.0×10⁻⁶) = 5.0×10³ N/C.', 'Divide force by test charge and track powers of ten.'),
  Capacitance: applicationSpec('A capacitor stores 6.0 mC at 3.0 V. What is its capacitance?', '2.0 mF', ['0.50 mF', '9.0 mF', '18 mF'], 'C = Q/V = 6.0 mC / 3.0 V = 2.0 mF.', 'Use consistent charge units before dividing by voltage.'),
  'Magnetic fields': applicationSpec('A 0.20 m wire carries 3.0 A perpendicular to a 0.50 T field. What force acts?', '0.30 N', ['0.03 N', '0.70 N', '1.50 N'], 'F = BIL = 0.50×3.0×0.20 = 0.30 N.', 'Use the perpendicular component when the wire is angled to the field.'),
  'Alternating currents': applicationSpec('A sinusoidal voltage has peak value 100 V. What is its rms value?', 'about 70.7 V', ['50 V', '100 V', '141 V'], 'For a sinusoid, Vrms = Vpeak/√2 ≈ 70.7 V.', 'Distinguish peak, peak-to-peak and rms values.'),
  'Quantum physics': applicationSpec('What is the photon energy for frequency 5.0×10¹⁴ Hz using h=6.63×10⁻³⁴ J s?', '3.32×10⁻¹⁹ J', ['1.33×10⁻⁴⁸ J', '7.54×10⁻⁷ J', '3.32×10¹⁹ J'], 'E = hf = 6.63×10⁻³⁴×5.0×10¹⁴ ≈ 3.32×10⁻¹⁹ J.', 'Multiply Planck constant by frequency and combine exponents.'),
  'Medical physics': applicationSpec('An ultrasound pulse returns 120 μs after reflecting from tissue. If sound speed is 1500 m/s, how deep is the boundary?', '0.090 m', ['0.045 m', '0.18 m', '90 m'], 'Depth = vt/2 = 1500×120×10⁻⁶/2 = 0.090 m.', 'Divide the round-trip distance by two.'),
  'Astronomy and cosmology': applicationSpec('A galaxy has recession speed 14 000 km/s and H₀ = 70 km/s/Mpc. What is its estimated distance?', '200 Mpc', ['20 Mpc', '980 Mpc', '2000 Mpc'], 'From v = H₀d, d = 14 000/70 = 200 Mpc.', 'Rearrange Hubble’s law and keep its compound units consistent.'),
  'Characteristics and classification': applicationSpec('Two organisms share many derived DNA sequences and a recent common ancestor. Which classification conclusion is best supported?', 'They should be placed in closely related taxonomic groups.', ['They must be the same individual organism.', 'They cannot belong to the same kingdom.', 'DNA evidence is irrelevant to classification.'], 'Shared derived molecular evidence supports a close evolutionary relationship.', 'Compare multiple inherited characteristics before inferring relatedness.'),
  'Organisation of the organism': applicationSpec('Several similar muscle cells work together to contract the stomach wall. What level of organisation do they form?', 'A tissue', ['An organ system', 'An organelle', 'A whole organism'], 'A group of similar specialised cells performing a function forms a tissue.', 'Use the sequence cell → tissue → organ → organ system.'),
  'Movement in and out of cells': applicationSpec('A plant cell is placed in a solution with lower water potential than the cell sap. What is the initial net water movement?', 'Water moves out of the cell by osmosis.', ['Water moves into the cell by active transport.', 'Solute moves out through a fully permeable membrane.', 'There is no movement because water potential is irrelevant.'], 'Water moves from higher to lower water potential across a partially permeable membrane.', 'Compare water potentials before predicting osmotic movement.'),
  'Biological molecules': applicationSpec('A food sample gives a lilac colour in the Biuret test. Which molecule is present?', 'Protein', ['Reducing sugar', 'Lipid', 'Starch'], 'A positive Biuret test indicates peptide bonds in protein.', 'Link each biochemical test to its reagent and positive colour change.'),
  Enzymes: applicationSpec('An enzyme-controlled reaction slows sharply above 60 °C and does not recover after cooling. What best explains this?', 'The enzyme has denatured and its active site changed shape.', ['The substrate has become an enzyme.', 'The activation energy has become zero.', 'The enzyme has been converted permanently into product.'], 'High temperature can disrupt bonds maintaining the enzyme’s tertiary structure.', 'Distinguish reversible temperature effects from irreversible denaturation.'),
  'Plant nutrition': applicationSpec('A destarched leaf has one illuminated green region and one covered region. After iodine testing, where should blue-black colour appear?', 'Only in the illuminated green region', ['Only in the covered region', 'Everywhere equally', 'Nowhere, because leaves cannot make starch'], 'Light and chlorophyll are required for photosynthesis that produces carbohydrate stored as starch.', 'Identify which experimental region has every required factor.'),
  'Human nutrition': applicationSpec('After digestion, where is most glucose absorbed into the blood?', 'Across villi in the small intestine', ['Across the stomach wall only', 'In the large intestine by bile', 'In the oesophagus by peristalsis'], 'Villi provide a large, thin, well-supplied surface for absorption in the small intestine.', 'Relate digestive-organ structure to its specific function.'),
  Transport: applicationSpec('Why does a large active organism need a mass-transport system rather than diffusion alone?', 'Its small surface-area-to-volume ratio and long internal distances make diffusion too slow.', ['Diffusion cannot occur in living cells.', 'Transport systems stop concentration gradients forming.', 'Large organisms have no exchange surfaces.'], 'Increasing size reduces relative surface area and increases diffusion distance.', 'Use size, surface area and diffusion distance together in explanations.'),
  'Diseases and immunity': applicationSpec('A bacterial culture is sensitive to an antibiotic, but a viral infection is not. Why?', 'The antibiotic targets bacterial structures or processes that viruses lack.', ['Viruses have thicker cell walls than bacteria.', 'Antibiotics are antibodies made by viruses.', 'Bacteria and viruses have identical cellular machinery.'], 'Antibiotics act on bacterial targets and do not treat viruses lacking those targets.', 'Match a treatment to the biology of the pathogen.'),
  'Gas exchange': applicationSpec('During exercise, ventilation and blood flow to lungs increase. What is the main gas-exchange benefit?', 'Steeper oxygen and carbon-dioxide concentration gradients are maintained.', ['The alveolar walls become permanently thicker.', 'Diffusion distance increases.', 'Oxygen is moved by active transport across alveoli.'], 'Renewing air and blood maintains gradients that speed diffusion.', 'Explain exchange rate using area, distance and gradient.'),
  Respiration: applicationSpec('A muscle receives insufficient oxygen during intense exercise. Which process can continue briefly?', 'Anaerobic respiration producing a smaller ATP yield', ['Photosynthesis producing oxygen', 'Aerobic respiration at a higher ATP yield', 'DNA replication replacing ATP'], 'Anaerobic pathways regenerate enough cofactor for limited ATP production without oxygen.', 'Compare ATP yield and products of aerobic and anaerobic pathways.'),
  Excretion: applicationSpec('Blood urea concentration rises when which organ fails to remove it effectively?', 'The kidney', ['The pancreas', 'The trachea', 'The gall bladder'], 'Kidneys filter blood and excrete urea in urine.', 'Trace each metabolic waste from its production to its excretory route.'),
  'Coordination and response': applicationSpec('A hand touches a hot surface and withdraws before conscious awareness. Which pathway explains this?', 'A reflex arc through sensory, relay and motor neurones', ['A hormone moving across one synapse', 'An antibody binding the heat', 'Diffusion of an impulse through blood'], 'A reflex arc produces a rapid involuntary response through the nervous system.', 'Follow information from receptor to coordinator to effector.'),
  Reproduction: applicationSpec('Which outcome is most likely from sexual reproduction?', 'Offspring show genetic variation from combining two gametes.', ['All offspring are clones of one parent.', 'Chromosome number doubles every generation.', 'No genetic information passes to offspring.'], 'Meiosis and random fertilisation generate new allele combinations.', 'Connect gamete formation and fertilisation to variation.'),
  Inheritance: applicationSpec('Two heterozygous parents Aa × Aa have a child. What is the probability of genotype aa?', '1/4', ['0', '1/2', '3/4'], 'The Punnett outcomes AA, Aa, Aa and aa make aa one of four.', 'List gametes and combine them systematically.'),
  'Variation and selection': applicationSpec('A pesticide kills most insects, but a few with a heritable resistance allele survive and reproduce. What happens over generations?', 'The resistance allele becomes more common.', ['Every insect deliberately develops resistance.', 'The resistance allele disappears immediately.', 'Only non-heritable changes are passed on.'], 'Differential survival and reproduction increase the frequency of a heritable resistance allele.', 'State the variation, selection pressure and reproductive consequence.'),
  'Organisms and their environment': applicationSpec('A top predator is removed from a food web. What is a plausible first effect?', 'Populations of some prey may increase.', ['All energy cycling stops instantly.', 'Every producer population must disappear.', 'Decomposers can no longer release nutrients.'], 'Removing predation can reduce mortality of prey and alter connected populations.', 'Trace direct links first, then consider indirect food-web effects.'),
  'Human influences on ecosystems': applicationSpec('A forest is cleared and burned. Which immediate global-cycle effect is most likely?', 'Stored carbon is released and future carbon uptake is reduced.', ['Atmospheric carbon dioxide must fall.', 'Biodiversity always rises.', 'The water cycle is unaffected.'], 'Combustion releases carbon and fewer trees remain to photosynthesise.', 'Identify both the immediate release and the lost future sink.'),
  'Biotechnology and genetic modification': applicationSpec('A bacterial plasmid is cut and joined to a human gene before transformation. What is the plasmid acting as?', 'A vector carrying recombinant DNA', ['An antibody', 'A ribosome', 'A monosaccharide'], 'Plasmids can carry inserted DNA into bacterial cells for cloning or expression.', 'Identify the roles of enzyme, vector, host and selected gene.'),
  'Cell structure': applicationSpec('A secretory cell produces large amounts of protein. Which organelles should be especially abundant?', 'Rough endoplasmic reticulum and Golgi apparatus', ['Cell wall and chloroplast only', 'Lysosomes and centrioles only', 'Smooth ER with no ribosomes only'], 'Ribosomes on rough ER synthesise protein and Golgi modifies and packages it.', 'Link the product made by a cell to the organelles that process it.'),
  'Cell membranes and transport': applicationSpec('A cell accumulates ions from a lower external concentration to a higher internal concentration. Which process is required?', 'Active transport using carrier proteins and energy', ['Simple diffusion down the gradient', 'Osmosis of the ions', 'Passive movement with no membrane protein'], 'Movement against a concentration gradient requires energy-coupled transport.', 'Compare movement direction with the concentration gradient.'),
  'The mitotic cell cycle': applicationSpec('A diploid cell completes mitosis and cytokinesis without mutation. What is produced?', 'Two genetically identical diploid daughter cells', ['Four genetically different haploid cells', 'One tetraploid cell only', 'Two cells with half the original chromosome number'], 'Mitosis preserves chromosome number and normally produces identical nuclei.', 'Track DNA replication separately from chromosome-number change.'),
  'Nucleic acids and protein synthesis': applicationSpec('A DNA template triplet is transcribed. Which molecule carries the complementary codon to a ribosome?', 'mRNA', ['DNA polymerase', 'A lipid', 'Glycogen'], 'Messenger RNA carries transcribed sequence information from DNA for translation.', 'Separate transcription products from translation machinery.'),
  'Transport in plants': applicationSpec('Radioactively labelled sucrose moves from a mature leaf to a growing root. Which tissue carries it?', 'Phloem', ['Xylem only', 'Epidermis', 'Guard cells'], 'Phloem translocates assimilates from sources to sinks.', 'Identify the transported substance and its source–sink direction.'),
  'Transport in mammals': applicationSpec('Which vessel feature most directly supports rapid exchange with tissues?', 'A capillary wall one cell thick', ['A thick muscular capillary wall', 'Valves in every artery', 'No branching near cells'], 'Thin capillary walls give a short diffusion distance.', 'Connect vessel structure to pressure, transport or exchange function.'),
  'Infectious diseases': applicationSpec('An infected person is isolated before they meet others. Which part of disease spread is reduced?', 'Transmission between hosts', ['Mutation of every host gene', 'Antibody specificity', 'The pathogen’s original classification'], 'Isolation reduces opportunities for a pathogen to pass to new hosts.', 'Choose controls that interrupt the relevant transmission route.'),
  Immunity: applicationSpec('A vaccinated person produces antibodies much faster on later exposure to the same antigen. Which cells explain this?', 'Memory lymphocytes', ['Red blood cells', 'Platelets', 'Ciliated epithelial cells'], 'Memory cells formed in the primary response drive a faster secondary response.', 'Relate vaccination to clonal selection and immune memory.'),
  'Biology:AS practical skills': applicationSpec('A student tests light intensity on photosynthesis. Which variable should be kept constant to isolate the effect?', 'Temperature', ['Number of bubbles as the dependent variable', 'Light intensity itself', 'The stated hypothesis'], 'Temperature also affects reaction rate and must be controlled.', 'List independent, dependent and control variables before collecting data.'),
  'Energy and respiration': applicationSpec('A cell blocks oxidative phosphorylation. Which immediate change is expected?', 'ATP production from the electron-transport chain falls.', ['ATP production becomes unlimited.', 'DNA becomes the main respiratory substrate instantly.', 'Oxygen production by mitochondria increases.'], 'Oxidative phosphorylation is a major ATP-producing stage of aerobic respiration.', 'Locate each respiratory stage and its ATP contribution.'),
  Photosynthesis: applicationSpec('A plant receives light and water but no carbon dioxide. Which process is directly limited?', 'Carbon fixation in the Calvin cycle', ['Water photolysis only', 'Absorption of all photons', 'ATP hydrolysis in every cell'], 'Carbon dioxide supplies carbon for carbohydrate formation in the light-independent stage.', 'Identify which raw material feeds each photosynthetic stage.'),
  Homeostasis: applicationSpec('Blood glucose rises after a meal. Which response helps restore the set range?', 'Insulin promotes glucose uptake and storage.', ['Glucagon promotes further glucose release.', 'Effectors amplify the rise indefinitely.', 'Receptors stop monitoring glucose.'], 'Insulin lowers blood glucose through uptake and glycogen formation.', 'Trace stimulus, receptor, coordinator and effector in the feedback loop.'),
  'Control and coordination': applicationSpec('A response must be rapid, localised and short-lived. Which signalling system is most suitable?', 'Nervous signalling along neurones', ['A slow endocrine signal only', 'Passive diffusion through all tissues', 'Inheritance through gametes'], 'Nervous impulses provide rapid targeted communication.', 'Compare response speed, duration and target range.'),
  'Selection and evolution': applicationSpec('After many generations, a population has a higher frequency of an allele that improves survival. What has occurred?', 'Evolution by natural selection', ['An individual changed its inherited alleles by effort.', 'Only a non-heritable acclimatisation occurred.', 'No population-level change occurred.'], 'A heritable allele-frequency change across generations is evolution.', 'Frame evolution as a population change, not an individual intention.'),
  'Classification, biodiversity and conservation': applicationSpec('A conservation programme stores seeds from many genetically different individuals. Which diversity is protected most directly?', 'Genetic diversity', ['Only ecosystem diversity', 'Only daily population size', 'No form of biodiversity'], 'Different alleles preserved in the seed bank maintain genetic diversity.', 'Specify whether evidence concerns genes, species or ecosystems.'),
  'Genetic technology': applicationSpec('PCR is used before sequencing a tiny DNA sample. What is PCR doing?', 'Amplifying the target DNA region', ['Translating DNA into protein', 'Separating lipids by mass', 'Destroying every copy of the target'], 'PCR makes many copies of a selected DNA sequence.', 'Identify template, primers, polymerase and amplification cycles.'),
  'Biology:A2 planning, analysis and evaluation': applicationSpec('Results have increasing spread as the measured value rises. Which graph addition best communicates uncertainty?', 'Appropriately calculated error bars', ['A decorative title only', 'Deleting all high values', 'Changing units without explanation'], 'Error bars display variability or uncertainty around plotted values.', 'Choose an uncertainty measure that matches the data and repeats.'),
  'Atomic structure': applicationSpec('An atom has 11 protons and 12 neutrons. What are its atomic and mass numbers?', 'Atomic number 11, mass number 23', ['Atomic number 12, mass number 11', 'Atomic number 23, mass number 12', 'Atomic number 11, mass number 12'], 'Atomic number counts protons; mass number counts protons plus neutrons.', 'Write proton and neutron counts before assigning the two numbers.'),
  'Atoms, molecules and stoichiometry': applicationSpec('2H₂ + O₂ → 2H₂O. How many moles of water form from 3 mol O₂ with excess H₂?', '6 mol', ['1.5 mol', '3 mol', '9 mol'], 'The mole ratio O₂:H₂O is 1:2, so 3 mol O₂ forms 6 mol H₂O.', 'Use coefficients as mole ratios, then identify the limiting reactant.'),
  'Chemical bonding': applicationSpec('Which bonding model best explains electrical conduction in molten sodium chloride?', 'Mobile ions carry charge.', ['Fixed ions transfer electrons through the lattice.', 'Neutral molecules release photons.', 'Shared electron pairs move between molecules.'], 'Melting frees ions in an ionic lattice to move and carry current.', 'Relate conductivity to the mobile charged particles present.'),
  'States of matter': applicationSpec('A gas is compressed at constant temperature. What happens to its pressure?', 'It increases because wall collisions become more frequent.', ['It decreases because particles lose all motion.', 'It stays zero.', 'It becomes independent of volume.'], 'Smaller volume increases collision frequency with container walls.', 'Use the particle model to connect volume with pressure.'),
  'Chemical energetics': applicationSpec('Breaking bonds requires 500 kJ/mol and forming new bonds releases 650 kJ/mol. What is ΔH?', '-150 kJ/mol', ['+150 kJ/mol', '-1150 kJ/mol', '+1150 kJ/mol'], 'ΔH = energy in - energy out = 500 - 650 = -150 kJ/mol.', 'Separate bond-breaking input from bond-forming release.'),
  Electrochemistry: applicationSpec('A half-cell has E° = +0.80 V and another +0.34 V. What is E°cell when the first is reduced?', '+0.46 V', ['-0.46 V', '+1.14 V', '+0.27 V'], 'E°cell = E°cathode - E°anode = 0.80 - 0.34 = 0.46 V.', 'Identify reduction and oxidation half-cells before subtracting.'),
  Equilibria: applicationSpec('For an exothermic equilibrium, temperature is increased. Which direction is favoured?', 'The endothermic reverse direction', ['The exothermic forward direction only', 'Neither direction because equilibrium stops', 'Both directions stop permanently'], 'The system opposes added heat by favouring the endothermic direction.', 'Treat heat as a reactant or product when applying Le Chatelier’s principle.'),
  'Reaction kinetics': applicationSpec('A catalyst is added to a reaction mixture. Which energy-profile change occurs?', 'A lower activation-energy pathway is available.', ['The enthalpy change becomes zero.', 'Reactant energy permanently increases.', 'The equilibrium constant changes at fixed temperature.'], 'A catalyst changes pathway and activation energy, not reactant/product energy difference.', 'Separate kinetic effects from equilibrium thermodynamics.'),
  Periodicity: applicationSpec('Across Period 3, first ionisation energy generally rises. What is the main reason?', 'Nuclear charge rises while shielding changes relatively little.', ['Atomic radius always rises sharply.', 'Outer electrons enter lower principal shells.', 'Proton number decreases.'], 'Greater effective nuclear attraction holds the outer electron more strongly.', 'Compare nuclear charge, shielding and distance together.'),
  'Group 2': applicationSpec('Why does magnesium react less vigorously with water than calcium?', 'Reactivity increases down Group 2 as outer electrons are lost more easily.', ['Magnesium has more occupied electron shells than calcium.', 'Calcium forms only 1+ ions.', 'Reactivity decreases down every metal group.'], 'Increased shielding and radius down the group reduce attraction to outer electrons.', 'Use electron loss and atomic structure to explain group trends.'),
  'Group 17': applicationSpec('Chlorine water is added to aqueous potassium bromide. What forms?', 'Bromine, because chlorine is the stronger oxidising agent', ['Fluorine, because bromide oxidises chloride', 'No reaction because all halogens are identical', 'Only potassium metal'], 'Chlorine oxidises bromide ions to bromine.', 'Use the Group 17 oxidising-power trend to predict displacement.'),
  'Nitrogen and sulfur': applicationSpec('In the Haber process, increasing pressure shifts equilibrium toward ammonia. Why?', 'The product side has fewer gas molecules.', ['Ammonia is the only gas present.', 'Pressure changes the equilibrium constant.', 'The catalyst consumes nitrogen.'], 'Higher pressure favours the side with fewer gaseous moles.', 'Count gaseous stoichiometric coefficients on both sides.'),
  'AS organic chemistry': applicationSpec('Ethene reacts with bromine. What type of reaction occurs?', 'Electrophilic addition', ['Nucleophilic substitution', 'Free-radical substitution', 'Condensation polymer hydrolysis'], 'The electron-rich C=C bond polarises bromine and undergoes addition.', 'Identify the functional group before selecting a mechanism.'),
  'AS analytical techniques': applicationSpec('An IR spectrum has a broad absorption around 3200–3600 cm⁻¹. Which bond is suggested?', 'O–H', ['C=O only', 'C–Cl only', 'No covalent bond'], 'A broad absorption in this region is characteristic of O–H stretching.', 'Combine IR evidence with other spectra before assigning a whole structure.'),
  'Chemistry:AS practical skills': applicationSpec('A burette reading changes from 1.20 cm³ to 23.65 cm³. What titre should be recorded?', '22.45 cm³', ['22.4 cm³', '23.65 cm³', '24.85 cm³'], 'Titre = final - initial = 23.65 - 1.20 = 22.45 cm³.', 'Record volumetric readings and calculated titres to appropriate precision.'),
  'A2 energetics': applicationSpec('At 298 K, ΔH = -40 kJ/mol and ΔS = -0.050 kJ mol⁻¹ K⁻¹. What is ΔG?', '-25.1 kJ/mol', ['-54.9 kJ/mol', '+25.1 kJ/mol', '+54.9 kJ/mol'], 'ΔG = ΔH - TΔS = -40 - 298(-0.050) = -25.1 kJ/mol.', 'Use consistent energy units before calculating TΔS.'),
  'Transition elements': applicationSpec('A ligand donates a lone pair to a metal ion. What bond forms?', 'A coordinate covalent bond', ['An ionic bond formed by proton transfer', 'A metallic bond with no direction', 'A hydrogen bond only'], 'Both bonding electrons originate from the ligand donor atom.', 'Identify the electron-pair donor and acceptor in a complex.'),
  'A2 organic chemistry': applicationSpec('A nucleophile attacks a carbonyl carbon. Why is that carbon susceptible?', 'The C=O bond is polar and carbon is δ+.', ['Carbon carries a full negative charge.', 'Oxygen donates the carbon nucleus.', 'The C=O bond is completely non-polar.'], 'Electronegativity polarises the carbonyl bond, making carbon electrophilic.', 'Mark partial charges before drawing a mechanism.'),
  'A2 analytical techniques': applicationSpec('A proton NMR signal integrates to 3 relative units and is a triplet. Which local pattern is most consistent?', 'Three equivalent H adjacent to two equivalent H', ['One H adjacent to no H', 'Two H adjacent to three H', 'Three H adjacent to three equivalent H'], 'Integration gives three protons; n+1 splitting as a triplet implies two neighbours.', 'Use integration, splitting and chemical shift together.'),
  'Chemistry:A2 planning, analysis and evaluation': applicationSpec('A temperature-change experiment loses heat to the surroundings. How does this affect the measured exothermic ΔH magnitude?', 'It is underestimated.', ['It is overestimated.', 'It becomes exactly zero.', 'It changes sign to endothermic in every case.'], 'Heat loss makes the observed temperature rise too small, so calculated energy release is too small.', 'Link each experimental limitation to the direction of its effect.'),
  'Basic economic ideas and resource allocation': applicationSpec('A government uses land to build a hospital instead of housing. What is the opportunity cost?', 'The housing benefits forgone', ['The hospital’s accounting cost only', 'All future government spending', 'No cost because the hospital is useful'], 'Opportunity cost is the value of the next-best alternative forgone.', 'Name the sacrificed alternative rather than only the money spent.'),
  'The price system and the microeconomy': applicationSpec('Demand increases while supply is unchanged. What happens to equilibrium price and quantity?', 'Both rise', ['Both fall', 'Price rises and quantity falls', 'Price falls and quantity rises'], 'A rightward demand shift moves equilibrium up along the supply curve.', 'Draw both curves and move only the curve named in the scenario.'),
  'Government microeconomic intervention': applicationSpec('A per-unit tax is imposed on producers. What is the likely immediate market effect?', 'Supply shifts left/up and equilibrium quantity falls.', ['Demand shifts right and quantity rises.', 'Supply shifts right because costs fall.', 'The market price must fall to zero.'], 'A tax raises marginal cost, reducing supply at each price.', 'Identify whether a policy changes demand, supply or a market boundary.'),
  'The macroeconomy': applicationSpec('Nominal GDP grows 5% while the price level rises 3%. Approximately how much does real GDP grow?', 'About 2%', ['About 3%', 'About 5%', 'About 8%'], 'Approximate real growth equals nominal growth minus inflation: 5% - 3% = 2%.', 'Separate changes in output from changes in the price level.'),
  'Government macroeconomic intervention': applicationSpec('A central bank raises interest rates to reduce demand-pull inflation. Which channel is intended?', 'Borrowing and spending fall, reducing aggregate demand.', ['Borrowing rises and aggregate demand expands.', 'Productive capacity instantly doubles.', 'The exchange rate must become zero.'], 'Higher interest rates tend to discourage borrowing and interest-sensitive spending.', 'Trace a policy instrument through behaviour to the macroeconomic objective.'),
  'International economic issues': applicationSpec('A country’s currency appreciates. Which effect is most likely, other things equal?', 'Exports become dearer to foreign buyers.', ['Exports become cheaper to foreign buyers.', 'Imports become dearer in domestic currency.', 'The current account must immediately balance.'], 'Appreciation raises foreign-currency export prices and lowers domestic-currency import prices.', 'Track which currency is used for each price comparison.'),
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

export function normalizeOriginalFoundationCatalog(value) {
  if (value !== undefined && value !== null && typeof value !== 'string') return null
  const catalog = String(value || '').trim() || ORIGINAL_FOUNDATION_CATALOG_VERSION
  return [ORIGINAL_FOUNDATION_CATALOG_VERSION, ORIGINAL_FOUNDATION_V2_CATALOG_VERSION].includes(catalog) ? catalog : null
}

function catalogOption(options) {
  if (options === undefined) return ORIGINAL_FOUNDATION_CATALOG_VERSION
  const value = typeof options === 'string' ? options : options?.foundationCatalog
  return normalizeOriginalFoundationCatalog(value)
}

function applicationFor(entry) {
  const key = `${entry.subject}:${entry.topicName}`
  const spec = V2_APPLICATION_SPECS[key] || V2_APPLICATION_SPECS[entry.topicName]
  if (!spec) throw new Error(`Missing curated v2 application for ${entry.routeId}/${entry.topicId} (${entry.topicName}).`)
  return spec
}

function v2Feedback(entry, { misconceptionId = null } = {}) {
  return Object.freeze({
    schemaVersion: 'stem-original-foundation-feedback-v2',
    correctSummary: `Correct: ${entry.solution.summary}`,
    incorrectSummary: `Review the ${entry.topicName} reasoning and try the next step.`,
    explanation: entry.solution.explanation,
    nextStep: entry.solution.nextStep,
    misconceptionId,
  })
}

function v2EntryFrom(entry, itemKind) {
  const skillFocus = itemKind === 'concept' ? 'retrieve' : itemKind === 'application' ? 'apply' : 'transfer'
  const id = `original-foundation:${entry.routeId}:${entry.topicId}:v2:${itemKind}`
  const correctText = entry.options.find((option) => option.id === entry.correctOptionId)?.text || ''
  const misconceptions = entry.options.filter((option) => option.id !== entry.correctOptionId)
  const application = applicationFor(entry)
  let prompt
  let correct
  let distractors
  let explanation
  let nextStep
  let misconceptionId = null
  let applicationBasis
  let transferBasis
  if (itemKind === 'concept') {
    prompt = entry.prompt
    correct = correctText
    distractors = misconceptions.map((option) => option.text)
    explanation = entry.solution.summary
    nextStep = `Explain the ${entry.topicName} idea in your own words before moving to the application item.`
  } else if (itemKind === 'application') {
    prompt = application.prompt
    correct = application.correct
    distractors = [...application.distractors]
    explanation = application.explanation
    nextStep = application.nextStep
    applicationBasis = 'curated-scenario'
  } else {
    const misconception = misconceptions[stableNumber(id) % misconceptions.length]
    misconceptionId = `${id}:misconception:${misconception.id.toLowerCase()}`
    prompt = `A learner says, “${misconception.text}” Which response best corrects the claim?`
    correct = `Correction: ${correctText}`
    distractors = [
      `Correction: ${misconception.text}`,
      ...misconceptions.filter((option) => option.id !== misconception.id).slice(0, 2).map((option) => `Correction: ${option.text}`),
    ]
    explanation = `The claim is incorrect. ${entry.solution.summary}`
    nextStep = `State why the original claim fails, then apply the corrected ${entry.topicName} idea to a new example.`
    transferBasis = 'misconception-correction'
  }
  const options = Object.freeze(orderedOptions(id, correct, distractors))
  const correctOption = options.find((option) => option.text === correct)
  if (!correctOption || options.length !== 4) throw new Error(`${id} failed its four-option contract.`)
  const solution = Object.freeze({
    summary: `Correct answer: ${correct}`,
    explanation,
    nextStep,
    markPoints: Object.freeze([Object.freeze({
      id: `${id}:M1`,
      marks: 1,
      description: itemKind === 'concept'
        ? 'Retrieve the correct foundation concept.'
        : itemKind === 'application'
          ? 'Apply the topic correctly to the concrete scenario or data.'
          : 'Identify and correct the misconception.',
    })]),
  })
  const candidate = {
    schemaVersion: ORIGINAL_FOUNDATION_V2_SCHEMA_VERSION,
    catalogVersion: ORIGINAL_FOUNDATION_V2_CATALOG_VERSION,
    foundationCatalog: ORIGINAL_FOUNDATION_V2_CATALOG_VERSION,
    itemKind,
    skillFocus,
    id,
    routeId: entry.routeId,
    stage: entry.stage,
    subject: entry.subject,
    subjectCode: entry.subjectCode,
    topicId: entry.topicId,
    topicName: entry.topicName,
    sourceKind: entry.sourceKind,
    sourceAuthority: entry.sourceAuthority,
    displaySourceLabel: entry.displaySourceLabel,
    foundationBasis: 'curated-foundation',
    distractorBasis: 'curated-within-topic',
    prompt,
    answerType: 'single-choice',
    options,
    correctOptionId: correctOption.id,
    solution,
    feedback: null,
    misconceptionId,
    maxScore: 1,
    scoreScope: 'original-learning-only',
    formalProgressEligible: false,
    countsTowardFormalGrade: false,
    ...(applicationBasis ? { applicationBasis } : {}),
    ...(transferBasis ? { transferBasis } : {}),
  }
  candidate.feedback = v2Feedback(candidate, { misconceptionId })
  return Object.freeze(candidate)
}

const V2_CATALOG = Object.freeze(CATALOG.flatMap((entry) => (
  ORIGINAL_FOUNDATION_ITEM_KINDS.map((itemKind) => v2EntryFrom(entry, itemKind))
)))
const V2_CATALOG_BY_KEY = new Map(V2_CATALOG.map((entry) => [`${entry.routeId}\u0000${entry.topicId}\u0000${entry.itemKind}`, entry]))
const V2_CATALOG_BY_ID = new Map(V2_CATALOG.map((entry) => [entry.id, entry]))

function publicAnswerContract(entry) {
  if (entry.catalogVersion === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION) {
    return Object.freeze({
      schemaVersion: 'stem-original-foundation-answer-contract-v2',
      id: `${entry.id}:answer:v2`,
      foundationCatalog: ORIGINAL_FOUNDATION_V2_CATALOG_VERSION,
      responseType: 'single-choice',
      submissionEndpoint: ORIGINAL_FOUNDATION_SUBMISSION_ENDPOINT,
      maxScore: entry.maxScore,
      scoreScope: entry.scoreScope,
      reveal: 'after-submission',
    })
  }
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

export function originalFoundationCatalogEntries(options) {
  const catalog = catalogOption(options)
  if (catalog === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION) return V2_CATALOG
  return CATALOG
}

export function originalFoundationQuestion(routeId, topicId, options) {
  const catalog = catalogOption(options)
  if (catalog === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION) {
    const itemKind = String(options?.itemKind || 'concept')
    return V2_CATALOG_BY_KEY.get(`${String(routeId || '')}\u0000${String(topicId || '')}\u0000${itemKind}`) || null
  }
  return CATALOG_BY_KEY.get(`${String(routeId || '')}\u0000${String(topicId || '')}`) || null
}

export function publicOriginalFoundationQuestion(routeId, topicId, options) {
  const entry = originalFoundationQuestion(routeId, topicId, options)
  if (!entry) return null
  const projected = {
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
  }
  if (entry.catalogVersion === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION) {
    projected.foundationCatalog = entry.foundationCatalog
    projected.itemKind = entry.itemKind
    projected.skillFocus = entry.skillFocus
    projected.misconceptionId = entry.misconceptionId
  }
  return Object.freeze(projected)
}

export function originalFoundationQuestionGroup(routeId, topicId, {
  components = [],
  foundationCatalog = ORIGINAL_FOUNDATION_CATALOG_VERSION,
  itemKind = 'concept',
} = {}) {
  const normalizedCatalog = normalizeOriginalFoundationCatalog(foundationCatalog)
  const question = publicOriginalFoundationQuestion(routeId, topicId, {
    foundationCatalog: normalizedCatalog,
    itemKind,
  })
  if (!question) return null
  const v2 = normalizedCatalog === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION
  const partId = `${question.id}:part-1`
  const bindingSignature = `original:${crypto.createHash('sha256').update(JSON.stringify([
    question.id,
    question.catalogVersion,
    question.prompt,
    question.options,
  ])).digest('hex')}`
  const sourceBindingProvenance = Object.freeze({
    schemaVersion: v2 ? 'stem-original-foundation-binding-v2' : 'stem-original-foundation-binding-v1',
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
      ...(v2 ? {
        foundationCatalog: ORIGINAL_FOUNDATION_V2_CATALOG_VERSION,
        itemKind: question.itemKind,
        skillFocus: question.skillFocus,
      } : {}),
    })]),
    reviewStatus: 'original-authored',
    studyOnly: true,
    studentStudyEligible: true,
    formalProgressEligible: false,
    syllabusMapping: Object.freeze({
      schemaVersion: v2 ? 'original-foundation-syllabus-mapping-v2' : 'original-foundation-syllabus-mapping-v1',
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
    ...(v2 ? {
      foundationCatalog: ORIGINAL_FOUNDATION_V2_CATALOG_VERSION,
      itemKind: question.itemKind,
      skillFocus: question.skillFocus,
    } : {}),
  })
}

export function originalFoundationQuestionGroupsForRoute(routeId, topicIds, {
  components = [],
  foundationCatalog = ORIGINAL_FOUNDATION_CATALOG_VERSION,
} = {}) {
  const normalizedCatalog = normalizeOriginalFoundationCatalog(foundationCatalog)
  const requestedTopicIds = topicIds === undefined
    ? (routeById(routeId)?.syllabus?.topics || []).map((topic) => topic.id)
    : (Array.isArray(topicIds) ? topicIds : [topicIds])
  return [...new Set(requestedTopicIds.map((topicId) => String(topicId || '')).filter(Boolean))]
    .flatMap((topicId) => (
      normalizedCatalog === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION
        ? ORIGINAL_FOUNDATION_ITEM_KINDS.map((itemKind) => originalFoundationQuestionGroup(routeId, topicId, {
            components,
            foundationCatalog: normalizedCatalog,
            itemKind,
          }))
        : [originalFoundationQuestionGroup(routeId, topicId, { components })]
    ))
    .filter(Boolean)
}

export function decorateOriginalFoundationInventory(inventory, {
  foundationCatalog = ORIGINAL_FOUNDATION_CATALOG_VERSION,
} = {}) {
  const normalizedCatalog = normalizeOriginalFoundationCatalog(foundationCatalog)
  const v2 = normalizedCatalog === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION
  const topics = (inventory?.topics || []).map((topic) => {
    const originalAvailable = originalFoundationQuestion(inventory.routeId, topic.id, {
      foundationCatalog: normalizedCatalog,
      itemKind: 'concept',
    }) ? (v2 ? ORIGINAL_FOUNDATION_ITEM_KINDS.length : 1) : 0
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
      catalogVersion: normalizedCatalog,
      topicCount: topics.length,
      startableTopicCount: topics.filter((topic) => topic.chapterStudy.startable).length,
      gapTopicIds: Object.freeze(gapTopicIds),
      ...(v2 ? { foundationCatalog: ORIGINAL_FOUNDATION_V2_CATALOG_VERSION } : {}),
    }),
  }
}

export function scoreOriginalFoundationResponse(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
    || Object.keys(input).some((key) => !['foundationCatalog', 'routeId', 'syllabusTopicId', 'questionId', 'response'].includes(key))) {
    fail(400, 'original_foundation_response_invalid', 'The original foundation submission has unsupported fields.')
  }
  const { routeId, syllabusTopicId, questionId, response } = input
  const requestedCatalog = normalizeOriginalFoundationCatalog(input.foundationCatalog)
  if (!requestedCatalog) fail(400, 'original_foundation_response_invalid', 'foundationCatalog must be v1 or v2.')
  const idCatalog = V2_CATALOG_BY_ID.has(String(questionId || ''))
    ? ORIGINAL_FOUNDATION_V2_CATALOG_VERSION
    : ORIGINAL_FOUNDATION_CATALOG_VERSION
  if (requestedCatalog !== idCatalog) {
    fail(409, 'original_foundation_catalog_mismatch', 'The original foundation catalog capability does not match this question ID.')
  }
  const entry = requestedCatalog === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION
    ? V2_CATALOG_BY_ID.get(String(questionId || ''))
    : originalFoundationQuestion(routeId, syllabusTopicId)
  if (!entry || entry.id !== String(questionId || '')) {
    fail(404, 'original_foundation_question_not_found', 'This original foundation question is not available for the selected chapter.')
  }
  if (entry.routeId !== String(routeId || '') || entry.topicId !== String(syllabusTopicId || '')) {
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
  if (requestedCatalog === ORIGINAL_FOUNDATION_V2_CATALOG_VERSION) {
    return Object.freeze({
      schemaVersion: 'stem-original-foundation-result-v2',
      foundationCatalog: ORIGINAL_FOUNDATION_V2_CATALOG_VERSION,
      catalogVersion: entry.catalogVersion,
      routeId: entry.routeId,
      syllabusTopicId: entry.topicId,
      questionId: entry.id,
      itemKind: entry.itemKind,
      skillFocus: entry.skillFocus,
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
        explanation: entry.solution.explanation,
        nextStep: entry.solution.nextStep,
        markPoints: Object.freeze(entry.solution.markPoints.map((point) => Object.freeze({
          id: point.id,
          awarded: correct,
          marks: correct ? point.marks : 0,
          maxMarks: point.marks,
          reason: correct ? point.description : entry.feedback.incorrectSummary,
        }))),
      }),
      feedback: Object.freeze({
        schemaVersion: entry.feedback.schemaVersion,
        outcome: correct ? 'correct' : 'incorrect',
        misconceptionId: entry.misconceptionId || null,
        summary: correct ? entry.feedback.correctSummary : entry.feedback.incorrectSummary,
        explanation: entry.feedback.explanation,
        nextStep: entry.feedback.nextStep,
      }),
    })
  }
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
