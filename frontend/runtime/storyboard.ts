import type {Storyboard} from './types';

// Extractors can return single images or sprite sheets with variable durations.
export function storyboardFrameAt(s:Storyboard|undefined,seconds:number,duration=0){
  if(!s?.fragments?.length)return null;
  const columns=Math.max(1,s.columns||1),rows=Math.max(1,s.rows||1),per=columns*rows;
  const fallback=s.fps>0?per/s.fps:duration/s.fragments.length;
  if(!(fallback>0)&&!s.fragments.every(f=>f.duration>0))return null;
  let remaining=Math.max(0,seconds),fragment=s.fragments[0],span=fallback;
  for(let i=0;i<s.fragments.length;i++){
    fragment=s.fragments[i];span=fragment.duration>0?fragment.duration:fallback;
    if(remaining<span||i===s.fragments.length-1)break;
    remaining-=span;
  }
  if(!/^https?:\/\//.test(fragment.url))return null;
  const index=Math.min(per-1,Math.floor(remaining*(s.fps>0?s.fps:per/span)));
  return {time:seconds,image:fragment.url,column:index%columns,row:Math.floor(index/columns),columns,rows};
}
