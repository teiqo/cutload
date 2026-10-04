export function setupTextMenu(){
  const menu=document.createElement('div');menu.className='text-context-menu';menu.hidden=true;menu.setAttribute('role','menu');document.body.append(menu);
  let previous:HTMLElement|null=null;
  const close=(restore=false)=>{menu.hidden=true;if(restore)previous?.focus()};
  document.addEventListener('pointerdown',event=>{if(!menu.contains(event.target as Node))close()});
  window.addEventListener('resize',()=>close());
  document.addEventListener('scroll',()=>close(),true);
  menu.addEventListener('keydown',event=>{
    const buttons=Array.from(menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'));
    if(event.key==='Escape'){event.preventDefault();close(true)}
    if(event.key==='Tab')close();
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();const index=buttons.indexOf(document.activeElement as HTMLButtonElement);buttons[(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus()}
  });
  document.addEventListener('contextmenu',event=>{
    const target=event.target instanceof Element?event.target:null;
    if(!target||menu.contains(target))return;
    const candidate=target.closest('input,textarea');
    const field=candidate instanceof HTMLTextAreaElement||candidate instanceof HTMLInputElement&&['text','url','search','email','tel','password'].includes(candidate.type)?candidate:null;
    const selected=window.getSelection()?.toString()||'';
    const error=target.closest('.error-details pre');
    if(!field&&!selected&&!error){close();return}
    event.preventDefault();
    previous=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const start=field?.selectionStart??0,end=field?.selectionEnd??0;
    const copyText=field?field.value.slice(start,end):selected||error?.textContent||'';
    menu.replaceChildren();
    const label=(ru:string,en:string)=>document.documentElement.lang==='en'?en:ru;
    const add=(text:string,enabled:boolean,action:()=>Promise<void>|void)=>{
      const button=document.createElement('button');button.type='button';button.className='small-btn';button.textContent=text;button.disabled=!enabled;button.setAttribute('role','menuitem');
      button.onclick=async()=>{close();try{await action()}catch{const toast=document.getElementById('toast');if(toast){toast.textContent=label('не удалось получить доступ к буферу обмена — попробуй Ctrl+C или Ctrl+V','clipboard unavailable — try Ctrl+C or Ctrl+V');toast.classList.add('show');setTimeout(()=>toast.classList.remove('show'),3500)}}};menu.append(button);
    };
    add(label('скопировать','copy'),Boolean(copyText),()=>navigator.clipboard.writeText(copyText));
    if(field){
      const editable=!field.readOnly&&!field.disabled;
      add(label('вставить','paste'),editable,async()=>{
        const text=await navigator.clipboard.readText();field.focus();field.setSelectionRange(start,end);field.setRangeText(text,start,end,'end');field.dispatchEvent(new Event('input',{bubbles:true}));
      });
      add(label('выделить всё','select all'),Boolean(field.value),()=>{field.focus();field.select()});
    }
    menu.hidden=false;
    menu.style.left=Math.max(8,Math.min(innerWidth-menu.offsetWidth-8,event.clientX))+'px';menu.style.top=Math.max(8,Math.min(innerHeight-menu.offsetHeight-8,event.clientY))+'px';
    menu.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  });
}
