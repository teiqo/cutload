const originalPaint=paint;
function rainbowPalette(time=performance.now()){
  if(!prefs.rainbow||prefs.performance||matchMedia('(prefers-reduced-motion: reduce)').matches)return null;
  const n=parseInt(prefs.color.slice(1),16),r=(n>>16)&255,g=(n>>8)&255,b=n&255;
  const max=Math.max(r,g,b),min=Math.min(r,g,b),d=max-min;
  const brightness=(max+min)/510,saturation=d===0?0:(d/255)/(1-Math.abs(2*brightness-1));
  const hue=(d===0?260:max===r?60*((g-b)/d%6):max===g?60*((b-r)/d+2):60*((r-g)/d+4))+(time-rainbowEpoch)/220;
  return {color:hslHex(hue,saturation,brightness),background:Array.from({length:6},(_,i)=>hslHex(hue+i*60,saturation*.8,brightness*.4))};
}
paint=function(c){
  const palette=rainbowPalette();c=palette?.color||c||prefs.color;
  if(palette)palette.background.forEach((value,i)=>document.body.style.setProperty('--rb'+(i+1),value));
  originalPaint(c);const st=document.body.style,light=prefs.theme==='light',black=prefs.theme==='amoled';
  document.querySelectorAll('.accsw[data-c]').forEach(button=>button.classList.toggle('sel',!prefs.rainbow&&button.dataset.c===prefs.color));
  const picker=document.querySelector('#accCustom'),hex=document.querySelector('#accCustomHex');
  if(picker.value.toLowerCase()!==prefs.color.toLowerCase())picker.value=prefs.color;
  if(document.activeElement!==hex&&hex.value.toLowerCase()!==prefs.color.toLowerCase())hex.value=prefs.color.toUpperCase();
  document.querySelector('#accCustomDot').style.background=prefs.color;
  const n=parseInt(c.slice(1),16),luma=(((n>>16)&255)*.299+((n>>8)&255)*.587+(n&255)*.114)/255;
  const visibleAccent=light&&luma>.85?mixc(c,'#657080',.48):luma<.12?mixc(c,light?'#40444b':'#b8bec8',.2):c;
  st.setProperty('--accent',visibleAccent);st.setProperty('--accent2',visibleAccent);st.setProperty('--accent2h',visibleAccent);
  st.setProperty('--button-text',light&&luma>.85?'#fff':luma<.12?'#121418':luma>.68?'#17232a':'#fff');
  st.setProperty('--bg',black?'#000000':light?mixc(c,'#e6ebf0',.42):mixc(c,'#101114',.14));
  st.setProperty('--panel',black?'#090a0b':light?'#ffffff':mixc(c,'#15171b',.16));
  st.setProperty('--dim',black?'#93979f':light?mixc(c,'#67737e',.2):mixc(c,'#9598a3',.25));
  st.setProperty('--hoverbg',black?'#181a1e':light?mixc(c,'#ffffff',.1):mixc(c,'#1c1e24',.16));
  st.setProperty('--shimc',mixc(c,'#000000',Math.max(.32,Math.min(.72,.7-luma*.42))));
  const starColor=mixc(visibleAccent,'#ffffff',.74);st.setProperty('--star-color',starColor);document.querySelector('#star3d').dataset.color=starColor;
};paint();
const revealControls=[...document.querySelectorAll('.quality,.fragment-toggle')];revealControls.forEach(el=>el.classList.add('reveal-control'));
let revealFrame=0,lastPointer=null;
document.addEventListener('pointermove',e=>{if(!opened||document.body.classList.contains('orbit-mode'))return;lastPointer={x:e.clientX,y:e.clientY};if(revealFrame)return;revealFrame=requestAnimationFrame(()=>{revealFrame=0;for(const el of revealControls){const r=el.getBoundingClientRect(),dx=Math.max(r.left-lastPointer.x,0,lastPointer.x-r.right),dy=Math.max(r.top-lastPointer.y,0,lastPointer.y-r.bottom),distance=Math.hypot(dx,dy);el.style.setProperty('--reveal',opened?Math.max(0,1-distance/115):0);el.style.setProperty('--pointer-x',lastPointer.x-r.left+'px');el.style.setProperty('--pointer-y',lastPointer.y-r.top+'px')}})},{passive:true});
document.addEventListener('pointerleave',()=>revealControls.forEach(el=>el.style.setProperty('--reveal',0)));
const clearButton=document.querySelector('.clear-input');new MutationObserver(()=>{clearButton.inert=document.body.classList.contains('expanded')}).observe(document.body,{attributes:true,attributeFilter:['class']});

