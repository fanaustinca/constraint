/* Runs a built file against a mock Poki SDK that records the order it is called
   in, and asserts the lifecycle rules: gameLoadingFinished before any gameplay,
   gameplayStop before every ad, no input or simulation while a break is up, a
   break only on the way back into gameplay, and no reward from a blocked ad.

     node tools/pokicheck.js poki/index.html
     node tools/pokicheck.js index.html            */
const fs=require('fs'), vm=require('vm'), path=require('path');
const file=process.argv[2]||'poki/index.html';
const html=fs.readFileSync(path.join(__dirname,'..',file),'utf8');
const IDS=new Set([...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]));
const js=html.slice(html.indexOf('<script>')+8, html.lastIndexOf('</script>'));
const isPoki=/const POKI_BUILD=true/.test(js);

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
              toggle(c,on){ on===undefined? (this._s.has(c)?this._s.delete(c):this._s.add(c))
                                          : (on?this._s.add(c):this._s.delete(c)); },
              contains(c){return this._s.has(c)} },
  style:{}, innerHTML:'', textContent:'', value:'', disabled:false, width:0, height:0,
  appendChild:noop, addEventListener(t,f){ (this._l[t]=this._l[t]||[]).push(f); },
  removeEventListener:noop, select:noop, blur:noop,
  querySelectorAll:()=>[], getContext:()=>ctxProxy, onclick:null }; }

const calls=[]; let REWARD=true;
const PokiSDK={
  init(){ calls.push('init'); return Promise.resolve().then(()=>{ calls.push('init.done'); }); },
  gameLoadingFinished(){ calls.push('gameLoadingFinished'); },
  gameplayStart(){ calls.push('gameplayStart'); },
  gameplayStop(){ calls.push('gameplayStop'); },
  commercialBreak(onStart){ calls.push('commercialBreak'); if(onStart) onStart(); return Promise.resolve(); },
  rewardedBreak(o){ calls.push('rewardedBreak'); if(o&&o.onStart) o.onStart(); return Promise.resolve(REWARD); }
};
let raf=null;
const timers=[];
const store={};
const docListeners={};
const sandbox={ console,
  document:{ getElementById:id=>{ if(!IDS.has(id)) return null; return cache[id]||(cache[id]=el(id)); },
             createElement:()=>el('new'), querySelectorAll:()=>[], querySelector:()=>null,
             addEventListener:(t,f)=>{ (docListeners[t]=docListeners[t]||[]).push(f); },
             body:el('body'), hidden:false },
  window:{ devicePixelRatio:1, AudioContext:null, PokiSDK: isPoki?PokiSDK:undefined },
  addEventListener:(t,f)=>{ (docListeners[t]=docListeners[t]||[]).push(f); },
  removeEventListener:noop,
  matchMedia:()=>({matches:false, addEventListener:noop}),
  devicePixelRatio:1,
  requestAnimationFrame:f=>{ raf=f; return 1; },
  performance:{now:()=>0},
  setTimeout:(f,ms)=>{ const t=setTimeout(f,Math.min(ms||0,5)); if(t.unref)t.unref(); timers.push(t); return t; },
  clearTimeout:t=>clearTimeout(t),
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
  Math, Date, JSON, Array, Object, String, Number, Proxy, Set, Map, RegExp, Error, Promise,
  isFinite, parseInt, parseFloat };
sandbox.window.PokiSDK = isPoki?PokiSDK:undefined;
if(isPoki) sandbox.PokiSDK=PokiSDK;
sandbox.window.AudioContext=function(){ throw new Error('no audio'); };
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(js, sandbox, {filename:path.basename(file)});
const run=c=>vm.runInContext(c,sandbox);
const fire=(t,ev)=>(docListeners[t]||[]).forEach(f=>f(ev||{preventDefault:noop,stopPropagation:noop}));
const frame=()=>{ if(raf){ const f=raf; raf=null; f(16); } };

let fail=0;
const ok=(c,m)=>{ if(!c){ console.log('  FAIL '+m); fail++; } else console.log('  ok   '+m); };
const idx=n=>calls.indexOf(n);

console.log('\n'+file+(isPoki?'  (POKI build, SDK present)':'  (standalone build, no SDK)'));

/* ---- before init settles, nothing may reach gameplay ---- */
console.log('\nstartup');
ok(run("G.state")==='boot', 'the game starts behind a loading panel, not in the menu');
run("ADS.playStart()"); frame();
ok(idx('gameplayStart')===-1, 'a gameplayStart before loading finished is refused');

