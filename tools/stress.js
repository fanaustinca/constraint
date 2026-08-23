/* Stress harness. Everything is driven by a seeded PRNG — including the game's
   own Math.random — so any failure it reports replays exactly:

     node tools/stress.js                 # all phases, seed 1
     node tools/stress.js --seed 7        # a different run
     node tools/stress.js --only fuzz     # one phase
     node tools/stress.js --deep          # longer fuzzing

   Phases: load, fuzz, ui, codes, ghosts, daily, ranking, save, builder.       */
const fs=require('fs'), vm=require('vm'), path=require('path');

const argv=process.argv.slice(2);
const arg=(k,d)=>{ const i=argv.indexOf(k); return i>=0? argv[i+1] : d; };
const SEED=+arg('--seed',1), ONLY=arg('--only',null), DEEP=argv.includes('--deep');
const TARGET=arg('--file', null);

/* ---------- seeded RNG, shared with the game ---------- */
function mulberry(a){ return ()=>{ a|=0; a=a+0x6D2B79F5|0;
  let t=Math.imul(a^a>>>15,1|a); t=t+Math.imul(t^t>>>7,61|t)^t;
  return ((t^t>>>14)>>>0)/4294967296; }; }
let rng=mulberry(SEED);
const rnd=()=>rng();
const ri=n=>Math.floor(rnd()*n);
const pick=a=>a[ri(a.length)];

/* ---------- sandbox ---------- */
const noop=()=>{};
const ctxProxy=new Proxy({},{get:(t,k)=>{
  if(k==='canvas') return {width:0,height:0};
  if(k==='roundRect') return undefined;
  if(k==='setTransform') return noop;
  if(k==='createPattern') return ()=>({});
  return t[k]!==undefined?t[k]:noop; }, set:()=>true});
const cache={};
function el(id){ return { id, _l:{},
  classList:{ _s:new Set(), add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
    toggle(c,on){ on===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c)):(on?this._s.add(c):this._s.delete(c)); },
    contains(c){return this._s.has(c)} },
  style:{}, innerHTML:'', textContent:'', value:'', disabled:false, width:0, height:0,
  appendChild:noop, addEventListener(t,f){ (this._l[t]=this._l[t]||[]).push(f); },
  removeEventListener:noop, select:noop, blur:noop, focus:noop,
  getBoundingClientRect:()=>({left:0,top:0,right:768,bottom:432,width:768,height:432}),
  querySelectorAll:()=>[], getContext:()=>ctxProxy, onclick:null }; }

const store={};
const sandboxMath=Object.create(Math);
sandboxMath.random=()=>rng();
const listeners={};
const sandbox={ console,
  document:{ getElementById:id=>cache[id]||(cache[id]=el(id)),
    createElement:()=>el('new'), querySelectorAll:()=>[], querySelector:()=>null,
    addEventListener:(t,f)=>{(listeners[t]=listeners[t]||[]).push(f);}, body:el('body'), hidden:false },
  window:{ devicePixelRatio:1, AudioContext:null },
  addEventListener:(t,f)=>{(listeners[t]=listeners[t]||[]).push(f);}, removeEventListener:noop,
  matchMedia:()=>({matches:false, addEventListener:noop}),
  devicePixelRatio:1, requestAnimationFrame:()=>0, performance:{now:()=>0},
  setTimeout:()=>0, clearTimeout:noop,
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
  Math:sandboxMath, Date, JSON, Array, Object, String, Number, Proxy, Set, Map, RegExp,
  Error, Promise, isFinite, isNaN, parseInt, parseFloat };
sandbox.window.AudioContext=function(){ throw new Error('no audio'); };
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
const srcFile = TARGET ? path.join(__dirname,'..',TARGET) : path.join(__dirname,'..','build','game.js');
let src=fs.readFileSync(srcFile,'utf8');
if(TARGET) src=src.slice(src.indexOf('<script>')+8, src.lastIndexOf('</script>'));
vm.runInContext(src,sandbox,{filename:'game'});
const run=c=>vm.runInContext(c,sandbox);
const S=sandbox;

/* ---------- reporting ---------- */
const fireKey=()=>(listeners['keydown']||[]).forEach(f=>f(
  {code:'Space',key:' ',repeat:false,target:{},preventDefault(){},stopPropagation(){}}));
const fireTap=()=>{ const c=cache['c']; if(c&&c._l.pointerdown) c._l.pointerdown.forEach(f=>f({preventDefault(){}})); };

const found=[];
let checks=0;
function bug(phase, what, detail){
  found.push({phase,what,detail});
  console.log('  BUG  ['+phase+'] '+what+(detail?'\n         '+detail:''));
}
function ok(phase,what){ checks++; }
function head(t){ console.log('\n'+t); }