// Measure both translations once, then interpolate real dimensions. Text stays
// at native scale and widths remain unchanged when the transition finishes.
const languageButton=document.querySelector('#langBtn'),changeLanguage=languageButton.onclick;
// Full-width card controls follow their container; never freeze their width
// from a measurement taken while the card is closed or animating.
const translatedControls=[...document.querySelectorAll('#servicesBtn,#loadBtn,#chooseFolder,.quality,.tp-th,#glassBtn,#accAuto')];
languageButton.onclick=()=>{
  const before=translatedControls.map(el=>el.getBoundingClientRect());
  for(const el of translatedControls){el.classList.remove('language-sizing');el.style.transition='none';el.style.width='';el.style.height=''}
  changeLanguage();
  const after=translatedControls.map(el=>{const rect=el.getBoundingClientRect();if(el.id!=='loadBtn')return rect;const measure=document.createElement('canvas').getContext('2d');measure.font=measurementFont(el);return {width:Math.ceil((measure.measureText(el.textContent).width+52)/2)*2,height:44}});
  translatedControls.forEach((el,i)=>{if(!after[i].width)return;el.style.width=before[i].width+'px';el.style.height=before[i].height+'px'});
  void document.body.offsetWidth;
  translatedControls.forEach((el,i)=>{el.style.transition='';if(!after[i].width)return;el.classList.add('language-sizing');el.style.width=(Math.ceil(after[i].width/2)*2)+'px';el.style.height=(Math.ceil(after[i].height/2)*2)+'px'});
  scheduleInputSize();
};
const qualitySizeObserver=new ResizeObserver(positionIndicator);document.querySelectorAll('.quality').forEach(el=>qualitySizeObserver.observe(el));
window.addEventListener('resize',()=>{for(const el of translatedControls){el.classList.remove('language-sizing');el.style.width='';el.style.height=''}positionIndicator()});

