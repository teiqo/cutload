(() => {
  const canvas=document.querySelector('#star3d'),button=document.querySelector('#aboutBtn');
  const gl=canvas.getContext('webgl',{alpha:true,antialias:true,premultipliedAlpha:false});if(!gl)return;
  function shader(type,source){const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error(gl.getShaderInfoLog(s));return s}
  const program=gl.createProgram();
  gl.attachShader(program,shader(gl.VERTEX_SHADER,`attribute vec3 position;attribute vec3 normal;attribute vec2 texcoord;attribute float edgeBand;attribute float edgeGlow;uniform mat4 model;uniform mat4 projection;varying vec3 N;varying vec3 P;varying vec2 uv;varying float band;varying float glow;void main(){vec4 p=model*vec4(position,1.);P=p.xyz;N=mat3(model)*normal;uv=texcoord;band=edgeBand;glow=edgeGlow;gl_Position=projection*p;}`));
  const derivatives=gl.getExtension('OES_standard_derivatives');
  // Tangent circular fillets replace only the final 14% of each needle tip.
  const tipStart=.86,tipSide=Math.pow(1-Math.pow(tipStart,.55),1/.55);
  const tipSlope=Math.pow(tipStart,-.45)*Math.pow(1-Math.pow(tipStart,.55),1/.55-1);
  const tipRadius=tipSide*Math.sqrt(1+tipSlope*tipSlope),tipCenter=tipStart-tipSlope*tipSide;
  gl.attachShader(program,shader(gl.FRAGMENT_SHADER,`${derivatives?'#extension GL_OES_standard_derivatives : enable\n':''}
    precision mediump float;varying vec3 N;varying vec3 P;varying vec2 uv;varying float band;varying float glow;uniform vec3 accent;
    void main(){
      if(band>.5){
        float tip=glow;
        float aa=${derivatives?'min(max(fwidth(band),.02),.8)':'.3'};
        float a=.10*tip*(1.-smoothstep(2.-aa,2.,band));
        gl_FragColor=vec4(mix(accent,vec3(1.),.88)*a,a);return;
      }
      vec3 n=normalize(N);if(!gl_FrontFacing)n=-n;vec3 v=normalize(-P);vec3 l=normalize(vec3(-.7,1.1,2.));
      float diffuse=max(dot(n,l),0.);float shine=pow(max(dot(n,normalize(l+v)),0.),28.);float rim=pow(1.-abs(dot(n,v)),2.);
      float boundary=pow(abs(uv.x),.55)+pow(abs(uv.y),.55);
      if(abs(uv.x)>.86)boundary=max(boundary,length(vec2(abs(uv.x)-${tipCenter.toFixed(8)},uv.y))/${tipRadius.toFixed(8)});
      if(abs(uv.y)>.86)boundary=max(boundary,length(vec2(uv.x,abs(uv.y)-${tipCenter.toFixed(8)}))/${tipRadius.toFixed(8)});
      float aa=${derivatives?'max(fwidth(boundary)*2.0,.001)':'.004'};float coverage=1.-smoothstep(1.-aa,1.,boundary);
      vec3 c=accent*(.72+.4*diffuse)+vec3(.65,.85,.88)*shine*.12;
      vec2 cell=mod(uv+.0425,.085)-.0425;float dot=1.-smoothstep(.009,.014,length(cell));c*=1.-dot*.18;
      float a=(.32+diffuse*.17+rim*.13)*.24*coverage;gl_FragColor=vec4(c*a,a);
    }`));
  gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(program));gl.useProgram(program);
  const triangles=[],rings=1,segments=640;
  // Three independent four-point membranes, each in its own coordinate plane.
  // The third basis vector is the membrane's concave axis (X, Y or Z).
  const sheets=[
    {name:'XY',u:[1,0,0],v:[0,1,0],w:[0,0,1]},
    {name:'YZ',u:[0,0,-1],v:[0,1,0],w:[1,0,0]},
    {name:'XZ',u:[1,0,0],v:[0,0,1],w:[0,-1,0]}
  ];
  function point(r,a){
    const c=Math.cos(a),s=Math.sin(a),power=2/.55;
    let x=Math.sign(c)*Math.pow(Math.abs(c),power),y=Math.sign(s)*Math.pow(Math.abs(s),power);
    if(Math.abs(x)>tipStart)x=Math.sign(x)*(tipCenter+Math.sqrt(Math.max(0,tipRadius*tipRadius-y*y)));
    if(Math.abs(y)>tipStart)y=Math.sign(y)*(tipCenter+Math.sqrt(Math.max(0,tipRadius*tipRadius-x*x)));
    return [r*x,r*y];
  }
  // Concavity belongs to the four-point outline. Each membrane is a genuinely
  // flat 2D star, with no displaced middle or bulging radial bands.
  function vertex(p,basis,band=0,glow=0){
    const [x,y]=p;
    return [...basis.u.map((v,i)=>v*x+basis.v[i]*y),...basis.w,x,y,band,glow]
  }
  function triangle(a,b,c,sheet,bands=[0,0,0],glows=[0,0,0]){triangles.push({data:[...vertex(a,sheet,bands[0],glows[0]),...vertex(b,sheet,bands[1],glows[1]),...vertex(c,sheet,bands[2],glows[2])]})}
  for(const sheet of sheets)for(let r=0;r<rings;r++)for(let a=0;a<segments;a++){const angle=a/segments*Math.PI*2,next=(a+1)/segments*Math.PI*2,p=point(r/rings,angle),q=point((r+1)/rings,angle),s=point((r+1)/rings,next),t=point(r/rings,next);triangle(p,q,s,sheet);if(r)triangle(p,s,t,sheet)}
  // A separate strip starts at the contour and extends inward along its normal.
  // Brightness follows distance along each curved edge: tip -> dark midpoint -> tip.
  function inside(angle){const p=point(1,angle),before=point(1,angle-.0001),after=point(1,angle+.0001),dx=after[0]-before[0],dy=after[1]-before[1],length=Math.hypot(dx,dy)||1;const width=.012;return [p[0]-dy/length*width,p[1]+dx/length*width]}
  const edgeLengths=[0],quarter=segments/4;
  for(let i=1;i<=quarter;i++){const a=point(1,(i-1)/segments*Math.PI*2),b=point(1,i/segments*Math.PI*2);edgeLengths.push(edgeLengths[i-1]+Math.hypot(b[0]-a[0],b[1]-a[1]))}
  function tipGlow(index){const fraction=edgeLengths[index%quarter]/edgeLengths[quarter],distance=Math.abs(2*fraction-1);return distance*distance*distance*(10-15*distance+6*distance*distance)}
  for(const sheet of sheets)for(let i=0;i<segments;i++){const a=i/segments*Math.PI*2,b=(i+1)/segments*Math.PI*2,p=point(1,a),q=point(1,b),innerP=inside(a),innerQ=inside(b),gp=tipGlow(i),gq=tipGlow(i+1);triangle(p,q,innerQ,sheet,[1,1,2],[gp,gq,gq]);triangle(p,innerQ,innerP,sheet,[1,2,2],[gp,gq,gp])}
  const packed=new Float32Array(triangles.flatMap(t=>t.data)),buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,packed,gl.STATIC_DRAW);
  const attributes=[['position',3,0],['normal',3,12],['texcoord',2,24],['edgeBand',1,32],['edgeGlow',1,36]].map(([name,size,offset])=>[gl.getAttribLocation(program,name),size,offset]);
  const modelLoc=gl.getUniformLocation(program,'model'),projLoc=gl.getUniformLocation(program,'projection'),colorLoc=gl.getUniformLocation(program,'accent');
  // Accumulate weighted color on the GPU; intersecting sheets no longer need
  // thousands of triangle sorts and a vertex-buffer upload on every frame.
  const composite=gl.createProgram();
  gl.attachShader(composite,shader(gl.VERTEX_SHADER,`attribute vec2 position;varying vec2 uv;void main(){uv=position*.5+.5;gl_Position=vec4(position,0.,1.);}`));
  gl.attachShader(composite,shader(gl.FRAGMENT_SHADER,`precision mediump float;uniform sampler2D image;varying vec2 uv;void main(){vec4 a=texture2D(image,uv);if(a.a<.001){gl_FragColor=vec4(0.);return;}float opacity=1.-exp(-a.a*2.9);float core=1.-smoothstep(0.,.28,distance(uv,vec2(.5)));opacity*=1.-.5*core;gl_FragColor=vec4(a.rgb/max(a.a,.001),opacity*.82);}`));
  gl.linkProgram(composite);if(!gl.getProgramParameter(composite,gl.LINK_STATUS))throw Error(gl.getProgramInfoLog(composite));
  const quad=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,1,-1,-1,1,-1,1,1,-1,1,1]),gl.STATIC_DRAW);
  const quadLoc=gl.getAttribLocation(composite,'position'),target=gl.createFramebuffer(),texture=gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.framebufferTexture2D(gl.FRAMEBUFFER,gl.COLOR_ATTACHMENT0,gl.TEXTURE_2D,texture,0);
  gl.disable(gl.DEPTH_TEST);gl.disable(gl.CULL_FACE);canvas.parentElement.classList.add('webgl-ready');
  const qmul=(a,b)=>[a[0]*b[0]-a[1]*b[1]-a[2]*b[2]-a[3]*b[3],a[0]*b[1]+a[1]*b[0]+a[2]*b[3]-a[3]*b[2],a[0]*b[2]-a[1]*b[3]+a[2]*b[0]+a[3]*b[1],a[0]*b[3]+a[1]*b[2]-a[2]*b[1]+a[3]*b[0]],qnorm=q=>{const n=Math.hypot(...q)||1;return q.map(v=>v/n)},qaxis=(axis,angle)=>{const n=Math.hypot(...axis)||1,s=Math.sin(angle/2)/n;return [Math.cos(angle/2),axis[0]*s,axis[1]*s,axis[2]*s]};
  // Oblique reference view reveals the three thin intersecting planes.
  let orientation=qnorm(qmul(qaxis([0,0,1],-.13),qmul(qaxis([0,1,0],.45),qaxis([1,0,0],.3)))),mode=false,dragging=false,pointer=null,previousTrackball=null,previousClient=[0,0],lastPointerTime=0,angularVelocity=[0,0,0],last=0,zoom=1,displayZoom=1,frameWindow=0,frameCount=0,starCenter=null;
  let autoAxis=[.55,1,.4],autoTarget=autoAxis.slice(),nextAutoTurn=0;
  function randomSpin(t,dt){if(t>=nextAutoTurn){const v=[Math.random()*2-1,Math.random()*2-1,Math.random()*2-1],n=Math.hypot(...v)||1;autoTarget=v.map(x=>x/n);nextAutoTurn=t+7000+Math.random()*7000}const blend=1-Math.exp(-dt*.35);autoAxis=autoAxis.map((v,i)=>v+(autoTarget[i]-v)*blend);return autoAxis}
  function modeLabel(){const label=lang==='ru'?(mode?'вернуться к загрузке':'вращать звезду'):(mode?'return to download':'rotate star');button.setAttribute('aria-label',label);button.title=label}
  const reduced=matchMedia('(prefers-reduced-motion:reduce)');modeLabel();button.setAttribute('aria-pressed','false');document.getElementById('langBtn').addEventListener('click',modeLabel);
  let orbitCenter=null;
  function setMode(on){if(mode===on)return;orbitCenter=on&&starCenter?starCenter.slice():null;mode=on;document.body.classList.toggle('orbit-mode',on);document.querySelector('.workspace').inert=on;button.classList.toggle('active',on);button.setAttribute('aria-pressed',on);modeLabel();if(pointer!==null&&canvas.hasPointerCapture(pointer))canvas.releasePointerCapture(pointer);dragging=false;pointer=null;previousTrackball=null;canvas.classList.remove('dragging');if(!on)zoom=1}
  button.onclick=()=>setMode(!mode);document.addEventListener('keydown',e=>{if(e.key==='Escape'&&mode)setMode(false)});
  function trackball(e){const r=canvas.getBoundingClientRect(),radius=Math.max(1,Math.min(r.width,r.height,innerWidth,innerHeight)*.36),x=(e.clientX-(r.left+r.width/2))/radius,y=((r.top+r.height/2)-e.clientY)/radius,d=Math.hypot(x,y),z=d<Math.SQRT1_2?Math.sqrt(1-d*d):.5/d,n=Math.hypot(x,y,z);return [x/n,y/n,z/n]}
  canvas.addEventListener('pointerdown',e=>{if(!mode||e.button!==0)return;dragging=true;pointer=e.pointerId;previousTrackball=trackball(e);previousClient=[e.clientX,e.clientY];lastPointerTime=e.timeStamp;angularVelocity=[0,0,0];canvas.setPointerCapture(pointer);canvas.classList.add('dragging');e.preventDefault()});
  canvas.addEventListener('pointermove',e=>{if(!dragging||e.pointerId!==pointer)return;const next=trackball(e),a=previousTrackball,b=next,cross=e.shiftKey?[0,0,1]:[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]],dot=Math.max(-1,Math.min(1,a[0]*b[0]+a[1]*b[1]+a[2]*b[2])),angle=e.shiftKey?(e.clientX-previousClient[0])*.006+(e.clientY-previousClient[1])*.003:Math.atan2(Math.hypot(...cross),dot),dt=Math.max(8,e.timeStamp-lastPointerTime)/1000;if(Math.abs(angle)>1e-5){orientation=qnorm(qmul(qaxis(cross,angle),orientation));const speed=Math.max(-12,Math.min(12,angle/dt));angularVelocity=angularVelocity.map((v,i)=>v*.3+cross[i]/(Math.hypot(...cross)||1)*speed*.7)}previousTrackball=next;previousClient=[e.clientX,e.clientY];lastPointerTime=e.timeStamp});
  function release(e){if(e.pointerId!==pointer)return;dragging=false;if(e.timeStamp-lastPointerTime>100||reduced.matches)angularVelocity=[0,0,0];pointer=null;previousTrackball=null;canvas.classList.remove('dragging')}
  function maxOrbitZoom(){const r=canvas.getBoundingClientRect(),footer=document.querySelector('footer').offsetHeight,cx=innerWidth/2,cy=(innerHeight-footer)/2,room=Math.max(80,2*Math.min(cx-20,innerWidth-cx-20,cy-78,innerHeight-footer-cy-20));return Math.min(.98/.95,room/(.95*Math.max(1,r.width)))}
  canvas.addEventListener('pointerup',release);canvas.addEventListener('pointercancel',e=>{release(e);angularVelocity=[0,0,0]});canvas.addEventListener('wheel',e=>{if(!mode)return;e.preventDefault();zoom=Math.max(.3,Math.min(Math.max(1,maxOrbitZoom()/1.08),zoom*Math.exp(-e.deltaY*.001)))},{passive:false});
  function frame(t){const economical=document.body.classList.contains('performance-mode');if(document.hidden||economical){last=t;requestAnimationFrame(frame);return}const dt=last?Math.min((t-last)/1000,.05):0;last=t;const animate=!document.body.classList.contains('noanim')&&!reduced.matches;if(!document.hidden){
    const spinAxis=randomSpin(t,dt);const expanded=document.body.classList.contains('expanded');const working=document.querySelector('#linkForm').classList.contains('link-working');const spinBoost=document.body.classList.contains('download-working')?5:working?2.5:1;
    const canvasWidth=canvas.clientWidth;
    const anchor=expanded?null:document.querySelector('.workspace').getBoundingClientRect();
    const targetCenter=mode&&orbitCenter?orbitCenter:[anchor?anchor.left+anchor.width/2:innerWidth/2,anchor?anchor.top+anchor.height/2:(innerHeight-document.querySelector('footer').offsetHeight)/2];
    if(!starCenter)starCenter=targetCenter.slice();
    const follow=animate?1-Math.exp(-dt*10):1;
    starCenter=starCenter.map((v,i)=>Math.abs(targetCenter[i]-v)<.05?targetCenter[i]:v+(targetCenter[i]-v)*follow);
    const centerLeft=Math.round(starCenter[0]*4)/4+'px',centerTop=Math.round(starCenter[1]*4)/4+'px';
    if(canvas.parentElement.style.left!==centerLeft)canvas.parentElement.style.left=centerLeft;
    if(canvas.parentElement.style.top!==centerTop)canvas.parentElement.style.top=centerTop;
    if(!dragging&&animate){const speed=Math.hypot(...angularVelocity);if(speed>1e-4)orientation=qnorm(qmul(qaxis(angularVelocity,speed*dt),orientation));const friction=Math.exp(-dt*.9);angularVelocity=angularVelocity.map(v=>v*friction);orientation=qnorm(qmul(qaxis(spinAxis,dt*.20*spinBoost*Math.min(1,Math.hypot(...spinAxis))),orientation))}
    {const size=Math.ceil(canvasWidth*(economical?Math.min(devicePixelRatio||1,1):Math.min(Math.max(devicePixelRatio||1,1.25),1.5))/64)*64;if(canvas.width!==size||canvas.height!==size){canvas.width=canvas.height=size;gl.viewport(0,0,size,size);gl.bindTexture(gl.TEXTURE_2D,texture);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,size,size,0,gl.RGBA,gl.UNSIGNED_BYTE,null)}
      const [w,x,y,z]=orientation;const m=[1-2*(y*y+z*z),2*(x*y+w*z),2*(x*z-w*y),0,2*(x*y-w*z),1-2*(x*x+z*z),2*(y*z+w*x),0,2*(x*z+w*y),2*(y*z-w*x),1-2*(x*x+y*y),0,0,0,-6,1];
      const zoomTarget=mode?Math.min(zoom*1.08,Math.max(1.08,maxOrbitZoom())):zoom;displayZoom+=(zoomTarget-displayZoom)*(animate?1-Math.exp(-dt*8):1);
      const f=.95*displayZoom,near=.1,far=20,projection=[f,0,0,0,0,f,0,0,0,0,-2/(far-near),0,0,0,-(far+near)/(far-near),1];const match=(canvas.dataset.color||'#9988dd').match(/^#([\da-f]{6})$/i);const rgb=match?[0,2,4].map(i=>parseInt(match[1].slice(i,i+2),16)/255):[.5,.4,.9];
      gl.bindFramebuffer(gl.FRAMEBUFFER,target);gl.useProgram(program);gl.bindBuffer(gl.ARRAY_BUFFER,buffer);for(const [loc,size,offset] of attributes){gl.enableVertexAttribArray(loc);gl.vertexAttribPointer(loc,size,gl.FLOAT,false,40,offset)}gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE);gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);gl.uniformMatrix4fv(modelLoc,false,new Float32Array(m));gl.uniformMatrix4fv(projLoc,false,new Float32Array(projection));gl.uniform3fv(colorLoc,new Float32Array(rgb));gl.drawArrays(gl.TRIANGLES,0,packed.length/10);
      for(const [loc] of attributes)gl.disableVertexAttribArray(loc);gl.bindFramebuffer(gl.FRAMEBUFFER,null);gl.useProgram(composite);gl.disable(gl.BLEND);gl.clear(gl.COLOR_BUFFER_BIT);gl.bindTexture(gl.TEXTURE_2D,texture);gl.bindBuffer(gl.ARRAY_BUFFER,quad);gl.enableVertexAttribArray(quadLoc);gl.vertexAttribPointer(quadLoc,2,gl.FLOAT,false,8,0);gl.drawArrays(gl.TRIANGLES,0,6);gl.disableVertexAttribArray(quadLoc);if(!canvas.dataset.initialFrameReady)canvas.dataset.initialFrameReady="true";
      if(!frameWindow)frameWindow=t;frameCount++;if(t-frameWindow>=1000){canvas.dataset.renderFps=String(Math.round(frameCount*1000/(t-frameWindow)));frameCount=0;frameWindow=t}
    }}requestAnimationFrame(frame)}requestAnimationFrame(frame);
})();
