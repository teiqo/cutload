import { invoke, isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { DownloadRequest, MediaInfo, Progress, RecentDownload } from './types';
export const desktop = isTauri();
export const browserBackend = !desktop && import.meta.env.DEV;
export const backendEnabled = desktop || browserBackend;
const address='http://127.0.0.1:5175';
let tokenPromise:Promise<string>|null=null;
async function token():Promise<string>{
  if(!tokenPromise)tokenPromise=fetch(`${address}/session`,{signal:AbortSignal.timeout(2500)}).then(async response=>{
    if(!response.ok)throw new Error('Локальный загрузчик недоступен');
    return (await response.json()).token as string;
  }).catch(()=>{tokenPromise=null;throw new Error('Локальный загрузчик не запущен. Запусти npm run browser в папке проекта.');});
  return tokenPromise;
}
async function command<T>(name:string,args:Record<string,unknown>={}):Promise<T>{
  if(desktop)return invoke<T>(name,args);
  const authorization=await token();
  let response:Response;
  try{response=await fetch(`${address}/rpc`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${authorization}`},body:JSON.stringify({command:name,args})});}
  catch{tokenPromise=null;throw new Error('Соединение с локальным загрузчиком потеряно');}
  if(!response.ok){tokenPromise=null;throw new Error('Локальный загрузчик перезапустился. Повтори действие.');}
  const data=await response.json();if(data.error)throw new Error(data.error);return data.result as T;
}
async function progress(callback:(event:Progress)=>void):Promise<()=>void>{
  if(desktop)return listen<Progress>('download-progress',event=>callback(event.payload));
  let stopped=false,cursor=0,first=true;
  const startedAt=Date.now();
  async function poll(){
    if(stopped)return;
    try{const data=await command<{cursor:number,events:{payload:Progress}[]}>('progress',{after:cursor});cursor=data.cursor;
      if(first){first=false;const latest=data.events.at(-1)?.payload;if(latest&&(['downloading','processing'].includes(latest.stage)||Number(latest.id.split('-')[0])>=startedAt))callback(latest);}
      else{for(const event of data.events)callback(event.payload);}
    }
    catch{/* Retry when the development backend starts or reconnects. */}
    if(!stopped)setTimeout(poll,500);
  }
  void poll();return ()=>{stopped=true};
}
export const backend = {
  analyze: (url:string,requestId?:string)=>command<MediaInfo>('analyze_media',{url,requestId}),
  cancelAnalysis:(id:string)=>command<void>('cancel_analysis',{id}),
  folder: ()=>command<string|null>('choose_folder'),
  defaults: ()=>command<string>('downloads_folder'),
  download: (request:DownloadRequest)=>command<string>('start_download',{request}),
  cancel: (id:string)=>command<void>('cancel_download',{id}),
  recent: ()=>command<RecentDownload[]>('recent_downloads'),
  thumbnail: (id:string)=>command<string|null>('download_thumbnail',{id}),
  open: (id:string,reveal:boolean)=>command<void>('open_download',{id,reveal}),
  cover: (url:string,title:string,folder:string)=>command<{id:string,path:string}>('save_cover',{url,title,folder}),
  project: ()=>command<string>('project_folder'),
  preview: (url:string)=>command<{duration:number,frames:{time:number,image:string}[]}>('preview_video',{url}),
  frame: (url:string,time:number)=>command<{time:number,image:string}>('preview_frame',{url,time}),
  progress,
};
