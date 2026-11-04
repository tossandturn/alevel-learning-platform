import crypto from 'node:crypto'
const fail=(statusCode,code,message)=>{throw Object.assign(Error(message),{statusCode,code})}
export function createTavernImageJobs({generator,now=Date.now}){
 const jobs=new Map(),ttl=10*60*1000
 function key(owner,id){if(!/^ielts:\d+$/.test(owner||''))fail(401,'auth_required','请登录后生成配图。');if(!/^[A-Za-z0-9_-]{8,160}$/.test(id||''))fail(400,'tavern_image_request_invalid','图片请求标识无效。');return owner+':'+id}
 const view=job=>({status:job.status,expiresAt:job.expiresAt,...(job.error?{error:job.error}:{})})
 function get(owner,id){const j=jobs.get(key(owner,id));if(!j||j.expiresAt<now())fail(404,'tavern_image_job_missing','配图任务已过期或服务已重启，文字仍保留。');return j}
 function submit(input,{retry=false}={}){
  const id=key(input.ownerId,input.requestId),hash=crypto.createHash('sha256').update(JSON.stringify([input.persona,input.prompt,input.conversationId||''])).digest('hex')
  for(const [k,j]of jobs)if(j.expiresAt<now())jobs.delete(k)
  let job=jobs.get(id)
  if(job){if(job.hash!==hash)fail(409,'tavern_image_request_conflict','配图内容已变化，请重新发送。');if(!(retry&&job.status==='failed'))return view(job);if(job.attempts>=3)fail(429,'tavern_image_retry_limit','本次配图已重试多次，请稍后重新发送。')}
  else {if(jobs.size>=12){const old=[...jobs].find(([,j])=>j.status!=='processing');if(!old)fail(429,'tavern_image_busy','已有配图正在生成，请稍候。');jobs.delete(old[0])}job={hash,attempts:0};jobs.set(id,job)}
  Object.assign(job,{status:'processing',result:null,error:null,expiresAt:now()+ttl,attempts:job.attempts+1})
  job.promise=generator.generate({...input,longJob:true}).then(result=>{job.result=result;job.status='completed'},error=>{job.status='failed';job.error={code:error.code||'tavern_image_failed',message:error.statusCode?error.message:'配图暂未完成，请稍后重试。'}})
  return view(job)
 }
 return {submit,status:(owner,id)=>view(get(owner,id)),result(owner,id){const job=get(owner,id);if(job.status!=='completed')fail(409,'tavern_image_not_ready','配图仍在生成。');return job.result},drain:()=>Promise.all([...jobs.values()].map(j=>j.promise))}
}
