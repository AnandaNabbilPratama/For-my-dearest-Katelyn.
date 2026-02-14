
/* Heart Chaser v4.6 — Local BGM + Auto-ON + Decoy Popup + Sparks */

// ---------- DOM ----------
const viewport     = document.getElementById('viewport');
const claw         = document.getElementById('claw');
const rod          = document.getElementById('rod');
const head         = document.getElementById('head');
const armL         = head.querySelector('.arm.left');
const armR         = head.querySelector('.arm.right');
const slot         = document.getElementById('slot');
const trackHandle  = document.getElementById('track-handle');
const heartsLayer  = document.getElementById('hearts');

const btnLeft      = document.getElementById('btn-left');
const btnRight     = document.getElementById('btn-right');
const btnDrop      = document.getElementById('btn-drop');
const btnSeize     = document.getElementById('btn-seize');

const statusMsg    = document.getElementById('status-msg');
const attemptsEl   = document.getElementById('attempt-count');

const modalOverlay = document.getElementById('modal-overlay');
const btnPlayAgain = document.getElementById('btn-play-again');
const btnClose     = document.getElementById('btn-close');

const confettiLayer= document.getElementById('confetti');
// Letter overlay DOM
const letterOverlay   = document.getElementById('letter-overlay');
const envelopeView    = document.getElementById('envelope-view');
const paperView       = document.getElementById('paper-view');
const btnOpenEnvelope = document.getElementById('btn-open-envelope');
const btnPaperClose   = document.getElementById('btn-paper-close');
btnOpenEnvelope?.addEventListener('click', () => {
  // animasi buka amplop → ganti ke paper
  envelopeView.classList.add('open');
  // jeda sedikit biar flap sempat berputar
  setTimeout(() => {
    // sembunyikan envelope, tampilkan paper
    envelopeView.classList.add('hidden');
    paperView.classList.remove('hidden');
    // trigger animasi muncul
    requestAnimationFrame(() => paperView.classList.add('show'));
  }, 520);
});

btnPaperClose?.addEventListener('click', () => {
  // tutup overlay
  closeLetterOverlay();
  // reset state agar kalau dibuka lagi tetap dari awal
  envelopeView.classList.remove('hidden', 'open');
  paperView.classList.remove('show');
});

// Helpers
function openLetterOverlay(){
  // tampilkan overlay + amplop tertutup
  letterOverlay.classList.remove('letter-hidden');
  envelopeView.classList.remove('open');        // pastikan tertutup
  paperView.classList.add('hidden');            // sembunyikan paper
}

function closeLetterOverlay(){
  letterOverlay.classList.add('letter-hidden');
}

// Music controls (local file)
const musicToggle  = document.getElementById('music-toggle');
const musicLabel   = document.getElementById('music-label');
const filePicker   = document.getElementById('music-file');
const bgm          = document.getElementById('bgm');

// Popup (decoy)
const decoyPopup   = document.getElementById('decoy-popup');
const decoyMsgEl   = document.getElementById('decoy-msg');
const toastClose   = document.getElementById('toast-close');

// ---------- State ----------
let attempts   = 0;
let busy       = false;
let pos        = 0.5;  // 0..1
let rodHeight  = 60;   // px
let capturedBox= null;

let audioCtx   = null; // AudioContext
let musicOn    = false;
let bgmSource  = null; // MediaElementSource
let musicGain  = null; // GainNode

const DEBUG_ON = new URLSearchParams(location.search).get('debug') === '1';

// ---------- Config ----------
const CFG = {
  moveStep:        0.06,
  rodMin:          60,
  dropSpeed:       10,
  downBottomFrac:  0.86,
  slotTargetFrac:  0.18,
  boxPad:          10,
  autoRadiusScale: 0.6,
  decoyCount:      6,
  decoyColors: ['#ffc2d1','#ffd5b8','#d9c2ff','#ff8aa0','#ffd66b','#9ad0ec','#f7b2d9','#c7f2a7'],
};

