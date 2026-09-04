/*
 * Cambridge International AS & A Level Mathematics 9709, 2026-2027.
 *
 * Topic codes and names follow the official subject-content chapters. Route
 * projections retain the official paper component while using M1, S1 and S2
 * as the student-facing labels for Papers 4, 5 and 6.
 */

export const CAMBRIDGE_9709_SYLLABUS_SOURCE = Object.freeze({
  board: 'Cambridge International',
  code: '9709',
  syllabusVersion: '2026-2027',
  officialUrl: 'https://www.cambridgeinternational.org/Images/697427-2026-2027-syllabus.pdf',
  subjectContentPages: Object.freeze([19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 37, 38, 39]),
  reviewStatus: 'source-published',
  assessmentComponents: Object.freeze([
    Object.freeze({ component: 1, stage: 'AS', track: 'theory', label: 'Paper 1 Pure Mathematics 1', studentLabel: 'P1' }),
    Object.freeze({ component: 2, stage: 'AS', track: 'theory', label: 'Paper 2 Pure Mathematics 2', studentLabel: 'P2' }),
    Object.freeze({ component: 3, stage: 'A2', track: 'theory', label: 'Paper 3 Pure Mathematics 3', studentLabel: 'P3' }),
    Object.freeze({ component: 4, stage: 'AS/A2', track: 'theory', label: 'Paper 4 Mechanics', studentLabel: 'M1' }),
    Object.freeze({ component: 5, stage: 'AS/A2', track: 'theory', label: 'Paper 5 Probability & Statistics 1', studentLabel: 'S1' }),
    Object.freeze({ component: 6, stage: 'A2', track: 'theory', label: 'Paper 6 Probability & Statistics 2', studentLabel: 'S2' }),
  ]),
})

const COMPONENT_TOPICS = Object.freeze({
  1: Object.freeze([
    ['9709-p1-topic-01', '1.1', 'Quadratics', 19],
    ['9709-p1-topic-02', '1.2', 'Functions', 19],
    ['9709-p1-topic-03', '1.3', 'Coordinate geometry', 20],
    ['9709-p1-topic-04', '1.4', 'Circular measure', 20],
    ['9709-p1-topic-05', '1.5', 'Trigonometry', 21],
    ['9709-p1-topic-06', '1.6', 'Series', 21],
    ['9709-p1-topic-07', '1.7', 'Differentiation', 22],
    ['9709-p1-topic-08', '1.8', 'Integration', 22],
  ]),
  2: Object.freeze([
    ['9709-p2-topic-01', '2.1', 'Algebra', 23],
    ['9709-p2-topic-02', '2.2', 'Logarithmic and exponential functions', 23],
    ['9709-p2-topic-03', '2.3', 'Trigonometry', 24],
    ['9709-p2-topic-04', '2.4', 'Differentiation', 24],
    ['9709-p2-topic-05', '2.5', 'Integration', 25],
    ['9709-p2-topic-06', '2.6', 'Numerical solution of equations', 25],
  ]),
  3: Object.freeze([
    ['9709-p3-topic-01', '3.1', 'Algebra', 26],
    ['9709-p3-topic-02', '3.2', 'Logarithmic and exponential functions', 27],
    ['9709-p3-topic-03', '3.3', 'Trigonometry', 27],
    ['9709-p3-topic-04', '3.4', 'Differentiation', 28],
    ['9709-p3-topic-05', '3.5', 'Integration', 28],
    ['9709-p3-topic-06', '3.6', 'Numerical solution of equations', 29],
    ['9709-p3-topic-07', '3.7', 'Vectors', 29],
    ['9709-p3-topic-08', '3.8', 'Differential equations', 29],
    ['9709-p3-topic-09', '3.9', 'Complex numbers', 30],
  ]),
  4: Object.freeze([
    ['9709-m1-topic-01', '4.1', 'Forces and equilibrium', 31],
    ['9709-m1-topic-02', '4.2', 'Kinematics of motion in a straight line', 32],
    ['9709-m1-topic-03', '4.3', 'Momentum', 32],
    ['9709-m1-topic-04', '4.4', "Newton's laws of motion", 33],
    ['9709-m1-topic-05', '4.5', 'Energy, work and power', 33],
  ]),
  5: Object.freeze([
    ['9709-s1-topic-01', '5.1', 'Representation of data', 34],
    ['9709-s1-topic-02', '5.2', 'Permutations and combinations', 34],
    ['9709-s1-topic-03', '5.3', 'Probability', 35],
    ['9709-s1-topic-04', '5.4', 'Discrete random variables', 35],
    ['9709-s1-topic-05', '5.5', 'The normal distribution', 36],
  ]),
  6: Object.freeze([
    ['9709-s2-topic-01', '6.1', 'The Poisson distribution', 37],
    ['9709-s2-topic-02', '6.2', 'Linear combinations of random variables', 37],
    ['9709-s2-topic-03', '6.3', 'Continuous random variables', 38],
    ['9709-s2-topic-04', '6.4', 'Sampling and estimation', 38],
    ['9709-s2-topic-05', '6.5', 'Hypothesis tests', 39],
  ]),
})