/* ---------- shared invariant check ---------- */
run(`
const STATES=['menu','play','pause','done','edit','cut','boot','rank','intro'];
function _inv(){
  const b=[];
  if(!isFinite(P.x)||!isFinite(P.y)) b.push('player position not finite: '+P.x+','+P.y);
  if(!isFinite(P.vx)||!isFinite(P.vy)) b.push('player velocity not finite: '+P.vx+','+P.vy);
  if(!isFinite(G.cam)) b.push('camera not finite: '+G.cam);
  if(!isFinite(G.time)||G.time<0) b.push('clock not sane: '+G.time);
  if(STATES.indexOf(G.state)<0) b.push('unknown state: '+G.state);
  if(G.parts>G.partsTotal) b.push('parts '+G.parts+' of '+G.partsTotal);
  if(G.deaths<0) b.push('negative deaths');
  if(G.fx.length>4000) b.push('fx runaway: '+G.fx.length);
  if(G.trail.length>400) b.push('trail runaway: '+G.trail.length);
  if(G.grid.length!==ROWS) b.push('grid lost rows: '+G.grid.length);
  for(const m of G.movers) if(!isFinite(m.x)||!isFinite(m.y)) { b.push('mover not finite'); break; }
  for(const s of G.saws)   if(!isFinite(s.x)||!isFinite(s.y)) { b.push('saw not finite'); break; }
  return b;
}`);
const inv=()=>run('_inv()');

module.exports={};

/* ================= phase: load ================= */
function phaseLoad(){
  head('load — every sheet, interlude, theme and a year of dailies');
  const N=run('LEVELS.length');
  for(let i=0;i<N;i++){
    let e=null;
    try{ run(`loadLevel(${i})`); }catch(err){ e=err.message; }
    if(e){ bug('load','sheet '+(i+1)+' throws on load', e); continue; }
    const r=run(`(()=>({spawn:!!G.spawn, exit:!!G.exit, cols:COLS, rows:G.grid.length,
      w:G.grid.every(r=>r.length===COLS), gems:G.gems.length, tot:G.partsTotal,
      finite:isFinite(G.exit.x)&&isFinite(G.exit.y)&&isFinite(G.spawn.x)&&isFinite(G.spawn.y),
      badcheck:G.checks.some(c=>!isFinite(c.sx)||!isFinite(c.sy)),
      portpairs:(G.portPairs||[]).length, porta:G.portA.length, portb:G.portB.length}))()`);
    if(!r.spawn) bug('load','sheet '+(i+1)+' has no spawn');
    if(!r.exit)  bug('load','sheet '+(i+1)+' has no exit');
    if(!r.finite) bug('load','sheet '+(i+1)+' spawn/exit not finite');
    if(r.rows!==18) bug('load','sheet '+(i+1)+' has '+r.rows+' rows');
    if(!r.w) bug('load','sheet '+(i+1)+' has a ragged row');
    if(r.badcheck) bug('load','sheet '+(i+1)+' has a datum with a bad respawn');
    if(r.gems!==r.tot) bug('load','sheet '+(i+1)+' gem count disagrees with partsTotal');
    if(Math.min(r.porta,r.portb)>0 && r.portpairs===0) bug('load','sheet '+(i+1)+' has portals but no pairs');
    ok('load','sheet '+(i+1));
  }
  for(let c=1;c<=6;c++){
    try{ run(`(()=>{const at=[39,79,103,127,151,152][${c-1}]; loadLevel(at); startCut(${c});
      for(let f=0;f<4000;f++){ step(); if(G.state!=='cut') break; } })()`); }
    catch(err){ bug('load','interlude '+c+' throws', err.message); }
  }
  const themes=run('BTHEMES.map(t=>t.k)');
  for(const t of themes){
    try{
      run(`(()=>{ED.theme=${JSON.stringify(t)}; const d=gridFromLevel(0); loadCustom(d.g,d.cols);})()`);
      const b=inv(); if(b.length) bug('load','theme '+t+': '+b.join('; '));
    }catch(err){ bug('load','theme '+t+' throws on a custom sheet', err.message); }
  }
  for(let d=0;d<370;d+=(DEEP?1:7)){
    try{
      run(`(()=>{const k=new Date(Date.UTC(2026,0,1+${d})).toISOString().slice(0,10);
        loadLevel(makeDaily(k));})()`);
      const b=inv(); if(b.length) bug('load','daily +'+d+' day: '+b.join('; '));
    }catch(err){ bug('load','daily +'+d+' days throws', err.message); }
  }
}

/* ================= phase: fuzz ================= */
function phaseFuzz(){
  const N=run('LEVELS.length');
  const rounds=DEEP?N:120;
  head('fuzz — random input against '+rounds+' sheets, invariants checked every frame');
  const frames=DEEP?3000:1400;
  for(let r=0;r<rounds;r++){
    const lvl = DEEP? r : ri(N);
    try{ run(`G.state='play'; loadLevel(${lvl})`); }
    catch(e){ bug('fuzz','sheet '+(lvl+1)+' will not load', e.message); continue; }
    let broke=false;
    for(let f=0;f<frames && !broke;f++){
      run(`(()=>{
        if(P.dead) respawn();
        if(Math.random()<0.10){ IN.l=Math.random()<0.5?1:0; IN.r=IN.l?0:(Math.random()<0.5?1:0); }
        if(Math.random()<0.05) IN.d=Math.random()<0.5?1:0;
        if(Math.random()<0.10){ press('jump'); IN.jumpHeld=1; }
        if(Math.random()<0.06) IN.jumpHeld=0;
        if(Math.random()<0.04) IN.dashP=1;
        if(Math.random()<0.002) cutJump();
        step();
      })()`);
      if(f%40===0 || f===frames-1){
        const b=inv();
        if(b.length){ bug('fuzz','sheet '+(lvl+1)+' frame '+f+': '+b.join('; '),
                          'replay: node tools/stress.js --seed '+SEED+' --only fuzz'); broke=true; }
      }
      if(run("G.state==='done'")) break;
    }
    ok('fuzz','sheet '+(lvl+1));
  }
}

