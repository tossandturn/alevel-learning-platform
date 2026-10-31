import crypto from 'node:crypto'
import path from 'node:path'
import {createCoachJobStore,coachJobId} from './coachJobStore.js'

// Detached execution reuses the exact existing Coach policy/provider pipeline.
// A phone disconnect affects polling only, never the generation or committed result.
export function createCoachJobs({root,authenticate,validate,readBody,resolvePayload=(owner,payload)=>payload,run,sendJson}){
  let store=null
  const jobs=()=>store||(store=createCoachJobStore({root:path.join(root(),'academic-coach-jobs')}))
  const running=new Set()
  async function execute(request,payload,owner,id,receivedAt,acceptance){
    let answer='',lastSave=0,done=false,answerActivityObserved=false
    const progress=event=>{try{jobs().progress(owner,id,event)}catch{/* Progress diagnostics cannot change the answer. */}}
    jobs().progress(owner,id,{type:'preparing',at:Date.now()})
    const response={statusCode:200,writableEnded:false,destroyed:false,setHeader(){},flushHeaders(){},
      write(frame){
        if(frame.startsWith(':'))return true
        const match=/^event: (\w+)\ndata: ([\s\S]+)\n\n$/.exec(frame)
        if(!match)throw Error('Invalid internal Coach event')
        const data=JSON.parse(match[2])
        if(match[1]==='meta'&&data.providerStatus==='connecting')progress({type:'requesting_model',at:Date.now(),provider:data.provider,model:data.model})
        if(match[1]==='delta'){answer+=data.text||'';if(!answerActivityObserved){answerActivityObserved=true;progress({type:'answer_delta',at:Date.now()})}}
        if(match[1]==='reset'){answer='';answerActivityObserved=false}
        if(Buffer.byteLength(answer)>65536)throw Error('Coach answer exceeds storage limit')
        if(match[1]==='done'){
          progress({type:'finalizing',at:Date.now()})
          data.timing={...data.timing,version:1,...acceptance,serverTotalMs:Math.round(performance.now()-receivedAt)}
          jobs().finish(owner,id,data);done=true
        }else if(Date.now()-lastSave>=300||match[1]==='reset'){
          jobs().update(owner,id,{answer,stage:answer?'arranging':'analysis'});lastSave=Date.now()
        }
        return true
      },
      end(){this.writableEnded=true},
    }
    try{await run(request,response,payload,progress)}finally{
      if(!done){jobs().update(owner,id,{answer,stage:'interrupted'});jobs().fail(owner,id)}
    }
  }
  return {
    async handle(request,response,url){
      const base='/api/ai/coach/jobs'
      if(url.pathname!==base&&!url.pathname.startsWith(base+'/'))return false
      const owner=authenticate(request)
      if(!owner)throw Object.assign(new Error('请先登录。'),{statusCode:401,code:'coach_auth_required'})
      if(url.pathname===base){
        if(request.method!=='GET'){sendJson(response,405,{code:'coach_job_method',error:'请求方式不支持。'});return true}
        const limitValue=url.searchParams.get('limit'),limit=limitValue===null?20:Number(limitValue)
        if(!Number.isInteger(limit)||limit<1||limit>20)throw Object.assign(new Error('答疑任务数量无效。'),{statusCode:400,code:'coach_job_limit_invalid'})
        const candidates=jobs().listCandidates(owner,{limit:60,cursor:url.searchParams.get('cursor')})
        const items=[];let lastCursor=null,scanned=0,hasMore=false
        for(const [index,candidate] of candidates.items.entries()){
          scanned++;lastCursor=candidate.cursor
          try{await validate(request,candidate.scope,true)}catch(error){if(error?.statusCode===403)continue;throw error}
          items.push(candidate.snapshot)
          if(items.length===limit){hasMore=index<candidates.items.length-1||Boolean(candidates.nextCursor);break}
        }
        if(items.length<limit&&scanned===candidates.items.length)hasMore=Boolean(candidates.nextCursor)
        sendJson(response,200,{schemaVersion:'stem-coach-task-list-v1',items,nextCursor:hasMore?lastCursor:null,serverNow:candidates.serverNow});return true
      }
      const id=coachJobId(url.pathname.slice((base+'/').length))
      if(request.method==='GET'){
        await validate(request,jobs().scope(owner,id),true)
        response.setHeader('Retry-After','1')
        sendJson(response,200,jobs().get(owner,id));return true
      }
      if(request.method!=='POST'){
        sendJson(response,405,{code:'coach_job_method',error:'请求方式不支持。'});return true
      }
      const receivedAt=performance.now()
      const rawPayload=await readBody(request)
      const bodyReadMs=Math.round(performance.now()-receivedAt),validationStarted=performance.now()
      const payload=await resolvePayload(owner,rawPayload)
      const validated=await validate(request,payload,false),scope=validated?.scope||validated,taskProfile=validated?.taskProfile||{}
      const validationMs=Math.round(performance.now()-validationStarted)
      const hash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      const accepted=jobs().begin({owner,id,hash,scope,taskProfile})
      if(accepted.created){
        // Start independently of response delivery, including a lost POST acknowledgement.
        const task=execute(request,payload,owner,id,receivedAt,{bodyReadMs,validationMs}).catch(()=>{try{jobs().fail(owner,id)}catch{}}).finally(()=>running.delete(task))
        running.add(task)
      }
      response.setHeader('Operation-Location',`/api/ai/coach/jobs/${id}`)
      response.setHeader('Retry-After','1')
      sendJson(response,202,accepted);return true
    },
    async close(){await Promise.allSettled([...running]);store?.close()},
  }
}
