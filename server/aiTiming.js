// Numeric-only diagnostics. Never retain prompts, images or reasoning content.
const FIELDS=new Set(['serializationMs','responseHeadersMs','firstChunkMs','firstReasoningMs','firstAnswerMs','streamCompleteMs','outputMs','totalMs','inputTokens','cachedInputTokens','outputTokens','reasoningTokens'])
export function safeAiTiming(value){
  const out={}
  for(const key of FIELDS){const n=value?.[key];if(typeof n==='number'&&Number.isFinite(n)&&n>=0&&n<=10000000)out[key]=Math.round(n)}
  return out
}
export function createAiTiming(now=()=>performance.now()){
  const start=now(),values={}
  return {
    mark(key){if(FIELDS.has(key)&&values[key]===undefined)values[key]=Math.max(0,now()-start)},
    usage(payload){
      const u=payload?.usage||payload?.response?.usage
      if(!u)return
      const counts={inputTokens:u.prompt_tokens??u.input_tokens,cachedInputTokens:u.prompt_cache_hit_tokens??u.input_tokens_details?.cached_tokens,outputTokens:u.completion_tokens??u.output_tokens,reasoningTokens:u.completion_tokens_details?.reasoning_tokens??u.output_tokens_details?.reasoning_tokens}
      Object.assign(values,safeAiTiming(counts))
    },
    snapshot(){
      const result={...values,totalMs:Math.max(0,now()-start)}
      if(values.streamCompleteMs!==undefined&&values.firstAnswerMs!==undefined)result.outputMs=Math.max(0,values.streamCompleteMs-values.firstAnswerMs)
      return safeAiTiming(result)
    },
  }
}
