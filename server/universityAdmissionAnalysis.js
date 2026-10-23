import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import {validateUniversityProfile} from './universityProfiles.js'

export const ADMISSION_DIMENSIONS=['alevel','ib','ap','language','competition','research']
const labels=['A-Level','IB','AP','语言','竞赛','科研／项目']
const unknown=[
 ['本校 A-Level 具体条款待核验','尚未完成本校该资格的逐项核验，不能据排名推定需要几个 A*。须核对完整 A-Level 门数、指定科目和专业条件。'],
 ['本校 IB 总分及 HL 条件待核验','尚未完成本校该资格的逐项核验。总分、HL 组合、核心加分及数学类别应分别确认，不将其他学校的分数套用。'],
 ['本校 AP 门数与组合条件待核验','尚未完成本校该资格的逐项核验。AP 入学资格、SAT／ACT 组合与入学后的学分兑换不是一回事。'],
 ['本校语言考试及豁免条款待核验','须核对授课语言、认可考试、总分与单项、有效期和豁免条件；不能把常见分数写成本校要求。'],
 ['竞赛是否有特定要求：待核验','未核验到本校适用的完整竞赛条款，不等于官网确认不要求。专业测试、作品集和竞赛获奖是不同事项。'],
 ['科研／项目是否需提交：待核验','未核验到本校适用的完整补充材料条款，不等于科研为必需或完全不被考虑。申请前检查是否接收项目、作品集或导师材料。']
]
function advice(country){
 const uk=country==='United Kingdom',us=country==='United States'
 return [
  uk?'先按专业检查必修科目、预估分和招生测试，再看等级组合；无关科目的高分不能替代指定科目。':us?'说明自己在学校课程条件下的学习难度和持续表现。A-Level、IB、AP 不是必须同时集齐的三套证书。':'先确认本校接受的资格和换算方法，再查专业先修课；不要直接套用英国大学的 A* 数量。',
  '把总分与相关 HL 科目分开准备，特别核对数学 AA／AI 和 HL／SL；核心加分是否计入也需确认。',
  uk?'先查对应课程的 AP 等效条件、必需科目及 SAT／ACT 搭配，避免只凑高分门数。':'优先选择与学习方向相关、能扎实掌握的课程；区分入学申请与学分兑换，不能以 AP 高分数量推算录取概率。',
  '先判断能否豁免，再按有效期安排考试；同步练习课堂讨论、学术阅读和写作，不能只追求总分。',
  '选择与兴趣相关且愿意长期投入的活动，讲清自己的贡献和成长。竞赛是证据之一，不建议堆证书或把奖项当保录取条件。',
  '项目可以从真实问题开始，保留方法、过程、失败与迭代及本人贡献。先看学校是否接收材料；不默认需要论文、付费科研或名校夏校。'
 ]
}
export function enrichUniversityProfile(row,institution,reviews){
 assert.equal(reviews?.schemaVersion,'university-admission-reviews-v1')
 assert(/^\d{4}-\d{2}-\d{2}$/.test(reviews.updatedOn))
 const profile=structuredClone(row.profile),overrides=reviews.universities[row.id]||{},recommendations=advice(institution.country)
 for(const key of Object.keys(overrides))assert(ADMISSION_DIMENSIONS.includes(key),'Unknown admissions dimension: '+key)
 const modules=ADMISSION_DIMENSIONS.map((id,i)=>({id,label:labels[i],status:'unverified',headline:unknown[i][0],detail:unknown[i][1],advice:recommendations[i],sourceIds:[]}))
 // Reuse reviewed language prose with all its qualifiers, never extract a bare score.
 if(profile.kind==='verified-overview'){
  const english=profile.sections.find(s=>/英语|语言/.test(s.label))
  if(english&&english.text.length<=500&&english.sourceIds.length){modules[3]={...modules[3],status:'official',headline:'英语政策：考试与适用条件',detail:english.text,sourceIds:[...english.sourceIds]}}
 }
 for(const [id,entry]of Object.entries(overrides)){
  assert(Array.isArray(entry.sourceKeys)&&entry.sourceKeys.length>0,'Reviewed claims require sources')
  const sourceIds=entry.sourceKeys.map(key=>{
   const source=reviews.sources[key];assert(source,'Missing reviewed source: '+key)
   const url=new URL(source.url);assert(url.protocol==='https:'&&!/\/test-page\/|\/requirements_old\/|\/draft\//i.test(url.pathname),'Unpublished source cannot support an admission claim')
   assert(/^\d{4}-\d{2}-\d{2}$/.test(source.checkedOn),'Missing review date')
   let existing=profile.sources.find(s=>s.url===source.url)
   if(!existing){existing={id:'analysis-'+crypto.createHash('sha256').update(source.url).digest('hex').slice(0,12),title:source.title,url:source.url};profile.sources.push(existing)}
   return existing.id
  })
  const i=ADMISSION_DIMENSIONS.indexOf(id)
  modules[i]={...modules[i],status:entry.status,headline:entry.headline,detail:entry.detail,advice:entry.advice||recommendations[i],sourceIds:[...new Set(sourceIds)]}
 }
 profile.analysis={schemaVersion:'undergraduate-six-dimensions-v1',updatedOn:reviews.updatedOn,summary:'国际本科申请。官网条件与 AI 准备建议分开列出；专业、入学年份及资格背景可能改变要求，待核验不代表不要求。',modules}
 validateUniversityProfile(profile)
 return profile
}
