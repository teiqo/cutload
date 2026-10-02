export function createPong(english:()=>boolean){
  const box=document.createElement('div');box.className='mini-pong';
  const canvas=document.createElement('canvas');canvas.width=canvas.height=104;canvas.tabIndex=0;canvas.setAttribute('aria-label','пинг-понг: управляй мышью по всей странице, пальцем или стрелками');
  const score=document.createElement('span');score.className='pong-score';
  const toggle=document.createElement('button');toggle.type='button';toggle.className='pong-toggle';
  box.append(canvas,score,toggle);const ctx=canvas.getContext('2d')!;
  let playing=false,visible=false,raf=0,last=0,painted=0,user=0,opponent=0,left=42,right=42,x=52,y=52,vx=43,vy=24,speed=49;
  function label(){score.textContent=`${user} : ${opponent}`;toggle.textContent=playing?'Ⅱ':'▶';toggle.setAttribute('aria-label',english()?(playing?'pause ping pong':'play ping pong'):(playing?'пауза пинг-понга':'играть в пинг-понг'))}
  function draw(){const style=getComputedStyle(document.body);ctx.clearRect(0,0,104,104);ctx.fillStyle=style.getPropertyValue('--dim');ctx.globalAlpha=.25;for(let yy=5;yy<104;yy+=10)ctx.fillRect(51,yy,1,5);ctx.globalAlpha=1;ctx.fillStyle=style.getPropertyValue('--accent');ctx.fillRect(5,left,3,20);ctx.fillRect(96,right,3,20);ctx.fillStyle=style.getPropertyValue('--txt');ctx.beginPath();ctx.arc(x,y,2.5,0,Math.PI*2);ctx.fill()}
  function serve(direction:number){x=y=52;speed=Math.min(175,speed*1.03);vx=direction*speed*.875;vy=(Math.random()>.5?1:-1)*speed*.48}
  function frame(time:number){raf=0;if(!playing||!visible||document.hidden)return;const dt=Math.min(.04,(time-last)/1000||0);last=time;
    right+=Math.max(-40*dt,Math.min(40*dt,y-10-right));right=Math.max(1,Math.min(83,right));x+=vx*dt;y+=vy*dt;
    if(y<3||y>101){y=Math.max(3,Math.min(101,y));vy=-vy}
    const hitLeft=vx<0&&x<=10&&x>=4&&y>=left-2&&y<=left+22,hitRight=vx>0&&x>=94&&x<=100&&y>=right-2&&y<=right+22;
    if(hitLeft||hitRight){x=hitLeft?10:94;speed=Math.min(175,speed*1.045);const offset=(y-(hitLeft?left:right)-10)/12;vy=offset*speed*.65;vx=(hitLeft?1:-1)*Math.sqrt(speed*speed-vy*vy)}
    if(x<0){opponent++;serve(1);label()}else if(x>104){user++;serve(-1);label()}
    const interval=document.body.classList.contains('performance-mode')?33:16;if(time-painted>=interval){painted=time;draw()}raf=requestAnimationFrame(frame)
  }
  function start(){last=performance.now();if(playing&&visible&&!document.hidden&&!raf)raf=requestAnimationFrame(frame)}
  toggle.onclick=()=>{playing=!playing;label();start();if(!playing){cancelAnimationFrame(raf);raf=0;draw()}};
  function point(event:PointerEvent){left=1+Math.max(0,Math.min(1,event.clientY/window.innerHeight))*82;if(!playing)draw()}
  canvas.onpointerdown=event=>{canvas.setPointerCapture(event.pointerId);point(event);canvas.focus()};canvas.onpointermove=point;
  document.addEventListener('pointermove',event=>{if(visible&&playing)point(event)},{passive:true});
  canvas.onkeydown=event=>{if(['ArrowUp','ArrowDown','w','s'].includes(event.key)){event.preventDefault();left=Math.max(1,Math.min(83,left+(['ArrowUp','w'].includes(event.key)?-10:10)));if(!playing)draw()}if(event.key===' '){event.preventDefault();toggle.click()}};
  document.addEventListener('visibilitychange',start);document.getElementById('langBtn')!.addEventListener('click',label);label();draw();
  return {element:box,setVisible(on:boolean){visible=on;if(!on){playing=false;cancelAnimationFrame(raf);raf=0;label()}else{draw();start()}}};
}