setTimeout(()=>{
  frame();
  if(isPoki){
    ok(idx('gameLoadingFinished')>=0, 'gameLoadingFinished went out');
    ok(idx('init')<idx('gameLoadingFinished'), 'init precedes gameLoadingFinished');
  }
  ok(run("G.state")==='menu', 'the menu opens once init settles');

  /* ---- gameplay ---- */
  console.log('\ngameplay');
  run("play(0)"); frame();
  /* a fresh save meets the first sheet's introduction card, and a card is not
     gameplay: no session may be open behind it */
  if(run("G.state")==='intro'){
    ok(run("ADS.playing")===false, 'no session is open behind an introduction card');
    run("closeIntro()"); frame();
  }
  if(isPoki){
    ok(idx('gameplayStart')>idx('gameLoadingFinished'), 'gameplayStart only after gameLoadingFinished');
  }
  ok(run("ADS.playing")===true, 'a session is open once play actually starts');

  /* ---- no internal ad timer ---- */
  console.log('\nad frequency is Poki’s to decide');
  ok(run("typeof ADS.gap")==='undefined',  'no ADS.gap');
  ok(run("typeof ADS.due")==='undefined',  'no ADS.due()');
  ok(run("typeof ADS.tick")==='undefined', 'no play-time clock');

  /* ---- a break only on the way back into gameplay ---- */
  console.log('\nwhere a commercial break is allowed');
  const asked=()=>calls.filter(c=>c==='commercialBreak').length;
  const probe=(setup,label,want)=>{
    const before=asked();
    run(setup); run("nextLevel._shown=false; G.state='done'; try{nextLevel()}catch(e){}");
    /* with no SDK there is no break to request anywhere, which is the point */
    ok((asked()-before>0)===(want && isPoki), isPoki? label : label.replace(/-> .*/,'-> no SDK, no break'));
  };
  probe("G.lvl=5",  'ordinary sheet -> break requested',            true);
  probe("G.lvl=-2", 'daily summary -> no break',                    false);
  probe("G.lvl=-1", 'builder test run -> no break',                 false);
  probe("SAVE.cuts={}; G.lvl=39", 'before an interlude -> no break', false);
  probe("G.lvl=LEVELS.length-1",  'last sheet, back to menu -> no break', false);

  if(isPoki){
    ok(idx('gameplayStop')>=0 && idx('gameplayStop')<calls.lastIndexOf('commercialBreak'),
       'gameplayStop precedes the break');
  }

  /* ---- frozen and deaf while a break is up ---- */
  console.log('\nwhile a break is on screen');
  run("ADS.lock(true)");
  ok(run("ADS.inAd")===true,            'the ad lock is on');
  ok(run("A.on")===false,               'audio is off');
  ok(run("document.body.classList.contains('adlock')")===true, 'the page is click-locked');
  run("G.state='play'; P.x=100; IN.r=0");
  fire('keydown',{code:'ArrowRight',key:'ArrowRight',preventDefault:noop,stopPropagation:noop,target:{}});
  ok(run("IN.r")===0,                   'keyboard input is ignored');
  const x0=run("P.x"); frame(); frame();
  ok(run("P.x")===x0,                   'the simulation does not advance');
  const gs=calls.filter(c=>c==='gameplayStart').length;
  run("ADS.playStart()");
  ok(calls.filter(c=>c==='gameplayStart').length===gs, 'no gameplayStart during a break');
  run("ADS.lock(false); G.state='menu'");

  /* ---- rewards ---- */
  console.log('\nrewards');
  const grant=()=>new Promise(r=>run("ADS.rewarded(ok=>{ globalThis.__r=ok; })") || setTimeout(()=>r(run("__r")),20));
  REWARD=true;
  grant().then(g=>{
    ok(g===true, 'a completed video grants the reward');
    REWARD=false;
    return grant();
  }).then(g=>{
    ok(g===false || !isPoki, isPoki? 'an incomplete video grants nothing'
                                   : 'standalone build grants without an SDK');
    /* blocked SDK */
    run("delete window.PokiSDK");
    return grant();
  }).then(g=>{
    ok(g===!isPoki, isPoki? 'a blocked SDK grants nothing'
                          : 'no SDK in a standalone build still grants');
    /* ---- hidden tab ---- */
    console.log('\nhidden tab');
    run("G.state='play'; ADS.playing=true");
    sandbox.document.hidden=true; fire('visibilitychange');
    ok(run("ADS.playing")===false, 'switching tabs closes the session');
    ok(run("G.state")==='pause',   'and pauses the game');

    console.log(fail? '\n'+fail+' FAILED\n' : '\nall clear\n');
    process.exit(fail?1:0);
  });
}, 30);