const linkInput=document.querySelector('#url'),linkForm=document.querySelector('#linkForm'),workspace=document.querySelector('.workspace');
const textMeasure=document.createElement('canvas').getContext('2d');let inputSizeFrame=0;
function measurementFont(el){const cs=getComputedStyle(el);return `${cs.fontStyle} ${cs.fontWeight} ${cs.fontSize} ${cs.fontFamily}`}
function sizeLinkForm(){
  inputSizeFrame=0;textMeasure.font=measurementFont(linkInput);
  const available=workspace.clientWidth,expanded=document.body.classList.contains('expanded');
  if(expanded){const width=Math.min(480,available)+'px';linkForm.style.setProperty('--form-width',width);workspace.style.setProperty('--form-width',width);return}
  // Keep the field and button slots fixed while the details card opens/closes.
  // Resizing the form here moved the placeholder across fractional pixels.
  const loadButton=document.querySelector('#loadBtn');
  const loadWidth=(Number.parseFloat(loadButton.style.width)||loadButton.getBoundingClientRect().width)+10;
  const minimum=300,maximum=480;
  const inputText=linkInput.value||linkInput.placeholder;
  const textWidth=textMeasure.measureText(inputText).width;
  const fieldWidth=Math.min(Math.max(minimum,Math.ceil(textWidth)+70),maximum,available-loadWidth);
  const snappedField=Math.round(fieldWidth/2)*2;
  const snappedForm=snappedField+Math.round(loadWidth/2)*2;
  workspace.style.setProperty('--closed-field-width',snappedField+'px');
  linkForm.style.setProperty('--form-width',snappedForm+'px');
  workspace.style.setProperty('--form-width',snappedForm+'px');
}
function scheduleInputSize(){if(!inputSizeFrame)inputSizeFrame=requestAnimationFrame(sizeLinkForm)}
function positionWorkspace(){
  workspace.style.width=(Math.floor(Math.min(620,window.innerWidth-32)/2)*2)+'px';
  const expanded=document.body.classList.contains('expanded'),card=document.querySelector('.download-card');
  const heading=workspace.querySelector('h1'),mobile=window.innerWidth<=600;
  const inlineStatus=workspace.querySelector(':scope > .download-status.status-open');
  const statusHeight=inlineStatus?inlineStatus.querySelector('.download-status-content').scrollHeight:0;
  const headHeight=heading.offsetHeight+(expanded?18:24)+44+statusHeight;
  const minTop=window.innerHeight<600?84:90;
  const cardRoom=Math.max(100,window.innerHeight-minTop-headHeight-16-48);
  const fragment=document.querySelector('.fragment-reveal'),fragmentContent=document.querySelector('.fragment-content'),cs=getComputedStyle(card);
  const helpHeight=card.querySelector('.codec-help-reveal')?.getBoundingClientRect().height||0;
  const dock=card.querySelector('.status-dock'),downloadStatus=dock?.querySelector('.download-status');
  const dockHeight=dock?.getBoundingClientRect().height||0;
  const statusTarget=downloadStatus?.classList.contains('status-open')?downloadStatus.querySelector('.download-status-content').scrollHeight:0;
  const targetCard=card.scrollHeight+32-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom)+2-fragment.getBoundingClientRect().height+(document.body.classList.contains('fragment-on')?fragmentContent.scrollHeight:0)-helpHeight-dockHeight+statusTarget;
  // Codec help expands inside the card. Do not include it in the workspace
  // anchor calculation: recentering here makes the save row jump on toggle.
  const height=headHeight+(expanded?16+Math.min(targetCard,cardRoom):2);
  let y=expanded?Math.max(minTop,Math.round((window.innerHeight-48-height)/2)):Math.max(minTop,Math.round((window.innerHeight+24-height)/2)+15);
  const previousY=Number.parseFloat(workspace.style.getPropertyValue('--workspace-y'));
  if(Number.isFinite(previousY)&&Math.abs(previousY-y)<=1)y=previousY;
  workspace.style.setProperty('--card-room',(expanded?Math.max(100,Math.floor(window.innerHeight-y-headHeight-16-48)):cardRoom)+'px');
  workspace.style.setProperty('--workspace-y',y+'px');
  workspace.style.left=Math.round((window.innerWidth-workspace.clientWidth)/2)+'px';
}
// Do not recalculate layout targets from the button's animated width.
// Coalesce placeholder mutations into a single layout measurement per frame.
let positionedState='',fragmentWasOpen=document.body.classList.contains('fragment-on'),fragmentTimer;
new MutationObserver(()=>{
  scheduleInputSize();
  const fragmentOpen=document.body.classList.contains('fragment-on');
  if(fragmentOpen!==fragmentWasOpen){fragmentWasOpen=fragmentOpen;clearTimeout(fragmentTimer);document.querySelector('.fragment-reveal').classList.add('fragment-transitioning');fragmentTimer=setTimeout(()=>document.querySelector('.fragment-reveal').classList.remove('fragment-transitioning'),650)}
  // Fragment rows expand inside the card; moving the whole workspace at the same
  // time makes the download button briefly cross the timeline. Keep the workspace
  // anchor stable and only reposition for states that change the main card shell.
  const state=['expanded','audio'].map(c=>document.body.classList.contains(c)).join(':');
  if(state!==positionedState){positionedState=state;requestAnimationFrame(positionWorkspace)}
}).observe(document.body,{attributes:true,attributeFilter:['class']});
linkInput.addEventListener('input',scheduleInputSize);
linkInput.addEventListener('change',scheduleInputSize);
clearButton.addEventListener('click',scheduleInputSize);
document.fonts.ready.then(scheduleInputSize);
new MutationObserver(scheduleInputSize).observe(linkInput,{attributes:true,attributeFilter:['placeholder']});
window.addEventListener('resize',()=>{scheduleInputSize();requestAnimationFrame(positionWorkspace)});
sizeLinkForm();positionWorkspace();

