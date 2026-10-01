import { analyzeRhythm } from './analysis.js';
const $ = (id) => document.getElementById(id);
const els = Object.fromEntries(['fileInput','uploadBtn','linkImportBtn','linkImportDialog','closeLinkImportBtn','linkImportForm','mediaLinkInput','convertLinkBtn','linkImportStatus','tracksFullDialog','closeTracksFullBtn','confirmTracksFullBtn','demoBtn','playBtn','playIcon','stopBtn','timeReadout','bpmInput','zoomInput','zoomValue','ruler','tracksGrid','timelineContent','timelineScroll','playhead','timelineHint','analysisStatus','alignBtn','splitBtn','duplicateBtn','extendBtn','deleteBtn','undoBtn','drumToggle','drumLevel','drumValue','exportBtn','exportFormat','exportSelection','selectionHint','clearSelectionBtn','tempoDialog','tempoQuestion','keepTempoBtn','changeTempoBtn','projectName','toast','helpBtn','helpDialog','closeHelpBtn'].map(id => [id,$(id)]));
const rail = document.querySelector('.timeline-side-header');
const palette = [
  { bg:'#fce2d8', border:'#f6bca7', ink:'#b9694b', wave:'#ed977a', dot:'#f19270' },
  { bg:'#e7e3f4', border:'#cbc5e5', ink:'#7c74ae', wave:'#9b91c6', dot:'#9c8ecb' },
  { bg:'#ddedeb', border:'#b7dad3', ink:'#4c8c82', wave:'#7dbbb0', dot:'#83bdb2' },
  { bg:'#faedcf', border:'#ead6a4', ink:'#9d8550', wave:'#cfaf6e', dot:'#d2b178' }
];
const state = { bpm:120, zoom:1, tracks:Array.from({length:3},(_,index)=>({id:uidTrack(index),name:`音轨 ${index+1}`,clips:[],muted:false,solo:false})), selected:null, exportSelection:null, playhead:0, playing:false, audio:null, sources:[], eqFilter:null, startedAt:0, raf:0, undo:[], exporting:false };
function uidTrack(index){return `track-${index+1}`;}
const rhythmCache = new WeakMap();
let toastTimer;
const uid = () => Math.random().toString(36).slice(2,10);
const beat = () => 60 / state.bpm;
const pxSecond = () => 42 * state.zoom / beat();
const barWidth = () => pxSecond() * beat() * 4;
const snap = (seconds) => Math.max(0, Math.round(seconds / (beat()/2)) * (beat()/2));
function snapClip(raw, clip){
  const time = Math.max(0,raw), measure=beat()*4, tolerance=18/pxSecond();
  if(Number.isFinite(clip.kickOffset)){
    const anchored=Math.round((time+clip.kickOffset)/measure)*measure-clip.kickOffset;
    if(anchored>=0&&Math.abs(time-anchored)<=tolerance)return anchored;
  }
  const atBar=Math.round(time/measure)*measure;
  if(Math.abs(time-atBar)<=tolerance)return atBar;
  return snap(time);
}
const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}.${Math.floor((s%1)*10)}`;
function toast(message){ els.toast.textContent=message; els.toast.classList.add('show'); clearTimeout(toastTimer); toastTimer=setTimeout(()=>els.toast.classList.remove('show'),2800); }
function audioContext(){ if(!state.audio) state.audio=new (window.AudioContext||window.webkitAudioContext)(); return state.audio; }
function allClips(){ return state.tracks.flatMap(t=>t.clips.map(c=>({track:t,clip:c}))); }
function audibleClips(){const solo=state.tracks.find(track=>track.solo);return state.tracks.filter(track=>solo?track===solo:!track.muted).flatMap(track=>track.clips.map(clip=>({track,clip})));}
function endTime(){ return Math.max(0,...allClips().map(({clip})=>clip.start+clip.duration)); }
function selected(){ return allClips().find(({clip})=>clip.id===state.selected); }
function saveUndo(){ state.undo.push({ tracks:state.tracks.map(t=>({id:t.id,clips:t.clips.map(c=>({...c}))})),selected:state.selected }); if(state.undo.length>30) state.undo.shift(); updateButtons(); }
function restoreUndo(){ const previous=state.undo.pop(); if(!previous)return; stop(); for(const saved of previous.tracks){const track=state.tracks.find(t=>t.id===saved.id);if(track)track.clips=saved.clips;} state.selected=previous.selected; render(); toast('已撤销上一步'); }
function updateButtons(){ const has=!!selected(); for(const el of [els.alignBtn,els.splitBtn,els.duplicateBtn,els.extendBtn,els.deleteBtn])el.disabled=!has; els.undoBtn.disabled=state.undo.length===0; els.exportBtn.disabled=state.exporting; }
function setPlayhead(seconds, rerun=false){ state.playhead=Math.min(Math.max(0,seconds),Math.max(endTime(),beat()*4)); els.playhead.style.left=`${state.playhead*pxSecond()}px`; els.timeReadout.textContent=fmt(state.playhead); if(rerun&&state.playing){ stop(false); play(); } }
function renderWave(canvas,clip,color){
  const node=canvas.parentElement,width=Math.max(1,Math.round(clip.duration*pxSecond()));
  const dpr=Math.min(window.devicePixelRatio||1,2);
  canvas.width=Math.min(4096,Math.round(width*dpr));canvas.height=96;
  const ctx=canvas.getContext('2d'),data=clip.buffer.getChannelData(0),height=canvas.height,sampleRate=clip.buffer.sampleRate;
  ctx.clearRect(0,0,canvas.width,height);ctx.fillStyle=color;
  for(let x=0;x<canvas.width;x+=2){
    const local=(x/canvas.width)*clip.duration;
    let sourceSecond=clip.sourceStart+local;
    if(clip.loop){const length=clip.loopEnd-clip.loopStart;sourceSecond=clip.loopStart+((sourceSecond-clip.loopStart)%length+length)%length;}
    if(sourceSecond>=clip.buffer.duration)continue;
    const a=Math.floor(sourceSecond*sampleRate),span=Math.max(1,Math.floor(clip.duration*sampleRate/canvas.width));
    let max=0;
    for(let i=a;i<Math.min(data.length,a+span);i+=Math.max(1,Math.floor(span/14)))max=Math.max(max,Math.abs(data[i]));
    const amp=Math.max(2,max*height*.43);ctx.fillRect(x,height/2-amp,1.5,amp*2);
  }
  node.querySelector('.kick-marker')?.remove();
  if(Number.isFinite(clip.kickOffset)&&clip.kickOffset>=0&&clip.kickOffset<clip.duration){
    const marker=document.createElement('span');marker.className='kick-marker';marker.style.left=`${clip.kickOffset*pxSecond()}px`;marker.title='识别到的底鼓起点';node.append(marker);
  }
  if(!node.querySelector('.trim-handle'))for(const side of ['left','right']){
    const handle=document.createElement('span');handle.className=`trim-handle ${side}`;handle.dataset.trim=side;handle.title=side==='left'?'拖动裁剪或还原左侧':'拖动裁剪或还原右侧';node.append(handle);
  }
}
function render(){
  const duration=Math.max(endTime()+beat()*4,beat()*4*16);
  const bars=Math.ceil(duration/(beat()*4));
  if(state.exportSelection){state.exportSelection.from=Math.min(state.exportSelection.from,bars*4-1);state.exportSelection.to=Math.min(state.exportSelection.to,bars*4-1);}
  const width=Math.max(els.timelineScroll.clientWidth,bars*barWidth());
  els.timelineContent.style.width=`${width}px`;
  els.timelineContent.style.setProperty('--bar-width',`${barWidth()}px`);
  els.timelineContent.style.setProperty('--beat-width',`${barWidth()/4}px`);
  els.ruler.innerHTML='';
  for(let b=0;b<bars;b++){
    const mark=document.createElement('div');mark.className='ruler-mark';mark.style.left=`${b*barWidth()}px`;
    mark.textContent=String(b+1).padStart(2,'0');
    if(b===0){const sm=document.createElement('small');sm.textContent='小节';mark.append(sm);}
    els.ruler.append(mark);
  }
  rail.querySelectorAll('.track-label').forEach(n=>n.remove());
  els.tracksGrid.innerHTML='';
  for(let index=0;index<Math.max(3,state.tracks.length);index++){
    const track=state.tracks[index];
    const style=palette[index%palette.length];
    const label=document.createElement('div');label.className='track-label';label.style.top=`${48+index*102}px`;
    label.innerHTML=`<span class="track-color" style="background:${style.dot}"></span><div class="track-meta"><strong></strong><small></small></div><div class="track-actions"><button type="button" class="track-toggle mute" aria-label="音轨 ${index+1} 静音" aria-pressed="false" title="静音 (M)">M</button><button type="button" class="track-toggle solo" aria-label="音轨 ${index+1} 独奏" aria-pressed="false" title="独奏 (S)">S</button></div>`;
    label.querySelector('strong').textContent=track?.name||`音轨 ${index+1}`;
    label.querySelector('small').textContent=track?.clips.length?`${track.clips.length} 个片段`:'等待上传';
    if(!track?.clips.length)label.classList.add('placeholder');
    for(const [kind,key] of [['mute','muted'],['solo','solo']]){
      const button=label.querySelector(`.${kind}`);
      button.setAttribute('aria-pressed',String(!!track?.[key]));
      button.onclick=()=>{
        if(key==='solo'){
          const enable=!track.solo;
          state.tracks.forEach(item=>{item.solo=false;});
          track.solo=enable;
        }else track[key]=!track[key];
        const wasPlaying=state.playing;
        if(wasPlaying)stop(false);
        render();
        if(wasPlaying)play();
      };
    }
    rail.append(label);
    const row=document.createElement('div');row.className=`track-row${track?.clips.length?'':' empty-track'}${track?.muted||state.tracks.some(t=>t.solo&&!track?.solo)?' inactive-track':''}`;
    if(track)row.dataset.track=track.id;
    for(const clip of track?.clips||[]){
      const node=document.createElement('div');node.className=`clip${state.selected===clip.id?' selected':''}`;
      node.style.left=`${clip.start*pxSecond()}px`;node.style.width=`${Math.max(12,clip.duration*pxSecond())}px`;
      node.style.setProperty('--clip-bg',style.bg);node.style.setProperty('--clip-border',style.border);node.style.setProperty('--clip-ink',style.ink);
      node.innerHTML='<span class="clip-title"></span><canvas></canvas>';
      node.querySelector('.clip-title').textContent=clip.name+(clip.loop?' · 循环':'');
      node.dataset.clip=clip.id;node.addEventListener('pointerdown',clipPointerDown);
      row.append(node);renderWave(node.querySelector('canvas'),clip,style.wave);
    }
    els.tracksGrid.append(row);
  }
  const height=48+Math.max(3,state.tracks.length)*102;
  els.timelineContent.style.minHeight=`${height}px`;
  els.tracksGrid.style.minHeight=`${height-48}px`;
  rail.style.minHeight=`${height}px`;
  els.timelineHint.textContent=allClips().length?`${state.tracks.length} 条音轨 · ${allClips().length} 个片段 · ${fmt(endTime())}`:'点击「上传歌曲」开始，或将音频拖进页面';
  renderExportSelection();
  setPlayhead(state.playhead);updateButtons();
}
function renderExportSelection(){
  const range=state.exportSelection;
  els.exportSelection.hidden=!range;
  els.clearSelectionBtn.hidden=!range;
  if(!range){els.selectionHint.textContent='右键划过小节标尺，按 1/4 小节选区导出';return;}
  const beatWidth=barWidth()/4;
  els.exportSelection.style.left=`${range.from*beatWidth}px`;
  els.exportSelection.style.width=`${(range.to-range.from+1)*beatWidth}px`;
  const label=index=>`第${Math.floor(index/4)+1}小节第${index%4+1}拍`;
  els.selectionHint.textContent=`${label(range.from)}${range.to===range.from?'':`–${label(range.to)}`} · 选取该部分导出`;
}
function beatAtPointer(clientX){
  const left=els.ruler.getBoundingClientRect().left;
  return Math.max(0,Math.min(els.ruler.children.length*4-1,Math.floor((clientX-left)/(barWidth()/4))));
}
function selectBeats(anchor,current){
  state.exportSelection={from:Math.min(anchor,current),to:Math.max(anchor,current)};
  renderExportSelection();
}
els.ruler.addEventListener('pointerdown',event=>{
  if(event.button!==2)return;
  event.preventDefault();event.stopPropagation();
  const anchor=beatAtPointer(event.clientX);
  selectBeats(anchor,anchor);
  const move=e=>{selectBeats(anchor,beatAtPointer(e.clientX));};
  const finish=()=>{
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',finish);
    window.removeEventListener('pointercancel',finish);
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',finish);
  window.addEventListener('pointercancel',finish);
});
els.ruler.addEventListener('contextmenu',event=>event.preventDefault());
els.clearSelectionBtn.onclick=()=>{state.exportSelection=null;render();};
function snapTrimBoundary(time){
  const bar=beat()*4,nearest=Math.round(time/bar)*bar;
  return Math.abs(time-nearest)<=Math.min(.12,12/pxSecond())?nearest:time;
}
function clipPointerDown(event){
  if(event.button!==0)return;
  event.preventDefault();
  const node=event.currentTarget,pair=allClips().find(({clip})=>clip.id===node.dataset.clip);
  if(!pair)return;
  const clip=pair.clip,side=event.target.closest('.trim-handle')?.dataset.trim||'move';
  const startX=event.clientX,startY=event.clientY;
  const initial={start:clip.start,duration:clip.duration,sourceStart:clip.sourceStart,kickOffset:clip.kickOffset};
  const waveColor=palette[state.tracks.indexOf(pair.track)%palette.length].wave;
  let moved=false,targetTrack=pair.track;
  state.selected=clip.id;
  document.querySelectorAll('.clip').forEach(n=>n.classList.toggle('selected',n.dataset.clip===clip.id));
  updateButtons();
  const move=e=>{
    const delta=(e.clientX-startX)/pxSecond();
    if((Math.abs(e.clientX-startX)>3||(side==='move'&&Math.abs(e.clientY-startY)>3))&&!moved){saveUndo();moved=true;}
    if(!moved)return;
    if(side==='left'){
      const sourceFloor=clip.loop?clip.loopStart:0;
      const minStart=Math.max(0,initial.start-(initial.sourceStart-sourceFloor));
      const maxStart=initial.start+initial.duration-.06;
      const next=Math.max(minStart,Math.min(maxStart,snapTrimBoundary(initial.start+delta)));
      const shift=next-initial.start;
      clip.start=next;clip.sourceStart=initial.sourceStart+shift;clip.duration=initial.duration-shift;
      if(Number.isFinite(initial.kickOffset))clip.kickOffset=initial.kickOffset-shift;
    }else if(side==='right'){
      const maxDuration=clip.loop?600-initial.start:clip.buffer.duration-initial.sourceStart;
      const end=Math.max(initial.start+.06,Math.min(initial.start+maxDuration,snapTrimBoundary(initial.start+initial.duration+delta)));
      clip.duration=end-initial.start;
    }else{
      clip.start=snapClip(initial.start+delta,clip);
      const grid=els.tracksGrid.getBoundingClientRect();
      const index=Math.floor((e.clientY-grid.top)/102);
      if(index>=0&&index<state.tracks.length&&state.tracks[index]!==targetTrack){
        targetTrack=state.tracks[index];
        const row=els.tracksGrid.children[index];row.append(node);
        const color=palette[index%palette.length];
        node.style.setProperty('--clip-bg',color.bg);
        node.style.setProperty('--clip-border',color.border);
        node.style.setProperty('--clip-ink',color.ink);
      }
    }
    node.style.left=`${clip.start*pxSecond()}px`;
    node.style.width=`${Math.max(12,clip.duration*pxSecond())}px`;
    if(side!=='move')renderWave(node.querySelector('canvas'),clip,waveColor);
    els.timelineHint.textContent=side==='move'?`已移动到 ${fmt(clip.start)}`:`片段长度 ${fmt(clip.duration)} · 拖动边缘可裁剪或还原`;
  };
  const up=()=>{
    window.removeEventListener('pointermove',move);
    window.removeEventListener('pointerup',up);
    window.removeEventListener('pointercancel',up);
    if(moved){
      if(side==='move'&&targetTrack!==pair.track){
        pair.track.clips=pair.track.clips.filter(item=>item.id!==clip.id);
        targetTrack.clips.push(clip);
      }
      stop();render();
    }else updateButtons();
  };
  window.addEventListener('pointermove',move);
  window.addEventListener('pointerup',up,{once:true});
  window.addEventListener('pointercancel',up,{once:true});
}
function stop(reset=true){if(state.playing){for(const s of state.sources){try{s.stop()}catch{}}state.sources=[];state.eqFilter?.disconnect();state.eqFilter=null;cancelAnimationFrame(state.raf);state.playing=false;els.playIcon.textContent='▶';els.playBtn.setAttribute('aria-label','播放');}if(reset)setPlayhead(0);}
function scheduleClip(ctx,clip,from,at,destination){const overlap=Math.max(clip.start,from),remaining=clip.duration-(overlap-clip.start);if(remaining<=0)return;const source=ctx.createBufferSource();source.buffer=clip.buffer;source.connect(destination);let offset=clip.sourceStart+(overlap-clip.start);if(clip.loop){source.loop=true;source.loopStart=clip.loopStart;source.loopEnd=clip.loopEnd;const length=clip.loopEnd-clip.loopStart;offset=clip.loopStart+((offset-clip.loopStart)%length+length)%length;}source.start(at+(overlap-from),offset,remaining);if(ctx===state.audio)state.sources.push(source);}
function eqInput(ctx,destination){
  const filter=ctx.createBiquadFilter();
  filter.type='peaking';filter.frequency.value=110;filter.Q.value=1.3;filter.gain.value=els.drumToggle.checked?Number(els.drumLevel.value):0;
  filter.connect(destination);
  return filter;
}
async function play(){if(state.playing){stop(false);return;}if(!allClips().length){toast('先上传一首音乐，或试听示例');return;}const ctx=audioContext();await ctx.resume();if(state.playhead>=endTime())setPlayhead(0);state.startedAt=ctx.currentTime-state.playhead;state.sources=[];const destination=eqInput(ctx,ctx.destination);state.eqFilter=destination;for(const {clip} of audibleClips())scheduleClip(ctx,clip,state.playhead,ctx.currentTime,destination);state.playing=true;els.playIcon.textContent='Ⅱ';els.playBtn.setAttribute('aria-label','暂停');const tick=()=>{if(!state.playing)return;const current=ctx.currentTime-state.startedAt;if(current>=endTime()){stop();return;}setPlayhead(current);const left=current*pxSecond(),view=els.timelineScroll;if(left>view.scrollLeft+view.clientWidth-50)view.scrollLeft=Math.max(0,left-view.clientWidth*.3);state.raf=requestAnimationFrame(tick);};tick();}
async function alignSelected({quiet=false,preserveBpm=false}={}){
  const pair=selected();if(!pair)return;
  const clip=pair.clip;
  els.alignBtn.disabled=true;els.alignBtn.querySelector('span').textContent='识别中…';
  await new Promise(resolve=>setTimeout(resolve,0));
  try{
    let analysis=rhythmCache.get(clip.buffer);
    if(!analysis){analysis=analyzeRhythm(clip.buffer);if(analysis)rhythmCache.set(clip.buffer,analysis);}
    if(!analysis){els.analysisStatus.hidden=false;els.analysisStatus.textContent='未找到稳定底鼓。可手动设置 BPM 并拖动片段对齐小节。';if(!quiet)toast('未检测到稳定底鼓，请手动对齐');return;}
    if(!preserveBpm){state.bpm=analysis.bpm;els.bpmInput.value=state.bpm;}
    const kick=analysis.detectedKicks.find(time=>time>=clip.sourceStart&&time<clip.sourceStart+clip.duration);
    if(kick===undefined){render();if(!quiet)toast('这个片段内没有检测到底鼓，请选择原始片段');return;}
    saveUndo();stop(false);
    clip.kickOffset=kick-clip.sourceStart;
    const measure=beat()*4;
    clip.start=Math.max(0,Math.ceil((clip.kickOffset-.08)/measure)*measure-clip.kickOffset);
    render();
    const bar=Math.round((clip.start+clip.kickOffset)/measure)+1;
    els.analysisStatus.hidden=false;
    els.analysisStatus.textContent=`估算 ${analysis.bpm} BPM · 当前网格 ${state.bpm} BPM · 底鼓 ${kick.toFixed(2)} 秒 · 已对齐第 ${bar} 小节。可手动校正 BPM，拖动时底鼓靠近小节线会吸附。`;
    if(!quiet)toast(`已识别 ${analysis.bpm} BPM，底鼓对齐第 ${bar} 小节`);
  }catch(error){console.error(error);toast('节拍识别失败，请手动设置 BPM');}
  finally{els.alignBtn.querySelector('span').textContent='智能对拍';updateButtons();}
}
function split(){const pair=selected();if(!pair){toast('先点选一个片段');return;}const c=pair.clip,cut=state.playhead-c.start;if(cut<=.03||cut>=c.duration-.03){toast('请把播放位置放在片段中间');return;}saveUndo();const second={...c,id:uid(),start:state.playhead,duration:c.duration-cut,sourceStart:c.sourceStart+cut,name:c.name};if(Number.isFinite(c.kickOffset)){second.kickOffset=c.kickOffset-cut;if(second.kickOffset<0)delete second.kickOffset;if(c.kickOffset>=cut)delete c.kickOffset;}if(c.loop){const len=c.loopEnd-c.loopStart;second.sourceStart=c.loopStart+((second.sourceStart-c.loopStart)%len+len)%len;}c.duration=cut;pair.track.clips.push(second);state.selected=second.id;render();toast('已在播放位置切开');}
function duplicate(){const pair=selected();if(!pair)return;saveUndo();const {track,clip}=pair;const copy={...clip,id:uid(),start:snap(clip.start+clip.duration)};track.clips.push(copy);state.selected=copy.id;render();toast('已复制片段，可拖动到需要的位置');}
function extend(){const pair=selected();if(!pair)return;saveUndo();const clip=pair.clip;if(!clip.loop){clip.loop=true;clip.loopStart=clip.sourceStart;clip.loopEnd=Math.min(clip.buffer.duration,clip.sourceStart+clip.duration);}clip.duration+=beat()*4;render();toast('已延长 4 拍，片段末尾会循环播放');}
function removeSelected(){const pair=selected();if(!pair)return;saveUndo();pair.track.clips=pair.track.clips.filter(c=>c.id!==pair.clip.id);state.selected=null;stop();render();toast('片段已删除');}
function askTempoChange(bpm){
  els.tempoQuestion.textContent=`新音频的bpm为${bpm}，是否需要更改？`;
  els.tempoDialog.returnValue='keep';
  els.keepTempoBtn.onclick=()=>els.tempoDialog.close('keep');
  els.changeTempoBtn.onclick=()=>els.tempoDialog.close('change');
  return new Promise(resolve=>{
    els.tempoDialog.addEventListener('close',()=>resolve(els.tempoDialog.returnValue==='change'),{once:true});
    els.tempoDialog.showModal();
  });
}
function showTracksFull(){
  if(!els.tracksFullDialog.open)els.tracksFullDialog.showModal();
}
function decodeHeader(value){
  try{return decodeURIComponent(value||'');}catch{return value||'';}
}
async function importLink(event){
  event.preventDefault();
  const emptyTrack=state.tracks.find(track=>!track.clips.length);
  if(!emptyTrack){els.linkImportDialog.close();showTracksFull();return;}
  const url=els.mediaLinkInput.value.trim();
  if(!/^https:\/\//i.test(url)){els.linkImportStatus.textContent='请输入完整的 https 链接。';return;}
  els.convertLinkBtn.disabled=true;
  els.linkImportStatus.textContent='正在提取并转换为 MP3，请不要关闭页面…';
  try{
    const response=await fetch('api/link-audio',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({url})});
    if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'链接转换失败');}
    const blob=await response.blob();
    const fileName=decodeHeader(response.headers.get('X-Audio-Filename'))||`链接音频_${Date.now()}.mp3`;
    const file=new File([blob],fileName,{type:'audio/mpeg'});
    const before=allClips().length;
    await addFiles([file]);
    if(allClips().length>before){els.linkImportDialog.close();els.linkImportForm.reset();els.linkImportStatus.textContent='';}
  }catch(error){
    console.error(error);
    els.linkImportStatus.textContent=location.hostname.endsWith('.github.io')?'线上转换服务尚未配置，请先在本机版使用此功能。':error.message||'链接转换失败，请检查链接后重试。';
  }finally{els.convertLinkBtn.disabled=false;}
}
async function addFiles(files){
  if(!files?.length)return;
  stop();let added=0;
  for(const file of files){
    try{
      const hadAudio=allClips().length>0,ctx=audioContext();
      const buffer=await ctx.decodeAudioData(await file.arrayBuffer());
      const track=state.tracks.find(t=>!t.clips.length);
      if(!track){showTracksFull();break;}
      const clip={id:uid(),name:file.name.replace(/\.[^.]+$/,''),buffer,start:0,sourceStart:0,duration:buffer.duration,loop:false,loopStart:0,loopEnd:buffer.duration};
      track.clips.push(clip);state.selected=clip.id;added++;render();
      await new Promise(resolve=>setTimeout(resolve,0));
      const analysis=analyzeRhythm(buffer);
      if(analysis)rhythmCache.set(buffer,analysis);
      if(hadAudio&&analysis&&Math.abs(analysis.bpm-state.bpm)>1&&await askTempoChange(analysis.bpm)){
        state.bpm=analysis.bpm;els.bpmInput.value=state.bpm;
      }
      await alignSelected({quiet:true,preserveBpm:hadAudio});
    }catch(error){console.error(error);toast(`无法读取或识别 ${file.name}，请尝试 WAV 或 MP3`);}
  }
  if(added)toast(`已导入 ${added} 个音频文件`);
  els.fileInput.value='';
}
function addDemo(){const ctx=audioContext(),duration=beat()*4*8,buffer=ctx.createBuffer(2,Math.ceil(duration*ctx.sampleRate),ctx.sampleRate);for(let ch=0;ch<2;ch++){const data=buffer.getChannelData(ch);for(let i=0;i<data.length;i++){const t=i/ctx.sampleRate,b=t/beat(),pulse=b%1,barBeat=Math.floor(b)%4;const bass=Math.sin(2*Math.PI*55*t)*Math.exp(-pulse*13)*.25;const chord=(Math.sin(2*Math.PI*220*t)+Math.sin(2*Math.PI*277.18*t)+Math.sin(2*Math.PI*329.63*t))*.035*(.55+.45*Math.sin(2*Math.PI*t/(beat()*4)));const clap=(barBeat===1||barBeat===3)&&pulse<.16?(Math.sin(i*127.3)*Math.sin(i*47.1))*Math.exp(-pulse*23)*.12:0;data[i]=bass+chord+clap;}}const track=state.tracks.find(t=>!t.clips.length);if(!track){showTracksFull();return;}const clip={id:uid(),name:'八小节律动',buffer,start:0,sourceStart:0,duration,loop:false,loopStart:0,loopEnd:duration};track.clips.push(clip);state.selected=clip.id;render();toast('示例已加入；可试试切开、移动和延长');}
function encodeWav(buffer){const channels=2,bytes=buffer.length*channels*2,array=new ArrayBuffer(44+bytes),view=new DataView(array);const write=(at,str)=>{for(let i=0;i<str.length;i++)view.setUint8(at+i,str.charCodeAt(i));};write(0,'RIFF');view.setUint32(4,36+bytes,true);write(8,'WAVE');write(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,channels,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*channels*2,true);view.setUint16(32,channels*2,true);view.setUint16(34,16,true);write(36,'data');view.setUint32(40,bytes,true);const left=buffer.getChannelData(0),right=buffer.numberOfChannels>1?buffer.getChannelData(1):left;for(let i=0;i<buffer.length;i++){for(let ch=0;ch<2;ch++){const sample=Math.max(-1,Math.min(1,ch?right[i]:left[i]));view.setInt16(44+(i*2+ch)*2,sample<0?sample*32768:sample*32767,true);}}return new Blob([array],{type:'audio/wav'});}
async function encodeMp3(buffer){
  if(!window.lamejs?.Mp3Encoder)throw new Error('MP3 编码器未加载');
  const encoder=new window.lamejs.Mp3Encoder(2,buffer.sampleRate,192),blocks=[];
  const left=buffer.getChannelData(0),right=buffer.getChannelData(1);
  for(let offset=0;offset<buffer.length;offset+=1152){
    const length=Math.min(1152,buffer.length-offset),a=new Int16Array(length),b=new Int16Array(length);
    for(let i=0;i<length;i++){
      const l=Math.max(-1,Math.min(1,left[offset+i])),r=Math.max(-1,Math.min(1,right[offset+i]));
      a[i]=l<0?l*32768:l*32767;b[i]=r<0?r*32768:r*32767;
    }
    const encoded=encoder.encodeBuffer(a,b);
    if(encoded.length)blocks.push(new Uint8Array(encoded));
    if(offset%(1152*96)===0){
      els.exportBtn.textContent=`正在生成 MP3 ${Math.round(offset/buffer.length*100)}%`;
      await new Promise(resolve=>setTimeout(resolve,0));
    }
  }
  const tail=encoder.flush();if(tail.length)blocks.push(new Uint8Array(tail));
  return new Blob(blocks,{type:'audio/mpeg'});
}
async function exportMix(){
  if(!allClips().length){toast('请先上传音乐或加入示例');return;}
  const range=state.exportSelection?{...state.exportSelection}:null;
  const from=range?range.from*beat():0;
  const to=range?(range.to+1)*beat():endTime();
  const duration=to-from;
  if(duration<=0){toast('选区无效，请重新选取拍位');return;}
  if(duration>600){toast('当前版本每次最多导出 10 分钟，请缩短选区或片段');return;}
  state.exporting=true;updateButtons();els.exportFormat.disabled=true;els.exportBtn.textContent='正在合成…';
  try{
    const format=els.exportFormat.value,sampleRate=44100;
    const ctx=new OfflineAudioContext(2,Math.ceil(duration*sampleRate),sampleRate);
    const destination=eqInput(ctx,ctx.destination);
    for(const {clip} of audibleClips())if(clip.start<to&&clip.start+clip.duration>from)scheduleClip(ctx,clip,from,0,destination);
    const rendered=await ctx.startRendering();
    const blob=format==='mp3'?await encodeMp3(rendered):encodeWav(rendered);
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    const suffix=range?`_第${Math.floor(range.from/4)+1}小节${range.from%4+1}拍-第${Math.floor(range.to/4)+1}小节${range.to%4+1}拍`:'';
    a.href=url;a.download=`${(els.projectName.value||'我的歌曲').replace(/[\\/:*?"<>|]/g,'_')}${suffix}.${format}`;
    document.body.append(a);a.click();a.remove();
    setTimeout(()=>URL.revokeObjectURL(url),60000);
    toast(`合成完成，${range?'选区 ':''}${format.toUpperCase()} 文件已开始下载`);
  }catch(error){console.error(error);toast('合成失败，请缩短音频或减少音轨后重试');}
  finally{state.exporting=false;els.exportFormat.disabled=false;els.exportBtn.innerHTML='<span aria-hidden="true">↗</span> 合成并下载';updateButtons();}
}
function updateEq(){const db=Number(els.drumLevel.value);els.drumValue.textContent=`+${db.toFixed(1)} dB`;if(state.eqFilter)state.eqFilter.gain.setTargetAtTime(els.drumToggle.checked?db:0,state.audio.currentTime,.02);}
window.addEventListener('wheel',event=>{
  if(!event.ctrlKey||els.helpDialog.open)return;
  event.preventDefault();
  const oldScale=pxSecond(),oldScroll=els.timelineScroll.scrollLeft;
  const rect=els.timelineScroll.getBoundingClientRect();
  const anchorX=Math.max(0,Math.min(rect.width,event.clientX-rect.left));
  const anchorTime=(oldScroll+anchorX)/oldScale;
  const direction=Math.sign(event.deltaY);
  if(!direction)return;
  const next=Math.max(.2,Math.min(1.8,Math.round((state.zoom-direction*.05)*20)/20));
  if(next===state.zoom)return;
  state.zoom=next;els.zoomInput.value=String(next);
  els.zoomValue.textContent=`${Math.round(next*100)}%`;
  render();els.timelineScroll.scrollLeft=Math.max(0,anchorTime*pxSecond()-anchorX);
},{passive:false});
els.uploadBtn.onclick=()=>els.fileInput.click();els.fileInput.onchange=e=>addFiles(e.target.files);els.linkImportBtn.onclick=()=>{if(state.tracks.every(track=>track.clips.length)){showTracksFull();return;}els.linkImportStatus.textContent='';els.linkImportDialog.showModal();};els.closeLinkImportBtn.onclick=()=>els.linkImportDialog.close();els.linkImportForm.onsubmit=importLink;els.closeTracksFullBtn.onclick=els.confirmTracksFullBtn.onclick=()=>els.tracksFullDialog.close();els.demoBtn.onclick=addDemo;els.playBtn.onclick=play;els.stopBtn.onclick=()=>stop();els.splitBtn.onclick=split;els.duplicateBtn.onclick=duplicate;els.extendBtn.onclick=extend;els.deleteBtn.onclick=removeSelected;els.undoBtn.onclick=restoreUndo;els.exportBtn.onclick=exportMix;els.helpBtn.onclick=()=>els.helpDialog.showModal();els.closeHelpBtn.onclick=()=>els.helpDialog.close();els.bpmInput.onchange=()=>{state.bpm=Math.max(50,Math.min(220,Number(els.bpmInput.value)||120));els.bpmInput.value=state.bpm;stop(false);render();toast('节拍网格已更新');};els.zoomInput.oninput=()=>{state.zoom=Number(els.zoomInput.value);els.zoomValue.textContent=`${Math.round(state.zoom*100)}%`;render();};els.drumLevel.oninput=updateEq;els.drumToggle.onchange=()=>{updateEq();toast(els.drumToggle.checked?'低频 EQ 已开启':'低频 EQ 已关闭');};els.timelineContent.addEventListener('pointerdown',e=>{if(e.target.closest('.clip'))return;const rect=els.timelineContent.getBoundingClientRect();setPlayhead(snap((e.clientX-rect.left)/pxSecond()),true);});window.addEventListener('keydown',e=>{if(e.target instanceof HTMLInputElement||e.target instanceof HTMLTextAreaElement||els.helpDialog.open||els.linkImportDialog.open||els.tracksFullDialog.open)return;if(e.code==='Space'){e.preventDefault();play();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='e'){e.preventDefault();split();}else if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();restoreUndo();}else if(e.key==='Delete'||e.key==='Backspace'){e.preventDefault();removeSelected();}});window.addEventListener('dragover',e=>{if(e.dataTransfer?.types.includes('Files'))e.preventDefault();});window.addEventListener('drop',e=>{if(e.dataTransfer?.files.length){e.preventDefault();addFiles(e.dataTransfer.files);}});window.addEventListener('resize',()=>render());render();
els.alignBtn.onclick=()=>alignSelected();

