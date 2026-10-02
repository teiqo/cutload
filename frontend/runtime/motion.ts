// FLIP in each element's layout coordinate system: moving the workspace does
// not add a second screen-wide flight to its children.
export function enableLayoutMotion(){
  const card=document.querySelector<HTMLElement>('.download-card')!;
  const selector=':scope > .qualities,:scope > .codec-picker';
  type Position={x:number,y:number,parent:Element|null};
  const positions=new WeakMap<HTMLElement,Position>(),animations=new WeakMap<HTMLElement,Animation>();
  const tracked=new Set<HTMLElement>();let frame=0,wasExpanded=document.body.classList.contains('expanded'),settleUntil=0;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  function schedule(){if(!frame)frame=requestAnimationFrame(update)}
  const observer=new ResizeObserver(schedule);
  function track(){
    const elements=[...Array.from(card.querySelectorAll<HTMLElement>(selector)),...Array.from(card.querySelectorAll<HTMLElement>('.quality,.codec-picker > label'))];
    for(const element of elements){if(tracked.has(element))continue;tracked.add(element);element.classList.add('layout-smooth');observer.observe(element);}
    for(const element of tracked)if(!element.isConnected){observer.unobserve(element);animations.get(element)?.cancel();tracked.delete(element)}
  }
  function update(){
    frame=0;track();
    const expanded=document.body.classList.contains('expanded');
    if(expanded!==wasExpanded){wasExpanded=expanded;settleUntil=performance.now()+1200;}
    // Read all positions before starting any animations.
    const moves=[...tracked].map(element=>{
      if(element.hidden||!element.offsetParent){positions.delete(element);animations.get(element)?.cancel();return null}
      const next={x:element.offsetLeft,y:element.offsetTop,parent:element.offsetParent};
      const previous=positions.get(element);positions.set(element,next);
      if(performance.now()<settleUntil){animations.get(element)?.cancel();return null;}
      if(!previous||previous.parent!==next.parent||(previous.x===next.x&&previous.y===next.y))return null;
      if(document.body.classList.contains('performance-mode')){animations.get(element)?.cancel();return null}
      const active=animations.get(element),translation=active?.playState==='running'?getComputedStyle(element).translate:'0px 0px';
      const [x=0,y=0]=translation.split(' ').map(value=>parseFloat(value)||0);
      return {element,x:previous.x-next.x+x,y:previous.y-next.y+y};
    });
    for(const move of moves){if(!move)continue;const {element,x,y}=move;animations.get(element)?.cancel();if(reduced.matches||Math.hypot(x,y)<.5)continue;
      const animation=element.animate([{translate:`${x}px ${y}px`},{translate:'0px 0px'}],{duration:document.body.classList.contains('performance-mode')?180:320,easing:'cubic-bezier(.2,.75,.25,1)'});animations.set(element,animation);
    }
  }
  track();update();observer.observe(card);
  new MutationObserver(schedule).observe(card,{childList:true,subtree:true,attributes:true,attributeFilter:['hidden']});
  new MutationObserver(schedule).observe(document.body,{attributes:true,attributeFilter:['class']});
  window.addEventListener('resize',schedule,{passive:true});
}