const TOPIC_OUTCOMES = Object.freeze({
  '1.1': Object.freeze([
    'carry out the process of completing the square for a quadratic polynomial ax^2 + bx + c and use a completed square form',
    'find the discriminant of a quadratic polynomial ax^2 + bx + c and use the discriminant',
    'solve quadratic equations, and quadratic inequalities, in one unknown',
    'solve by substitution a pair of simultaneous equations of which one is linear and one is quadratic',
    'recognise and solve equations in x which are quadratic in some function of x',
  ]),
  '1.2': Object.freeze([
    'understand the terms function, domain, range, one-one function, inverse function and composition of functions',
    'identify the range of a given function in simple cases, and find the composition of two given functions',
    'determine whether or not a given function is one-one, and find the inverse of a one-one function in simple cases',
    'illustrate in graphical terms the relation between a one-one function and its inverse',
    'understand and use transformations of the graph of y = f(x) given by y = f(x) + a, y = f(x + a), y = af(x), y = f(ax) and simple combinations of these',
  ]),
  '1.3': Object.freeze([
    'find the equation of a straight line given sufficient information',
    'interpret and use any of the forms y = mx + c, y - y1 = m(x - x1), ax + by + c = 0 in solving problems',
    'understand that the equation (x - a)^2 + (y - b)^2 = r^2 represents the circle with centre (a, b) and radius r',
    'use algebraic methods to solve problems involving lines and circles',
    'understand the relationship between a graph and its associated algebraic equation, and use the relationship between points of intersection of graphs and solutions of equations',
  ]),
  '1.4': Object.freeze([
    'understand the definition of a radian, and use the relationship between radians and degrees',
    'use the formulae s = r theta and A = 1/2 r^2 theta in solving problems concerning the arc length and sector area of a circle',
  ]),
  '1.5': Object.freeze([
    'sketch and use graphs of the sine, cosine and tangent functions for angles of any size, using either degrees or radians',
    'use the exact values of the sine, cosine and tangent of 30 degrees, 45 degrees, 60 degrees, and related angles',
    'use the notations sin^-1 x, cos^-1 x and tan^-1 x to denote the principal values of the inverse trigonometric relations',
    'use the identities tan theta = sin theta / cos theta and sin^2 theta + cos^2 theta = 1',
    'find all the solutions of simple trigonometrical equations lying in a specified interval',
  ]),
  '1.6': Object.freeze([
    'use the expansion of (a + b)^n, where n is a positive integer',
    'recognise arithmetic and geometric progressions',
    'use the formulae for the nth term and for the sum of the first n terms to solve problems involving arithmetic or geometric progressions',
    'use the condition for the convergence of a geometric progression, and the formula for the sum to infinity of a convergent geometric progression',
  ]),
  '1.7': Object.freeze([
    'understand the gradient of a curve at a point as the limit of the gradients of a suitable sequence of chords, and use the notations f\' (x), f\'\' (x), dy/dx and d2y/dx2 for first and second derivatives',
    'use the derivative of x^n for any rational n, together with constant multiples, sums and differences of functions, and of composite functions using the chain rule',
    'apply differentiation to gradients, tangents and normals, increasing and decreasing functions and rates of change',
    'locate stationary points and determine their nature, and use information about stationary points in sketching graphs',
  ]),
  '1.8': Object.freeze([
    'understand integration as the reverse process of differentiation, and integrate (ax + b)^n for any rational n except -1, together with constant multiples, sums and differences',
    'solve problems involving the evaluation of a constant of integration',
    'evaluate definite integrals',
    'use definite integration to find the area of a region bounded by a curve and lines parallel to the axes, or between a curve and a line or between two curves, and a volume of revolution about one of the axes',
  ]),
  '2.1': Object.freeze([
    'understand the meaning of |x|, sketch the graph of y = |ax + b| and use relations such as |a| = |b| if and only if a^2 = b^2 and |x - a| < b if and only if a - b < x < a + b when solving equations and inequalities',
    'divide a polynomial, of degree not exceeding 4, by a linear or quadratic polynomial, and identify the quotient and remainder (which may be zero)',
    'use the factor theorem and the remainder theorem',
  ]),
  '2.2': Object.freeze([
    'understand the relationship between logarithms and indices, and use the laws of logarithms excluding change of base',
    'understand the definition and properties of e^x and ln x, including their relationship as inverse functions and their graphs',
    'use logarithms to solve equations and inequalities in which the unknown appears in indices',
    'use logarithms to transform a given relationship to linear form, and hence determine unknown constants by considering the gradient and/or intercept',
  ]),
  '2.3': Object.freeze([
    'understand the relationship of the secant, cosecant and cotangent functions to cosine, sine and tangent, and use properties and graphs of all six trigonometric functions for angles of any magnitude',
    'use trigonometrical identities for the simplification and exact evaluation of expressions, and in the course of solving equations, selecting identities appropriate to the context, including sec^2(theta) = 1 + tan^2(theta), cosec^2(theta) = 1 + cot^2(theta), the expansions of sin(A +/- B), cos(A +/- B) and tan(A +/- B), the formulae for sin(2A), cos(2A) and tan(2A), and the R sin(theta +/- alpha) and R cos(theta +/- alpha) forms',
  ]),
  '2.4': Object.freeze([
    'use the derivatives of e^x, ln x, sin x, cos x and tan x, together with constant multiples, sums, differences and composites',
    'differentiate products and quotients',
    'find and use the first derivative of a function which is defined parametrically or implicitly',
  ]),
  '2.5': Object.freeze([
    'extend the idea of reverse differentiation to include the integration of exp(ax + b), 1/(ax + b), sin(ax + b), cos(ax + b) and sec^2(ax + b)',
    'use trigonometrical relationships in carrying out integration',
    'understand and use the trapezium rule to estimate the value of a definite integral',
  ]),
  '2.6': Object.freeze([
    'locate approximately a root of an equation by means of graphical considerations and/or searching for a sign change',
    'understand the idea of, and use the notation for, a sequence of approximations which converges to a root of an equation',
    'understand how a given simple iterative formula of the form x_(n+1) = F(x_n) relates to the equation being solved, and use a given iteration, or an iteration based on a given rearrangement of an equation, to determine a root to a prescribed degree of accuracy',
  ]),
  '3.1': Object.freeze([
    'understand the meaning of |x|, sketch the graph of y = |ax + b| and use relations such as |a| = |b| if and only if a^2 = b^2 and |x - a| < b if and only if a - b < x < a + b when solving equations and inequalities',
    'divide a polynomial, of degree not exceeding 4, by a linear or quadratic polynomial, and identify the quotient and remainder (which may be zero)',
    'use the factor theorem and the remainder theorem',
    'recall an appropriate form for expressing rational functions in partial fractions, and carry out the decomposition when the denominator is no more complicated than (ax + b)(cx + d)(ex + f), (ax + b)(cx + d)^2 or (ax + b)(cx^2 + d)',
    'use the expansion of (1 + x)^n, where n is a rational number and |x| < 1, including adapted expansions and determining the set of values of x for which the expansion is valid',
  ]),
  '3.2': Object.freeze([
    'understand the relationship between logarithms and indices, and use the laws of logarithms excluding change of base',
    'understand the definition and properties of e^x and ln x, including their relationship as inverse functions and their graphs',
    'use logarithms to solve equations and inequalities in which the unknown appears in indices',
    'use logarithms to transform a given relationship to linear form, and hence determine unknown constants by considering the gradient and/or intercept',
  ]),
  '3.3': Object.freeze([
    'understand the relationship of the secant, cosecant and cotangent functions to cosine, sine and tangent, and use properties and graphs of all six trigonometric functions for angles of any magnitude',
    'use trigonometrical identities for simplification and exact evaluation of expressions and in solving equations, selecting identities appropriate to the context',
  ]),
  '3.4': Object.freeze([
    'use the derivatives of e^x, ln x, sin x, cos x, tan x and tan^-1 x, together with constant multiples, sums, differences and composites',
    'differentiate products and quotients',
    'find and use the first derivative of a function which is defined parametrically or implicitly',
  ]),
  '3.5': Object.freeze([
    'extend the idea of reverse differentiation to include the integration of exp(ax + b), 1/(ax + b), sin(ax + b), cos(ax + b), sec^2(ax + b), 1/(x^2 + a^2), and inverse-tangent forms',
    'use trigonometrical relationships in carrying out integration',
    'integrate rational functions by means of decomposition into partial fractions of the specified forms',
    "recognise an integrand of the form k f'(x) / f(x), and integrate such functions",
    'recognise when an integrand can usefully be regarded as a product, and use integration by parts',
    'use a given substitution to simplify and evaluate either a definite or an indefinite integral',
  ]),
  '3.6': Object.freeze([
    'locate approximately a root of an equation by means of graphical considerations and/or searching for a sign change',
    'understand the idea of, and use the notation for, a sequence of approximations which converges to a root of an equation',
    'understand how a given simple iterative formula relates to the equation being solved, and use an iteration to determine a root to a prescribed degree of accuracy',
  ]),
  '3.7': Object.freeze([
    'use standard notations for vectors in two and three dimensions, including column vectors, xi + yj, three-dimensional column vectors, xi + yj + zk, AB and a',
    'carry out addition and subtraction of vectors and multiplication of a vector by a scalar, and interpret these operations in geometrical terms',
    'calculate the magnitude of a vector, and use unit vectors, displacement vectors and position vectors',
    'understand the significance of all the symbols in the vector equation of a straight line, and find the equation of a line given sufficient information',
    'determine whether two lines are parallel, intersect or are skew, and find the point of intersection of two lines when it exists',
    'use formulae to calculate the scalar product of two vectors, and use scalar products in problems involving lines and points',
  ]),
  '3.8': Object.freeze([
    'formulate a simple statement involving a rate of change as a differential equation',
    'find by integration a general form of solution for a first order differential equation in which the variables are separable',
    'use an initial condition to find a particular solution',
    'interpret the solution of a differential equation in the context of a problem being modelled by the equation',
  ]),
  '3.9': Object.freeze([
    'understand the idea of a complex number, recall the meaning of the terms real part, imaginary part, modulus, argument and conjugate, and use the fact that two complex numbers are equal if and only if both real and imaginary parts are equal',
    'carry out operations of addition, subtraction, multiplication and division of two complex numbers expressed in Cartesian form x + iy',
    'use the result that, for a polynomial equation with real coefficients, any non-real roots occur in conjugate pairs',
    'represent complex numbers geometrically by means of an Argand diagram',
    'carry out operations of multiplication and division of two complex numbers expressed in polar form',
    'find the two square roots of a complex number',
    'understand in simple terms the geometrical effects of conjugating a complex number and of arithmetic operations on complex numbers',
    'illustrate simple equations and inequalities involving complex numbers by means of loci in an Argand diagram',
  ]),
  '4.1': Object.freeze([
    'identify the forces acting in a given situation',
    'understand the vector nature of force, and find and use components and resultants',
    'use the principle that, when a particle is in equilibrium, the vector sum of the forces acting is zero, or equivalently that the sum of the components in any direction is zero',
    'understand that a contact force between two surfaces can be represented by normal and frictional components',
    'use the model of a smooth contact, and understand the limitations of this model',
    'understand limiting friction and limiting equilibrium, recall the definition of coefficient of friction, and use the appropriate relationship',
    "use Newton's third law",
  ]),
  '4.2': Object.freeze([
    'understand distance and speed as scalar quantities, and displacement, velocity and acceleration as vector quantities',
    'sketch and interpret displacement-time graphs and velocity-time graphs, and in particular appreciate that the area under a velocity-time graph represents displacement, the gradient of a displacement-time graph represents velocity, and the gradient of a velocity-time graph represents acceleration',
    'use differentiation and integration with respect to time to solve simple problems concerning displacement, velocity and acceleration',
    'use appropriate formulae for motion with constant acceleration in a straight line',
  ]),
  '4.3': Object.freeze([
    'use the definition of linear momentum and show understanding of its vector nature',
    'use conservation of linear momentum to solve problems that may be modelled as the direct impact of two bodies',
  ]),
  '4.4': Object.freeze([
    "apply Newton's laws of motion to the linear motion of a particle of constant mass moving under the action of constant forces, which may include friction, tension in an inextensible string and thrust in a connecting rod",
    'use the relationship between mass and weight W = mg',
    'solve simple problems modelled as a particle moving vertically or on an inclined plane with constant acceleration',
    'solve simple problems which may be modelled as the motion of connected particles',
  ]),
  '4.5': Object.freeze([
    'understand the concept of the work done by a force, and calculate the work done by a constant force when its point of application undergoes a displacement not necessarily parallel to the force',
    'understand gravitational potential energy and kinetic energy, and use appropriate formulae',
    'understand and use the relationship between the change in energy of a system and the work done by the external forces, and use in appropriate cases the principle of conservation of energy',
    'use the definition of power as the rate at which a force does work, and use the relationship between power, force and velocity for a force acting in the direction of motion',
    'solve problems involving, for example, the instantaneous acceleration of a car moving on a hill against a resistance',
  ]),
  '5.1': Object.freeze([
    'select a suitable way of presenting raw statistical data, and discuss advantages and/or disadvantages of particular representations',
    'draw and interpret stem-and-leaf diagrams, box-and-whisker plots, histograms and cumulative frequency graphs',
    'understand and use different measures of central tendency (mean, median, mode) and variation (range, interquartile range, standard deviation)',
    'use a cumulative frequency graph',
    'calculate and use the mean and standard deviation of a set of data, including grouped data, either from the data itself or from given totals sum(x) and sum(x^2), or coded totals sum(x - a) and sum((x - a)^2), and use such totals in solving problems which may involve up to two data sets',
  ]),
  '5.2': Object.freeze([
    'understand the terms permutation and combination, and solve simple problems involving selections',
    'solve problems about arrangements of objects in a line, including repetition and restriction',
  ]),
  '5.3': Object.freeze([
    'evaluate probabilities in simple cases by enumeration of equiprobable elementary events or calculation using permutations or combinations',
    'use addition and multiplication of probabilities, as appropriate, in simple cases',
    'understand exclusive and independent events, including determination of whether events are independent',
    'calculate and use conditional probabilities in simple cases',
  ]),
  '5.4': Object.freeze([
    'draw up a probability distribution table for a discrete random variable X, and calculate E(X) and Var(X)',
    'use formulae for probabilities for the binomial and geometric distributions, and recognise practical situations where these distributions are suitable models',
    'use formulae for expectation and variance of the binomial distribution and expectation of the geometric distribution',
  ]),
  '5.5': Object.freeze([
    'understand the use of a normal distribution to model a continuous random variable, and use normal distribution tables',
    'solve problems concerning a variable X, where X has a normal distribution, including finding the value of P(X > x1), or a related probability, given the values of x1, mu and sigma, and finding a relationship between x1, mu and sigma given the value of P(X > x1) or a related probability',
    'recall conditions under which the normal distribution approximates the binomial distribution, and use this approximation with a continuity correction',
  ]),
  '6.1': Object.freeze([
    'use formulae to calculate probabilities for a Poisson distribution',
    'use the fact that the mean and variance of a Poisson random variable are each equal to its parameter',
    'understand the relevance of the Poisson distribution to random events, and use the Poisson distribution as a model',
    'use the Poisson distribution as an approximation to the binomial distribution where appropriate',
    'use the normal distribution, with continuity correction, as an approximation to the Poisson distribution where appropriate',
  ]),
  '6.2': Object.freeze([
    'use, when solving problems, the results that E(aX + b) = aE(X) + b, Var(aX + b) = a^2 Var(X), E(aX + bY) = aE(X) + bE(Y), Var(aX + bY) = a^2 Var(X) + b^2 Var(Y) for independent X and Y, that aX + b is normal if X is normal, that aX + bY is normal for independent normal X and Y, and that X + Y is Poisson for independent Poisson X and Y',
  ]),
  '6.3': Object.freeze([
    'understand the concept of a continuous random variable, and recall and use properties of a probability density function',
    'use a probability density function to solve problems involving probabilities, and calculate the mean and variance of a distribution',
  ]),
  '6.4': Object.freeze([
    'understand the distinction between a sample and a population, and appreciate the necessity for randomness in choosing samples',
    'explain in simple terms why a given sampling method may be unsatisfactory',
    'recognise that a sample mean can be regarded as a random variable, and use the facts that E(X-bar) = mu and Var(X-bar) = sigma^2/n',
    'use the fact that a sample mean has a normal distribution if the population variable has a normal distribution',
    'use the Central Limit Theorem where appropriate',
    'calculate unbiased estimates of the population mean and variance from a sample, using raw or summarised data',
    'determine and interpret a confidence interval for a population mean in cases where the population is normally distributed with known variance or where a large sample is used',
    'determine, from a large sample, an approximate confidence interval for a population proportion',
  ]),
  '6.5': Object.freeze([
    'understand the nature of a hypothesis test, the difference between one-tailed and two-tailed tests, and the terms null hypothesis, alternative hypothesis, significance level, rejection region (or critical region), acceptance region and test statistic',
    'formulate hypotheses and carry out a hypothesis test in the context of a single observation from a population which has a binomial or Poisson distribution, using direct evaluation of probabilities or a normal approximation to the binomial or the Poisson distribution, where appropriate',
    'formulate hypotheses and carry out a hypothesis test concerning the population mean in cases where the population is normally distributed with known variance or where a large sample is used',
    'understand the terms Type I error and Type II error in relation to hypothesis tests',
    'calculate the probabilities of making Type I and Type II errors in specific situations involving tests based on a normal distribution or direct evaluation of binomial or Poisson probabilities',
  ]),
})