/* ================= phase: ui ================= */
function phaseUi(){
  head('ui — random clicks through every menu, '+(DEEP?4000:1500)+' of them');
  const ids=['btnPlay','btnLevels','btnHow','btnTest','btnDaily','btnBuild','btnBack','btnHowBack',
    'btnResume','btnRetry2','btnSkip','btnQuit','btnGiveUp','btnNext','btnRetry','btnList',
    'btnRankAgain','btnRankDone','btnWipe','bExit','bTest','bCompile','bPaste','bSave','bLoad',
    'bClear','bRemix','bWide-','bWide+','bSlot1','bSlot2','bSlot3','adGo','adNo'];
  run("G.state='menu'");
  const n=DEEP?4000:1500;
  for(let i=0;i<n;i++){
    const id=pick(ids);
    try{
      run(`(()=>{const e=document.getElementById(${JSON.stringify(id)});
        if(e&&typeof e.onclick==='function') e.onclick({preventDefault(){},stopPropagation(){}});})()`);
    }catch(e){
      bug('ui','clicking '+id+' throws from state '+run('G.state'), e.message+'  (seed '+SEED+', click '+i+')');
      run("G.state='menu'");
      continue;
    }
    if(rnd()<0.3){ try{ run('step()'); }catch(e){ bug('ui','step() throws after '+id, e.message); } }
    const b=inv();
    if(b.length){ bug('ui','after clicking '+id+': '+b.join('; ')); run("G.state='menu'; loadLevel(0)"); }
    ok('ui',id);
  }
}

/* ================= phase: codes ================= */
function phaseCodes(){
  head('codes — round trip, mutation, and garbage');
  const N=run('LEVELS.length');
  for(let i=0;i<N;i+=(DEEP?1:11)){
    const r=run(`(()=>{const d=gridFromLevel(${i}); if(!d) return 'no grid';
      const c=encodeGrid(d.g,d.cols,'winter'); const b=decodeGrid(c);
      if(!b) return 'refused its own code';
      if(b.cols!==d.cols) return 'cols '+b.cols+' != '+d.cols;
      if(b.theme!=='winter') return 'theme lost';
      for(let y=0;y<ROWS;y++) for(let x=0;x<d.cols;x++) if(b.g[y][x]!==d.g[y][x]) return 'tile changed at '+x+','+y;
      return 'ok';})()`);
    if(r!=='ok') bug('codes','sheet '+(i+1)+' round trip: '+r);
  }
  const valid=run(`encodeGrid(blankGrid(64),64,'code')`);
  const alphabet='#SI=~^vBGWTtKDonwCpqPX.0123456789ABZ<>{}$\\u0000\\uffff \\n,';
  let crashes=0, accepted=0;
  const tries=DEEP?60000:15000;
  for(let i=0;i<tries;i++){
    let s;
    const mode=ri(4);
    if(mode===0){ let t=''; const n=ri(80); for(let j=0;j<n;j++) t+=pick(alphabet.split('')); s=t; }
    else if(mode===1){ s='CS2.'+ri(4000)+'.'+pick(['code','winter','','x'.repeat(ri(30))])+'.'+
        Array.from({length:ri(60)},()=>pick(alphabet.split(''))).join(''); }
    else if(mode===2){ const a=valid.split(''); for(let k=0;k<1+ri(4);k++) a[ri(a.length)]=pick(alphabet.split('')); s=a.join(''); }
    else { s=valid.slice(0, ri(valid.length)); }
    let out;
    try{ out=run('decodeGrid('+JSON.stringify(s)+')'); }
    catch(e){ crashes++; if(crashes<4) bug('codes','decodeGrid throws on '+JSON.stringify(s.slice(0,40)), e.message); continue; }
    if(out){
      accepted++;
      const shape=run(`(()=>{const d=decodeGrid(${JSON.stringify(s)});
        if(d.g.length!==ROWS) return 'rows';
        if(!d.g.every(r=>r.length===d.cols)) return 'ragged';
        if(!BTHEMES.some(t=>t.k===d.theme)) return 'unknown theme '+d.theme;
        if(!(d.cols>=32&&d.cols<=1088)) return 'cols';
        return 'ok';})()`);
      if(shape!=='ok') bug('codes','accepted a malformed code ('+shape+'): '+JSON.stringify(s.slice(0,50)));
      /* and it must be loadable */
      try{ run(`(()=>{const d=decodeGrid(${JSON.stringify(s)}); ED.theme=d.theme; loadCustom(d.g,d.cols);})()`); }
      catch(e){ bug('codes','a code decoded but would not load', e.message); }
    }
  }
  console.log('       '+tries+' hostile codes, '+accepted+' accepted, '+crashes+' crashes');
}

