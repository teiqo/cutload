// Runs before the document paints, including before the main module loads.
(() => {
  let color='#000000',theme=matchMedia('(prefers-color-scheme: light)').matches?'light':'accent';
  try{const saved=JSON.parse(localStorage.getItem('cutload-style')||'{}');if(/^#[\da-f]{6}$/i.test(saved.color||''))color=saved.color;if(['light','accent','amoled'].includes(saved.theme))theme=saved.theme;}catch{}
  const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  const luma=(channels[0]*.299+channels[1]*.587+channels[2]*.114)/255;
  if(luma<.12){const base=theme==='light'?[64,68,75]:[184,190,200];color='#'+channels.map((c,i)=>Math.round(c*.2+base[i]*.8).toString(16).padStart(2,'0')).join('');}
  else if(theme==='light'&&luma>.85){const base=[101,112,128];color='#'+channels.map((c,i)=>Math.round(c*.48+base[i]*.52).toString(16).padStart(2,'0')).join('');}
  document.documentElement.style.setProperty('--startup-accent',color);
  const effective=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  const bright=(effective[0]*.299+effective[1]*.587+effective[2]*.114)/255>.45;
  const tint=(base,amount)=>'#'+effective.map((channel,i)=>Math.round(channel*amount+base[i]*(1-amount)).toString(16).padStart(2,'0')).join('');
  const tile=tint(bright?[18,20,24]:[239,241,245],.22);
  const luminance=hex=>{
    const rgb=[1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);
    return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
  };
  let amount=.85,star=tint(bright?[255,255,255]:[0,0,0],amount);
  const backgroundLuminance=luminance(tile);
  while(amount>0){
    const foregroundLuminance=luminance(star);
    if((Math.max(backgroundLuminance,foregroundLuminance)+.05)/(Math.min(backgroundLuminance,foregroundLuminance)+.05)>=4.5)break;
    amount=Math.max(0,amount-.05);star=tint(bright?[255,255,255]:[0,0,0],amount);
  }
  document.documentElement.style.setProperty('--startup-logo-tile',tile);
  document.documentElement.style.setProperty('--startup-logo-star',star);
  // Independent of module initialization, IPC, fonts and WebGL readiness.
  // The normal startup path removes this earlier after the first stable frame.
  setTimeout(()=>{
    const splash=document.getElementById('startupSplash');
    if(!splash)return;
    splash.classList.add('startup-finished');
    setTimeout(()=>splash.remove(),400);
  },2800);
})();
