import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import {desktop} from './bridge';
import {newerRelease} from './update-version';
import appPackage from '../../package.json';

export function setupSettings(){
  const popup=document.querySelector<HTMLElement>('#accPop')!,settings=document.querySelector<HTMLButtonElement>('#settingsBtn')!,language=document.querySelector<HTMLButtonElement>('#langBtn')!;
  settings.innerHTML='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m9.5 3-.6 2-1.7 1-2-.5L3 9l1.4 1.5v3L3 15l2.2 3.5 2-.5 1.7 1 .6 2h5l.6-2 1.7-1 2 .5L21 15l-1.4-1.5v-3L21 9l-2.2-3.5-2 .5-1.7-1-.6-2Z"/><circle cx="12" cy="12" r="3"/></svg>';
  const title=document.createElement('h2');title.className='settings-title';
  const row=document.createElement('div');row.className='settings-language';const languageLabel=document.createElement('span');row.append(languageLabel,language);popup.prepend(title,row);
  language.className='small-btn settings-language-button';
  const updates=document.createElement('div');updates.className='settings-updates';
  const check=document.createElement('button');check.type='button';check.className='small-btn';check.id='checkUpdates';
  const result=document.createElement('p');result.setAttribute('role','status');result.setAttribute('aria-live','polite');
  const open=document.createElement('button');open.type='button';open.className='small-btn';open.hidden=true;
  updates.append(check,result,open);row.after(updates);
  const notice=document.createElement('aside');notice.className='app-update-notice';notice.hidden=true;notice.setAttribute('aria-live','polite');
  const noticeText=document.createElement('span'),noticeOpen=document.createElement('button');noticeOpen.type='button';noticeOpen.className='small-btn';notice.append(noticeText,noticeOpen);document.body.append(notice);
  let version=appPackage.version,latest='',state:'idle'|'checking'|'available'|'current'|'empty'|'error'='idle',inFlight=false;
  const text=(ru:string,en:string)=>document.documentElement.lang==='en'?en:ru;
  function render(){
    title.textContent=text('настройки','settings');popup.setAttribute('aria-label',title.textContent);settings.setAttribute('aria-label',latest?text('настройки — доступно обновление','settings — update available'):title.textContent);settings.title=title.textContent;
    languageLabel.textContent=text('язык','language');language.textContent=document.documentElement.lang==='en'?'en':'ru';language.setAttribute('aria-label',text('сменить язык','change language'));
    check.textContent=state==='checking'?text('проверяю обновления…','checking for updates…'):text('искать обновления','check for updates');check.disabled=inFlight;
    const messages={idle:text(`версия ${version}`,`version ${version}`),checking:text('проверяю новые версии на GitHub','checking GitHub releases'),available:text(`доступна версия ${latest}`,`version ${latest} is available`),current:text('установлена актуальная версия','you have the latest version'),empty:text('новых опубликованных версий пока нет','no new published releases yet'),error:text('не удалось проверить. проверь интернет и попробуй ещё раз','could not check. check your connection and try again')};
    result.textContent=messages[state];open.hidden=!latest;open.textContent=noticeOpen.textContent=text('открыть обновление','open update');noticeText.textContent=text(`доступно обновление ${latest}`,`update ${latest} is available`);notice.hidden=!latest;settings.classList.toggle('has-update',Boolean(latest));
  }
  async function showRelease(){if(desktop)await invoke('open_updates');else window.open('https://github.com/teiqo/cutload/releases','_blank','noopener,noreferrer')}
  for(const button of [open,noticeOpen])button.onclick=event=>{event.stopPropagation();void showRelease().catch(()=>{state='error';render()})};
  async function checkUpdates(){
    if(inFlight)return;inFlight=true;state='checking';render();
    try{
      const response=await fetch('https://api.github.com/repos/teiqo/cutload/releases/latest',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
      if(response.status===404){latest='';state='empty'}
      else {if(!response.ok)throw new Error('update check failed');const release=await response.json();if(release.draft||release.prerelease||typeof release.tag_name!=='string')throw new Error('invalid release');latest=newerRelease(release.tag_name,version)?release.tag_name:'';state=latest?'available':'current'}
    }catch{state=latest?'available':'error'}finally{inFlight=false;render()}
  }
  check.onclick=event=>{event.stopPropagation();void checkUpdates()};
  language.addEventListener('click',()=>{localStorage.setItem('cutload-language',document.documentElement.lang);render()});
  if(localStorage.getItem('cutload-language')==='en'&&document.documentElement.lang!=='en')language.click();
  render();
  void (async()=>{if(desktop)version=await getVersion();render();await checkUpdates()})();
}
