const PRACTICE_PATTERN = /真题|练习|刷题|习题|组卷|题目|题集|专题|practice|drill|questions?|set|paper/i
const LATEST_PATTERN = /最新|最近|latest|newest/i

const QUALIFICATIONS = Object.freeze([
  qualification('bpho', 'bpho', 'Round 1', /b\s*ph[o0]|british\s*physics\s*olympiad|英国物理奥赛/i),
  qualification('esat', 'esat', 'Physics', /\besat\b/i),
  qualification('tmua', 'tmua', 'Paper 1', /\btmua\b/i),
  qualification('amc12', 'amc12', 'AMC 12', /\bamc\s*12\b/i),
  qualification('igcse-biology', '0610', 'IGCSE', /0610|igcse\s*biology|IG鐢熺墿/i),
  qualification('biology', '9700', 'AS', /9700|a[-\s]?level\s*biology|as\s*biology|a2\s*biology|biology|鐢熺墿/i),
  qualification('physics', '9702', 'AS', /9702|a[-\s]?level\s*physics|as\s*physics|a2\s*physics|A水准物理|A-Level物理|物理/i),
  qualification('igcse-physics', '0625', 'IGCSE', /0625|igcse\s*physics|IG物理/i),
  qualification('chemistry', '9701', 'AS', /9701|a[-\s]?level\s*chemistry|A-Level化学|化学/i),
  qualification('economics', '9708', 'AS', /9708|a[-\s]?level\s*economics|A-Level经济|经济/i),
  qualification('further-math', '9231', 'AS', /9231|further\s*math(?:ematics)?|高数|进阶数学/i),
  qualification('math', '9709', 'AS', /9709|a[-\s]?level\s*math(?:ematics)?|A水准数学|A-Level数学/i),
  qualification('igcse-math', '0580', 'IGCSE', /0580|igcse\s*math(?:ematics)?|IG数学/i),
  qualification('additional-math', '0606', 'IGCSE', /0606|additional\s*math(?:ematics)?|IG附加数学/i),
])

function qualification(subjectId, code, defaultStage, pattern) {
  return Object.freeze({ subjectId, code, defaultStage, pattern })
}

