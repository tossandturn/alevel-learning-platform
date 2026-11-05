import {SCRIPT_ANIME_ASSETS,SCRIPT_ANIME_BOOKS,SCRIPT_ANIME_STYLE} from './scriptArtSpec.js'
import {loadTavernMediaCatalog} from './tavernMedia.js'

// Presentation-only data. Never import story truth or rewrite pinned room editions.
const normalize=s=>String(s||'').normalize('NFKC').toLowerCase().replace(/[\s，。！？、,.:：;；!?“”"'（）()]/g,'')
const eligible=(game,a)=>a.scriptId===game.id&&(!a.roleId||game.roles.some(r=>r.id===a.roleId&&r.name===a.roleName))
const art=(spec,catalog)=>spec?catalog.byId.get('scriptanime-'+spec.id)||null:null
export function scriptSceneArt(game,stage,catalog=loadTavernMediaCatalog()){
 return art(SCRIPT_ANIME_ASSETS.find(a=>eligible(game,a)&&a.kind==='scene'&&a.stage===stage),catalog)?.src||game.acts?.[stage]?.image||''
}
export function scriptMessageArt(game,message,catalog=loadTavernMediaCatalog()){
 if(!message.image||message.actor!=='dm'||message.kind!=='narration')return message.image||''
 // Old rooms may not have a stage on messages. Match the authored opening,
 // not the currently displayed act (which would change every earlier scene).
 const stage=game.acts.findIndex(a=>a.opening===message.text&&a.image===message.image)
 return stage<0?message.image:scriptSceneArt(game,stage,catalog)
}
export function scriptImageIntent(value){
 const text=normalize(value)
 if(/不要|不想|不用|别画|为什么|怎么|如何|会.*(?:吗|么)|能.*吗|是否|次数|收费|扣费/.test(text))return false
 return /^(?:请|麻烦|帮我|给我|我想|我要|我想要|可以)*?(?:画出|画一下|画一张|画个|画|生成一张|生成图片|重新画|实时画)/.test(text)||/^(?:请|给我|让我|我想|想|我要|要|能不能)*?(?:看看|看一下|看一眼|看).*(?:立绘|图片|配图|合影|头像|的样子|场景图)$/.test(text)
}
function simpleRequest(query,asset){
 let rest=query
 for(const alias of [...asset.aliases].sort((a,b)=>b.length-a.length))rest=rest.split(normalize(alias)).join('')
 return rest.replace(/给我|让我|我想要|我想|我要|想要|请|麻烦|帮我|一下|一张|一幅|一个|看看|看|展示|显示|发来|发|画出|画|图片|照片|配图|立绘|肖像|头像|图|的|吧|呀|好不好|可以吗/g,'')===''
}
export function scriptImagePlan(game,stage,request,catalog=loadTavernMediaCatalog()){
 const book=SCRIPT_ANIME_BOOKS.find(b=>b.id===game.id),query=normalize(request),assets=SCRIPT_ANIME_ASSETS.filter(a=>eligible(game,a)),visible=assets.filter(a=>a.minStage<=stage)
 const namedStage=query.match(/第([一二三123])幕/),futureStage=namedStage?({'一':0,'二':1,'三':2,'1':0,'2':1,'3':2}[namedStage[1]]>stage):false
 const blocked=futureStage||/(?:凶手|真凶|谜底|密码|未解锁|幕后真相|隐藏答案|其他角色的秘密|色情|裸体|裸露|性行为|强奸|血腥|内脏|自残|自杀|真人肖像|名人肖像|celebrity|gore|nude|sexualcontent)/i.test(query)||assets.some(a=>a.minStage>stage&&a.aliases.some(alias=>query.includes(normalize(alias))&&(alias.length>=4||simpleRequest(query,a))))
 if(blocked)return {blocked:true,asset:null,referenceIds:[]}
 const named=visible.filter(a=>a.kind==='portrait'&&query.includes(normalize(a.roleName))),prop=visible.find(a=>a.kind==='prop'&&a.aliases.some(alias=>query.includes(normalize(alias)))),scene=visible.find(a=>a.kind==='scene'&&a.stage===stage)
 const explicit=visible.find(a=>a.aliases.some(alias=>query.includes(normalize(alias)))&&simpleRequest(query,a))
 const current=/^(?:请|我想|给我|让我)?(?:看看|看|画|展示)?(?:当前|现在的|本幕)(?:场景|画面|场景图|图片)$/.test(query)
 const custom=/重新|实时|重画|换装|换衣|自定义/.test(query)
 const asset=!custom?art(current?scene:explicit,catalog):null
 const ensemble=visible.find(a=>a.kind==='ensemble')
 const references=[...(named.length>2?[ensemble]:named),...(!named.length&&prop?[prop]:[]),...(!named.length&&!prop&&/合影|全员|全体|所有角色/.test(query)?[ensemble]:[]),scene].filter(Boolean)
 const referenceIds=[...new Set(references.map(a=>art(a,catalog)?.id).filter(Boolean))].slice(0,3)
 const characters=(book?.characters||[]).filter(c=>game.roles.some(r=>r.id===c.roleId&&r.name===c.name))
 return {blocked:false,asset,referenceIds,artDirection:[SCRIPT_ANIME_STYLE,book?.mood||'',...characters.map(c=>c.name+': '+c.appearance),'Reference images are the authoritative visual design. Preserve the characters\' faces, hair, clothing and the book palette. The request may change composition but never change the 2D anime style. No readable text, evidence reconstruction or hidden clue.'].join('\n')}
}
export function scriptArtReferenceUrls(scene,catalog=loadTavernMediaCatalog()){
 if(!Number.isInteger(scene?.stage)||scene.stage<0||scene.stage>2)return []
 const allowed=new Set(SCRIPT_ANIME_ASSETS.filter(a=>a.scriptId===scene.id&&a.minStage<=scene.stage).map(a=>'scriptanime-'+a.id))
 return [...new Set(Array.isArray(scene.referenceIds)?scene.referenceIds:[])].filter(id=>allowed.has(id)).map(id=>catalog.byId.get(id)?.src).filter(Boolean).slice(0,3).map(src=>'https://stem.ieltsist.com'+src)
}
