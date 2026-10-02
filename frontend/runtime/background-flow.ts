// Move a single composited layer; no gradient repaint on every frame.
export function setupBackgroundFlow(){
  const layer=document.querySelector<HTMLElement>('#shimLayer')!;
  const viewport=document.createElement('div');
  viewport.className='background-flow-viewport';viewport.setAttribute('aria-hidden','true');
  layer.before(viewport);viewport.append(layer);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let animation:Animation|null=null,x=0,y=0,direction=1;
  let pauseTimer:ReturnType<typeof setTimeout>|undefined;
  const transform=(a:number,b:number)=>`translate3d(${a}%,${b}%,0)`;
  function next(){
    const previous=animation;
    const target=direction*(6+Math.random()*5),vertical=Math.random()*4-2;
    direction*=-1;
    // Quintic interpolation has zero velocity and acceleration at either end.
    // Random destinations can join without a sudden change in motion.
    const frames=Array.from({length:61},(_,i)=>{
      const t=i/60,s=t*t*t*(t*(6*t-15)+10);
      return {offset:t,transform:transform(x+(target-x)*s,y+(vertical-y)*s)};
    });
    animation=layer.animate(frames,{duration:14000+Math.random()*4000,easing:'linear',fill:'forwards'});
    x=target;y=vertical;
    animation.onfinish=next;
    previous?.cancel();
  }
  function sync(){
    clearTimeout(pauseTimer);
    const enabled=document.body.classList.contains('shim-on')&&!document.body.classList.contains('performance-mode');
    viewport.classList.toggle('flow-visible',enabled);
    if(document.hidden||reduced.matches){animation?.pause();return;}
    // Keep the same position through fading and rapid toggles; resume rather
    // than recreating the movement from its starting frame.
    if(!enabled){pauseTimer=setTimeout(()=>animation?.pause(),700);return;}
    if(!animation)next();
    animation?.play();
  }
  new MutationObserver(sync).observe(document.body,{attributes:true,attributeFilter:['class']});
  document.addEventListener('visibilitychange',sync);reduced.addEventListener('change',sync);sync();
}