const TOPICS = Object.freeze([
  topic('biology', 'biology-9700-as-cell', /9700.*(?:cell|molecule)|as.*biology.*(?:cell|molecule)|cells?|biological molecules/i, 1),
  topic('biology', 'biology-9700-as-transport', /9700.*(?:transport|gas exchange)|as.*biology.*(?:transport|gas exchange)|transport|gas exchange/i, 1),
  topic('biology', 'biology-9700-as-genetics', /9700.*(?:genetics|biodiversity)|as.*biology.*(?:genetics|biodiversity)|genetics|biodiversity|classification/i, 1),
  topic('biology', 'biology-9700-a2-energy', /9700.*(?:energy|homeostasis)|a2.*biology.*(?:energy|homeostasis)|photosynthesis|respiration|homeostasis/i, 1),
  topic('biology', 'biology-9700-a2-inheritance', /9700.*(?:inheritance|evolution)|a2.*biology.*(?:inheritance|evolution)|inheritance|evolution|selection/i, 1),
  topic('biology', 'biology-9700-a2-biotechnology', /9700.*biotechnology|a2.*biology.*biotechnology|biotechnology|gene technology/i, 1),
  topic('igcse-biology', 'biology-0610-cell', /0610.*cell|igcse.*biology.*cell|cells?|diffusion|osmosis|enzymes/i, 2),
  topic('igcse-biology', 'biology-0610-coordination', /0610.*coordination|igcse.*biology.*coordination|homeostasis|nervous|hormones?/i, 2),
  topic('igcse-biology', 'biology-0610-genetics', /0610.*(?:inheritance|variation)|igcse.*biology.*(?:inheritance|variation)|inheritance|variation|natural selection/i, 2),
  topic('igcse-biology', 'biology-0610-ecology', /0610.*ecology|igcse.*biology.*ecology|ecology|food chain|biodiversity/i, 2),
  topic('igcse-biology', 'biology-0610-practical', /0610.*practical|igcse.*biology.*practical|microscopy|experiment|investigation/i, 2),
  topic('physics', 'physics-9702-mechanics', /力学|运动学|动力学|动量|mechanics|kinematics|dynamics|momentum/i, 1),
  topic('physics', 'physics-9702-waves', /波|干涉|衍射|驻波|waves?|interference|diffraction|stationary/i, 1),
  topic('physics', 'physics-9702-electricity', /电学|电路|电流|电阻|electricity|current|circuit|resistance|potential difference/i, 1),
  topic('physics', 'physics-9702-fields', /场|引力场|电场|磁场|fields?|gravitational|electric field|magnetic field/i, 1),
  topic('physics', 'physics-9702-particles', /现代物理|粒子|核物理|放射性|particles?|nuclear|radioactivity|quantum/i, 1),
  topic('physics', 'physics-9702-thermal', /热学|气体|thermal|ideal gas|temperature|internal energy/i, 1),
  topic('physics', 'physics-9702-practical-data', /实验|数据|误差|不确定度|practical|data analysis|uncertainty/i, 1),

  topic('igcse-physics', 'physics-0625-forces', /力学|运动|力|mechanics|motion|forces?/i, 2),
  topic('igcse-physics', 'physics-0625-electricity', /电学|磁学|electricity|magnetism|circuits?/i, 2),
  topic('igcse-physics', 'physics-0625-waves', /波|光|声|waves?|light|sound/i, 2),
  topic('igcse-physics', 'physics-0625-thermal', /热学|thermal|temperature/i, 2),
  topic('igcse-physics', 'physics-0625-atomic-space', /原子|核|放射性|atomic|nuclear|radioactivity/i, 2),
  topic('igcse-physics', 'physics-0625-space', /太空|天体|恒星|space|astronomy|stars?/i, 2),

  topic('chemistry', 'chemistry-9701-physical', /物理化学|原子结构|化学键|能量|平衡|动力学|physical chemistry|atomic structure|bonding|energetics|equilibria|kinetics/i),
  topic('chemistry', 'chemistry-9701-inorganic', /无机|周期性|过渡元素|inorganic|periodicity|transition elements?/i),
  topic('chemistry', 'chemistry-9701-organic', /有机|烃|合成|聚合|organic|hydrocarbon|synthesis|polymeri[sz]ation/i),
  topic('chemistry', 'chemistry-9701-analysis', /分析|实验|滴定|光谱|analysis|practical|titration|spectr/i),

  topic('economics', 'economics-9708-as-micro', /AS微观|需求|供给|弹性|市场失灵|microeconomics|demand|supply|elasticity|market failure/i),
  topic('economics', 'economics-9708-as-macro', /AS宏观|总需求|总供给|宏观指标|macroeconomics|aggregate demand|aggregate supply/i),
  topic('economics', 'economics-9708-a2-micro', /A2微观|市场结构|企业|劳动力市场|market structure|firms?|labour market/i),
  topic('economics', 'economics-9708-a2-macro', /A2宏观|乘数|货币|银行|经济增长|multiplier|money|banking|economic growth/i),
  topic('economics', 'economics-9708-international', /国际经济|汇率|发展|全球化|international|exchange rate|development|globalisation/i),

  topic('math', 'math-9709-pure', /纯数|代数|函数|微积分|pure|algebra|functions?|calculus|differentiation|integration/i),
  topic('math', 'math-9709-mechanics', /力学|mechanics/i, 3),
  topic('math', 'math-9709-statistics', /统计|概率|statistics|probability/i),
  topic('math', 'math-9709-problem-solving', /综合|建模|problem solving|modelling/i),
  topic('further-math', 'math-9231-further-pure', /纯数|复数|矩阵|微分方程|further pure|complex|matrices|differential equations/i),
  topic('further-math', 'math-9231-further-mechanics', /力学|further mechanics/i, 3),
  topic('further-math', 'math-9231-further-statistics', /统计|概率|further statistics|probability/i),
  topic('further-math', 'math-9231-problem-solving', /综合|problem solving/i),

  topic('igcse-math', 'math-0580-number', /数与数制|数值|number|ratio|percentage/i),
  topic('igcse-math', 'math-0580-algebra', /代数|图像|algebra|graphs?/i),
  topic('igcse-math', 'math-0580-geometry', /几何|geometry|circle/i),
  topic('igcse-math', 'math-0580-trigonometry', /三角|trigonometry/i),
  topic('igcse-math', 'math-0580-probability', /概率|probability/i),
  topic('igcse-math', 'math-0580-statistics', /统计|statistics/i),
  topic('additional-math', 'math-0606-functions', /函数|functions?/i),
  topic('additional-math', 'math-0606-quadratics', /二次|多项式|quadratics?|polynomials?/i),
  topic('additional-math', 'math-0606-trigonometry', /三角|trigonometry/i),
  topic('additional-math', 'math-0606-calculus', /微积分|calculus|differentiation|integration/i),

  topic('bpho', 'bpho-mechanics', /力学|mechanics|dynamics/i),
  topic('bpho', 'bpho-waves', /波|振动|waves?|oscillations?/i),
  topic('bpho', 'bpho-electricity', /电|磁|electricity|electromagnetism/i),
  topic('bpho', 'bpho-thermal-modern', /热|现代物理|thermal|modern|quantum|nuclear/i),
  topic('esat', 'esat-mathematics-1', /math(?:ematics)?\s*1|数学1/i),
  topic('esat', 'esat-mathematics-2', /math(?:ematics)?\s*2|数学2/i),
  topic('esat', 'esat-physics', /物理|physics/i),
  topic('esat', 'esat-chemistry', /化学|chemistry/i),
  topic('esat', 'esat-biology', /生物|biology/i),
  topic('tmua', 'tmua-algebra', /代数|函数|algebra|functions?/i),
  topic('tmua', 'tmua-geometry', /几何|三角|geometry|trigonometry/i),
  topic('tmua', 'tmua-proof', /证明|逻辑|proof|logic/i),
  topic('tmua', 'tmua-problem-solving', /综合|问题解决|problem solving/i),
  topic('amc12', 'amc12-algebra', /代数|函数|algebra|functions?/i),
  topic('amc12', 'amc12-geometry', /几何|三角|geometry|trigonometry/i),
  topic('amc12', 'amc12-number', /数论|number theory|number/i),
  topic('amc12', 'amc12-combinatorics', /组合|计数|概率|combinatorics|counting|probability/i),
  topic('amc12', 'amc12-logic', /逻辑|策略|logic|strategy/i),
])