// ---------- Utils ----------
const clamp  = (n,a,b)=> Math.max(a, Math.min(b, n));
const rand   = (min,max)=> Math.random()*(max-min)+min;
const randInt= (min,max)=> Math.floor(rand(min,max));
const vpRect = ()=> viewport.getBoundingClientRect();
const dpi    = window.devicePixelRatio || 1;

function setClawXByFraction(fr){
  pos = clamp(fr, 0.05, 0.95);
  const rect = vpRect();
  claw.style.left = (pos * rect.width) + 'px';
  trackHandle.style.left = `calc(${(pos*100).toFixed(2)}% - -2px)`; // fixed offset
}
function setRodHeight(h){
  rodHeight = Math.max(CFG.rodMin, h);
  rod.style.height = rodHeight + 'px';
  head.style.top   = rodHeight + 'px';
}

function makeHeartBox(type='decoy'){
  const box = document.createElement('div');
  box.className = `heartBox ${type}`;
  box.dataset.type = type;
  box.innerHTML = `
    <svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M50 86 L16 54 Q6 44 6 30 Q6 18 14 10 Q22 2 34 2 Q44 2 52 9 Q60 2 70 2 Q82 2 90 10 Q98 18 98 30 Q98 44 88 54 L50 86 Z" />
    </svg>`;
  return box;
}
function placeHeart(box, x, y){
  const rect = vpRect();
  box.style.left = (x - rect.left - 27) + 'px';
  box.style.top  = (y - rect.top  - 27) + 'px';
}

function setupHearts(){
  heartsLayer.innerHTML = '';
  const rect = vpRect();
  const target = makeHeartBox('target'); heartsLayer.appendChild(target);
  placeHeart(target, rect.left + rand(80, rect.width - 80), rect.top + rect.height*0.62);
  for(let i=0;i<CFG.decoyCount;i++){
    const d = makeHeartBox('decoy');
    d.style.setProperty('--fill', CFG.decoyColors[randInt(0, CFG.decoyColors.length)]);
    heartsLayer.appendChild(d);
    const dx = rect.left + rand(70, rect.width - 70);
    const dy = rect.top  + rand(rect.height*0.50, rect.height*0.70);
    placeHeart(d, dx, dy);
  }
}

function getCenter(el){ const r = el.getBoundingClientRect(); return { x:r.left+r.width/2, y:r.top+r.height/2, w:r.width, h:r.height, rect:r }; }
function getClawTip(){ const hr = head.getBoundingClientRect(); return { x: hr.left + hr.width/2, y: hr.bottom + 20 }; }

// ---------- Audio (Web Audio + HTMLAudio) ----------
function ensureAudio(){
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state === 'suspended'){
    try{ audioCtx.resume(); }catch(_){ }
  }
}
async function ensureUserAudioReady(){
  if(!audioCtx) audioCtx = new (window.AudioContext||window.webkitAudioContext)();
  if(audioCtx.state === 'suspended'){
    try{ await audioCtx.resume(); }catch(_){ }
  }
}
function initBgmGraph(){
  ensureAudio();
  if(!bgmSource){
    try{ bgmSource = audioCtx.createMediaElementSource(bgm); }catch(e){ /* ignore */ }
  }
  if(!musicGain && bgmSource){
    musicGain = audioCtx.createGain();
    musicGain.gain.value = 0.0001;
    bgmSource.connect(musicGain).connect(audioCtx.destination);
  }
}
function waitForBgmCanPlayThrough(){
  return new Promise((resolve, reject)=>{
    const onReady=()=>{cleanup(); resolve();};
    const onErr  =()=>{cleanup(); reject(new Error('bgm load error'));};
    const cleanup=()=>{
      bgm.removeEventListener('canplaythrough', onReady);
      bgm.removeEventListener('error', onErr);
    };
    bgm.addEventListener('canplaythrough', onReady, { once:true });
    bgm.addEventListener('error', onErr, { once:true });
    if (bgm.readyState >= 3){ cleanup(); resolve(); }
  });
}