/* ================= phase: ghosts ================= */
function phaseGhosts(){
  head('ghosts — record, encode, replay');
  const r=run(`(()=>{
    const a=[]; let x=100,y=100;
    for(let i=0;i<1500;i++){ x+=Math.round((Math.random()-.5)*40); y+=Math.round((Math.random()-.5)*40);
      a.push([x,y]); }
    const enc=encGhost(a); const dec=decGhost(enc);
    if(!dec) return 'decode returned nothing';
    if(dec.length!==a.length) return 'length '+dec.length+' != '+a.length;
    for(let i=0;i<a.length;i++) if(dec[i][0]!==a[i][0]||dec[i][1]!==a[i][1]) return 'sample '+i+' differs';
    return 'ok';})()`);
  if(r!=='ok') bug('ghosts','round trip: '+r);
  for(const junk of ['','.',',','...','1.','.1','zz.zz','9'.repeat(400),'-1.-1','a'.repeat(50000)]){
    try{ const g=run('decGhost('+JSON.stringify(junk)+')');
      if(g && g.some(p=>!isFinite(p[0])||!isFinite(p[1]))) bug('ghosts','decoded a non-finite sample from '+JSON.stringify(junk.slice(0,20)));
    }catch(e){ bug('ghosts','decGhost throws on '+JSON.stringify(junk.slice(0,20)), e.message); }
  }
  const cap=run(`(()=>{ SAVE.ghosts={};
    for(let i=0;i<200;i++){ SAVE.ghosts['L'+i]={t:999,d:'1.1'}; }
    G.lvl=0; G.rec=[[0,0],[1,1],[2,2],[3,3],[4,4]]; G.time=1; saveGhost();
    return Object.keys(SAVE.ghosts).length; })()`);
  if(cap>run('GHOST_MAX')+1) bug('ghosts','writing a ghost does not trim the store: '+cap+' entries');
  const capLoad=run(`(()=>{ const o={}; for(let i=0;i<200;i++) o['L'+i]={t:i,d:'1.1'};
    localStorage.setItem(SKEY, JSON.stringify({ghosts:o})); loadSave();
    return Object.keys(SAVE.ghosts).length; })()`);
  if(capLoad>run('GHOST_MAX')) bug('ghosts','loading does not trim an oversized store: '+capLoad+' entries');
  /* every route back to the start of a sheet, at every kind of index */
  for(const setup of ["playDaily()","(()=>{ED.grid=blankGrid(64);ED.cols=64;loadCustom(ED.grid,64)})()","loadLevel(0)"]){
    for(const act of ['(()=>{G.state="play";restart()})()','reloadSheet()','skipLevel()']){
      try{ run(setup); run(act); }
      catch(e){ bug('ghosts','restart path '+act+' throws after '+setup, e.message); }
    }
  }
}

/* ================= phase: daily ================= */
function phaseDaily(){
  head('daily — determinism and tiers');
  const same=run(`(()=>{const k='2026-05-05';
    const a=makeDaily(k), b=makeDaily(k);
    return JSON.stringify(a.chunks)===JSON.stringify(b.chunks) && a.w===b.w;})()`);
  if(!same) bug('daily','the same date builds two different sheets');
  const diff=run(`(()=>{const a=makeDaily('2026-05-05'), b=makeDaily('2026-05-06');
    return JSON.stringify(a.chunks)!==JSON.stringify(b.chunks);})()`);
  if(!diff) bug('daily','two dates build the same sheet');
  const tiers=new Set();
  for(let d=0;d<120;d++){
    const t=run(`(()=>{const k=new Date(Date.UTC(2026,0,1+${d})).toISOString().slice(0,10);
      const L=makeDaily(k); return L.chunks.length;})()`);
    tiers.add(t);
  }
  if(tiers.size<2) bug('daily','every day is the same length');
}

/* ================= phase: ranking ================= */
function phaseRanking(){
  head('ranking — the binary search always terminates and always places you');
  for(let t=0;t<(DEEP?300:80);t++){
    const r=run(`(()=>{
      startTest();
      let guard=0;
      while(TEST.on && guard++<400){
        G.state='play';
        if(Math.random()<0.5) { G.time=1+Math.random()*40; G.deaths=Math.floor(Math.random()*9); endTrial(false); }
        else endTrial(true);
      }
      if(guard>=400) return 'did not terminate';
      if(SAVE.rank===undefined||SAVE.rank===null) return 'no rank';
      if(!(SAVE.rank>=1)) return 'rank '+SAVE.rank;
      if(!rankName(SAVE.rank-1)) return 'rank '+SAVE.rank+' has no name';
      return 'ok'; })()`);
    if(r!=='ok'){ bug('ranking',r,'seed '+SEED+' run '+t); break; }
  }
}

