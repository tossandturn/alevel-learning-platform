// WHATWG SSE framing only, not model JSON or completion validation.
// https://html.spec.whatwg.org/multipage/server-sent-events.html#event-stream-interpretation
export function createAiSseDecoder({maxEventChars=2*1024*1024}={}) {
  let buffer='',scan=0,event='',data=[],dataChars=0,skipLf=false,first=true
  const bounded=length=>{
    if(length>maxEventChars)throw Object.assign(new Error('AI provider SSE event exceeded its size limit.'),{code:'AI_RESPONSE_SCHEMA_INVALID'})
  }
  return {
    *push(value) {
      let chunk=String(value||'')
      if(!chunk)return
      if(first){first=false;if(chunk.charCodeAt(0)===0xfeff)chunk=chunk.slice(1)}
      if(skipLf){skipLf=false;if(chunk.startsWith('\n'))chunk=chunk.slice(1)}
      buffer+=chunk
      let start=0
      for(;scan<buffer.length;scan++){
        const char=buffer[scan]
        if(char!=='\n'&&char!=='\r')continue
        const line=buffer.slice(start,scan)
        if(char==='\r'){
          if(buffer[scan+1]==='\n')scan++
          else if(scan===buffer.length-1)skipLf=true
        }
        start=scan+1
        bounded(line.length+dataChars)
        if(line===''){
          const frame=data.length?{event,data:data.join('\n')}:null
          event='';data=[];dataChars=0
          if(frame)yield frame
          continue
        }
        if(line.startsWith(':'))continue
        const colon=line.indexOf(':'),field=colon<0?line:line.slice(0,colon)
        let content=colon<0?'':line.slice(colon+1)
        if(content.startsWith(' '))content=content.slice(1)
        if(field==='data'){data.push(content);dataChars+=content.length+1;bounded(dataChars)}
        else if(field==='event')event=content
        // id/retry/unknown fields do not change the provider answer contract.
      }
      buffer=buffer.slice(start);scan-=start
      bounded(buffer.length+dataChars)
    },
  }
}
