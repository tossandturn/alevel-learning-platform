export function paperReferencesFromHeader(value){
 const text=String(value||'').slice(0,2200).toUpperCase(),result=new Set()
 const named=/(?:^|[^A-Z0-9])(W\s*(?:P\s*H|M\s*A|F\s*M|M\s*E|S\s*T|D\s*M)\s*\d\s*\d|6\s*P\s*H\s*\d\s*\d|(?:PH|MA|FM)\s*0\s*[1-9])(?=[^0-9]|$)/g
 for(const match of text.matchAll(named))result.add(match[1].replace(/\s/g,''))
 for(const match of text.matchAll(/(?:^|[^0-9])(6[0-9]{3})\s*\/\s*0[1-9](?=[^0-9]|$)/g))result.add(match[1])
 return [...result]
}