function playChime(success=false){
  ensureAudio();
  const now=audioCtx.currentTime; const seq=success?[659.25,783.99,987.77]:[392.00,329.63];
  seq.forEach((f,i)=>{
    const o=audioCtx.createOscillator(); const g=audioCtx.createGain();
    o.type=success?'sine':'triangle'; o.frequency.value=f;
    g.gain.setValueAtTime(0.0001, now+i*0.04);
    g.gain.exponentialRampToValueAtTime(success?0.12:0.09, now+i*0.04+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now+i*0.04+0.28);
    o.connect(g).connect(audioCtx.destination);
    o.start(now+i*0.04); o.stop(now+i*0.04+0.34);
  });
}
function playDecoy(){
  ensureAudio(); const now=audioCtx.currentTime; const seq=[349.23, 311.13];
  seq.forEach((f,i)=>{
    const o=audioCtx.createOscillator(); const g=audioCtx.createGain();
    o.type='sine'; o.frequency.value=f;
    g.gain.setValueAtTime(0.0001, now+i*0.03);
    g.gain.exponentialRampToValueAtTime(0.08, now+i*0.03+0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, now+i*0.03+0.22);
    o.connect(g).connect(audioCtx.destination);
    o.start(now+i*0.03); o.stop(now+i*0.03+0.28);
  });
}

async function toggleMusic(){
  await ensureUserAudioReady();

  if(musicOn){
    try{
      const now = audioCtx.currentTime;
      if(musicGain){
        musicGain.gain.cancelScheduledValues(now);
        musicGain.gain.setValueAtTime(Math.max(0.0001, musicGain.gain.value), now);
        musicGain.gain.exponentialRampToValueAtTime(0.0001, now+0.4);
        setTimeout(()=> bgm.pause(), 420);
      } else { bgm.pause(); }
    }catch(_){ }
    musicOn=false; musicLabel.textContent='Off'; syncMusicButton();
    return;
  }

  initBgmGraph();
  try {
    await waitForBgmCanPlayThrough();
    await bgm.play();
    const now = audioCtx.currentTime;
    if(musicGain){
      musicGain.gain.setValueAtTime(0.0001, now);
      musicGain.gain.exponentialRampToValueAtTime(0.12, now+0.35);
    }
    musicOn=true; musicLabel.textContent='On'; syncMusicButton();
  } catch(e){
    try { filePicker.click(); } catch(_) {}
  }
}

filePicker.addEventListener('change', (e)=>{
  const f = e.target.files && e.target.files[0];
  if(!f) return;
  const url = URL.createObjectURL(f);
  bgm.src = url;
  initBgmGraph();
  bgm.play().then(()=>{
    const now = audioCtx.currentTime;
    if(musicGain){
      musicGain.gain.setValueAtTime(0.0001, now);
      musicGain.gain.exponentialRampToValueAtTime(0.12, now+0.35);
    }
    musicOn=true; musicLabel.textContent='On'; syncMusicButton();
  }).catch(()=>{
    showDecoyPopup && showDecoyPopup('Failed to play the selected music. Try another file.');
  });
});

musicToggle.addEventListener('click', toggleMusic);
musicToggle.addEventListener('keydown', (e)=>{ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); toggleMusic(); } });

function vibrate(ms){ if(navigator.vibrate){ try{navigator.vibrate(ms);}catch(_){}} }

// ---------- Collision ----------
function computeRadius(box){ const w = box.getBoundingClientRect().width; return Math.max(24, w * CFG.autoRadiusScale * dpi); }
function hitHeart(){ const tip = getClawTip(); const children = Array.from(heartsLayer.children); for(const box of children){ const c = getCenter(box); const r = computeRadius(box); const d = Math.hypot(c.x - tip.x, c.y - tip.y); const pad = CFG.boxPad; const inBox = tip.x >= c.rect.left - pad && tip.x <= c.rect.right + pad && tip.y >= c.rect.top - pad && tip.y <= c.rect.bottom + pad; if (d <= r || inBox){ return box; } } return null; }