const codecSelect=document.querySelector('#codecSelect');let codecMode='',codecLanguage='';
const rememberedCodecs={video:{mp4:'h264',webm:'vp9'},audio:{mp3:'mp3',m4a:'aac',opus:'opus',flac:'flac',wav:'wav',webm:'original'}};
const codecPicker=document.createElement('div');codecPicker.className='codec-picker';codecPicker.setAttribute('role','radiogroup');codecSelect.after(codecPicker);codecSelect.hidden=true;
function updateCodecs(){
  const audio=document.body.classList.contains('audio'),mode=audio?'audio':'video';
  // Preserve the existing controls and their measured widths when quality alone changes.
  if(mode===codecMode&&lang===codecLanguage&&codecPicker.querySelector('#outputCodec')?.value===codecSelect.value)return;
  codecLanguage=lang;
  const keepHelpOpen=Boolean(codecPicker.querySelector('.help-open'));
  const previous=mode===codecMode?codecSelect.value:(audio?'mp3':'h264');codecMode=mode;
  const choices=audio?[
    ['original','webm · оригинальный: opus','webm · original: opus'],['mp3','mp3 · звук mp3','mp3 · mp3 audio'],['aac','m4a · звук aac','m4a · aac audio'],['opus','opus · звук opus','opus · opus audio'],['flac','flac · без потерь','flac · lossless'],['wav','wav · без сжатия','wav · uncompressed']
  ]:[
    ['original','mp4 · оригинальный: av1 + opus','mp4 · original: av1 + opus'],['h264','mp4 · h264 + mp3','mp4 · h264 + mp3'],['hevc','mp4 · h265 / hevc + aac','mp4 · h265 / hevc + aac'],['av1','mp4 · av1 + opus','mp4 · av1 + opus'],['vp9','webm · vp9 + opus','webm · vp9 + opus']
  ];
  codecSelect.replaceChildren(...choices.map(([value,ru,en])=>{const option=document.createElement('option');option.value=value;option.textContent=(lang==='ru'?ru:en).toLowerCase();return option}));
  codecSelect.value=choices.some(c=>c[0]===previous)?previous:'original';
  codecPicker.setAttribute('aria-label',lang==='ru'?'формат и кодек':'format and codec');
  codecPicker.removeAttribute('role');
  const existingFields=codecPicker.querySelectorAll(':scope > label');
  const formatField=existingFields[0]||document.createElement('label'),codecField=existingFields[1]||document.createElement('label');
  const formatCaption=document.createElement('span'),codecCaption=document.createElement('span');
  formatCaption.textContent=lang==='ru'?'формат':'format';codecCaption.textContent=lang==='ru'?'кодек':'codec';
  const formatInput=document.createElement('select'),codecInput=document.createElement('select');
  formatInput.id='outputFormat';codecInput.id='outputCodec';
  const rows=choices.map(([value,ru,en])=>{const [format,detail]=(lang==='ru'?ru:en).split(' · ');return {value,format,detail}});
  const current=rows.find(row=>row.value===codecSelect.value);
  for(const format of new Set(rows.map(row=>row.format))){const option=document.createElement('option');option.value=format;option.textContent='.'+format;formatInput.append(option)}
  formatInput.value=current.format;
  function fillCodecOptions(value){codecInput.replaceChildren(...rows.filter(row=>row.format===formatInput.value).map(row=>{const option=document.createElement('option');option.value=row.value;option.textContent=row.detail;return option}));codecInput.value=value;}
  fillCodecOptions(current.value);
  let previousFormat=current.format;rememberedCodecs[mode][previousFormat]=current.value;
  formatInput.onchange=()=>{rememberedCodecs[mode][previousFormat]=codecInput.value;const candidates=rows.filter(row=>row.format===formatInput.value);const next=candidates.find(row=>row.value===rememberedCodecs[mode][formatInput.value])||candidates[0];fillCodecOptions(next.value);previousFormat=formatInput.value;codecSelect.value=next.value;codecSelect.dispatchEvent(new Event('change'));formatInput.blur()};
  codecInput.onchange=()=>{rememberedCodecs[mode][formatInput.value]=codecInput.value;codecSelect.value=codecInput.value;codecSelect.dispatchEvent(new Event('change'));codecInput.blur()};
  const measure=document.createElement('canvas').getContext('2d');
  function sizeChoices(){for(const field of [formatInput,codecInput]){measure.font=getComputedStyle(field).font;const label=field.closest('label');const width=Math.ceil(measure.measureText(field.selectedOptions[0]?.textContent||'').width)+48;label.style.setProperty('--choice-width',Math.max(76,width)+'px')}}
  formatInput.addEventListener('change',sizeChoices);codecInput.addEventListener('change',sizeChoices);
  const previousHelp=codecPicker.querySelector('.codec-help');
  const help=document.createElement('div');help.className='codec-help';
  const summary=document.createElement('summary');summary.textContent='?';summary.setAttribute('aria-label',lang==='ru'?'справка о кодеках':'codec help');
  const content=document.createElement('div');content.className='codec-help-content';
  const explanations=audio?(lang==='ru'?['mp3 — для большинства плееров','aac / m4a — компактный файл для телефона','opus — хорошее качество при малом размере','flac — сжатие без потерь, файл крупнее','wav — без сжатия, самый большой файл','оригинальный — сохранить исходный кодек']:['mp3 — widely compatible','aac / m4a — compact mobile audio','opus — quality at a small size','flac — lossless, larger files','wav — uncompressed, largest files','original — keep the source codec']):(lang==='ru'?['h264 + mp3 — совместимость с большинством устройств','h265 / hevc + aac — меньше размер, нужен современный плеер','av1 + opus — эффективное сжатие, кодирование медленнее','vp9 + opus — webm для браузеров','оригинальный — сохранить кодеки источника']:['h264 + mp3 — broad device compatibility','h265 / hevc + aac — smaller, needs a modern player','av1 + opus — efficient, slower encoding','vp9 + opus — webm for browsers','original — keep source codecs']);
  for(const description of explanations){const paragraph=document.createElement('p');paragraph.textContent=description;content.append(paragraph)}
  const trigger=document.createElement('button');trigger.type='button';trigger.className='codec-help-trigger';trigger.textContent='?';trigger.setAttribute('aria-label',summary.getAttribute('aria-label'));trigger.setAttribute('aria-expanded','false');
  const reveal=document.createElement('div');reveal.className='codec-help-reveal';const clip=document.createElement('div');clip.className='codec-help-clip';clip.append(content);reveal.append(clip);reveal.inert=true;
  const measureHelp=()=>reveal.style.setProperty('--help-height',Math.ceil(content.getBoundingClientRect().height)+'px');
  new ResizeObserver(measureHelp).observe(content);
  trigger.onclick=()=>{measureHelp();const open=!help.classList.contains('help-open');help.classList.toggle('help-open',open);trigger.setAttribute('aria-expanded',String(open));reveal.inert=!open;requestAnimationFrame(positionWorkspace)};
  reveal.addEventListener('transitionend',event=>{if(event.target===reveal&&event.propertyName==='height')requestAnimationFrame(positionWorkspace)});
  help.append(trigger,reveal);
  if(keepHelpOpen){help.classList.add('help-open');trigger.setAttribute('aria-expanded','true');reveal.inert=false}
  let persistentHelp=help;
  if(previousHelp){previousHelp.querySelector('.codec-help-content').replaceChildren(...content.childNodes);previousHelp.querySelector('button').setAttribute('aria-label',trigger.getAttribute('aria-label'));persistentHelp=previousHelp;}
  formatField.replaceChildren(formatCaption,formatInput);codecField.replaceChildren(codecCaption,codecInput);codecPicker.replaceChildren(formatField,codecField,persistentHelp);
  requestAnimationFrame(sizeChoices);document.fonts.ready.then(sizeChoices);
  requestAnimationFrame(positionWorkspace);
}
const originalSelectQuality=selectQuality;selectQuality=function(q){originalSelectQuality(q);updateCodecs()};
const sizedChangeLanguage=languageButton.onclick;languageButton.onclick=()=>{sizedChangeLanguage();updateCodecs();scheduleInputSize();requestAnimationFrame(positionWorkspace)};
updateCodecs();

