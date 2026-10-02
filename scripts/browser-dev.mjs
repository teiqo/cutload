import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

const project=resolve(import.meta.dirname,'..');
const bundled=resolve(project,'../../work/toolchain');
const env={...process.env};
if(existsSync(resolve(bundled,'cargo/bin/cargo.exe'))){
  env.CARGO_HOME=resolve(bundled,'cargo');env.RUSTUP_HOME=resolve(bundled,'rustup');
  env.PATH=`${resolve(bundled,'cargo/bin')};${env.PATH}`;
}
const cargo=existsSync(resolve(bundled,'cargo/bin/cargo.exe'))?resolve(bundled,'cargo/bin/cargo.exe'):'cargo';
const children=[];
function start(binary,args){const child=spawn(binary,args,{cwd:project,env,stdio:'inherit',windowsHide:true});children.push(child);return child;}
function stop(){for(const child of children)child.kill();}
process.on('SIGINT',()=>{stop();process.exit()});process.on('SIGTERM',()=>{stop();process.exit()});
const server=start(cargo,['run','--manifest-path','src-tauri/Cargo.toml','--','--browser-backend']);
const vite=start(process.execPath,['node_modules/vite/bin/vite.js','--host','127.0.0.1','--port','5174','--strictPort']);
for(const child of [server,vite])child.on('exit',code=>{stop();process.exit(code||0)});