// ---------- Popup (decoy) ----------
function showDecoyPopup(message){ if(decoyMsgEl && message) decoyMsgEl.textContent = message; decoyPopup?.classList.remove('hidden'); const onEsc=(e)=>{ if(e.key==='Escape'){ hideDecoyPopup(); window.removeEventListener('keydown',onEsc);} }; window.addEventListener('keydown', onEsc); clearTimeout(showDecoyPopup._t); showDecoyPopup._t = setTimeout(hideDecoyPopup, 1800); }
function hideDecoyPopup(){ decoyPopup?.classList.add('hidden'); }
toastClose?.addEventListener('click', hideDecoyPopup);
decoyPopup?.addEventListener('click', (e)=>{ if(e.target===decoyPopup) hideDecoyPopup(); });

// ---------- Animations ----------
function attachBox(box){ capturedBox = box; box.classList.add('capturedBox'); head.appendChild(box); box.style.left = '50%'; box.style.top = 'auto'; box.style.transform='translateX(-50%)'; head.classList.add('bump'); setTimeout(()=> head.classList.remove('bump'), 280); box.animate([{ transform:'translateX(-50%) rotate(0deg)' },{ transform:'translateX(-50%) rotate(3deg)' },{ transform:'translateX(-50%) rotate(0deg)' }], { duration: 380, easing:'ease-out' }); }

function spawnConfetti(count=28){ const r = vpRect(); const cx=r.left+r.width/2, cy=r.top+r.height/2; const glyphs=['❤','💖','💘','💝']; for(let i=0;i<count;i++){ const e=document.createElement('div'); e.className='confetti-heart'; e.textContent=glyphs[randInt(0,glyphs.length)]; e.style.left=(cx+rand(-60,60))+'px'; e.style.top=(cy+rand(-30,10))+'px'; e.style.setProperty('--x', rand(-40,40)+'px'); e.style.setProperty('--y', rand(-20,20)+'px'); e.style.setProperty('--dx', rand(-70,70)+'px'); confettiLayer.appendChild(e); setTimeout(()=> e.remove(), 1200); } }

function spawnSparksAtSlot(count=16){ const slotR = slot.getBoundingClientRect(); const vp = viewport.getBoundingClientRect(); const cx = slotR.left + slotR.width/2 - vp.left; const cy = slotR.top + 6 - vp.top; for(let i=0;i<count;i++){ const s=document.createElement('div'); s.className='spark'; s.style.left=cx+'px'; s.style.top=cy+'px'; const ang=Math.random()*2*Math.PI, dist=16+Math.random()*18; s.style.setProperty('--dx', Math.cos(ang)*dist+'px'); s.style.setProperty('--dy', Math.sin(ang)*dist+'px'); viewport.appendChild(s); setTimeout(()=> s.remove(), 560); } }

// ---------- Modal ----------
function openModal(){ modalOverlay.classList.remove('hidden'); }
function closeModal(){ modalOverlay.classList.add('hidden'); }
btnPlayAgain.addEventListener('click', ()=>{ closeModal(); resetRound(); });
btnClose.addEventListener('click', ()=> closeModal());

// ---------- Game Flow ----------
function animateDrop(){ if(busy) return; busy=true; statusMsg.textContent=''; attemptsEl.textContent=(++attempts); const vp = vpRect(); const maxRod = vp.height * CFG.downBottomFrac; let h = CFG.rodMin; capturedBox = null; claw.classList.remove('grab'); const down = ()=>{ h += CFG.dropSpeed; setRodHeight(h); const box = hitHeart(); if(box){ claw.classList.add('grab'); attachBox(box); vibrate(80); if (box.dataset.type === 'target') { playChime(true); retractThenCarryToSlot(); } else { playDecoy(); showDecoyPopup('This is not the correct heart, try again to find his heart!'); box.animate([{ opacity:1, transform:'translateX(-50%) scale(1)' }, { opacity:0, transform:'translateX(-50%) scale(0.85)' }], { duration:480, easing:'ease-out' }); setTimeout(()=>{ try{ box.remove(); }catch(_){ } capturedBox = null; }, 500); retractOnly(); } return; } if(h < maxRod){ requestAnimationFrame(down); } else { claw.classList.add('grab'); statusMsg.textContent='Try again, my love 💔'; vibrate(40); retractOnly(); } }; requestAnimationFrame(down); }