// Nonmodal popover anchored to the service trigger, with reversible fading.
const servicesPanel=document.querySelector('#servicesDialog'),servicesTrigger=document.querySelector('#servicesBtn');
servicesTrigger.setAttribute('aria-controls','servicesDialog');servicesTrigger.setAttribute('aria-expanded','false');
function positionServices(){
  const r=servicesTrigger.getBoundingClientRect(),width=servicesPanel.offsetWidth;
  servicesPanel.style.left=Math.round(Math.max(12,Math.min(window.innerWidth-width-12,r.left+(r.width-width)/2)))+'px';
  servicesPanel.style.top=Math.round(r.bottom+8)+'px';
  servicesPanel.style.maxHeight=Math.max(120,window.innerHeight-r.bottom-48)+'px';
}
function hideServices(){servicesPanel.classList.remove('show');servicesPanel.inert=true;servicesTrigger.setAttribute('aria-expanded','false')}
function toggleServices(){const on=!servicesPanel.classList.contains('show');positionServices();servicesPanel.classList.toggle('show',on);servicesPanel.inert=!on;servicesTrigger.setAttribute('aria-expanded',String(on))}
document.addEventListener('click',e=>{if(!servicesTrigger.contains(e.target))hideServices()});
document.addEventListener('keydown',e=>{if(e.key==='Escape')hideServices()});
window.addEventListener('resize',positionServices);new ResizeObserver(positionServices).observe(servicesTrigger);

