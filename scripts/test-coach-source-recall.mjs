import assert from 'node:assert/strict'
import {studyQuestionBank,isVerifiedPastPaperItem,isStudentReleasedAiStudyItem} from '../src/data/questionBank.js'
import {createCoachQuestionSourceResolver} from '../server/coachQuestionSource.js'

const bank=studyQuestionBank.filter(q=>isVerifiedPastPaperItem(q)||isStudentReleasedAiStudyItem(q))
const q=bank.find(q=>q.sourceRef.paper==='9702_m24_qp_22.pdf'&&q.sourceRef.question==='Q2')
const resolve=createCoachQuestionSourceResolver({questionBankProvider:()=>bank}).resolve
const visible=q.prompt.slice(q.prompt.indexOf('When the diver is on the platform'),q.prompt.indexOf('(c(i))')).trim()
for(const [kind,text] of Object.entries({
 missingWord:q.prompt.replace(/\bthe\b/i,''),
 OCRSpelling:q.prompt.replace('platform','platforrn'),
 cropped:visible.slice(0,Math.floor(visible.length*.65)),
 labels:visible.replace(/\([a-z](?:\([ivx]+\))?\)/gi,'').replace(/Fig\.\s*\d+\.\d+/g,''),
 unitOCR:visible.replace('s⁻¹','s−1'),
})){
 const result=resolve({hasImages:true,lookupText:text})
 assert.equal(result.status,'matched',kind+' must survive ordinary photo extraction differences')
 assert.equal(result.paperFile,q.sourceRef.paper);assert.equal(result.questionNumber,2)
}
for(const text of [q.prompt.replace('9.0 m','19.0 m'),visible.replace('9.0 m','19.0 m'),'Define acceleration.','The answer is 14 m/s.','Calculate the speed of an object.']){
 assert.notEqual(resolve({hasImages:true,lookupText:text}).status,'matched','Changed givens, generic text or answer text cannot become source proof')
}
const wood=bank.find(q=>q.sourceRef.paper==='0625_s25_qp_21.pdf'&&q.sourceRef.question==='Q6')
assert.equal(resolve({hasImages:true,lookupText:wood.prompt+'\n'+wood.options.join('\n')}).questionNumber,6,'The printed MCQ options are part of the source, not unmatched noise')
const math='4 The polynomial p is given by p(x) = a^2 x^3 + 2ax^2 + ax + 2, where a is a positive integer.\nIt is given that 2x + 1 is a factor of p(x).\n(a) Find the value of a. [3]\n(b) Hence factorise p(x). [2]\n(c) Hence show that the equation p(x) = 0 has only one real root. [1]'
const mathResult=resolve({hasImages:true,lookupText:math});assert.equal(mathResult.paperFile,'0606_m25_qp_12.pdf');assert.equal(mathResult.questionNumber,4)
assert.equal(resolve({hasImages:true,lookupText:math.replace('2ax^2','7ax^2')}).status,'unconfirmed','A changed coefficient is not a wording variation')
assert.equal(resolve({hasImages:true,lookupText:math.replace('2ax^2','- 2ax^2')}).status,'unconfirmed','A changed sign must not be hidden by token normalization')
assert.equal(resolve({hasImages:true,lookupText:math.replace('+ ax','- ax')}).status,'unconfirmed','A changed symbolic operator must not be hidden by token normalization')
assert.equal(resolve({hasImages:true,lookupText:''}).status,'unconfirmed')
console.log('Coach source recall regressions PASS')