function topic(subjectId, knowledgeGroupId, pattern, priority = 10) {
  return Object.freeze({ subjectId, knowledgeGroupId, pattern, priority })
}

function officialPhysicsIntentTopic(source, fallback) {
  const routes = [
    ['physics-9702-topic-01', /physical quantities|units?|measurement|uncertainty|scalars?|vectors?/i],
    ['physics-9702-topic-02', /kinematics|projectile|motion graphs?|free fall/i],
    ['physics-9702-topic-03', /dynamics|momentum|Newton|collisions?|forces? and momentum/i],
    ['physics-9702-topic-04', /density|pressure|moments?|equilibrium|buoyancy/i],
    ['physics-9702-topic-05', /work|energy|power/i],
    ['physics-9702-topic-06', /deformation|stress|strain|Young modulus|elasticity/i],
    ['physics-9702-topic-08', /superposition|interference|diffraction|stationary waves?/i],
    ['physics-9702-topic-07', /waves?|wave properties|polarisation|Doppler|optical waves?/i],
    ['physics-9702-topic-10', /D\.C\.? circuits?|DC circuits?|Kirchhoff|potential divider/i],
    ['physics-9702-topic-19', /capacitance|capacitors?/i],
    ['physics-9702-topic-09', /electricity|current|resistivity|resistance|potential difference/i],
    ['physics-9702-topic-13', /gravitational field|gravitation|orbits?/i],
    ['physics-9702-topic-18', /electric field|Coulomb/i],
    ['physics-9702-topic-20', /magnetic field|electromagnetic induction/i],
    ['physics-9702-topic-12', /circular motion/i],
    ['physics-9702-topic-14', /temperature|specific heat|latent heat/i],
    ['physics-9702-topic-15', /ideal gas|kinetic theory/i],
    ['physics-9702-topic-16', /thermodynamics|internal energy|thermal processes?/i],
    ['physics-9702-topic-17', /oscillations?|simple harmonic|resonance/i],
    ['physics-9702-topic-21', /alternating current/i],
    ['physics-9702-topic-22', /quantum|photoelectric|wave-particle|energy levels?/i],
    ['physics-9702-topic-23', /nuclear|radioactivity|mass defect|binding energy/i],
    ['physics-9702-topic-24', /medical physics|ultrasound|X-rays?|PET/i],
    ['physics-9702-topic-25', /astronomy|cosmology|stellar|luminosity|Hubble|blackbody/i],
  ]
  const match = routes.find(([, pattern]) => pattern.test(source))
  if (match) return { ...fallback, knowledgeGroupId: match[0] }
  const legacyFallbacks = {
    'physics-9702-mechanics': 'physics-9702-topic-03',
    'physics-9702-waves': 'physics-9702-topic-07',
    'physics-9702-electricity': 'physics-9702-topic-09',
    'physics-9702-fields': 'physics-9702-topic-13',
    'physics-9702-particles': 'physics-9702-topic-23',
    'physics-9702-thermal': 'physics-9702-topic-15',
    'physics-9702-practical-data': 'physics-9702-topic-01',
  }
  return fallback && legacyFallbacks[fallback.knowledgeGroupId]
    ? { ...fallback, knowledgeGroupId: legacyFallbacks[fallback.knowledgeGroupId] }
    : fallback
}

