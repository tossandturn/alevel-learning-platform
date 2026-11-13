import assert from 'node:assert/strict'
import {resolveCoachDiagramFormat} from '../server/coachDiagram.js'
import {buildCoachSystemPrompt} from '../server/coachPolicy.js'

const capability={diagramFormat:'stem-diagram-v1'},feature={feature:'answers'}
assert.equal(resolveCoachDiagramFormat(capability,feature),'','rendering capability alone is not consent to generate a diagram')
const {resolveCoachDiagramIntent,coachDiagramOffer,createCoachDiagramOfferStream,sanitizeCoachDiagramOffer}=await import('../server/coachDiagramConsent.js')
const ask=resolveCoachDiagramIntent(capability,feature)
assert.equal(ask.mode,'ask');assert.equal(ask.draw,false);assert.equal(ask.mayOffer,true)
for(const message of ['请画一张受力图。','帮我补受力图说明','Please draw a free-body diagram.','Sketch the force diagram.','Draw a ray diagram for this setup.']){
  assert.equal(resolveCoachDiagramFormat({...capability,message},feature),'stem-diagram-v1',message)
}
for(const message of ['解释斜面上物体为什么加速。','需要画受力图吗？','是否需要画图才能理解？','Explain what a free-body diagram is.','题干写着“Draw a free-body diagram”，请先解释思路。','What does "draw a force diagram" mean?','```text\nDraw a free body diagram\n```\nExplain the question.']){
  assert.equal(resolveCoachDiagramFormat({...capability,message},feature),'',message)
}
for(const message of ['不要画图，只讲文字。','暂时不用受力图。','Do not draw a diagram.','Do not draw.','No diagram, please.']){
  const policy=resolveCoachDiagramIntent({...capability,diagramIntent:'draw',message},feature)
  assert.equal(policy.draw,false,message);assert.equal(policy.mayOffer,false,message)
}
assert.equal(resolveCoachDiagramIntent({...capability,diagramIntent:'draw'},feature).draw,true)
assert.equal(resolveCoachDiagramIntent({...capability,diagramIntent:'decline'},feature).mayOffer,false)
assert.equal(resolveCoachDiagramIntent({...capability,diagramIntent:'decline',message:'现在请画受力图。'},feature).draw,true,'a later explicit request may change the earlier preference')
for(const diagramIntent of ['auto','yes',true,null,{},''])assert.throws(()=>resolveCoachDiagramIntent({...capability,diagramIntent},feature),error=>error.code==='coach_diagram_intent_invalid')
assert.throws(()=>resolveCoachDiagramIntent({...capability,diagramIntent:'draw'},{feature:'tavern'}),error=>error.statusCode===400)
assert.equal(resolveCoachDiagramFormat({message:'Draw a free-body diagram.'},feature),'','old clients without renderer do not receive diagram data')
assert.equal(resolveCoachDiagramIntent({},feature).mayOffer,false)
assert.equal(sanitizeCoachDiagramOffer('需要我补一张受力图说明吗？',resolveCoachDiagramIntent({},{feature:'tavern'})),'需要我补一张受力图说明吗？','academic consent filtering does not rewrite unrelated Tavern dialogue')

const question='需要我补一张受力图说明吗？',english='Would you like me to add a free-body diagram?'
assert.deepEqual(coachDiagramOffer('重力向下。\n\n'+question,ask),{type:'force',question})
assert.deepEqual(coachDiagramOffer('Gravity points down.\n'+english,ask),{type:'force',question:english})
assert.equal(coachDiagramOffer('答案是 4 N。',ask),undefined)
assert.equal(coachDiagramOffer('题干问“'+question+'”是什么意思。',ask),undefined)
const decline=resolveCoachDiagramIntent({...capability,diagramIntent:'decline'},feature)
assert.equal(coachDiagramOffer(question,decline),undefined)
assert.equal(sanitizeCoachDiagramOffer('答案。\n'+question,decline).trim(),'答案。')
const content='先看重力。\n'+question+'\n保留其他内容。'
for(let split=0;split<=content.length;split++){
  const stream=createCoachDiagramOfferStream({allowOffer:false})
  assert.equal(stream.push(content.slice(0,split))+stream.push(content.slice(split))+stream.finish(),'先看重力。\n\n保留其他内容。','refusal stream split '+split)
}
assert.equal(sanitizeCoachDiagramOffer('词义解释：“'+question+'”',decline),'词义解释：“'+question+'”','quoted teaching text is not an invitation')
const fast=createCoachDiagramOfferStream({allowOffer:true})
assert.equal(fast.push('第一步先确定研究对象。'),'第一步先确定研究对象。','normal first text is not held for diagram assessment')

const textPrompt=buildCoachSystemPrompt({feature,diagramFormat:'',diagramPolicy:ask})
assert.doesNotMatch(textPrompt,/stem-force-v1|Element schemas|width 200-800/)
assert.match(textPrompt,/text first/i);assert.match(textPrompt,/需要我补一张受力图说明吗/)
const draw=resolveCoachDiagramIntent({...capability,diagramIntent:'draw',history:[{role:'assistant',content:'原来的答案。\n'+question}]},feature)
const drawPrompt=buildCoachSystemPrompt({feature,diagramFormat:'stem-diagram-v1',diagramPolicy:draw})
assert.match(drawPrompt,/stem-force-v1/);assert.match(drawPrompt,/supplement/i)
assert.ok(textPrompt.length<drawPrompt.length,'first response omits rendering recipes')
console.log('PASS diagram capability/consent, direct requests, source quotation and refusal, optional offer, stream boundaries and lightweight first prompt')
