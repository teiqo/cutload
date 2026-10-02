import {backend} from './bridge';
import type {RecentDownload} from './types';
import {errorExplanation} from './errors';

export function createHistory(english:()=>boolean){
  const t=(ru:string,en:string)=>english()?en:ru;
  const tools=document.createElement('div');tools.className='bottom-tools';
  const orbit=document.getElementById('aboutBtn')!;orbit.before(tools);tools.append(orbit);
  const trigger=document.createElement('button');trigger.type='button';trigger.className='circle history-trigger';trigger.setAttribute('aria-expanded','false');trigger.setAttribute('aria-controls','recentDownloads');
  trigger.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 11a9 9 0 1 1 2.6 7M3 5v6h6"/><path d="M12 7v5l3 2"/></svg>';tools.append(trigger);
  const panel=document.createElement('section');panel.id='recentDownloads';panel.className='recent-downloads';panel.setAttribute('aria-label',t('недавние загрузки','recent downloads'));panel.inert=true;
  const header=document.createElement('div');header.className='recent-header';
  const heading=document.createElement('h2'),close=document.createElement('button');close.type='button';close.className='recent-close';close.textContent='×';header.append(heading,close);
  const list=document.createElement('div');list.className='recent-list';panel.append(header,list);document.body.append(panel);
  let thumbnailQueue=Promise.resolve();
  const visibleThumbs=new IntersectionObserver(entries=>{for(const entry of entries){if(!entry.isIntersecting)continue;visibleThumbs.unobserve(entry.target);const image=entry.target as HTMLImageElement;thumbnailQueue=thumbnailQueue.then(async()=>{if(!image.isConnected)return;try{const src=await backend.thumbnail(image.dataset.download!);if(src&&image.isConnected)image.src=src}catch{}})}},{root:list});
  let open=false,revision=0;
  function labels(){const label=t('недавние загрузки','recent downloads');trigger.setAttribute('aria-label',label);trigger.title=label;heading.textContent=label;close.setAttribute('aria-label',t('закрыть','close'));panel.setAttribute('aria-label',label)}
  function hide(){open=false;revision++;panel.classList.remove('recent-open');panel.inert=true;trigger.setAttribute('aria-expanded','false');trigger.classList.remove('active')}
  function render(entries:RecentDownload[]){
    visibleThumbs.disconnect();list.replaceChildren();
    if(!entries.length){const empty=document.createElement('p');empty.className='recent-empty';empty.textContent=t('здесь появятся скачанные файлы','completed downloads will appear here');list.append(empty);return}
    for(const entry of entries){
      const row=document.createElement('article');row.className='recent-entry';
      const title=document.createElement('h3');title.textContent=entry.title;title.title=entry.title;
      const path=document.createElement('p');path.className='recent-path';path.textContent=entry.path.split(/[\\/]/).pop()||entry.path;path.title=entry.path;
      const date=document.createElement('time');date.dateTime=new Date(entry.created*1000).toISOString();date.textContent=new Intl.DateTimeFormat(english()?'en':'ru',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'}).format(entry.created*1000);
      const actions=document.createElement('div');actions.className='recent-actions';
      for(const reveal of [false,true]){const button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent=reveal?t('перейти к файлу','show in folder'):t('посмотреть','view');button.title=reveal?t('выделить файл в проводнике','reveal file in explorer'):t('открыть в плеере','open in player');button.onclick=async()=>{button.disabled=true;try{await backend.open(entry.id,reveal);row.querySelector('.recent-error')?.remove()}catch(error){row.querySelector('.recent-error')?.remove();const warning=errorExplanation(String(error),english());warning.className='recent-error';row.append(warning)}finally{button.disabled=false}};actions.append(button)}
      const headingRow=document.createElement('div');headingRow.className='recent-entry-heading';const details=document.createElement('div');details.append(title,path,date);
      const image=document.createElement('img');image.className='recent-thumb';image.alt='';image.dataset.download=entry.id;image.decoding='async';
      if(entry.thumbnail&&/^https?:\/\//.test(entry.thumbnail)){image.loading='lazy';image.referrerPolicy='no-referrer';image.onerror=()=>{image.onerror=null;image.removeAttribute('src');visibleThumbs.observe(image)};image.src=entry.thumbnail}else visibleThumbs.observe(image);
      headingRow.append(image);
      headingRow.append(details);row.append(headingRow,actions);list.append(row);
    }
  }
  async function refresh(){
    labels();if(!open)return;
    const current=++revision;
    try{const entries=await backend.recent();if(open&&revision===current)render(entries)}
    catch(error){if(open&&revision===current){const warning=document.createElement('p');warning.className='recent-empty';warning.textContent=String(error);list.replaceChildren(warning)}}
  }
  trigger.onclick=()=>{if(open){hide();return}open=true;panel.inert=false;panel.classList.add('recent-open');trigger.setAttribute('aria-expanded','true');trigger.classList.add('active');void refresh()};
  close.onclick=hide;
  document.addEventListener('click',event=>{const target=event.target as Node;if(open&&!panel.contains(target)&&!trigger.contains(target))hide()});
  document.addEventListener('keydown',event=>{if(event.key==='Escape')hide()});
  document.getElementById('langBtn')!.addEventListener('click',()=>{labels();void refresh()});
  labels();return {refresh};
}