const COMPONENT_SCOPE = Object.freeze({
  1: Object.freeze({ component: 1, notes: Object.freeze([]) }),
  2: Object.freeze({ component: 2, notes: Object.freeze(['Knowledge of the content for Paper 1: Pure Mathematics 1 is assumed, and candidates may be required to demonstrate such knowledge in answering questions.']) }),
  3: Object.freeze({ component: 3, notes: Object.freeze(['Knowledge of the content of Paper 1: Pure Mathematics 1 is assumed, and candidates may be required to demonstrate such knowledge in answering questions.']) }),
  4: Object.freeze({ component: 4, notes: Object.freeze(['Questions set will be mainly numerical, and will aim to test mechanical principles without involving difficult algebra or trigonometry.', 'However, candidates should be familiar in particular with the following trigonometrical results: sin(theta - 90 degrees) = -cos(theta), cos(theta - 90 degrees) = sin(theta), tan(theta) = sin(theta) / cos(theta), and sin^2(theta) + cos^2(theta) = 1.', 'Knowledge of algebraic methods from the content for Paper 1: Pure Mathematics 1 is assumed.', "This content list refers to the equilibrium or motion of a 'particle'. Examination questions may involve extended bodies in a 'realistic' context, but these extended bodies should be treated as particles, so any force acting on them is modelled as acting at a single point.", 'Vector notation will not be used in the question papers.']) }),
  5: Object.freeze({ component: 5, notes: Object.freeze(['Questions set will be mainly numerical, and will test principles in probability and statistics without involving knowledge of algebraic methods beyond the content for Paper 1: Pure Mathematics 1.', "Knowledge of the following probability notation is also assumed: P(A), P(A and B), P(A or B), P(A|B) and the use of A' to denote the complement of A."]) }),
  6: Object.freeze({ component: 6, notes: Object.freeze(['Knowledge of the content of Paper 5: Probability & Statistics 1 is assumed, and candidates may be required to demonstrate such knowledge in answering questions.', 'Knowledge of calculus within the content for Paper 3: Pure Mathematics 3 will also be assumed.']) }),
})

