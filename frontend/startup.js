// Runs before the document paints, including before the main module loads.
(() => {
  let color='#000000',theme=matchMedia('(prefers-color-scheme: light)').matches?'light':'accent';
  try{const saved=JSON.parse(localStorage.getItem('cutload-style')||'{}');if(/^#[\da-f]{6}$/i.test(saved.color||''))color=saved.color;if(['light','accent','amoled'].includes(saved.theme))theme=saved.theme;}catch{}
  const channels=[1,3,5].map(i=>parseInt(color.slice(i,i+2),16));
  const luma=(channels[0]*.299+channels[1]*.587+channels[2]*.114)/255;
  if(luma<.12){const base=theme==='light'?[64,68,75]:[184,190,200];color='#'+channels.map((c,i)=>Math.round(c*.2+base[i]*.8).toString(16).padStart(2,'0')).join('');}
  else if(theme==='light'&&luma>.85){const base=[101,112,128];color='#'+channels.map((c,i)=>Math.round(c*.48+base[i]*.52).toString(16).padStart(2,'0')).join('');}
  document.documentElement.style.setProperty('--startup-accent',color);
})();