function retractOnly(){ const up=()=>{ if(rodHeight>CFG.rodMin){ setRodHeight(rodHeight-CFG.dropSpeed); requestAnimationFrame(up);} else { busy=false; claw.classList.remove('grab'); } }; requestAnimationFrame(up); }
function retractThenCarryToSlot(){ const up=()=>{ if(rodHeight>CFG.rodMin){ setRodHeight(rodHeight-CFG.dropSpeed); requestAnimationFrame(up);} else { const target=CFG.slotTargetFrac; const dir= pos<target?1:-1; const move=()=>{ if(Math.abs(pos-target)>0.006){ setClawXByFraction(pos+dir*0.02); requestAnimationFrame(move);} else { setClawXByFraction(target); dropIntoSlot(); } }; requestAnimationFrame(move); } }; requestAnimationFrame(up); }
function dropIntoSlot(){ const slotR = slot.getBoundingClientRect(); const vp = vpRect(); const dropDepth = 42; const targetH = CFG.rodMin + dropDepth; const down=()=>{ if(rodHeight<targetH){ setRodHeight(rodHeight+CFG.dropSpeed); requestAnimationFrame(down);} else { if(capturedBox){ viewport.appendChild(capturedBox); capturedBox.classList.remove('capturedBox'); capturedBox.style.position='absolute'; capturedBox.style.left=(slotR.left+slotR.width/2 - vp.left - 24)+'px'; capturedBox.style.top=(slotR.top - vp.top - 20)+'px'; capturedBox.style.transform='translate(0,0)'; capturedBox.animate([{ transform:'translateY(0)', opacity:1 },{ transform:'translateY(14px)', opacity:0 }], { duration:420, easing:'ease-in' }); setTimeout(()=>{ capturedBox.remove(); spawnSparksAtSlot(); win(); }, 420); } else { win(); } } }; requestAnimationFrame(down); }
function win(){ spawnConfetti(); vibrate(100); setTimeout(()=> openModal(), 380); }

// ---------- Controls ----------
function moveLeft(){ if(busy) return; setClawXByFraction(pos - CFG.moveStep); }
function moveRight(){ if(busy) return; setClawXByFraction(pos + CFG.moveStep); }
btnLeft.addEventListener('click', moveLeft); btnRight.addEventListener('click', moveRight); btnDrop.addEventListener('click', animateDrop); btnSeize.addEventListener('click', animateDrop);
window.addEventListener('keydown', (e)=>{ const k=e.key.toLowerCase(); if(k==='arrowleft'||k==='a') moveLeft(); else if(k==='arrowright'||k==='d') moveRight(); else if(k===' '||e.code==='Space'||k==='enter') animateDrop(); });

// ---------- Sync UI ----------
function syncMusicButton(){ const isOn = (musicLabel?.textContent?.trim().toLowerCase()==='on'); musicToggle.setAttribute('aria-pressed', isOn ? 'true' : 'false'); }

// ---------- Auto-ON after first user interaction (global) ----------
let __autoMusicArmed = true;
function __enableMusicAfterInteraction(){
  if(!__autoMusicArmed) return;
  __autoMusicArmed = false;
  try{ if(!musicOn) toggleMusic(); }catch(_){ }
  window.removeEventListener('click', __enableMusicAfterInteraction);
  window.removeEventListener('touchstart', __enableMusicAfterInteraction);
}
window.addEventListener('click', __enableMusicAfterInteraction, { once:false });
window.addEventListener('touchstart', __enableMusicAfterInteraction, { once:false });

// ---------- Round reset ----------
function resetRound(){ setupHearts(); setClawXByFraction(0.5); setRodHeight(CFG.rodMin); statusMsg.textContent=''; syncMusicButton(); }
window.addEventListener('resize', ()=>{ setClawXByFraction(pos); setupHearts(); });

// ---------- Init ----------
resetRound();