const TOPIC_NOTES = Object.freeze({
  '1.1': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Example: locate the vertex of y = ax^2 + bx + c or sketch the graph.']),
    2: Object.freeze(['Example: determine the number of real roots of ax^2 + bx + c = 0. Knowledge of the term repeated root is included.']),
    3: Object.freeze(['Use factorising, completing the square and the formula.']),
    4: Object.freeze(['Examples include x + y + 1 = 0 with x^2 + y^2 = 25, and 2x + 3y = 7 with 3x^2 = 4 + 4xy.']),
    5: Object.freeze(['Examples include x^4 - 5x^2 + 4 = 0 and tan^2(x) = 1 + tan(x).']),
  }) }),
  '1.2': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['A composite function gf can only be formed when the range of f is within the domain of g.']),
    4: Object.freeze(['Sketches should include the mirror line y = x.']),
    5: Object.freeze(['Use the terms translation, reflection and stretch. Questions may involve algebraic or trigonometric functions or other graphs with given features.']),
  }) }),
  '1.3': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Examples include two points, or one point and the gradient.']),
    2: Object.freeze(['Include distances, gradients, midpoints, points of intersection, and the relationship between gradients of parallel and perpendicular lines.']),
    3: Object.freeze(['Include the expanded form x^2 + y^2 + 2gx + 2fy + c = 0.']),
    4: Object.freeze(['Use elementary geometrical properties of circles, such as tangent perpendicular to radius, angle in a semicircle and symmetry. Implicit differentiation is not included.']),
    5: Object.freeze(['Example: determine the values of k for which y = x + k intersects, touches or does not meet a quadratic curve.']),
  }) }),
  '1.4': Object.freeze({ outcomes: Object.freeze({ 2: Object.freeze(['Include calculation of lengths and angles in triangles and areas of triangles.']) }) }),
  '1.5': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Examples include y = 3 sin(x), y = 1 - cos(2x) and y = tan(x) + 1/4.']),
    3: Object.freeze(['No specialised knowledge of these functions is required, but understanding of them as examples of inverse functions is expected.']),
    4: Object.freeze(['Use the identities in proving identities, simplifying expressions and solving equations.']),
    5: Object.freeze(['General forms of solution are not included.']),
  }) }),
  '1.6': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['The notations nCr and n! are included. Knowledge of the greatest term and properties of the coefficients is not required.']),
    3: Object.freeze(['Numbers a, b, c are in arithmetic progression if 2b = a + c, or equivalently in geometric progression if b^2 = ac. Questions may involve more than one progression.']),
  }) }),
  '1.7': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Only an informal understanding of the idea of a limit is expected. This includes consideration of the gradient of the chord joining the points with x coordinates 2 and (2 + h) on the curve y = x^3. Formal use of the general method of differentiation from first principles is not required.']),
    3: Object.freeze(['Including connected rates of change, for example, given the rate of increase of the radius of a circle, find the rate of increase of the area for a specific value of one of the variables.']),
    4: Object.freeze(['Including use of the second derivative for identifying maxima and minima; alternatives may be used in questions where no method is specified. Knowledge of points of inflexion is not included.']),
  }) }),
  '1.8': Object.freeze({ outcomes: Object.freeze({
    3: Object.freeze(['Simple cases of improper integrals are included.']),
    4: Object.freeze(['A volume of revolution may involve a region not bounded by the axis of rotation.']),
  }) }),
  '2.1': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Graphs of y = |f(x)| and y = f(|x|) for non-linear functions f are not included.']),
    3: Object.freeze(['Examples include finding factors and remainders, solving polynomial equations and evaluating unknown coefficients. Factors of the form ax + b with non-unit x coefficient and calculation of remainders are included.']),
  }) }),
  '2.2': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Include the graph of y = e^(kx) for both positive and negative values of k.']),
    4: Object.freeze(['Examples include transforming y = kx^n to ln(y) = ln(k) + n ln(x), and y = k(a^x) to ln(y) = ln(k) + x ln(a).']),
  }) }),
  '2.3': Object.freeze({ outcomes: Object.freeze({ 2: Object.freeze(['Use sec^2(theta) = 1 + tan^2(theta), cosec^2(theta) = 1 + cot^2(theta), the expansions of sin(A +/- B), cos(A +/- B) and tan(A +/- B), the double-angle formulae, and the R sin(theta +/- alpha) and R cos(theta +/- alpha) forms.']) }) }),
  '2.4': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Examples include differentiating products and quotients.']),
    3: Object.freeze(['Examples include parametric and implicit functions. Include problems involving tangents and normals.']),
  }) }),
  '2.5': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Knowledge of the general method of integration by substitution is not required.']),
    2: Object.freeze(['Examples include using double-angle formulae to integrate sin^2(x) or cos^2(2x).']),
    3: Object.freeze(['Use sketch graphs in simple cases to determine whether the trapezium rule gives an over-estimate or an under-estimate.']),
  }) }),
  '2.6': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Example: find a pair of consecutive integers between which a root lies.']),
    3: Object.freeze(['Knowledge of the condition for convergence is not included, but an understanding that an iteration may fail to converge is expected.']),
  }) }),
  '3.1': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Graphs of y = |f(x)| and y = f(|x|) for non-linear functions f are not included.']),
    4: Object.freeze(['The denominator is restricted to (ax + b)(cx + d)(ex + f), (ax + b)(cx + d)^2 or (ax + b)(cx^2 + d). A numerator with degree exceeding the denominator is excluded.']),
    5: Object.freeze(['Finding the general term is not included. Adapting the standard series and determining the valid set of x values are included.']),
  }) }),
  '3.2': Object.freeze({ outcomes: Object.freeze({ 2: Object.freeze(['Include the graph of y = e^(kx) for both positive and negative values of k.']) }) }),
  '3.3': Object.freeze({ outcomes: Object.freeze({ 2: Object.freeze(['Use the specified secant, cosecant, compound-angle, double-angle and R-form identities.']) }) }),
  '3.4': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Derivatives of sin^-1(x) and cos^-1(x) are not required.']),
    3: Object.freeze(['Include problems involving tangents and normals.']),
  }) }),
  '3.5': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Include exp(ax + b), 1/(ax + b), sin(ax + b), cos(ax + b), sec^2(ax + b), 1/(x^2 + a^2) and examples such as 1/(x^2 + 3^2).']),
    3: Object.freeze(['Restricted to the partial-fraction types specified in topic 3.1.']),
    4: Object.freeze(['Examples include k f\' (x) / f(x), 1/(x^2 + 1) and tan(x).']),
    5: Object.freeze(['Examples include x sin(2x), x^2 exp(-x), ln(x) and x tan^-1(x).']),
    6: Object.freeze(['Example: integrate sin^2(x) cos(x) using u = sin(x).']),
  }) }),
  '3.6': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Example: find a pair of consecutive integers between which a root lies.']),
    3: Object.freeze(['Knowledge of the condition for convergence is not included, but an understanding that an iteration may fail to converge is expected.']),
  }) }),
  '3.7': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Use column-vector, unit-vector, position-vector and AB notation in two and three dimensions.']),
    2: Object.freeze(['The general form of the ratio theorem is not included, but the midpoint result is expected.']),
    5: Object.freeze(['The shortest distance between two skew lines and the equation of their common perpendicular are not required.']),
    6: Object.freeze(['Knowledge of the vector product is not required.']),
  }) }),
  '3.8': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['The introduction and evaluation of a constant of proportionality, where necessary, is included.']),
    2: Object.freeze(['Include integration techniques from topic 3.5.']),
    4: Object.freeze(['No specialised knowledge of a real-life context is required.']),
  }) }),
  '3.9': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['The notations Re(z), Im(z), |z|, arg(z) and z* should be known. Arguments usually use -pi < theta <= pi, but 0 <= theta < 2pi may be used when convenient.']),
    2: Object.freeze(['Full details of working should be shown.']),
    5: Object.freeze(['Include |z1 z2| = |z1||z2| and arg(z1 z2) = arg(z1) + arg(z2), with corresponding results for division.']),
    6: Object.freeze(['Example: the square roots of 5 + 12i in exact Cartesian form. Full details of working should be shown.']),
  }) }),
  '4.1': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['A force diagram may be required.']),
    2: Object.freeze(['Calculations are required; approximate solutions by scale drawing are not accepted.']),
    3: Object.freeze(['Solutions by resolving are usually expected. Equivalent methods may be accepted but are not required knowledge.']),
    6: Object.freeze(['Use F = mu R or F <= mu R as appropriate. Terminology such as about to slip may mean limiting equilibrium.']),
  }) }),
  '4.2': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Restricted to motion in one dimension only. Deceleration may be used for decreasing speed.']),
    3: Object.freeze(['Calculus is restricted to techniques from Paper 1: Pure Mathematics 1.']),
    4: Object.freeze(['Questions may require more than one equation and information about different particles.']),
  }) }),
  '4.3': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Restricted to motion in one dimension only.']),
    2: Object.freeze(['Direct impact where the bodies coalesce on impact is included. Impulse and the coefficient of restitution are not required.']),
  }) }),
  '4.4': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Other resisting forces, such as air resistance, will be indicated in the question.']),
    2: Object.freeze(['Questions are mainly numerical and use the approximate value g = 10 m s^-2.']),
    3: Object.freeze(['Examples include a particle on a rough plane with different acceleration up and down the plane.']),
    4: Object.freeze(['Examples include a light inextensible string over a smooth pulley and a car towing a trailer.']),
  }) }),
  '4.5': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Use W = Fd cos(theta); knowledge of the scalar product is not required.']),
    3: Object.freeze(['Overall energy changes may be considered when motion is not linear.']),
    4: Object.freeze(['For P = Fv, the force acts in the direction of motion. Average power is work done divided by time taken.']),
  }) }),
  '5.1': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Back-to-back stem-and-leaf diagrams are included.']),
    4: Object.freeze(['A cumulative frequency graph may estimate medians, quartiles, percentiles and proportions.']),
    5: Object.freeze(['Use totals such as sum x, sum x^2, coded totals and up to two data sets.']),
  }) }),
  '5.2': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Questions may include people sitting in two or more rows. Objects arranged in a circle are not included.']),
  }) }),
  '5.3': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Explicit use of the general addition formula is not required.']),
    3: Object.freeze(['Independence may be tested by comparing P(A and B) with P(A)P(B).']),
    4: Object.freeze(['The conditional-probability formula may be required in simple cases.']),
  }) }),
  '5.4': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Use the notations B(n, p) and Geo(p), where Geo(p) has P(X = r) = p(1 - p)^(r - 1) for r = 1, 2, 3, ... .']),
    3: Object.freeze(['Proofs of formulae are not required.']),
  }) }),
  '5.5': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Sketches of normal curves to illustrate distributions or probabilities may be required.']),
    2: Object.freeze(['For calculations involving standardisation, full details of the working should be shown, for example Z = (X - mu) / sigma.']),
    3: Object.freeze(['The approximation requires n sufficiently large so that both np > 5 and nq > 5.']),
  }) }),
  '6.1': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Proofs are not required.']),
    4: Object.freeze(['For the binomial approximation, n is large and p is small; approximately n > 50 and np < 5.']),
    5: Object.freeze(['For the normal approximation to Poisson, lambda is large; approximately lambda >= 15.']),
  }) }),
  '6.2': Object.freeze({ outcomes: Object.freeze({ 1: Object.freeze(['Proofs of these results are not required.']) }) }),
  '6.3': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Density functions are defined over a single interval only; the domain may be infinite.']),
    2: Object.freeze(['The median or other percentiles may be found by direct consideration of area. Explicit knowledge of the cumulative distribution function is not included.']),
  }) }),
  '6.4': Object.freeze({ outcomes: Object.freeze({
    2: Object.freeze(['Include an elementary understanding of random numbers in producing random samples. Knowledge of quota or stratified sampling is not required.']),
    5: Object.freeze(['Only an informal understanding of the Central Limit Theorem is required.']),
    6: Object.freeze(['Only a simple understanding of unbiased is required.']),
  }) }),
  '6.5': Object.freeze({ outcomes: Object.freeze({
    1: Object.freeze(['Outcomes of hypothesis tests are expected to be interpreted in the context of the question.']),
    2: Object.freeze(['Use direct probabilities or an appropriate normal approximation to the binomial or Poisson distribution.']),
  }) }),
})

