// PDF content-stream order often differs from the printed order, especially
// coefficients and superscripts in Cambridge maths. Reconstruct lines from
// glyph coordinates before indexing. This is not OCR or an answer parser.
export function spatialPdfSourceText(items,height){
 const visible=items.filter(i=>i.str?.trim()&&i.transform?.[5]>42&&i.transform?.[5]<height-55&&!/^[.·_\s]{4,}$/.test(i.str))
 const lines=[]
 for(const item of visible.sort((a,b)=>b.transform[5]-a.transform[5]||a.transform[4]-b.transform[4])){
  let line=lines.findLast(l=>Math.abs(l.top-item.transform[5])<=7)
  if(!line){line={top:item.transform[5],items:[]};lines.push(line)}
  line.items.push(item)
 }
 return lines.map(line=>{
  const heights=new Map();for(const i of line.items){const y=Math.round(i.transform[5]);heights.set(y,(heights.get(y)||0)+i.str.length)}
  const baseline=[...heights].sort((a,b)=>b[1]-a[1])[0][0]
  return line.items.sort((a,b)=>a.transform[4]-b.transform[4]||b.transform[5]-a.transform[5]).map(i=>(i.transform[5]-baseline>3&&/^[0-9−+\-]+$/.test(i.str.trim())?'^':'')+i.str).join(' ')
 }).join('\n').replace(/[.·_]{4,}/g,' ').replace(/[\u0000-\u0008]/g,' ').replace(/\b\d{4}\/\d{2}\/[A-Z/]+\/\d{2}\b/g,' ').replace(/[ \t]+/g,' ').trim()
}
