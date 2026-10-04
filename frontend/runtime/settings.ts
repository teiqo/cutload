import {getVersion} from '@tauri-apps/api/app';
import {invoke} from '@tauri-apps/api/core';
import {listen} from '@tauri-apps/api/event';
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
  let installing=false,installMessage='',installerUrl='';
  const text=(ru:string,en:string)=>document.documentElement.lang==='en'?en:ru;
  function render(){
    title.textContent=text('настройки','settings');popup.setAttribute('aria-label',title.textContent);settings.setAttribute('aria-label',latest?text('настройки — доступно обновление','settings — update available'):title.textContent);settings.title=title.textContent;
    languageLabel.textContent=text('язык','language');language.textContent=document.documentElement.lang==='en'?'русский':'english';language.setAttribute('aria-label',language.textContent);
    check.textContent=state==='checking'?text('проверяю обновления…','checking for updates…'):text('искать обновления','check for updates');check.disabled=inFlight||installing;
    const messages={idle:text(`версия ${version}`,`version ${version}`),checking:text('проверяю новые версии на GitHub','checking GitHub releases'),available:text(`доступна версия ${latest}`,`version ${latest} is available`),current:text('установлена актуальная версия','you have the latest version'),empty:text('новых опубликованных версий пока нет','no new published releases yet'),error:text('не удалось проверить. проверь интернет и попробуй ещё раз','could not check. check your connection and try again')};
    result.textContent=installMessage||messages[state];open.hidden=!latest;open.textContent=noticeOpen.textContent=installing?text('устанавливаю…','installing…'):desktop?text('установить обновление','install update'):text('скачать обновление','download update');open.disabled=noticeOpen.disabled=installing;noticeText.textContent=installMessage||text(`доступно обновление ${latest}`,`update ${latest} is available`);notice.hidden=!latest;settings.classList.toggle('has-update',Boolean(latest));
  }
  async function installUpdate(){
    if(installing)return;
    if(!desktop){if(installerUrl)window.open(installerUrl,'_blank','noopener,noreferrer');return;}
    installing=true;installMessage=text('подготавливаю обновление…','preparing update…');render();
    try{await invoke('install_update')}
    catch(error){installMessage=text(String(error),'could not install the update. finish any downloads, check your connection and try again');}
    finally{installing=false;render()}
  }
  for(const button of [open,noticeOpen])button.onclick=event=>{event.stopPropagation();void installUpdate()};
  if(desktop)void listen<{stage:string;percent:number}>('app-update-progress',({payload})=>{
    installMessage=payload.stage==='installing'?text('устанавливаю обновление — приложение перезапустится','installing update — the app will restart'):payload.stage==='downloading'?text(`скачиваю обновление · ${payload.percent}%`,`downloading update · ${payload.percent}%`):text('проверяю обновление…','checking update…');render();
  });
  async function checkUpdates(){
    if(inFlight||installing)return;inFlight=true;installMessage='';state='checking';render();
    try{
      const response=await fetch('https://api.github.com/repos/teiqo/cutload/releases/latest',{headers:{Accept:'application/vnd.github+json'},signal:AbortSignal.timeout(10000)});
      if(response.status===404){latest='';state='empty'}
      else {if(!response.ok)throw new Error('update check failed');const release=await response.json();if(release.draft||release.prerelease||typeof release.tag_name!=='string')throw new Error('invalid release');latest=newerRelease(release.tag_name,version)?release.tag_name:'';const name=`cutload_${release.tag_name.replace(/^v/,'')}_x64-setup.exe`,url=`https://github.com/teiqo/cutload/releases/download/${release.tag_name}/${name}`;installerUrl=release.assets?.some((a:{name:string;browser_download_url:string})=>a.name===name&&a.browser_download_url===url)?url:'';state=latest?'available':'current'}
    }catch{state=latest?'available':'error'}finally{inFlight=false;render()}
  }
  check.onclick=event=>{event.stopPropagation();void checkUpdates()};
  language.addEventListener('click',()=>{localStorage.setItem('cutload-language',document.documentElement.lang);render()});
  if(localStorage.getItem('cutload-language')==='en'&&document.documentElement.lang!=='en')language.click();
  render();
  void (async()=>{if(desktop)version=await getVersion();render();await checkUpdates()})();
}