function questionCount(source) {
  const value = Number(source.match(/(\d{1,2})\s*(?:题|道|questions?)/i)?.[1])
  return Math.min(30, Math.max(10, value || 10))
}

function stageFor(source, qualification) {
  if (/\bA2\b|A2阶段|高二/i.test(source)) return 'A2'
  if (/\bAS\b|AS阶段|高一/i.test(source)) return 'AS'
  if (/IGCSE|\bIG\b/i.test(source)) return 'IGCSE'
  if (/SPC|senior physics challenge/i.test(source)) return 'SPC'
  if (/round\s*2|第二轮/i.test(source)) return 'Round 2'
  if (/round\s*1|第一轮/i.test(source)) return 'Round 1'
  if (/paper\s*2|卷二/i.test(source)) return 'Paper 2'
  if (/paper\s*1|卷一/i.test(source)) return 'Paper 1'
  return qualification.defaultStage
}

function parseSource(source) {
  const qualification = QUALIFICATIONS.find((item) => item.pattern.test(source))
  const matchingTopics = TOPICS.filter((item) => item.pattern.test(source) && (!qualification || item.subjectId === qualification.subjectId))
    .toSorted((left, right) => left.priority - right.priority)
  const fallbackTopics = qualification ? [] : TOPICS.filter((item) => item.pattern.test(source))
    .toSorted((left, right) => left.priority - right.priority)
  const rawSelectedTopic = matchingTopics[0] || fallbackTopics[0]
  const resolvedQualification = qualification || QUALIFICATIONS.find((item) => item.subjectId === rawSelectedTopic?.subjectId)
  const selectedTopic = resolvedQualification?.subjectId === 'physics'
    ? officialPhysicsIntentTopic(source, rawSelectedTopic)
    : rawSelectedTopic
  if (!resolvedQualification) return null
  if (!PRACTICE_PATTERN.test(source) && source.replace(/\s+/g, '').length > 10) return null
  if (!selectedTopic) {
    return {
      type: 'clarify-practice',
      subjectId: resolvedQualification.subjectId,
      subjectCode: resolvedQualification.code,
      stage: stageFor(source, resolvedQualification),
      questionCount: questionCount(source),
      topicOptions: TOPICS.filter((item) => item.subjectId === resolvedQualification.subjectId).map((item) => item.knowledgeGroupId),
      sourceRequest: 'verified-topic-drill',
    }
  }
  return {
    type: 'build-topic-practice',
    subjectId: resolvedQualification.subjectId,
    subjectCode: resolvedQualification.code,
    stage: stageFor(source, resolvedQualification),
    knowledgeGroupId: selectedTopic.knowledgeGroupId,
    questionCount: questionCount(source),
    sourceRequest: 'verified-topic-drill',
  }
}

export function parseCoachIntent(message) {
  const source = String(message || '').trim()
  if (!source) return null
  const bpho = QUALIFICATIONS.find((item) => item.subjectId === 'bpho')
  if (bpho.pattern.test(source) && /SPC|senior physics challenge/i.test(source) && (LATEST_PATTERN.test(source) || /真题|paper/i.test(source))) {
    return { type: 'open-latest-paper', contest: 'bpho-spc', label: 'BPhO Senior Physics Challenge' }
  }
  return parseSource(source)
}

export function resolveCoachIntent(message, history = []) {
  const direct = parseCoachIntent(message)
  if (direct) return direct
  const recentUserMessages = history.filter((item) => item?.role === 'user').slice(-2).map((item) => item.content)
  return parseCoachIntent([...recentUserMessages, message].filter(Boolean).join(' '))
}

export function latestBphoSpcPaper(items = []) {
  const markSchemeIds = new Set(items.filter((item) => item.subject === 'bpho' && item.kind === 'ms').map((item) => item.id))
  return items
    .filter((item) => item.subject === 'bpho' && item.kind === 'qp' && /^BPhO_SPC_\d{4}_QP\.pdf$/i.test(item.file) && item.markSchemeId && markSchemeIds.has(item.markSchemeId))
    .toSorted((left, right) => (Number(right.year) || 0) - (Number(left.year) || 0) || left.file.localeCompare(right.file))[0] || null
}