/* ================= phase: save ================= */
function phaseSave(){
  head('save — write, reload, and survive garbage');
  const r=run(`(()=>{
    SAVE.unlocked=123; SAVE.best[5]=9.99; SAVE.parts[5]=3; SAVE.skipped[7]=1;
    SAVE.cuts[2]=1; SAVE.rank=6; SAVE.mute=true; SAVE.unl.th.space=1; SAVE.unl.wr[2]=1;
    SAVE.builds={'1':encodeGrid(blankGrid(64),64,'code')};
    SAVE.ghosts={L3:{t:1.5,d:'1.1,2.2'}}; SAVE.daily={streak:3,time:5};
    save(); loadSave();
    const bad=[];
    if(SAVE.unlocked!==123) bad.push('unlocked '+SAVE.unlocked);
    if(SAVE.best[5]!==9.99) bad.push('best');
    if(SAVE.parts[5]!==3) bad.push('parts');
    if(SAVE.skipped[7]!==1) bad.push('skipped');
    if(SAVE.cuts[2]!==1) bad.push('cuts');
    if(SAVE.rank!==6) bad.push('rank');
    if(SAVE.mute!==true) bad.push('mute');
    if(SAVE.unl.th.space!==1) bad.push('theme');
    if(SAVE.unl.wr[2]!==1) bad.push('remix set');
    if(!SAVE.builds['1']) bad.push('build slot');
    if(!SAVE.ghosts.L3) bad.push('ghost');
    if(!SAVE.daily||SAVE.daily.streak!==3) bad.push('daily');
    return bad.length?bad.join(', '):'ok';})()`);
  if(r!=='ok') bug('save','a full save does not survive a reload: '+r);

  const junk=['','null','[]','0','"x"','{','{"unlocked":"x"}','{"best":[1,2]}','{"ghosts":5}',
    '{"unl":7}','{"builds":[1]}','{"daily":[]}','{"__proto__":{"dev":1}}','{"parts":{"a":"b"}}'];
  for(const j of junk){
    S.localStorage.setItem('constraint.save.v1', j);
    try{ run('loadSave()'); }
    catch(e){ bug('save','loadSave throws on '+j, e.message); continue; }
    const b=run(`(()=>{const b=[];
      if(typeof SAVE.unlocked!=='number'||!isFinite(SAVE.unlocked)) b.push('unlocked');
      if(typeof SAVE.best!=='object') b.push('best');
      if(typeof SAVE.unl!=='object'||typeof SAVE.unl.th!=='object') b.push('unl');
      if(SAVE.dev!==0&&SAVE.dev!==1) b.push('dev');
      if(({}).dev) b.push('Object.prototype polluted');
      return b.join(',');})()`);
    if(b) bug('save','after loading '+j+' these are wrong: '+b);
    try{ run('buildPicker(); paintThemes(); openBuild(); G.state="menu"'); }
    catch(e){ bug('save','the UI throws after loading '+j, e.message); }
  }
  S.localStorage.removeItem('constraint.save.v1'); run('loadSave()');

  const quota=run(`(()=>{ const real=localStorage.setItem;
    localStorage.setItem=()=>{ throw new Error('QuotaExceededError'); };
    let threw=false; try{ save(); }catch(e){ threw=true; }
    localStorage.setItem=real; return threw; })()`);
  if(quota) bug('save','a full localStorage throws out of save() instead of being swallowed');
}

