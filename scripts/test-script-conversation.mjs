import assert from 'node:assert/strict'
import fs from 'node:fs'
assert.ok(fs.existsSync(new URL('../server/scriptConversation.js',import.meta.url)),'conversation policy is not implemented yet')
const conversation=await import('../server/scriptConversation.js')
const base={actor:{id:'jiangyuan',name:'江远'},sender:{id:'sutang',name:'苏棠'},trigger:'收工后一起喝茶，不加糖。',messages:[]}
assert.equal(typeof conversation.scriptConversationIssues,'function')
const say=text=>({segments:[{kind:'speech',text}]})
for(const text of ['这句话我记下了。','这句话我已经记住了。','你的话我记住了。','好，我记着了。','好，我已经记下了。','我会记住你说的话。'])assert.ok(conversation.scriptConversationIssues(say(text),base).includes('canned-memory-ack'),text)
for(const text of ['庭院，薄荷茶，不加糖。','我记得那支旧手电。','我在笔记上记下了地址。'])assert.ok(!conversation.scriptConversationIssues(say(text),base).includes('canned-memory-ack'),text)
assert.equal(conversation.scriptConversationContract({...base,trigger:'嗯'}).lead,true)
assert.equal(conversation.scriptConversationContract({...base,trigger:'先别说了，让我安静一会'}).lead,false)
assert.ok(conversation.scriptConversationIssues(say('好的。你想聊什么？'),{...base,trigger:'你说吧'}).includes('empty-topic-lead'))
assert.equal(conversation.scriptConversationIssues(say('面包还热着。你想坐窗边，还是院子里？'),{...base,trigger:'你说吧'}).length,0)
const text='第一句讲眼前的事情，不要急着总结它的意义。第二句说一点自己的真实想法，让对方有话可接。还有一句可以说清眼前的安排，不用替对方做总结。第三句留一个具体的问题，你想先聊哪一段？'
const framed=conversation.scriptConversationReply(say(text),base)
assert.ok(framed.segments.length>=2);assert.equal(framed.segments.map(p=>p.text).join(''),text)
assert.ok(framed.segments.every(p=>Array.from(p.text).length<=70))
assert.ok(conversation.scriptConversationIssues(say('很长的反复总结。'.repeat(40)),base).includes('reply-too-long'))
assert.ok(conversation.scriptConversationContract({...base,trigger:'请详细解释一下你的背景经历'}).maxCharacters>conversation.scriptConversationContract(base).maxCharacters)
assert.equal(conversation.scriptConversationIssues(say('这句话我记下了。'),{...base,actor:{id:'dm'}}).includes('canned-memory-ack'),false)
console.log('PASS short role replies, canned-memory fence, concrete proactive leads and lossless bubble reflow')
