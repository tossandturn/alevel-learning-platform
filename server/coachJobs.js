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
    let answer='',lastSave=0,done=false
    const response={statusCode:200,writableEnded:false,destroyed:false,setHeader(){},flushHeaders(){},
      write(frame){
        if(frame.startsWith(':'))return true
        const match=/^event: (\w+)\ndata: ([\s\S]+)\n\n$/.exec(frame)
        if(!match)throw Error('Invalid internal Coach event')
        const data=JSON.parse(match[2])
        if(match[1]==='delta')answer+=data.text||''
        if(match[1]==='reset')answer=''
        if(Buffer.byteLength(answer)>65536)throw Error('Coach answer exceeds storage limit')
        if(match[1]==='done'){
          data.timing={...data.timing,version:1,...acceptance,serverTotalMs:Math.round(performance.now()-receivedAt)}
          jobs().finish(owner,id,data);done=true
        }else if(Date.now()-lastSave>=300||match[1]==='reset'){
          jobs().update(owner,id,{answer,stage:answer?'arranging':'analysis'});lastSave=Date.now()
        }
        return true
      },
      end(){this.writableEnded=true},
    }
    try{await run(request,response,payload)}finally{
      if(!done){jobs().update(owner,id,{answer,stage:'interrupted'});jobs().fail(owner,id)}
    }
  }
  return {
    async handle(request,response,url){
      if(!url.pathname.startsWith('/api/ai/coach/jobs/'))return false
      const owner=authenticate(request)
      if(!owner)throw Object.assign(new Error('请先登录。'),{statusCode:401,code:'coach_auth_required'})
      const id=coachJobId(url.pathname.slice('/api/ai/coach/jobs/'.length))
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
      const scope=await validate(request,payload,false)
      const validationMs=Math.round(performance.now()-validationStarted)
      const hash=crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
      const accepted=jobs().begin({owner,id,hash,scope})
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