/* ================= phase: builder ================= */
function phaseBuilder(){
  head('builder — resize, paint, and always exactly one spawn and one exit');
  const r=run(`(()=>{
    ED.grid=blankGrid(64); ED.cols=64;
    for(let i=0;i<400;i++){
      const w=[32,48,64,128,192,320,448,1088][Math.floor(Math.random()*8)];
      resizeGrid(w);
      let P=0,X=0;
      for(let y=0;y<ROWS;y++){ if(ED.grid[y].length!==ED.cols) return 'ragged after resize to '+w;
        for(let x=0;x<ED.cols;x++){ const c=ED.grid[y][x]; if(c==='P')P++; else if(c==='X')X++; } }
      if(P!==1) return 'spawns: '+P+' after resize to '+w;
      if(X!==1) return 'exits: '+X+' after resize to '+w;
    }
    return 'ok';})()`);
  if(r!=='ok') bug('builder','resize: '+r);

  /* drive the real paint path: clientX/Y map 1:1 onto world pixels through
     edTile(), so aiming at a cell means aiming at cx*TS - cam */
  const paint=run(`(()=>{
    ED.grid=blankGrid(96); ED.cols=96; G.cam=0;
    const before=JSON.stringify(ED.grid);
    for(let i=0;i<6000;i++){
      ED.tool=PALETTE[Math.floor(Math.random()*PALETTE.length)][0];
      G.cam=Math.floor(Math.random()*(ED.cols*TS-VW>0?ED.cols*TS-VW:1));
      const cx=Math.floor(Math.random()*(ED.cols+10))-5, cy=Math.floor(Math.random()*(ROWS+10))-5;
      edPaint({clientX:cx*TS-G.cam+2, clientY:cy*TS+2});
      if(ED.grid.length!==ROWS) return 'grid lost rows';
      if(!ED.grid.every(r=>r.length===ED.cols)) return 'grid went ragged';
      if(ED.tool==='P'||ED.tool==='X'){
        let n=0; for(let y=0;y<ROWS;y++) for(let x=0;x<ED.cols;x++) if(ED.grid[y][x]===ED.tool) n++;
        if(n>1) return 'painting '+ED.tool+' left '+n+' of them';
      }
    }
    /* and a click well outside the sheet must change nothing */
    const snap=JSON.stringify(ED.grid);
    ED.tool='#'; G.cam=0;
    edPaint({clientX:-9999, clientY:-9999}); edPaint({clientX:999999, clientY:999999});
    edPaint({clientX:NaN, clientY:NaN});
    if(JSON.stringify(ED.grid)!==snap) return 'a click outside the sheet edited it';
    return 'ok';})()`);
  if(paint!=='ok') bug('builder','paint: '+paint);

  const play=run(`(()=>{
    for(let t=0;t<40;t++){
      ED.grid=blankGrid(64); ED.cols=64;
      for(let i=0;i<500;i++){
        const ch=PALETTE[Math.floor(Math.random()*PALETTE.length)][0];
        const y=Math.floor(Math.random()*ROWS), x=Math.floor(Math.random()*ED.cols);
        if(ch!=='P'&&ch!=='X') ED.grid[y][x]=ch;
      }
      ED.theme=BTHEMES[Math.floor(Math.random()*BTHEMES.length)].k;
      loadCustom(ED.grid,ED.cols);
      G.state='play';
      for(let f=0;f<400;f++){
        if(P.dead) respawn();
        IN.r=Math.random()<0.6?1:0; IN.l=IN.r?0:1;
        if(Math.random()<0.12) press('jump');
        if(Math.random()<0.05) IN.dashP=1;
        step();
        const b=_inv(); if(b.length) return 'sheet '+t+' frame '+f+': '+b.join('; ');
        if(G.state==='done') break;
      }
    }
    return 'ok';})()`);
  if(play!=='ok') bug('builder','a random painted sheet breaks: '+play);
}

/* ================= phase: cuts ================= */
function phaseCuts(){
  head('cuts — every interlude ends, by key and by tap, and waits if you do nothing');
  const AT=[39,79,103,127,151,152];
  for(let c=1;c<=6;c++){
    /* left alone it should hold on its last frame rather than run away */
    run(`SAVE.cuts={}; SAVE.unlocked=LEVELS.length; loadLevel(${AT[c-1]}); startCut(${c})`);
    let broke=false;
    for(let f=0;f<2600 && !broke;f++){
      run('step()');
      const b=inv(); if(b.length){ bug('cuts','interlude '+c+' frame '+f+': '+b.join('; ')); broke=true; }
    }
    if(!broke && run("G.state")!=='cut') bug('cuts','interlude '+c+' left on its own, before any input');

    /* and it must end for both a key and a tap */
    for(const [how,fire] of [['key',fireKey],['tap',fireTap]]){
      run(`SAVE.cuts={}; SAVE.unlocked=LEVELS.length; loadLevel(${AT[c-1]}); startCut(${c})`);
      let f=0, left=false;
      for(; f<6000; f++){
        run('step()');
        if(f%7===0) fire();
        const b=inv(); if(b.length){ bug('cuts','interlude '+c+' ('+how+') frame '+f+': '+b.join('; ')); left=true; break; }
        if(run("G.state")!=='cut'){ left=true; break; }
      }
      if(!left) bug('cuts','interlude '+c+' never ends on '+how);
      else {
        const st=run('G.state');
        /* 'intro' is a legitimate landing: the sheet an interlude opens onto may
           introduce something, and the card holds the clock until it is closed */
        if(['menu','play','done','intro'].indexOf(st)<0) bug('cuts','interlude '+c+' ('+how+') ended in state '+st);
        if(st==='intro'){ run('closeIntro()');
          if(run('G.state')!=='play') bug('cuts','interlude '+c+' ('+how+'): closing the card did not start the sheet'); }
      }
      ok('cuts','interlude '+c+' by '+how);
    }
  }
}

/* ================= phase: spawnsafe ================= */
function phaseSpawnsafe(){
  head('spawnsafe — no start and no datum may drop you onto something that kills you');
  const N=run('LEVELS.length');
  for(let i=0;i<N;i++){
    const r=run(`(()=>{
      loadLevel(${i}); G.state='play';
      const at=[{x:G.spawn.x,y:G.spawn.y,what:'the start'}];
      for(const c of G.checks) at.push({x:c.sx,y:c.sy,what:'a datum at column '+Math.round(c.sx/TS)});
      for(const p of at){
        G.spawn={x:p.x,y:p.y}; respawn(true);
        IN.l=IN.r=IN.u=IN.d=0; IN.jumpHeld=0; IN.dashP=0;
        for(let f=0;f<8;f++){ step(); if(P.dead) return p.what+' kills you in '+f+' frames'; }
        if(!isFinite(P.x)||!isFinite(P.y)) return p.what+' is not a finite position';
      }
      return 'ok';})()`);
    if(r!=='ok') bug('spawnsafe','sheet '+(i+1)+': '+r);
    ok('spawnsafe','sheet '+(i+1));
  }
}

