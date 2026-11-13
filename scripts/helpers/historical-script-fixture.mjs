// Compatibility suite: seed pre-retirement rooms through constructor injection.
// This helper is never imported by server code or shipped to production.
// New-room policy is tested separately against the real, uninjected API.
import {scriptGame,SCRIPT_GAMES} from '../../server/scriptGameCatalog.js'
import {editorialEdition} from '../../server/scriptEditorialEditions.js'
import {scriptSceneArt} from '../../server/scriptArt.js'
import {createScriptRoomStore as actualStore} from '../../server/scriptRoomStore.js'
import {createScriptRoomApi as actualApi} from '../../server/scriptRoomApi.js'
export {scriptGame,SCRIPT_GAMES}
export {scriptActorMessages} from '../../server/scriptRoomApi.js'
export function newScriptGame(id,version){
 const spec=editorialEdition(id)
 return version===2&&spec?scriptGame(id,spec.version,spec.edition):scriptGame(id,version)
}
export function publicScriptCatalog(){return ['before-rain','thirteenth-curtain','last-midnight','inverted-observatory','one-more-stop','last-elective','venice-blue-hour'].map(id=>{
 const game=newScriptGame(id,2),{title,genre,duration,difficulty,summary,warning,roles}=game
 return {id,version:2,title,genre,duration,difficulty,summary,warning,players:`1–${roles.length} 人 · AI 补位`,cover:scriptSceneArt(game,0),roles:roles.map(({id,name,tagline})=>({id,name,tagline}))}
})}
export const createScriptRoomStore=options=>actualStore({...options,resolveNewGame:newScriptGame})
export const createScriptRoomApi=options=>actualApi({...options,store:options.store||createScriptRoomStore({root:options.root})})
export const currentEditorialBooks=()=>publicScriptCatalog().map(({id})=>newScriptGame(id,2))
