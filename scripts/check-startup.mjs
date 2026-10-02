import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import ts from 'typescript';

const permissions=JSON.parse(fs.readFileSync('src-tauri/capabilities/main.json')).permissions;
assert(permissions.includes('core:window:allow-show'),'native startup requires permission to show the window');
function fixture(){
  const timers=[];
  const splash={faded:false,removed:false,classList:{add(){splash.faded=true}},remove(){splash.removed=true}};
  return {splash,timers,setTimeout:(fn,ms)=>timers.push({fn,ms})};
}
// The classic script must remove the overlay even if the main module never initializes.
{
  const f=fixture();
  vm.runInNewContext(fs.readFileSync('frontend/startup.js','utf8'),{
    matchMedia:()=>({matches:false}),localStorage:{getItem:()=>null},
    document:{documentElement:{style:{setProperty(){}}},getElementById:()=>f.splash},setTimeout:f.setTimeout
  });
  assert.equal(f.timers[0].ms,2800);f.timers.shift().fn();assert(f.splash.faded);
  f.timers.shift().fn();assert(f.splash.removed);
}
// A rejected or unresponsive native show command must not block the normal timeout.
for(const show of [()=>Promise.reject(new Error('denied')),()=>new Promise(()=>{})]){
  const f=fixture();
  const source=fs.readFileSync('frontend/runtime/startup.ts','utf8').replace(/^import .*;\r?\n/gm,'').replace('export async function','async function');
  const context=vm.createContext({desktop:true,getCurrentWindow:()=>({show}),console:{error(){}},
    document:{querySelector:()=>f.splash,fonts:{ready:new Promise(()=>{})}},
    requestAnimationFrame(){},performance:{now:()=>1000},setTimeout:f.setTimeout});
  vm.runInContext(ts.transpile(source,{target:ts.ScriptTarget.ES2022}),context);
  const done=vm.runInContext('finishStartup()',context);
  await Promise.resolve();assert.equal(f.timers[0].ms,2200);f.timers.shift().fn();await done;
  assert(f.splash.faded);f.timers.shift().fn();assert(f.splash.removed);
}
console.log('startup checks passed: window permission, module failure fallback, rejected and pending IPC recovery');