/* ================= phase: intros ================= */
function phaseIntros(){
  head('intros — every new thing gets a card, once, and nothing is left unexplained');
  const feats=run(`(()=>{const all=new Set();
    for(let i=0;i<LEVELS.length;i++){ loadLevel(i); for(const f of G.feat) all.add(f); }
    return [...all];})()`);
  const cards=run('INTROS.map(t=>t.k)');
  for(const f of feats) if(cards.indexOf(f)<0) bug('intros','"'+f+'" appears in the game but has no card');
  for(const c of cards) if(feats.indexOf(c)<0) bug('intros','the card for "'+c+'" is never shown by any sheet');
  for(const c of cards){
    const t=run('INTROS.find(t=>t.k==='+JSON.stringify(c)+')');
    if(!t.n || !t.d) bug('intros','the card for "'+c+'" is missing a name or a line');
    if(t.d && t.d.length>170) bug('intros','the card for "'+c+'" runs to '+t.d.length+' characters');
  }
  /* a straight playthrough: how many cards, and never the same one twice */
  const seq=run(`(()=>{ SAVE.seen={}; TEST.on=false; const seen={}, out=[];
    for(let i=0;i<LEVELS.length;i++){
      loadLevel(i);
      const fresh=G.feat.filter(k=>!seen[k] && INTROS.some(t=>t.k===k));
      if(fresh.length>INTRO_MAX+0.001) return 'a card would carry '+fresh.length+' rows';
      for(const k of fresh) seen[k]=1;
      if(fresh.length) out.push(i+1);
    }
    return out;})()`);
  if(typeof seq==='string'){ bug('intros',seq); }
  else {
    console.log('       '+seq.length+' cards across a full run, first at sheet '+seq[0]+', last at '+seq[seq.length-1]);
    if(seq.length>34) bug('intros','a player would be interrupted '+seq.length+' times');
    if(seq[0]!==1) bug('intros','the first sheet shows no card at all');
  }
  /* opening and closing one, and the clock held behind it */
  const beh=run(`(()=>{
    SAVE.seen={}; TEST.on=false; play(0);
    if(G.state!=='intro') return 'sheet 1 showed no card';
    const t0=G.time; for(let i=0;i<90;i++) step();
    if(G.time!==t0) return 'the clock ran behind the card';
    if(ADS.playing) return 'a gameplay session was open behind the card';
    closeIntro();
    if(G.state!=='play') return 'closing did not start the sheet';
    play(0);
    if(G.state!=='play') return 'the card came back a second time';
    SAVE.seen={}; TEST.on=true; play(0); const s=G.state; TEST.on=false;
    if(s!=='play') return 'a card interrupted the ranking test';
    return 'ok';})()`);
  if(beh!=='ok') bug('intros',beh);
  ok('intros','behaviour');
  /* the ladder carries nothing optional */
  const g=run(`(()=>{let t=0; for(let i=TRIAL0;i<TRIAL0+TRIALN;i++){ loadLevel(i); t+=G.gems.length; } return t;})()`);
  if(g) bug('intros','the trial ladder still has '+g+' parts on it');
  const g2=run(`(()=>{let t=0; for(let i=0;i<40;i++){ loadLevel(i); t+=G.gems.length; } return t;})()`);
  if(!g2) bug('intros','ordinary sheets lost their parts too');
  ok('intros','trials');
}

/* ================= phase: respawn ================= */
function phaseRespawn(){
  head('respawn — no start and no datum may kill you while you stand still');
  const N=run('LEVELS.length');
  const warms=DEEP?[0,60,140,240,360,520,700]:[0,60,140,240,360,520];
  for(let i=0;i<N;i++){
    const r=run(`(()=>{
      const warms=${JSON.stringify(warms)};
      for(const warm of warms){
        loadLevel(${i}); G.state='play';
        IN.l=IN.r=IN.u=IN.d=0; IN.jumpHeld=0; IN.dashP=0;
        for(let f=0;f<warm;f++){ if(P.dead) respawn(); step(); }
        const pts=[{x:G.spawn.x,y:G.spawn.y,what:'the start'}]
          .concat(G.checks.map(c=>({x:c.sx,y:c.sy,what:'the datum at column '+Math.round(c.sx/TS)})));
        for(const p of pts){
          const keep={x:G.spawn.x,y:G.spawn.y};
          G.spawn={x:p.x,y:p.y}; respawn(true);
          IN.l=IN.r=IN.u=IN.d=0; IN.jumpHeld=0; IN.dashP=0;
          let died=-1;
          for(let f=0;f<90;f++){ step(); if(P.dead){ died=f; break; } }
          G.spawn=keep;
          if(died>=0) return p.what+' kills you '+died+' frames after respawn (world warmed '+warm+' frames)';
        }
      }
      return 'ok';})()`);
    if(r!=='ok') bug('respawn','sheet '+(i+1)+': '+r);
    ok('respawn','sheet '+(i+1));
  }
}