// Whole-pixel button and form endpoints; hover never changes text raster layers.
const loadControl=document.querySelector('#loadBtn');
const nativeSizeLinkForm=sizeLinkForm;let measuredLoadLabel='';
sizeLinkForm=function(){
  const font=measurementFont(loadControl);textMeasure.font=font;
  const labelKey=loadControl.textContent+'|'+font;if(labelKey!==measuredLoadLabel||!loadControl.style.width){measuredLoadLabel=labelKey;loadControl.style.width=(Math.ceil((textMeasure.measureText(loadControl.textContent).width+52)/2)*2)+'px'}
  nativeSizeLinkForm();
};
scheduleInputSize();

codecSelect.addEventListener('change',()=>codecSelect.blur());

// Static edge refraction: no animated noise, canvas copies, or frame-by-frame filters.
const glassDefinitions=document.createElementNS('http://www.w3.org/2000/svg','svg');
glassDefinitions.setAttribute('width','0');glassDefinitions.setAttribute('height','0');glassDefinitions.setAttribute('aria-hidden','true');
glassDefinitions.style.position='absolute';glassDefinitions.innerHTML='<defs><filter id="glass-edge-refraction" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency=".012 .018" numOctaves="1" seed="8" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale="9" xChannelSelector="R" yChannelSelector="G"/></filter></defs>';
document.body.prepend(glassDefinitions);
const lowPowerGlass=matchMedia('(prefers-reduced-motion: reduce)').matches||(navigator.hardwareConcurrency&&navigator.hardwareConcurrency<=4)||(navigator.deviceMemory&&navigator.deviceMemory<=4);
document.body.classList.toggle('glass-lite',Boolean(lowPowerGlass));
translations.performanceMode='performance mode';
const standardApplyPrefs=applyPrefs;
applyPrefs=function(){prefs.anim=true;prefs.blur=0;if(prefs.glass&&prefs.performance){prefs.performance=false;toast('liquid glass отключает режим производительности','liquid glass turns performance mode off')}standardApplyPrefs();document.body.classList.toggle('performance-mode',Boolean(prefs.performance));document.body.classList.toggle('glass-lite',Boolean(lowPowerGlass||prefs.performance));document.querySelector('#animChk').checked=Boolean(prefs.performance)};
document.querySelector('#animChk').onchange=event=>{prefs.performance=event.target.checked;if(prefs.performance){prefs.glass=false;toast('режим производительности несовместим с liquid glass','performance mode is incompatible with liquid glass')}applyPrefs()};
document.querySelector('#glassBtn').addEventListener('click',()=>{if(!prefs.glass)toast('liquid glass несовместим с режимом производительности; при включении режим будет отключён','liquid glass is incompatible with performance mode; enabling it turns that mode off')});
document.querySelector('#accAuto').addEventListener('click',()=>{prefs.performance=false;applyPrefs()});
let lastRainbowUpdate=0;
tick=function(t){if(!document.hidden&&!prefs.performance&&prefs.rainbow&&t-lastRainbowUpdate>=100){lastRainbowUpdate=t;paint()}requestAnimationFrame(tick)};
applyPrefs();
document.querySelector('#accPop').addEventListener('click',event=>{if(event.target.closest('.accsw[data-c]')){prefs.rainbow=false;applyPrefs();}});
// Coalesce native color-picker bursts and persist once the interaction settles.
let colorFrame=0,colorSaveTimer=0,colorSettledTimer=0;
const savedPreferenceWriter=savePrefs;
savePrefs=function(){clearTimeout(colorSaveTimer);colorSaveTimer=setTimeout(savedPreferenceWriter,220)};
function queueColor(value){prefs.color=value;document.body.classList.add('color-adjusting');clearTimeout(colorSettledTimer);colorSettledTimer=setTimeout(()=>document.body.classList.remove('color-adjusting'),180);if(colorFrame)return;colorFrame=setTimeout(()=>{colorFrame=0;applyPrefs()},40)}
document.querySelector('#accCustom').oninput=event=>queueColor(event.target.value);
document.querySelector('#accCustomHex').oninput=event=>{let value=event.target.value;if(!value.startsWith('#'))value='#'+value;if(/^#[0-9a-f]{6}$/i.test(value))queueColor(value)};
document.fonts.ready.then(()=>{measuredLoadLabel='';scheduleInputSize();requestAnimationFrame(()=>{positionWorkspace();positionIndicator()})});

// Clamp the selection to five seconds; visual handles butt together at that limit.
const nativeUpdateTimes=updateTimes;
updateTimes=function(){
  const a=document.querySelector('#rangeStart'),b=document.querySelector('#rangeEnd'),max=+b.max;
  a.value=Math.max(0,Math.min(+a.value,max-3));b.value=Math.max(+a.value+3,Math.min(max,+b.value));
  nativeUpdateTimes();
  const track=document.querySelector('#timeline'),width=track.clientWidth||400;
  let start=+a.value/max*100,end=+b.value/max*100;const gap=8/width*100;
  if(end-start<gap){const middle=(start+end)/2;start=Math.max(0,Math.min(100-gap,middle-gap/2));end=start+gap}
  const left=Math.round(start/100*width*64)/64,right=Math.max(left+8,Math.round(end/100*width*64)/64);
  track.style.setProperty('--start',left+'px');track.style.setProperty('--end',right+'px');
  for(const [id,range,min,maxValue] of [['trimStart',a,0,+b.value-3],['trimEnd',b,+a.value+3,max]]){const h=document.getElementById(id);h.setAttribute('role','slider');h.setAttribute('aria-valuemin',min);h.setAttribute('aria-valuemax',maxValue);h.setAttribute('aria-valuenow',range.value);h.setAttribute('aria-valuetext',fmt(+range.value))}
};
for(const [id,rangeId,side] of [['trimStart','rangeStart','start'],['trimEnd','rangeEnd','end']]){
  const handle=document.getElementById(id),range=document.getElementById(rangeId);let drag=null;
  handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();drag={x:e.clientX,value:+range.value};handle.setPointerCapture(e.pointerId)});
  handle.addEventListener('pointermove',e=>{if(!drag)return;const width=document.getElementById('timeline').clientWidth,max=+document.getElementById('rangeEnd').max,v=Math.round(drag.value+(e.clientX-drag.x)/width*max);range.value=side==='start'?Math.max(0,Math.min(v,+document.getElementById('rangeEnd').value-3)):Math.min(max,Math.max(v,+document.getElementById('rangeStart').value+3));updateTimes()});
  const release=()=>{drag=null};handle.addEventListener('pointerup',release);handle.addEventListener('pointercancel',release);
  handle.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(e.key))return;e.preventDefault();const max=+document.getElementById('rangeEnd').max;let v=e.key==='Home'?0:e.key==='End'?max:+range.value+(e.key==='ArrowLeft'?-1:1)*(e.shiftKey?5:1);range.value=side==='start'?Math.max(0,Math.min(v,+document.getElementById('rangeEnd').value-3)):Math.min(max,Math.max(v,+document.getElementById('rangeStart').value+3));updateTimes()});
}
new ResizeObserver(updateTimes).observe(document.getElementById('timeline'));
updateTimes();

for(const [id,side] of [['startTime','start'],['endTime','end']]){
  const field=document.getElementById(id);
  const commit=()=>{const parts=field.value.trim().split(':');if(parts.length===2&&parts.every(p=>/^\d+$/.test(p))){const v=Number(parts[0])*60+Number(parts[1]),a=document.getElementById('rangeStart'),b=document.getElementById('rangeEnd');if(side==='start')a.value=Math.max(0,Math.min(v,+b.value-3));else b.value=Math.min(+b.max,Math.max(v,+a.value+3))}updateTimes()};
  field.addEventListener('blur',commit);field.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();commit();field.blur()}});
}
