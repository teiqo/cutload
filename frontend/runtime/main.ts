import {setupTextMenu} from './context-menu';
import {setupBackgroundFlow} from './background-flow';
import {finishStartup} from './startup';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {setupSettings} from './settings';
import { backend, desktop, backendEnabled } from './bridge';
import type { MediaInfo, Progress } from './types';
import './desktop.css';
import {createHistory} from './history';
import {enableLayoutMotion} from './motion';
import {createPreview} from './preview';
import {explainError} from './errors';

// Adapter for the existing design. The downloader itself never depends on its globals.
declare function showMedia(force?:string):void;
declare function selectQuality(q:string):void;
declare function updateTimes():void;
declare function positionWorkspace():void;
declare function positionIndicator():void;
declare let audioSource:boolean;
declare let quality:string;
declare let lang:string;
const element=<T extends HTMLElement=HTMLElement>(id:string)=>document.getElementById(id) as T;
let media:MediaInfo|null=null,job:string|null=null,analyzing=false,mediaUrl='';
let folder=localStorage.getItem('cutload-folder')||'';
let pickingFolder=false;
const duration=(seconds:number)=>`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
const text=(ru:string,en:string)=>lang==='ru'?ru:en;
const history=createHistory(()=>lang!=='ru');
const saveLabel=element('savePath').closest('.save-row')!.previousElementSibling!;saveLabel.classList.add('save-label');
const saveBlock=document.createElement('div');saveBlock.className='save-block';saveLabel.before(saveBlock);saveBlock.append(saveLabel,element('savePath').closest('.save-row')!);
enableLayoutMotion();
const coverLoadingBar=document.createElement('span');coverLoadingBar.className='cover-loading-bar';coverLoadingBar.setAttribute('aria-hidden','true');document.querySelector('.cover')!.after(coverLoadingBar);
const fragmentPlayback=document.createElement('span');fragmentPlayback.className='fragment-playback';const fragmentDuration=element('duration');fragmentDuration.before(fragmentPlayback);fragmentPlayback.append(fragmentDuration);
const coverButton=document.createElement('button');coverButton.type='button';coverButton.className='small-btn media-preview-btn';coverButton.textContent='скачать обложку';document.querySelector('.media-info')!.after(coverButton);coverButton.hidden=true;
const coverPreview=document.createElement('dialog');coverPreview.className='cover-preview';
const coverPreviewImage=document.createElement('img');coverPreviewImage.alt='';
const coverPreviewClose=document.createElement('button');coverPreviewClose.type='button';coverPreviewClose.className='close';coverPreviewClose.textContent='×';coverPreviewClose.setAttribute('aria-label','закрыть');coverPreviewClose.onclick=()=>coverPreview.close();
coverPreview.append(coverPreviewImage,coverPreviewClose);document.body.append(coverPreview);
coverPreview.addEventListener('click',event=>{if(event.target===coverPreview)coverPreview.close()});
const coverControl=document.querySelector<HTMLElement>('.cover')!;coverControl.setAttribute('role','button');coverControl.tabIndex=0;coverControl.setAttribute('aria-label','показать обложку');
function openCover(){if(!media?.thumbnail)return;coverPreviewImage.src=media.thumbnail_full||media.thumbnail;coverPreviewImage.alt=media.title;coverPreviewClose.setAttribute('aria-label',text('закрыть','close'));coverPreview.showModal()}
coverControl.addEventListener('click',openCover);coverControl.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();openCover()}});
element('langBtn').addEventListener('click',()=>{coverButton.textContent=text('скачать обложку','download cover')});

const titlebar=document.createElement('div');titlebar.className='desktop-titlebar';
const drag=document.createElement('div');drag.className='desktop-drag';drag.setAttribute('aria-label','переместить окно');
titlebar.append(drag);
for(const [action,label,shape] of [['minimize','свернуть','<path d="M3 8h10"/>'],['maximize','развернуть','<rect x="3" y="3" width="10" height="10"/>'],['close','закрыть','<path d="m3 3 10 10M13 3 3 13"/>']]){
  const button=document.createElement('button');button.type='button';button.className=`window-${action}`;button.setAttribute('aria-label',label);
  button.innerHTML=`<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.2" aria-hidden="true">${shape}</svg>`;
  button.onclick=async()=>{if(!desktop)return;const window=getCurrentWindow();if(action==='minimize')await window.minimize();else if(action==='maximize')await window.toggleMaximize();else await window.close()};titlebar.append(button);
}
drag.onmousedown=event=>{if(desktop&&event.button===0&&event.detail!==2){event.preventDefault();void getCurrentWindow().startDragging()}};
drag.ondblclick=()=>{if(desktop)void getCurrentWindow().toggleMaximize()};
if(desktop){
  document.body.prepend(titlebar);document.body.classList.add('desktop-app');
  document.addEventListener('contextmenu',event=>event.preventDefault());
  document.addEventListener('keydown',event=>{if(event.key==='F7'||event.key==='F12'||((event.ctrlKey||event.metaKey)&&['p','s','r','+','-','=','0'].includes(event.key.toLowerCase()))||(event.ctrlKey&&event.shiftKey&&['i','j','c'].includes(event.key.toLowerCase())))event.preventDefault()});
}

