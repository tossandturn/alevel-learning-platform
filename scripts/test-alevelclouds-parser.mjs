import assert from 'node:assert/strict'
import {parseSource} from './import-alevelclouds-papers.mjs'
const options={board:'Edexcel',subject:'physics',host:'edephy'}
const html='<h5>新考纲</h5><details><summary>U1: Mechanics and Materials</summary><table><tr><th rowspan="2">2025年6月</th><td><a href="https://edephy.alevelclouds.com/25_06_QP_U1.pdf">试卷</a><a href="https://edephy.alevelclouds.com/25_06_MS_U1.pdf">答案</a></td></tr><tr><td><a href="https://edephy.alevelclouds.com/25_06_QP_U1A.pdf">A</a></td></tr><!--<a href="https://edephy.alevelclouds.com/25_06_QP_HIDDEN.pdf">hidden</a>--></table></details>'
const rows=parseSource(html,options);assert.equal(rows.length,3);assert.equal(rows[2].variant,'A');assert.equal(rows[0].legacy,false);assert.equal(rows[0].unit,'U1')
assert.throws(()=>parseSource(html.replace('2025年6月','2024年6月'),options),/disagrees/)
assert.equal(parseSource(html.replaceAll('edephy.alevelclouds.com','untrusted.example'),options).length,0)
assert.equal(parseSource('<h5>旧考纲</h5>'+html.replace('<h5>新考纲</h5>',''),options)[0].legacy,true)
console.log('PASS source parsing: table row spans, variants, legacy separation, comment exclusion, dates and source host')