/* ================= phase: portals ================= */
function phasePortals(){
  head('portals — pairs do not cross, deliver you, and do not bounce you back');
  const N=run('LEVELS.length');
  let sheets=0, pairs=0;
  for(let i=0;i<N;i++){
    const has=run(`(()=>{loadLevel(${i}); return (G.portPairs||[]).length;})()`);
    if(!has) continue;
    sheets++; pairs+=has;
    const r=run(`(()=>{
      G.state='play';
      /* every door belongs to exactly one pair */
      const seen=new Set();
      for(const [a,b] of G.portPairs){
        if(seen.has(a)||seen.has(b)) return 'a door is in two pairs';
        seen.add(a); seen.add(b);
      }
      /* the pairing must not cross: no swap of two pairs may shorten it. Being
         globally nearest is not the property — a closer door may already be
         claimed by a closer partner. */
      const d=(p,q)=>Math.hypot(p.x-q.x,p.y-q.y);
      for(let u=0;u<G.portPairs.length;u++) for(let v=u+1;v<G.portPairs.length;v++){
        const [a1,b1]=G.portPairs[u], [a2,b2]=G.portPairs[v];
        if(d(a1,b2)+d(a2,b1) < d(a1,b1)+d(a2,b2)-0.5) return 'pairs '+u+' and '+v+' cross';
      }
      for(let k=0;k<G.portPairs.length;k++){
        const [a,b]=G.portPairs[k];
        /* walk into A and come out at B, and stay there */
        G.portLock=0;
        P.x=a.x-PW/2; P.y=a.y-PH/2; P.vx=0; P.vy=0; P.dead=0;
        IN.l=IN.r=0;
        step();
        const near=Math.hypot((P.x+PW/2)-b.x,(P.y+PH/2)-b.y);
        if(near>TS*1.5) return 'pair '+k+' did not deliver you (off by '+Math.round(near)+'px)';
        for(let f=0;f<40;f++){
          step();
          const back=Math.hypot((P.x+PW/2)-a.x,(P.y+PH/2)-a.y);
          if(back<TS) return 'pair '+k+' threw you straight back after '+f+' frames';
        }
      }
      return 'ok';})()`);
    if(r!=='ok') bug('portals','sheet '+(i+1)+': '+r);
    ok('portals','sheet '+(i+1));
  }
  console.log('       '+pairs+' pairs across '+sheets+' sheets');
}

/* ================= phase: marathon ================= */
function phaseMarathon(){
  const n=DEEP?200:70;
  head('marathon — '+n+' sheets back to back through the real transition, watching for leaks');
  run("SAVE.unlocked=LEVELS.length; G.state='menu'; play(0)");
  let prev=null, growing=0;
  for(let i=0;i<n;i++){
    try{
      run(`(()=>{ if(G.state!=='play'){ G.state='play'; }
        G.won=0; win();
        nextLevel();
        let guard=0;
        while(G.state==='cut' && guard++<20000){ const S=SC[G.cutScene]||SC[1]; G.cut=S.end; step(); }
      })()`);
    }catch(e){ bug('marathon','sheet '+i+' transition throws', e.message); break; }
    const b=inv(); if(b.length){ bug('marathon','after sheet '+i+': '+b.join('; ')); break; }
    const m=run(`({fx:G.fx.length, trail:G.trail.length, broken:G.broken.size, crumbs:G.crumbs.size,
      movers:G.movers.length, saws:G.saws.length, ghosts:Object.keys(SAVE.ghosts).length,
      pieces:(G.pieces||[]).length, checks:G.checks.length, gems:G.gems.length})`);
    if(m.ghosts>run('GHOST_MAX')) bug('marathon','ghost store grew to '+m.ghosts);
    if(prev){
      /* nothing should climb without bound across sheets */
      const climb=['fx','trail','broken','crumbs','movers','saws','pieces'].filter(k=>m[k]>prev[k]);
      growing = climb.length===7 ? growing+1 : 0;
      if(growing>6) bug('marathon','every collection has grown for seven sheets running: '+JSON.stringify(m));
    }
    prev=m;
    ok('marathon','sheet '+i);
  }
}

/* ---------- run ---------- */
const PHASES={load:phaseLoad, fuzz:phaseFuzz, ui:phaseUi, codes:phaseCodes,
              ghosts:phaseGhosts, daily:phaseDaily, ranking:phaseRanking,
              save:phaseSave, builder:phaseBuilder, cuts:phaseCuts,
              marathon:phaseMarathon, spawnsafe:phaseSpawnsafe, portals:phasePortals,
              respawn:phaseRespawn, intros:phaseIntros};
console.log('stress — seed '+SEED+(DEEP?' (deep)':'')+(TARGET?' against '+TARGET:''));
const list = ONLY? [ONLY] : Object.keys(PHASES);
for(const p of list){
  if(!PHASES[p]){ console.log('no phase called '+p); process.exit(2); }
  rng=mulberry(SEED);            /* each phase starts from the same seed */
  try{ PHASES[p](); }
  catch(e){ bug(p,'the phase itself crashed', e.stack.split('\n').slice(0,3).join('\n')); }
}
console.log('\n'+checks+' checks, '+found.length+' problem'+(found.length===1?'':'s'));
process.exit(found.length?1:0);