const status=document.createElement('div');status.className='download-status';status.setAttribute('role','status');status.setAttribute('aria-live','polite');
status.setAttribute('aria-hidden','true');status.inert=true;
const statusText=document.createElement('p');statusText.className='download-status-text';
const statusReason=document.createElement('p');statusReason.className='download-status-reason';
const progress=document.createElement('div');progress.className='download-progress';progress.hidden=true;progress.setAttribute('role','progressbar');progress.setAttribute('aria-label','прогресс загрузки');progress.setAttribute('aria-valuemin','0');progress.setAttribute('aria-valuemax','100');
const progressFill=document.createElement('span');progressFill.className='download-progress-fill';progress.append(progressFill);
function setProgress(value:number|null){
  progress.classList.toggle('indeterminate',value==null);
  if(value==null){progress.removeAttribute('aria-valuenow');return;}
  const percent=Math.max(0,Math.min(100,value));progress.setAttribute('aria-valuenow',String(percent));progressFill.style.transform=`scaleX(${percent/100})`;
}
const cancel=document.createElement('button');cancel.type='button';cancel.className='small-btn';cancel.textContent='отменить';cancel.hidden=true;
const statusClip=document.createElement('div');statusClip.className='download-status-clip';
const statusContent=document.createElement('div');statusContent.className='download-status-content';
statusContent.append(progress,statusText,statusReason,cancel);statusClip.append(statusContent);status.append(statusClip);
const statusDock=document.createElement('aside');statusDock.className='status-dock';statusDock.inert=true;
// Keep download messages in document flow below the card, never over its controls.
element('downloadBtn').after(statusDock);
new ResizeObserver(()=>requestAnimationFrame(()=>{
  positionWorkspace();
  if(status.parentElement===statusDock&&status.classList.contains('status-open')){
    const card=document.querySelector<HTMLElement>('.download-card')!;
    requestAnimationFrame(()=>card.scrollTo({top:Math.max(0,statusDock.offsetTop+statusDock.offsetHeight+16-card.clientHeight),behavior:'smooth'}));
  }
})).observe(statusContent);
element('linkForm').after(status);
function placeStatus(download:boolean){
  if(download)statusDock.prepend(status);else element('linkForm').after(status);
  statusDock.classList.toggle('dock-open',download&&status.classList.contains('status-open'));statusDock.inert=!download;
}
const statusDismiss=document.createElement('button');statusDismiss.type='button';statusDismiss.className='status-dismiss';statusDismiss.hidden=true;statusDismiss.textContent='×';statusDismiss.setAttribute('aria-label','скрыть сообщение');statusContent.append(statusDismiss);
const errorDetails=document.createElement('details');errorDetails.className='error-details';errorDetails.hidden=true;const errorSummary=document.createElement('summary'),errorRaw=document.createElement('pre');errorSummary.textContent='подробнее';errorDetails.append(errorSummary,errorRaw);statusContent.append(errorDetails);
const retry=document.createElement('button');retry.type='button';retry.className='small-btn';retry.hidden=true;retry.textContent='повторить';statusContent.append(retry);let lastAttempt:()=>void=()=>{void loadMedia()};retry.onclick=()=>lastAttempt();
const statusActions=document.createElement('div');statusActions.className='status-actions';statusActions.hidden=true;statusContent.append(statusActions);
let statusTimer:ReturnType<typeof setTimeout>|undefined;
function completedActions(id:string){statusActions.replaceChildren();for(const reveal of [false,true]){const b=document.createElement('button');b.className='small-btn';b.type='button';b.textContent=reveal?text('перейти к файлу','show in folder'):text('открыть','open');b.onclick=()=>{lastAttempt=()=>b.click();void backend.open(id,reveal).catch(error=>message(String(error),true))};statusActions.append(b)}statusActions.hidden=false}
const inputActivity=document.createElement('span');inputActivity.className='input-activity';inputActivity.setAttribute('aria-hidden','true');document.querySelector('.input-wrap')!.append(inputActivity);
let lastStatusReason='';
const lineAnimations=new Map<HTMLElement,Animation>();
const lineVersions=new Map<HTMLElement,number>();
function setStatusLine(line:HTMLElement,value:string,delay:number,animate:boolean){
  if(line.textContent===value)return;
  const version=(lineVersions.get(line)||0)+1;lineVersions.set(line,version);
  lineAnimations.get(line)?.cancel();
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches||document.body.classList.contains('performance-mode');
  const enter=()=>{if(lineVersions.get(line)!==version)return;line.textContent=value;
    if(animate)requestAnimationFrame(positionWorkspace);
    if(animate&&!reduced){const animation=line.animate([{opacity:0,translate:'0px -7px'},{opacity:1,translate:'0px 0px'}],{duration:260,delay,easing:'cubic-bezier(.2,.75,.25,1)',fill:'backwards'});lineAnimations.set(line,animation);}
  };
  if(animate&&!reduced&&line.textContent&&status.classList.contains('status-open')){
    const exit=line.animate([{opacity:1,translate:'0px 0px'},{opacity:0,translate:'0px 7px'}],{duration:150,easing:'ease-in',fill:'forwards'});lineAnimations.set(line,exit);
    exit.finished.then(()=>{if(lineVersions.get(line)===version){exit.cancel();enter();}}).catch(()=>{});
  }else enter();
}
function message(value:string,error=false,reason=''){
  clearTimeout(statusTimer);
  if(error){const explanation=explainError(reason||value,lang!=='ru');value=explanation.title;reason=explanation.action;if(errorRaw.textContent!==explanation.details)errorDetails.open=false;errorRaw.textContent=explanation.details;errorSummary.textContent=text('подробнее','details');retry.textContent=text('повторить','retry');retry.hidden=!explanation.retry;statusActions.hidden=true;}
  else retry.hidden=true;
  errorDetails.hidden=!error;status.classList.remove('status-complete');
  const opening=!status.classList.contains('status-open'),changed=lastStatusReason!==reason;
  setStatusLine(statusText,value,0,analyzing);statusText.title=value;setStatusLine(statusReason,reason,90,analyzing);lastStatusReason=reason;
  status.classList.add('status-open');status.classList.toggle('has-error',error);
  status.setAttribute('aria-hidden','false');status.inert=false;
  const docked=status.parentElement===statusDock;statusDock.classList.toggle('dock-open',docked);statusDock.inert=!docked;statusDismiss.hidden=analyzing||Boolean(job);
  if(opening||changed)requestAnimationFrame(positionWorkspace);
}
function hideStatus(){statusDismiss.hidden=true;clearTimeout(statusTimer);for(const line of [statusText,statusReason]){lineVersions.set(line,(lineVersions.get(line)||0)+1);lineAnimations.get(line)?.cancel();}status.classList.remove('status-open');status.setAttribute('aria-hidden','true');status.inert=true;statusDock.classList.remove('dock-open');statusDock.inert=true;document.querySelector<HTMLElement>('.download-card')!.scrollTo({top:0,behavior:'smooth'});requestAnimationFrame(positionWorkspace)}
status.addEventListener('transitionend',event=>{if(event.target===status)requestAnimationFrame(positionWorkspace)});
statusDismiss.onclick=hideStatus;element('closeCard').addEventListener('click',hideStatus);document.querySelector('.clear-input')!.addEventListener('click',()=>{if(!job&&!analyzing)hideStatus()});
function downloaded(id:string,path:string){message(text('скачано','downloaded'),false,path);status.classList.add('status-complete');completedActions(id)}
function busy(value:boolean){element<HTMLButtonElement>('downloadBtn').disabled=value;cancel.hidden=!value;statusDismiss.hidden=value||analyzing;element<HTMLButtonElement>('closeCard').disabled=value;progress.hidden=!value;status.classList.toggle('is-busy',value);document.body.classList.toggle('download-working',value);element('linkForm').classList.toggle('link-working',analyzing);}
function applyMedia(info:MediaInfo){
  media=info;
  coverButton.hidden=!info.thumbnail;coverButton.textContent=text('скачать обложку','download cover');
  audioSource=info.formats.length>0&&info.formats.every(format=>format.vcodec==='none');
  showMedia(audioSource?'audio':'video');
  element('mediaTitle').textContent=info.title||text('без названия','untitled');
  element('mediaMeta').textContent=[info.uploader||info.channel,info.duration?duration(info.duration):null].filter(Boolean).join(' · ');
  videoPreview?.reset();
  const max=Math.max(1,Math.floor(info.duration||0));
  for(const id of ['rangeStart','rangeEnd'])element<HTMLInputElement>(id).max=String(max);
  element<HTMLInputElement>('rangeStart').value='0';element<HTMLInputElement>('rangeEnd').value=String(max);
  element<HTMLInputElement>('fragmentCheck').disabled=!info.duration||info.duration<5;
  document.querySelectorAll<HTMLButtonElement>('.quality[data-q]').forEach(button=>{
    const q=button.dataset.q!;
    const maximum=Math.max(0,...info.formats.filter(f=>f.vcodec!=='none').map(f=>f.height||0));
    button.hidden=!['auto','audio'].includes(q)&&(audioSource||(maximum>0&&Number(q)>maximum));
    button.disabled=false;
  });
  const cover=document.querySelector<HTMLElement>('.cover')!;
  cover.replaceChildren();
  cover.classList.remove('cover-loading');cover.style.setProperty('--cover-width',(info.thumbnail_width&&info.thumbnail_height?Math.round(Math.max(32,Math.min(112,56*info.thumbnail_width/info.thumbnail_height))/2)*2:88)+'px');
  if(info.thumbnail&&/^https?:\/\//.test(info.thumbnail)){
    const image=document.createElement('img');image.alt='';image.referrerPolicy='no-referrer';cover.classList.add('cover-loading');
    image.decoding='async';image.onload=()=>{cover.classList.remove('cover-loading');};
    image.onerror=()=>{image.remove();cover.classList.remove('cover-loading')};cover.append(image);image.src=info.thumbnail;
  }
  updateTimes();positionIndicator();requestAnimationFrame(positionWorkspace);
}

