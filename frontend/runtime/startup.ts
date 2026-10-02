import {getCurrentWindow} from '@tauri-apps/api/window';
import {desktop} from './bridge';

export async function finishStartup(){
  const splash=document.querySelector<HTMLElement>('#startupSplash');
  if(!splash)return;
  if(desktop)await getCurrentWindow().show();
  const frame=()=>new Promise<void>(resolve=>requestAnimationFrame(()=>resolve()));
  const ready=async()=>{
    await document.fonts.ready;
    await frame();await frame();
    const canvas=document.querySelector<HTMLCanvasElement>('#star3d');
    if(!document.body.classList.contains('performance-mode')&&canvas?.parentElement?.classList.contains('webgl-ready')){
      while(!canvas.dataset.initialFrameReady)await frame();
    }
    const moving=Array.from(document.querySelectorAll('.workspace,.star-wrap,#linkForm')).flatMap(el=>el.getAnimations()).filter(a=>a.playState==='running');
    await Promise.allSettled(moving.map(animation=>animation.finished));
    await frame();await frame();
  };
  await Promise.race([ready(),new Promise(resolve=>setTimeout(resolve,2200))]);
  // A short minimum keeps the logo from flashing on fast machines.
  const remaining=550-performance.now();if(remaining>0)await new Promise(resolve=>setTimeout(resolve,remaining));
  splash.classList.add('startup-finished');
  setTimeout(()=>splash.remove(),400);
}