function notesFor(sectionCode, outcomeNumber) {
  const entry = TOPIC_NOTES[sectionCode]
  return Object.freeze([...(entry?.outcomes?.[outcomeNumber] || [])])
}

function topicNotesFor(sectionCode) {
  const entry = TOPIC_NOTES[sectionCode]
  return Object.freeze([...new Set(Object.values(entry?.outcomes || {}).flat())])
}

function syllabusPoint(topicId, sectionCode, outcomeNumber, officialText) {
  return Object.freeze({
    id: `math-9709-point-${sectionCode.replace('.', '-')}-${String(outcomeNumber).padStart(2, '0')}`,
    topicId,
    sectionCode,
    outcomeNumber,
    officialText,
    officialNotes: notesFor(sectionCode, outcomeNumber),
  })
}

export function cambridge9709TopicsForRoute(routeId, components) {
  const selected = new Set((components || []).map(Number))
  let order = 0
  return Object.freeze(Object.entries(COMPONENT_TOPICS).flatMap(([componentValue, topics]) => {
    const component = Number(componentValue)
    if (!selected.has(component)) return []
    return topics.map(([id, code, name, officialPage]) => {
      const points = (TOPIC_OUTCOMES[code] || []).map((officialText, index) => (
        syllabusPoint(id, code, index + 1, officialText)
      ))
      return Object.freeze({
        id,
        routeId,
        syllabusVersion: CAMBRIDGE_9709_SYLLABUS_SOURCE.syllabusVersion,
        code,
        name,
        order: ++order,
        officialPage,
        component,
        officialNotes: topicNotesFor(code),
        componentScope: COMPONENT_SCOPE[component],
        points: Object.freeze(points),
      })
    })
  }))
}

export function cambridge9709SyllabusForRoute(routeId, components) {
  const selected = new Set((components || []).map(Number))
  const topics = cambridge9709TopicsForRoute(routeId, components)
  return Object.freeze({
    routeId,
    syllabusVersion: CAMBRIDGE_9709_SYLLABUS_SOURCE.syllabusVersion,
    officialUrl: CAMBRIDGE_9709_SYLLABUS_SOURCE.officialUrl,
    assessmentComponents: Object.freeze(CAMBRIDGE_9709_SYLLABUS_SOURCE.assessmentComponents.filter((item) => selected.has(item.component))),
    componentScope: Object.freeze([...selected].sort((a, b) => a - b).map((component) => COMPONENT_SCOPE[component]).filter(Boolean)),
    topics,
    points: Object.freeze(topics.flatMap((item) => item.points)),
  })
}
