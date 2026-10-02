import {backend} from './bridge';
import {errorExplanation} from './errors';
import type {Storyboard} from './types';
import {storyboardFrameAt} from './storyboard';
type Frame={time:number,image:string,column?:number,row?:number,columns?:number,rows?:number};
export function createPreview(getSource:()=>{url:string,audio:boolean,storyboard?:Storyboard,duration?:number,thumbnail?:string},onDuration:(seconds:number)=>void,onProjectDownload:()=>void){
  const timeline=document.getElementById('timeline')!;
  const content=document.querySelector<HTMLElement>('.fragment-content')!;
  const filmstrip=document.getElementById('filmstrip')!;
  const hover=document.querySelector<HTMLElement>('.hover-preview')!;
  const preview=document.querySelector<HTMLElement>('.preview-frame')!;
  const image=document.createElement('img');image.alt='кадр видео';preview.replaceChildren(image);
  const activity=document.createElement('span');activity.className='frame-activity';activity.setAttribute('aria-hidden','true');preview.append(activity);
  const loadingBar=document.createElement('span');loadingBar.className='preview-loading-bar';loadingBar.setAttribute('aria-hidden','true');hover.append(loadingBar);
  image.onload=()=>{if(image.naturalHeight)hover.style.setProperty('--preview-aspect',String(image.naturalWidth/image.naturalHeight));if(!inFlight)hover.classList.remove('frame-loading')};
  const notice=document.createElement('div');notice.className='preview-notice';content.prepend(notice);
  let frames:Frame[]=[],loadedUrl='',revision=0,timer:ReturnType<typeof setTimeout>,inFlight=false,wanted=-1,coverFallback=false;
  const cache=new Map<number,Frame>();
  function storyboardFrame(seconds:number):Frame|null{const source=getSource();return storyboardFrameAt(source.storyboard,seconds,source.duration)}
  function tile(element:HTMLElement,frame:Frame){
    // Sprite coordinates must override the old decorative preview background.
    element.style.setProperty('background-image',`url("${frame.image.replace(/"/g,'%22')}")`,'important');
    element.style.setProperty('background-size',`${frame.columns! *100}% ${frame.rows! *100}%`,'important');
    element.style.setProperty('background-position',`${frame.columns!>1?frame.column!/(frame.columns!-1)*100:0}% ${frame.rows!>1?frame.row!/(frame.rows!-1)*100:0}%`,'important');
    element.style.setProperty('background-repeat','no-repeat','important');
    element.classList.add('storyboard-frame');
  }
  function showFrame(frame:Frame){if(frame.columns){image.hidden=true;tile(preview,frame);const s=getSource().storyboard!;hover.style.setProperty('--preview-aspect',String(s.width/s.height))}else{image.hidden=false;preview.classList.remove('storyboard-frame');for(const property of ['background-image','background-size','background-position','background-repeat'])preview.style.removeProperty(property);image.src=frame.image}}
  async function requestFrame(key:number,current:number){
    if(inFlight||cache.has(key)||key<0)return;inFlight=true;hover.classList.add('frame-loading');
    try{const frame=await backend.frame(getSource().url,key);if(current!==revision)return;cache.set(key,frame);if(cache.size>48)cache.delete(cache.keys().next().value!);if(wanted===key)image.src=frame.image;}
    catch{}finally{inFlight=false;if(image.complete)hover.classList.remove('frame-loading');if(frames.length&&(wanted!==key||current!==revision))void requestFrame(wanted,revision);}
  }
  const menu=document.createElement('div');menu.className='preview-menu';menu.hidden=true;
  const download=document.createElement('button');download.type='button';download.textContent='скачать в папку проекта';menu.append(download);document.body.append(menu);
  download.onclick=()=>{menu.hidden=true;onProjectDownload()};
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target as Node))menu.hidden=true});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')menu.hidden=true});
  for(const target of [timeline,document.querySelector<HTMLElement>('.cover')!])target.addEventListener('contextmenu',event=>{
    if(!getSource().url)return;event.preventDefault();menu.hidden=false;
    menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,event.clientX))+'px';
    menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,event.clientY))+'px';
  });
  async function ensure(){
    const source=getSource();if(source.audio||!source.url||loadedUrl===source.url)return;
    loadedUrl=source.url;const current=++revision;frames=[];coverFallback=false;cache.clear();filmstrip.replaceChildren();content.dataset.preview='pending';
    notice.textContent='получаю кадры видео…';filmstrip.setAttribute('aria-busy','true');
    if(source.storyboard&&source.duration){frames=Array.from({length:9},(_,i)=>storyboardFrame(source.duration!*i/9)).filter((f):f is Frame=>Boolean(f));if(frames.length){filmstrip.replaceChildren(...frames.map(f=>{const cell=document.createElement('div'),picture=document.createElement('span');picture.className='storyboard-tile';tile(picture,f);cell.append(picture);return cell}));showFrame(frames[0]);notice.textContent='';content.dataset.preview='ready';filmstrip.setAttribute('aria-busy','false');return}}
    try{const result=await backend.preview(source.url);if(current!==revision)return;
      frames=result.frames.sort((a,b)=>a.time-b.time);onDuration(result.duration);
      filmstrip.replaceChildren(...Array.from({length:9},(_,i)=>{const seconds=result.duration*i/9,frame=frames.reduce((a,b)=>Math.abs(a.time-seconds)<Math.abs(b.time-seconds)?a:b);const cell=document.createElement('div');const thumb=document.createElement('img');thumb.src=frame.image;thumb.alt='';cell.append(thumb);return cell}));
      showFrame(frames[0]);notice.textContent='';content.dataset.preview='ready';filmstrip.setAttribute('aria-busy','false');
    }catch(error){if(current===revision){
      if(source.thumbnail&&/^https?:\/\//.test(source.thumbnail)){
        coverFallback=true;
        frames=Array.from({length:9},(_,i)=>({time:(source.duration||0)*i/9,image:source.thumbnail!}));
        filmstrip.replaceChildren(...frames.map(frame=>{const cell=document.createElement('div'),thumb=document.createElement('img');thumb.src=frame.image;thumb.alt='';cell.append(thumb);return cell}));
        showFrame(frames[0]);notice.textContent='';content.dataset.preview='ready';
      }else{loadedUrl='';notice.replaceChildren(errorExplanation(String(error),document.documentElement.lang==='en'));content.dataset.preview='error';}
      filmstrip.setAttribute('aria-busy','false');
    }}
  }
  document.getElementById('fragmentCheck')!.addEventListener('change',()=>{if((document.getElementById('fragmentCheck') as HTMLInputElement).checked)void ensure()});
  document.querySelector('.qualities')!.addEventListener('click',()=>{if((document.getElementById('fragmentCheck') as HTMLInputElement).checked)void ensure()});
  timeline.onpointermove=event=>{
    if(getSource().audio||!frames.length)return;
    const rect=timeline.getBoundingClientRect(),p=Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));
    const seconds=p*Number((document.getElementById('rangeEnd') as HTMLInputElement).max);
    const half=hover.offsetWidth/2;
    hover.style.left=Math.max(half,Math.min(rect.width-half,p*rect.width))+'px';
    document.getElementById('hoverTime')!.textContent=`${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(Math.floor(seconds%60)).padStart(2,'0')}`;
    const key=Math.floor(seconds),nearest=cache.get(key)||frames.reduce((a,b)=>Math.abs(a.time-seconds)<Math.abs(b.time-seconds)?a:b);wanted=key;
    const storyboard=storyboardFrame(seconds);if(storyboard){showFrame(storyboard);return}
    showFrame(nearest);clearTimeout(timer);if(coverFallback)return;const current=revision;
    timer=setTimeout(()=>void requestFrame(key,current),160);
  };
  timeline.onpointerleave=()=>{wanted=-1;clearTimeout(timer)};
  return {reset(){revision++;loadedUrl='';frames=[];coverFallback=false;wanted=-1;cache.clear();clearTimeout(timer);notice.textContent='';image.removeAttribute('src');filmstrip.replaceChildren();filmstrip.setAttribute('aria-busy','false');content.dataset.preview='idle';hover.classList.remove('frame-loading');menu.hidden=true;}};
}