// Expose a few existing editor actions to browsers that support WebMCP.
if(document.modelContext?.registerTool){
  const register=(tool)=>{try{Promise.resolve(document.modelContext.registerTool(tool)).catch(console.warn);}catch(error){console.warn(error);}};
  register({name:'get_editor_state',title:'读取编辑状态',description:'读取当前节拍、音轨、静音独奏状态、片段与播放位置。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:true},execute(){return {bpm:state.bpm,playheadSeconds:state.playhead,eqEnabled:els.drumToggle.checked,eqGainDb:Number(els.drumLevel.value),tracks:state.tracks.map(t=>({name:t.name,muted:t.muted,solo:t.solo,clips:t.clips.map(c=>({id:c.id,startSeconds:c.start,durationSeconds:c.duration}))}))};}});
  register({name:'set_editor_tempo',title:'设置节拍速度',description:'设置编辑器的 BPM，并更新可见的四四拍时间网格。',inputSchema:{type:'object',properties:{bpm:{type:'integer',minimum:50,maximum:220}},required:['bpm'],additionalProperties:false},annotations:{readOnlyHint:false},execute(input){if(!Number.isInteger(input?.bpm)||input.bpm<50||input.bpm>220)throw new Error('BPM 必须为 50 到 220 的整数');state.bpm=input.bpm;els.bpmInput.value=input.bpm;stop(false);render();return {bpm:state.bpm};}});
  register({name:'split_selected_clip',title:'切开所选片段',description:'在当前播放位置切开已选中的音频片段。',inputSchema:{type:'object',properties:{},additionalProperties:false},annotations:{readOnlyHint:false},execute(){const pair=selected();if(!pair||state.playhead<=pair.clip.start+.03||state.playhead>=pair.clip.start+pair.clip.duration-.03)throw new Error('请先选中片段，并把播放位置放在片段内部');split();return {clipCount:allClips().length,playheadSeconds:state.playhead};}});
}
