import assert from 'node:assert/strict'
import {spatialPdfSourceText} from './lib/coach-pdf-source-text.mjs'
import {sourceTokens,verifySourcePassage} from '../server/coachSourceText.js'
const item=(str,x,y,height=11.5)=>({str,transform:[1,0,0,1,x,y],height})
const values=[item('Express',95,765),item('y',140,765),item('y',173,765),item('3',134,765),item('12',162,765),item('15',189,765),item('2',146,770,8),item('-',152,765),item('-',180,765),item('in the form',204,765),item('(',265,765),item(')',291,765),item('y',269,765),item('a',285,765),item('b',312,765),item('3',258,765),item('2',296,770,8),item('+',276,765),item('+',302,765),item(', where a and b are constants.',319,765)]
const actual=spatialPdfSourceText(values,842),expected='Express 3y² - 12y - 15 in the form 3(y+a)² + b, where a and b are constants.'
assert(verifySourcePassage(sourceTokens(expected),sourceTokens(actual)),'Spatial coefficients and superscripts must be restored before text retrieval')
assert.equal(verifySourcePassage(sourceTokens(expected.replace('12y','17y')),sourceTokens(actual)),null)
console.log('Source PDF spatial reading order and coefficient checks PASS')
