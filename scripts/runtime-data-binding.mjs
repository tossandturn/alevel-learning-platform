import fs from 'node:fs'
import path from 'node:path'
import assert from 'node:assert/strict'

export function assertRuntimeDataBinding(releaseRoot,declaration,expectedRoot){
 const bindingPath=path.join(releaseRoot,'data')
 if(declaration===undefined){assert.ok(!fs.existsSync(bindingPath)&&!fs.lstatSync(bindingPath,{throwIfNoEntry:false}),'undeclared runtime data binding');assert.ok(!expectedRoot,'unexpected runtime data argument');return []}
 assert.equal(declaration.schemaVersion,'stem-runtime-data-binding.v1');assert.equal(declaration.relativePath,'data')
 assert.ok(expectedRoot&&path.isAbsolute(expectedRoot),'explicit absolute runtime data root required')
 assert.equal(declaration.target,path.resolve(expectedRoot),'runtime data declaration differs from deployment target')
 assert.ok(fs.lstatSync(bindingPath).isSymbolicLink(),'runtime data must be a link, never copied database contents')
 assert.equal(fs.realpathSync(bindingPath),fs.realpathSync(expectedRoot),'runtime data link changed')
 assert.equal(fs.realpathSync(expectedRoot),path.resolve(expectedRoot),'runtime data target must be canonical')
 assert.ok(fs.statSync(expectedRoot).isDirectory(),'runtime data target must be a directory')
 const relative=path.relative(fs.realpathSync(releaseRoot),fs.realpathSync(expectedRoot))
 assert.ok(relative.startsWith('..'+path.sep)||path.isAbsolute(relative),'persistent data cannot reside inside the release')
 return ['data']
}