async function receive(event:Progress){
  if(job&&job!==event.id)return;
  if(status.parentElement!==statusDock)placeStatus(true);
  job=event.id;
  if(event.stage==='cancelled'){job=null;busy(false);hideStatus();element('downloadBtn').textContent=text('скачать','download');return;}
  if(event.stage==='complete'){job=null;busy(false);downloaded(event.id,event.path||'');element('downloadBtn').textContent=text('скачать','download');void history.refresh();return;}
  if(['downloading','processing'].includes(event.stage))busy(true);
  const percent=event.percent==null?'':` · ${Math.floor(event.percent)}%`;
  const megabytes=(bytes:number)=>(bytes/1_000_000).toLocaleString(lang==='ru'?'ru-RU':'en-US',{maximumFractionDigits:1});
  const transfer=event.downloaded_bytes!=null?`${megabytes(event.downloaded_bytes)} ${text('из','of')} ${event.total_bytes!=null?megabytes(event.total_bytes):'…'} ${text('МБ','MB')}`:'';
  const remaining=event.eta!=null?text(`осталось ${duration(Math.ceil(event.eta))}`,`${duration(Math.ceil(event.eta))} remaining`):text('рассчитываю время…','estimating time…');
  const labels:Record<string,[string,string]>={downloading:[text('скачиваю файл','downloading file')+percent,text('получаю данные с сайта; скорость зависит от источника и соединения','receiving data from the source; speed depends on the source and connection')],processing:[text('подготавливаю файл','preparing file')+percent,event.message],complete:[text('готово','complete'),event.path||''],cancelled:[text('загрузка отменена','download cancelled'),''],error:[text('не удалось скачать','download failed'),event.message]};
  const [label,reason]=labels[event.stage]||[event.message,''];message(label,event.stage==='error',reason);
  if(event.stage==='downloading')statusReason.textContent=transfer?`${transfer} · ${remaining}`:text('ожидаю данные от источника…','waiting for source data…');
  setProgress(event.percent??null);
  if(['complete','error','cancelled'].includes(event.stage)){job=null;busy(false);element('downloadBtn').textContent=text('скачать','download')}
}
cancel.onclick=()=>{if(job)void backend.cancel(job).catch(error=>message(String(error),true))};

let searchRevision=0,searchId='',searchTimers:ReturnType<typeof setTimeout>[]=[];
function searchButton(active:boolean){const form=element('linkForm');form.classList.toggle('searching',active);element('loadBtn').setAttribute('aria-label',active?text('отменить поиск','cancel search'):text('загрузить','load'));element<HTMLButtonElement>('loadBtn').disabled=false;form.classList.toggle('link-working',active);}
function cancelSearch(){if(!analyzing)return;searchRevision++;analyzing=false;searchTimers.forEach(clearTimeout);searchButton(false);const id=searchId;searchId='';if(id)void backend.cancelAnalysis(id).catch(()=>{});for(const [url,entry] of prefetched)if(entry.id===id)prefetched.delete(url);hideStatus()}
async function loadMedia(){
  if(analyzing||job)return;
  const url=element<HTMLInputElement>('url').value.trim();
  if(!url){element<HTMLInputElement>('url').focus();return}
  const revision=++searchRevision,cached=prefetched.get(url);searchId=cached?.id||crypto.randomUUID();analyzing=true;searchButton(true);lastAttempt=()=>{void loadMedia()};
  placeStatus(false);progress.hidden=true;cancel.hidden=true;statusActions.hidden=true;
  message(text('проверяю ссылку','checking link'),false,text('получаю название, длительность и доступное качество','reading the title, duration and available qualities'));
  const searchLines=[
    [text('получаю данные','reading media data'),text('ожидаю название, длительность и доступные форматы от источника','waiting for the title, duration and available formats')],
    [text('поиск ещё идёт','still searching'),text('источник отвечает дольше обычного; продолжаю ждать','the source is taking longer than usual; still waiting')]
  ];
  const timers=searchLines.map(([label,reason],index)=>setTimeout(()=>{if(analyzing&&revision===searchRevision)message(label,false,reason)},index===0?1200:5500));searchTimers=timers;
  try{const info=await (cached?.promise||backend.analyze(url,searchId));if(revision!==searchRevision)return;mediaUrl=url;applyMedia(info);hideStatus();}
  catch(error){if(revision===searchRevision&&!String(error).includes('SEARCH_CANCELLED'))message(String(error),true)}
  finally{timers.forEach(clearTimeout);if(revision===searchRevision){analyzing=false;searchId='';searchButton(false);statusDismiss.hidden=!status.classList.contains('status-open')||Boolean(job);}}
}
const prefetched=new Map<string,{promise:Promise<MediaInfo>,id:string}>();let prefetchTimer:ReturnType<typeof setTimeout>;
element<HTMLInputElement>('url').addEventListener('input',()=>{clearTimeout(prefetchTimer);const url=element<HTMLInputElement>('url').value.trim();if(!/^https?:\/\/(?:www\.)?(?:youtube\.com\/watch\?.*v=|youtu\.be\/)[\w-]{11}(?:[&#?].*)?$/.test(url))return;prefetchTimer=setTimeout(()=>{if(prefetched.has(url)||analyzing)return;const id=crypto.randomUUID(),promise=backend.analyze(url,id),entry={promise,id};prefetched.set(url,entry);setTimeout(()=>{if(prefetched.get(url)===entry)prefetched.delete(url)},600000);if(prefetched.size>4)prefetched.delete(prefetched.keys().next().value!);promise.catch(()=>{if(prefetched.get(url)===entry)prefetched.delete(url)})},700)});

let projectDownload:()=>void=()=>{};
const videoPreview=backendEnabled?createPreview(()=>({url:mediaUrl,audio:document.body.classList.contains('audio'),storyboard:media?.storyboard,duration:media?.duration,thumbnail:media?.thumbnail}),seconds=>{
  if(!media)return;media.duration=seconds;const max=Math.floor(seconds);
  for(const id of ['rangeStart','rangeEnd'])element<HTMLInputElement>(id).max=String(max);
  element<HTMLInputElement>('rangeEnd').value=String(max);element<HTMLInputElement>('fragmentCheck').disabled=max<5;
  updateTimes();requestAnimationFrame(positionWorkspace);
},()=>projectDownload()):null;
if(backendEnabled){
  searchButton(false);
  async function pickFolder():Promise<boolean>{
    if(pickingFolder)return false;
    pickingFolder=true;element<HTMLButtonElement>('downloadBtn').disabled=true;
    try{const selected=await backend.folder();if(!selected)return false;folder=selected;localStorage.setItem('cutload-folder',folder);element('savePath').textContent=folder;return true;}
    finally{pickingFolder=false;element<HTMLButtonElement>('downloadBtn').disabled=Boolean(job);}
  }
  element<HTMLFormElement>('linkForm').onsubmit=event=>{event.preventDefault();if(analyzing)cancelSearch();else void loadMedia()};
  element('chooseFolder').onclick=()=>{void pickFolder().catch(error=>message(String(error),true))};
  coverButton.onclick=async()=>{if(!media?.thumbnail||job)return;lastAttempt=()=>coverButton.click();try{if(!folder&&!await pickFolder())return;placeStatus(true);coverButton.disabled=true;statusActions.hidden=true;message(text('скачиваю обложку','downloading cover'));const saved=await backend.cover(media.thumbnail_full||media.thumbnail,media.title,folder);downloaded(saved.id,saved.path);void history.refresh()}catch(error){message(String(error),true)}finally{coverButton.disabled=false}};
  async function startDownload(destination?:string){
    if(!media||job||pickingFolder)return;
    lastAttempt=()=>{void startDownload(destination)};
    if(element<HTMLInputElement>('fragmentCheck').checked&&!media.duration){message(text('дождитесь загрузки шкалы фрагмента','wait for the fragment timeline'),false,text('определяю длительность видео','reading video duration'));return;}
    if(!destination&&!folder){try{if(!await pickFolder())return;}catch(error){message(text('не удалось выбрать папку','could not select a folder'),true,String(error));return;}}
    setProgress(0);placeStatus(true);busy(true);message(text('подключаюсь к источнику','connecting to source'),false,text('выбираю дорожки для указанного качества и формата','selecting tracks for the requested quality and format'));setProgress(null);
    statusActions.hidden=true;
    const fragmentCheck=element<HTMLInputElement>('fragmentCheck');
    const start=Number(element<HTMLInputElement>('rangeStart').value),end=Number(element<HTMLInputElement>('rangeEnd').value);
    const trim=fragmentCheck.checked&&(start>0||end<Number(element<HTMLInputElement>('rangeEnd').max));
    if(fragmentCheck.checked&&!trim){fragmentCheck.checked=false;fragmentCheck.dispatchEvent(new Event('change',{bubbles:true}));}
    try{
      job=await backend.download({url:mediaUrl,title:media.title,thumbnail:media.thumbnail,folder:destination||folder,quality,codec:element<HTMLSelectElement>('outputCodec').value,format:element<HTMLSelectElement>('outputFormat').value,audio:document.body.classList.contains('audio'),duration:media.duration||undefined,...(trim?{start,end}:{})});
    }catch(error){job=null;busy(false);message(String(error),true)}
  }
  element('downloadBtn').onclick=()=>{void startDownload()};
  projectDownload=()=>{void backend.project().then(path=>startDownload(path)).catch(error=>message(String(error),true))};
  void backend.progress(receive);
  element('savePath').textContent=folder||text('выберем при первом скачивании','choose on the first download');
  const caption=document.querySelector<HTMLElement>('.demo-caption')!;
  caption.remove();
  document.querySelector<HTMLElement>('.fragment-content')!.dataset.preview='pending';
}else{
  document.querySelector<HTMLElement>('.demo-caption')!.textContent='предпросмотр интерфейса · скачивание доступно в приложении';
}
setupSettings();
setupTextMenu();
setupBackgroundFlow();
void finishStartup();
