/* browsercheck.js — the Poki submission checklist, run in a real browser.
 *
 * Everything else in tools/ runs the game in a stubbed node sandbox: it can
 * assert what the code computes, and it cannot see a layout, a paint, a real
 * event loop or a real localStorage. This walks the same checklist against
 * headless Chrome, with the Poki CDN intercepted by a recording mock SDK.
 *
 *   NODE_PATH=$HOME/.cbrowser/node_modules node tools/browsercheck.js
 *   ... --only ads          one phase
 *   ... --file index.html   against the Pages build (default: poki/index.html)
 *   ... --shots DIR         also write a screenshot per layout size
 *
 * See tools/browser.js for the harness and how to install puppeteer.
 *
 * ASSERTIONS ARE REAL HERE. ok(cond, msg) checks cond — unlike stress.js's
 * ok(phase, msg), which only counts. Mutation-test anything you add.
 */
const H=require('./browser.js');
const fs=require('fs'), path=require('path');

const argv=process.argv.slice(2);
const arg=n=>{ const i=argv.indexOf('--'+n); return i<0?null:argv[i+1]; };
const ONLY=arg('only'), FILE=arg('file')||'poki/index.html', SHOTS=arg('shots');
if(SHOTS) fs.mkdirSync(SHOTS,{recursive:true});

let checks=0; const bugs=[];
function ok(c, what){ checks++; if(!c) bugs.push([PHASE, what]); return !!c; }
function note(s){ console.log('       '+s); }
function pass(what){ console.log('  ok   '+what); }
function chk(c, what){ const r=ok(c,what); console.log((r?'  ok   ':'  BUG  ')+what); return r; }
let PHASE='';
function phase(name, desc){ PHASE=name; console.log('\n'+name+' — '+desc); }
const want = ONLY ? (n=>n===ONLY) : (()=>true);

/* ---- shared little drivers, evaluated in the page ---------------------- */
const toMenu = p => H.until(p, ()=>typeof G!=='undefined' && G.state==='menu', 20000, 'menu');
/* start a sheet without the intro card in the way — the card is its own state
   and gameplay is meant to wait behind it, which several phases assert */
const startSheet = async (p, i=0) => {
  await p.evaluate(n=>{ SAVE.unlocked=Math.max(SAVE.unlocked,10); play(n); if(G.state==='intro') closeIntro(); }, i);
  await H.sleep(250);
};
const seq = p => H.calls(p);
const tail = (a,n) => a.slice(-n).join(' → ');

/* ====================================================================== */
async function boot(){
  phase('boot','the SDK comes up, says loading is finished, and says it once');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}});
  try{
    await toMenu(s.page);
    const c=await seq(s.page);
    chk(s.errors.length===0, 'the page loads with no uncaught error');
    if(s.errors.length) note(JSON.stringify(s.errors));
    chk(c[0]==='init', 'init() is the first thing asked of the SDK');
    chk(c.filter(x=>x==='gameLoadingFinished').length===1, 'gameLoadingFinished() fires exactly once');
    chk(c.indexOf('init') < c.indexOf('gameLoadingFinished'), 'and it fires after init(), not before');
    chk(c.indexOf('gameplayStart')===-1, 'no gameplayStart() before the player has done anything');
    const ext=s.external.filter(u=>u!==H.CDN);
    chk(ext.length===0, 'the SDK is the only thing loaded off this origin');
    if(ext.length) note('also requested: '+ext.join(', '));
    /* the loading panel has to be gone, or nothing above is reachable */
    chk(await s.page.evaluate(()=>!document.getElementById('ovBoot').classList.contains('on')),
        'the loading panel gives way to the menu');
    note('calls: '+c.join(' → '));
  } finally { await s.close(); }
}

/* ====================================================================== */
async function lifecycle(){
  phase('lifecycle','gameplayStart and gameplayStop bracket exactly the play, once each');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}});
  const p=s.page;
  try{
    await toMenu(p);
    chk((await seq(p)).indexOf('gameplayStart')===-1, 'sitting in the menu is not gameplay');

    /* an intro card is not gameplay either — the clock and the session wait */
    await p.evaluate(()=>{ SAVE.unlocked=10; play(0); });
    await H.sleep(200);
    const introUp=await p.evaluate(()=>G.state==='intro');
    if(introUp) chk((await seq(p)).indexOf('gameplayStart')===-1, 'an intro card is not gameplay either');
    await p.evaluate(()=>{ if(G.state==='intro') closeIntro(); });
    await H.sleep(250);
    chk((await seq(p)).filter(x=>x==='gameplayStart').length===1, 'reaching play fires gameplayStart() once');

    /* pause */
    await p.evaluate(()=>togglePause()); await H.sleep(200);
    let c=await seq(p);
    chk(c[c.length-1]==='gameplayStop', 'pausing fires gameplayStop()');
    await H.sleep(300);
    c=await seq(p);
    chk(c.filter(x=>x==='gameplayStop').length===1, 'and does not keep firing it while paused');
    await p.evaluate(()=>togglePause()); await H.sleep(200);
    c=await seq(p);
    chk(c[c.length-1]==='gameplayStart', 'resuming fires gameplayStart() again');

    /* A hidden tab, switched for real rather than faked: visibilitychange is
       fired at the document and reaches the window listener by bubbling, and a
       synthetic Event() without bubbles:true never gets there — which looks
       exactly like a game that ignores the tab going away. */
    const other=await s.browser.newPage();
    await other.goto('about:blank');
    await other.bringToFront();
    await H.sleep(400);
    chk(await p.evaluate(()=>document.hidden===true), 'the tab really is hidden');
    c=await seq(p);
    chk(c[c.length-1]==='gameplayStop', 'a hidden tab closes the session');
    chk(await p.evaluate(()=>G.state==='pause'), 'and pauses the game rather than running it unseen');
    await p.bringToFront(); await other.close();
    await H.sleep(300);
    c=await seq(p);
    chk(c[c.length-1]!=='gameplayStart', 'coming back to a paused game does not restart the session on its own');

    /* death and restart stay inside one session */
    await p.evaluate(()=>{ togglePause(); }); await H.sleep(150);
    const before=(await seq(p)).length;
    await p.evaluate(()=>{ restart(); restart(); }); await H.sleep(300);
    chk((await seq(p)).length===before, 'dying and restarting stays inside the one session');

    /* out to the menu */
    await p.evaluate(()=>{ G.state='menu'; showOv('ovMenu'); }); await H.sleep(200);
    c=await seq(p);
    chk(c[c.length-1]==='gameplayStop', 'leaving for the menu closes the session');

    /* no adjacent duplicates anywhere in the whole run */
    c=(await seq(p)).filter(x=>x==='gameplayStart'||x==='gameplayStop');
    let dup=null;
    for(let i=1;i<c.length;i++) if(c[i]===c[i-1]) dup=c[i];
    chk(!dup, 'no two gameplay events of the same kind ever land back to back');
    if(dup) note('doubled: '+dup);
    chk(c[0]==='gameplayStart', 'the sequence opens with a start');
    note('gameplay events: '+c.map(x=>x==='gameplayStart'?'▶':'■').join(''));
  } finally { await s.close(); }
}

/* ====================================================================== */
async function ads(){
  phase('ads','a break is asked for at a sheet edge, and the game is frozen and mute while it runs');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}, adMs:700});
  const p=s.page;
  try{
    await toMenu(p);
    await startSheet(p,0);
    chk(await p.evaluate(()=>A.on===true || SAVE.mute===true), 'audio is on going in (or muted by choice)');

    /* clear the sheet with a break due */
    await p.evaluate(()=>{ ADS.last=0; win(); });
    await H.sleep(200);
    chk(await p.evaluate(()=>G.state==='done'), 'clearing the sheet reaches the done panel');
    let c=await seq(p);
    chk(c.indexOf('commercialBreak')===-1, 'nothing is asked for while the done panel is up');

    await p.evaluate(()=>nextLevel());
    await H.until(p, ()=>ADS.inAd, 4000, 'the break to start');
    c=await seq(p);
    const iBreak=c.lastIndexOf('commercialBreak');
    chk(iBreak>=0, 'walking on to the next sheet asks for a commercialBreak()');
    chk(c[iBreak-1]==='gameplayStop', 'and gameplayStop() goes out immediately before it');

    /* frozen, mute, deaf to input */
    const t0=await p.evaluate(()=>G.tick);
    chk(await p.evaluate(()=>A.on===false), 'audio is off while the break is on screen');
    chk(await p.evaluate(()=>document.body.classList.contains('adlock')), 'the app is locked out of pointer events');
    chk(await p.evaluate(()=>getComputedStyle(document.querySelector('.app')).pointerEvents==='none'),
        'and that lock is what the stylesheet actually applies');
    await p.keyboard.press('Space'); await p.keyboard.press('Enter');
    await p.keyboard.down('ArrowRight'); await H.sleep(200); await p.keyboard.up('ArrowRight');
    chk(await p.evaluate(()=>G.tick)===t0, 'the simulation does not advance while the break runs');
    chk(await p.evaluate(()=>IN.l===0&&IN.r===0&&IN.jumpHeld===0), 'and no key reaches the player');
    c=await seq(p);
    chk(c.lastIndexOf('commercialBreak:end')<iBreak, 'the space bar does not cut the break short');
    chk(await p.evaluate(()=>!document.pointerLockElement), 'nothing holds the pointer lock during a break');

    /* and back */
    await H.until(p, ()=>!ADS.inAd, 6000, 'the break to end');
    await H.sleep(400);
    chk(await p.evaluate(()=>A.on===true||SAVE.mute===true), 'audio comes back after the break');
    chk(await p.evaluate(()=>!document.body.classList.contains('adlock')), 'and the app takes input again');
    /* the sheet on the far side of the break may open with an intro card, and
       a card is deliberately not gameplay — so the session opens when the card
       is closed, not the moment the break ends */
    chk(await p.evaluate(()=>G.lvl===1 && (G.state==='play'||G.state==='intro')),
        'the player lands in the next sheet, not on a dead screen');
    c=await seq(p);
    chk(c.indexOf('gameplayStart', c.lastIndexOf('commercialBreak'))===-1
        || await p.evaluate(()=>G.state==='play'),
        'no session is opened behind an intro card');
    await p.evaluate(()=>{ if(G.state==='intro') closeIntro(); }); await H.sleep(300);
    chk(await p.evaluate(()=>G.state==='play'), 'and play resumes once the card is closed');
    c=await seq(p);
    chk(c[c.length-1]==='gameplayStart', 'and a fresh gameplayStart() opens the new session');

    /* the floor between breaks */
    const n=(await seq(p)).filter(x=>x==='commercialBreak').length;
    await p.evaluate(()=>{ win(); }); await H.sleep(150);
    await p.evaluate(()=>nextLevel()); await H.sleep(600);
    chk((await seq(p)).filter(x=>x==='commercialBreak').length===n,
        'a second sheet finished inside the gap asks for nothing');
    await p.evaluate(()=>{ if(G.state==='intro') closeIntro(); }); await H.sleep(250);
    chk(await p.evaluate(()=>G.state==='play'), 'and the player still walks straight on');
    note('calls: '+tail(await seq(p), 8));
  } finally { await s.close(); }
}

/* ====================================================================== */
async function rewarded(){
  phase('rewarded','no video without being asked for one, and a refused video pays nothing');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}, adMs:200});
  const p=s.page;
  try{
    await toMenu(p);
    await startSheet(p,0);
    await p.evaluate(()=>togglePause()); await H.sleep(150);
    chk((await seq(p)).indexOf('rewardedBreak')===-1, 'opening the pause menu starts no video');

    /* Skip sheet is the one rewarded path a player meets early */
    await p.click('#btnSkip'); await H.sleep(250);
    chk(await p.evaluate(()=>document.getElementById('ovAd').classList.contains('on')),
        'Skip sheet asks first rather than rolling a video');
    chk((await seq(p)).indexOf('rewardedBreak')===-1, 'and still no video has been asked for');
    const txt=await p.evaluate(()=>document.getElementById('adSub').textContent+' | '+document.getElementById('adGo').textContent);
    chk(/video/i.test(txt), 'the prompt says a video is what it costs');
    note('prompt: '+txt.trim());

    /* declining */
    await p.click('#adNo'); await H.sleep(200);
    chk((await seq(p)).indexOf('rewardedBreak')===-1, 'saying no rolls nothing');

    /* accepting */
    await p.click('#btnSkip'); await H.sleep(200);
    await p.click('#adGo');
    await H.until(p, ()=>ADS.inAd, 4000, 'the video to start');
    let c=await seq(p);
    const i=c.lastIndexOf('rewardedBreak');
    chk(i>=0, 'saying yes asks for a rewardedBreak()');
    chk(c[i-1]==='gameplayStop', 'and gameplayStop() precedes it');
    chk(await p.evaluate(()=>A.on===false), 'audio is off while a rewarded video runs');
    chk(await p.evaluate(()=>document.body.classList.contains('adlock')), 'and the app is locked');
    await H.until(p, ()=>!ADS.inAd, 6000, 'the video to end');
    await H.sleep(300);
    chk(await p.evaluate(()=>SAVE.skipped&&SAVE.skipped[0]===1), 'a completed video pays out the skip');
    chk(await p.evaluate(()=>!document.body.classList.contains('adlock')), 'and hands the game back');
  } finally { await s.close(); }
}

async function rewardRefused(){
  phase('refused','a video the network refuses grants nothing and says so without blaming a blocker');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}, adMs:150, reward:false});
  const p=s.page;
  try{
    await toMenu(p);
    await startSheet(p,0);
    await p.evaluate(()=>togglePause()); await H.sleep(150);
    await p.click('#btnSkip'); await H.sleep(200);
    await p.click('#adGo');
    await H.until(p, ()=>!ADS.inAd && !!ADQ===false || true, 3000, 'the video to settle');
    await H.sleep(600);
    chk(await p.evaluate(()=>!(SAVE.skipped&&SAVE.skipped[0])), 'an unfinished video grants nothing');
    const body=await p.evaluate(()=>document.body.innerText);
    chk(!/ad ?block|adblocker|disable your ad/i.test(body), 'and nothing on screen mentions an ad blocker');
    chk(await p.evaluate(()=>!document.body.classList.contains('adlock')), 'the game is not left locked');
  } finally { await s.close(); }
}

/* ====================================================================== */
async function adblock(){
  phase('adblock','with the SDK blocked the game still plays, and never says why');
  const s=await H.open({file:FILE, sdk:'block', viewport:{width:1280,height:720}});
  const p=s.page;
  try{
    await toMenu(p);
    chk(s.errors.length===0, 'a blocked SDK throws nothing');
    if(s.errors.length) note(JSON.stringify(s.errors));
    chk(await p.evaluate(()=>ADS.absent===true), 'the game notices the SDK never arrived');
    await startSheet(p,0);
    chk(await p.evaluate(()=>G.state==='play'), 'and the sheet still plays');
    await p.keyboard.down('ArrowRight'); await H.sleep(250); await p.keyboard.up('ArrowRight');
    chk(await p.evaluate(()=>IN.r===0 && G.tick>0), 'the simulation runs');
    /* a sheet edge with no SDK must not stall on an ad that can never come */
    await p.evaluate(()=>{ ADS.last=0; win(); }); await H.sleep(150);
    await p.evaluate(()=>nextLevel()); await H.sleep(500);
    await p.evaluate(()=>{ if(G.state==='intro') closeIntro(); }); await H.sleep(250);
    chk(await p.evaluate(()=>G.state==='play'), 'a sheet edge walks straight on with no SDK to ask');
    /* rewarded pays nothing in the shipped build */
    await p.evaluate(()=>togglePause()); await H.sleep(120);
    await p.click('#btnSkip'); await H.sleep(150);
    await p.click('#adGo'); await H.sleep(500);
    const shipped=await p.evaluate(()=>POKI_BUILD===true);
    if(shipped) chk(await p.evaluate(()=>!(SAVE.skipped&&SAVE.skipped[G.lvl])),
                    'and a blocked video pays out nothing in the shipped build');
    const body=await p.evaluate(()=>document.body.innerText);
    chk(!/ad ?block|adblocker|whitelist|disable your ad/i.test(body), 'nothing anywhere blames a blocker');
    /* console diagnostics are fine — a player never opens it — but a visible
       banner is not, and neither is a dialog */
    chk(await p.evaluate(()=>!document.querySelector('dialog[open]')), 'and nothing modal is in the way');
  } finally { await s.close(); }
}

/* ====================================================================== */
async function storage(){
  phase('storage','progress survives a reload, and a browser that refuses to store still plays');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}});
  const p=s.page;
  try{
    await toMenu(p);
    /* every run here starts on a fresh profile, which is the incognito first
       visit: an empty store must read as a new player, not as a broken save */
    chk(await p.evaluate(()=>SAVE.unlocked===1 && Object.keys(SAVE.best).length===0),
        'an empty store reads as a brand new player');
    chk(await p.evaluate(()=>document.getElementById('btnPlay').textContent.trim()==='Start'),
        'and the menu offers Start rather than Continue');
    await startSheet(p,0);
    await p.evaluate(()=>{ G.time=12.34; win(); }); await H.sleep(200);
    const key=await p.evaluate(()=>SKEY);
    chk(/save/i.test(key), 'the storage key says out loud that it is a save: '+key);
    const stored=await p.evaluate(k=>localStorage.getItem(k), key);
    chk(!!stored, 'clearing a sheet writes it down');
    await p.reload({waitUntil:'load'});
    await toMenu(p);
    chk(await p.evaluate(()=>SAVE.unlocked>=2), 'and a reload finds it again');
    chk(await p.evaluate(()=>SAVE.best&&SAVE.best[0]!==undefined), 'including the time on the sheet');
    /* every key written must be the game's own */
    const keys=await p.evaluate(()=>Object.keys(localStorage));
    chk(keys.every(k=>k.startsWith('constraint.')), 'nothing is written outside the game\'s own namespace');
    note('keys: '+keys.join(', '));
    /* Poki asks that a game storing progress says so where a player can read it */
    const told=await p.evaluate(()=>{
      const seen=[];
      for(const id of ['ovLevels','ovHow']){
        const t=document.getElementById(id).innerText||'';
        if(/saved in this browser|local storage/i.test(t)) seen.push(id);
      }
      return seen;
    });
    chk(told.length>=2, 'the player is told the game saves in their browser'
        +(told.length?' (on '+told.join(', ')+')':' — nowhere'));
  } finally { await s.close(); }

  /* a storage that throws on every call — Safari private mode, a locked-down
     embed, a user who blocked site data. The game must not care. */
  const t=await H.open({file:FILE, viewport:{width:1280,height:720}});
  try{
    await t.page.evaluateOnNewDocument(()=>{
      const boom=()=>{ throw new DOMException('denied','SecurityError'); };
      Object.defineProperty(window,'localStorage',{configurable:true,get(){ return {getItem:boom,setItem:boom,removeItem:boom,clear:boom,key:boom,length:0}; }});
    });
    await t.page.reload({waitUntil:'load'});
    await toMenu(t.page);
    chk(t.errors.length===0, 'a localStorage that throws on every call breaks nothing');
    if(t.errors.length) note(JSON.stringify(t.errors));
    await startSheet(t.page,0);
    chk(await t.page.evaluate(()=>G.state==='play'), 'and the game is still playable');
    await t.page.evaluate(()=>win()); await H.sleep(200);
    chk(await t.page.evaluate(()=>G.state==='done'), 'and clearing a sheet still works without saving it');
  } finally { await t.close(); }
}

/* ====================================================================== */
async function focus(){
  phase('focus','the keyboard reaches the game without a click first, and the page never scrolls');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}});
  const p=s.page;
  try{
    await toMenu(p);
    await startSheet(p,0);
    /* nothing has been clicked in the play area: the keys must work anyway */
    await p.evaluate(()=>document.body.focus());
    await p.keyboard.down('ArrowRight'); await H.sleep(200);
    chk(await p.evaluate(()=>IN.r===1), 'a key works with nothing focused but the document');
    await p.keyboard.up('ArrowRight');
    const moved=await p.evaluate(()=>P.x);
    chk(moved>0, 'and the player actually moves');

    /* force the document to be scrollable, then try to scroll it with the game keys */
    await p.evaluate(()=>{ const d=document.createElement('div'); d.id='tallpad';
      d.style.cssText='position:absolute;top:0;left:0;width:1px;height:5000px'; document.body.appendChild(d);
      document.documentElement.style.overflow='auto'; document.body.style.overflow='auto'; window.scrollTo(0,0); });
    /* one key at a time, so a failure names the key. These are the ones Poki
       asks about by name: the game claims them, so the browser must not. */
    const scrolled=[];
    for(const k of ['Space','ArrowDown','ArrowUp','ArrowLeft','ArrowRight']){
      await p.evaluate(()=>window.scrollTo(0,0));
      await p.keyboard.press(k); await H.sleep(80);
      const y=await p.evaluate(()=>window.scrollY||document.documentElement.scrollTop||0);
      if(y!==0) scrolled.push(k+' → '+y);
    }
    chk(scrolled.length===0, 'the space bar and the cursor keys scroll the page not at all'
        +(scrolled.length?' ('+scrolled.join(', ')+')':''));
    /* the keys the game does not claim are only safe because the embed cannot
       scroll in the first place — assert that, rather than assume it */
    await p.evaluate(()=>window.scrollTo(0,0));
    await p.keyboard.press('PageDown'); await H.sleep(80);
    const pg=await p.evaluate(()=>window.scrollY||document.documentElement.scrollTop||0);
    note('page-down with the frame forced scrollable moves it '+pg+'px — harmless only '
         +'because the embed sets overflow:hidden, checked next');
    await p.evaluate(()=>{ const d=document.getElementById('tallpad'); if(d) d.remove();
      document.documentElement.style.overflow=''; document.body.style.overflow=''; });

    /* the embed itself must not be scrollable in the first place */
    const over=await p.evaluate(()=>({
      docScroll: document.documentElement.scrollHeight-document.documentElement.clientHeight,
      bodyOverflow: getComputedStyle(document.body).overflow }));
    chk(over.docScroll<=0, 'and the document is not taller than the frame to begin with');
    chk(/hidden/.test(over.bodyOverflow), 'the embed body does not scroll');
  } finally { await s.close(); }
}

/* ====================================================================== */
const SIZES=[
  ['poki minimum',        640,360, 1,false],
  ['720p',               1280,720, 1,false],
  ['1080p',              1920,1080,1,false],
  ['odd wide',           1440,600, 1,false],
  ['odd tall',            800,900, 1,false],
  ['phone landscape',     844,390, 3,true ],
  ['phone landscape sm',  667,375, 2,true ],
  ['phone portrait',      390,844, 3,true ],
  ['phone portrait sm',   360,640, 3,true ],
  ['tablet portrait',     768,1024,2,true ],
  ['tablet landscape',   1024,768, 2,true ],
];
async function layout(){
  phase('layout','every box gets the whole sheet, in the right shape, with nothing off the edge');
  for(const [name,w,h,dpr,touch] of SIZES){
    const s=await H.open({file:FILE, viewport:{width:w,height:h,deviceScaleFactor:dpr,hasTouch:touch,isMobile:touch}});
    const p=s.page;
    try{
      await toMenu(p);
      await startSheet(p,0);
      const m=await p.evaluate(()=>{
        const c=document.querySelector('canvas'), r=c.getBoundingClientRect();
        const vis=e=>{ const q=e.getBoundingClientRect(); const cs=getComputedStyle(e);
          return cs.display!=='none' && cs.visibility!=='hidden' && q.width>0 && q.height>0; };
        return {
          cv:{x:r.x,y:r.y,w:r.width,h:r.height,back:[c.width,c.height]},
          deck: document.body.classList.contains('deck'),
          cmd: (()=>{const c=document.querySelector('.cmd');
                return {shown: !!c && vis(c), text: c? c.textContent.replace(/\s+/g,' ').trim() : ''};})(),
          vw:innerWidth, vh:innerHeight, dpr:devicePixelRatio,
          docOver: document.documentElement.scrollWidth-innerWidth,
          docTall: document.documentElement.scrollHeight-innerHeight,
          touchOn: vis(document.getElementById('touch')),
          pads: [...document.querySelectorAll('.touch button')].filter(vis)
                 .map(b=>{const q=b.getBoundingClientRect();return {a:b.getAttribute('aria-label'),
                    x:q.x,y:q.y,w:q.width,h:q.height};}),
          bar: (()=>{const b=document.querySelector('.bar'); if(!b||!vis(b)) return null;
                const q=b.getBoundingClientRect(); return {x:q.x,y:q.y,w:q.width,h:q.height,
                  over:b.scrollWidth-b.clientWidth,
                  /* the three things a player watches during a run */
                  run:['hudTime','hudDeaths','hudParts'].filter(id=>vis(document.getElementById(id))),
                  lines:Math.round(q.height/22)};})()
        };
      });
      const ar=m.cv.w/m.cv.h;
      const inside = m.cv.x>=-1 && m.cv.y>=-1 && m.cv.x+m.cv.w<=m.vw+1 && m.cv.y+m.cv.h<=m.vh+1;
      const fills = (m.cv.w>=m.vw-1) || (m.cv.h>=m.vh-1);   /* one axis is always full */
      const back = m.cv.back[0]<=2560 && m.cv.back[0]>=Math.min(768, Math.round(m.cv.w));
      const share = (m.cv.w*m.cv.h)/(m.vw*m.vh);
      chk(Math.abs(ar-32/18)<0.02, name+': the sheet keeps its 32:18 shape ('+ar.toFixed(3)+')');
      chk(inside, name+': the canvas is inside the box');
      chk(fills, name+': and fills it on one axis');
      chk(m.docOver<=0, name+': nothing sticks out sideways');
      chk(m.docTall<=0, name+': and the page is not taller than the frame');
      chk(back, name+': the backing store is sized for the box ('+m.cv.back.join('×')+')');
      if(touch){
        chk(m.touchOn, name+': a touch device gets the on-screen pad');
        /* pads must not sit on top of one another */
        let clash=null;
        for(let i=0;i<m.pads.length;i++) for(let j=i+1;j<m.pads.length;j++){
          const a=m.pads[i], b=m.pads[j];
          if(a.x<b.x+b.w && b.x<a.x+a.w && a.y<b.y+b.h && b.y<a.y+a.h) clash=a.a+' / '+b.a;
        }
        chk(!clash, name+': no two pads overlap'+(clash?' ('+clash+')':''));
        const small=m.pads.filter(b=>b.w<40);
        chk(small.length===0, name+': every pad is big enough for a thumb'
            +(small.length?' ('+small.map(b=>b.a+' '+Math.round(b.w)+'px').join(', ')+')':''));
        const off=m.pads.filter(b=>b.x<0||b.y<0||b.x+b.w>m.vw+1||b.y+b.h>m.vh+1);
        chk(off.length===0, name+': every pad is on screen'
            +(off.length?' ('+off.map(b=>b.a).join(', ')+')':''));
        /* A box with room under the sheet must use it: the pads belong in the
           empty band, not drawn over the one part of the screen being read.
           Where the sheet fills the box there is nowhere else for them to go,
           and they overlay it as they always have. */
        const slack=m.vh-m.cv.h;
        chk(m.deck===(slack>=220), name+': the deck is cut exactly when there is a band for it'
            +' (slack '+Math.round(slack)+'px, deck '+m.deck+')');
        if(m.deck){
          const onSheet=m.pads.filter(b=>b.x<m.cv.x+m.cv.w && m.cv.x<b.x+b.w
                                      && b.y<m.cv.y+m.cv.h && m.cv.y<b.y+b.h)
                              .filter(b=>b.a!=='Pause');
          chk(onSheet.length===0, name+': the thumb pads are off the sheet, not on it'
              +(onSheet.length?' ('+onSheet.map(b=>b.a).join(', ')+')':''));
          const low=Math.max(...m.pads.map(b=>b.y+b.h));
          chk(m.vh-low<=40, name+': and they sit at the bottom of the screen ('
              +Math.round(m.vh-low)+'px clear)');
        }
      } else {
        chk(!m.touchOn, name+': a mouse box is not given a thumb pad');
        /* and a box with no pad has to be told the controls some other way —
           the key strip is the only place double jump is ever named */
        chk(m.cmd.shown, name+': a box with no pad gets the key strip instead');
        chk(/double jump/i.test(m.cmd.text), name+': and the strip names double jump');
      }
      if(m.bar){
        chk(m.bar.over<=1, name+': the status bar fits without scrolling');
        chk(m.bar.run.length===3, name+': the clock, the deaths and the parts are all on the bar'
            +(m.bar.run.length<3?' (only '+(m.bar.run.join(', ')||'none')+')':''));
      }
      note(name+' '+w+'×'+h+'@'+dpr+' → canvas '+Math.round(m.cv.w)+'×'+Math.round(m.cv.h)
           +' at '+Math.round(m.cv.x)+','+Math.round(m.cv.y)
           +'  '+Math.round(share*100)+'% of the box  backing '+m.cv.back.join('×'));
      if(SHOTS) await p.screenshot({path:path.join(SHOTS,'layout-'+name.replace(/\W+/g,'_')+'.png')});
    }catch(e){ chk(false, name+': '+e.message); }
    finally { await s.close(); }
  }
}

/* ====================================================================== */
async function resize(){
  phase('resize','the sheet is recut live, without a reload and without drift');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}});
  const p=s.page;
  try{
    await toMenu(p);
    await startSheet(p,0);
    const shape=async()=>p.evaluate(()=>{ const c=document.querySelector('canvas'),r=c.getBoundingClientRect();
      return {w:r.width,h:r.height,bw:c.width,bh:c.height,vw:innerWidth,vh:innerHeight}; });
    const seen=[];
    for(const [w,h] of [[900,500],[640,360],[1600,900],[400,800],[1280,720],[1920,1080],[700,1000],[1280,720]]){
      await p.setViewport({width:w,height:h});
      await H.sleep(220);
      const q=await shape(); seen.push(q);
      const ar=q.w/q.h;
      chk(Math.abs(ar-32/18)<0.02, 'resize to '+w+'×'+h+' keeps the shape ('+ar.toFixed(3)+')');
      chk(q.w<=w+1 && q.h<=h+1, 'resize to '+w+'×'+h+' stays inside the box');
      chk(q.bw>1 && q.bh>1, 'resize to '+w+'×'+h+' keeps a real backing store');
    }
    /* back where we started, we should be the same size we started */
    const a=seen[4], b=seen[seen.length-1];
    chk(Math.abs(a.w-b.w)<1.5 && Math.abs(a.h-b.h)<1.5, 'returning to a size returns to the same layout');
    chk(await p.evaluate(()=>G.state==='play'), 'and the game is still running through all of it');
    chk(s.errors.length===0, 'no resize threw');
    if(s.errors.length) note(JSON.stringify(s.errors));

    /* the same for an ad handing the game back in another box, which fires no
       resize event of its own — this is what ADS.lock(false) calls fit() for */
    await p.evaluate(()=>{ ADS.lock(true); });
    await p.setViewport({width:900,height:520});
    await H.sleep(120);
    await p.evaluate(()=>{ ADS.lock(false); });
    await H.sleep(250);
    const q=await shape();
    chk(Math.abs(q.w/q.h-32/18)<0.02, 'a break that hands back a different box is re-cut, not stretched');
    chk(q.w<=901 && q.h<=521, 'and the sheet fits the box it came back to');
  } finally { await s.close(); }
}

/* ====================================================================== */
async function builder(){
  phase('builder','the builder opens, draws, and gives the sheet a usable share of every box');
  for(const [name,w,h,dpr,touch] of [['desktop',1280,720,1,false],['poki min',640,360,1,false],
                                     ['phone portrait',390,844,3,true],['phone landscape',844,390,3,true]]){
    const s=await H.open({file:FILE, viewport:{width:w,height:h,deviceScaleFactor:dpr,hasTouch:touch,isMobile:touch}});
    const p=s.page;
    try{
      await toMenu(p);
      await p.evaluate(()=>{ SAVE.unlocked=10; openBuild(); });
      await H.sleep(400);
      chk(await p.evaluate(()=>G.state==='edit'), name+': the builder opens');
      const m=await p.evaluate(()=>{
        const c=document.querySelector('canvas'), r=c.getBoundingClientRect();
        const bp=document.getElementById('buildPanel'), q=bp.getBoundingClientRect();
        return {cv:{x:r.x,y:r.y,w:r.width,h:r.height}, panel:{x:q.x,y:q.y,w:q.width,h:q.height,
          on:bp.classList.contains('on'), over:bp.scrollHeight-bp.clientHeight},
          rows:(typeof edView==='function'?edView():null), body:document.body.className,
          vw:innerWidth, vh:innerHeight};
      });
      chk(m.panel.on, name+': the panel is up');
      chk(m.cv.w>0 && m.cv.h>0, name+': the sheet has a canvas to draw on');
      chk(m.cv.x>=-1 && m.cv.y>=-1 && m.cv.x+m.cv.w<=m.vw+1 && m.cv.y+m.cv.h<=m.vh+1,
          name+': the sheet is inside the box');
      chk(m.panel.x>=-1 && m.panel.y>=-1 && m.panel.x+m.panel.w<=m.vw+1 && m.panel.y+m.panel.h<=m.vh+1,
          name+': and so is the panel');
      /* they may not sit on top of each other */
      const clash = m.cv.x<m.panel.x+m.panel.w && m.panel.x<m.cv.x+m.cv.w
                 && m.cv.y<m.panel.y+m.panel.h && m.panel.y<m.cv.y+m.cv.h;
      chk(!clash, name+': the panel does not cover the sheet');
      if(m.rows) chk(m.rows.h>=17.9, name+': all 18 rows are on screen ('+m.rows.h.toFixed(1)+')');
      /* draw a tile and read it back */
      const drew=await p.evaluate(()=>{
        if(typeof ED==='undefined') return null;
        const before=ED.grid[5][5]; ED.grid[5][5]='#'; return {before, after:ED.grid[5][5]};
      });
      chk(drew && drew.after==='#', name+': a tile can be written into the sheet');
      chk(s.errors.length===0, name+': the builder throws nothing');
      if(s.errors.length) note(JSON.stringify(s.errors));
      note(name+': sheet '+Math.round(m.cv.w)+'×'+Math.round(m.cv.h)
           +'  panel '+Math.round(m.panel.w)+'×'+Math.round(m.panel.h)+'  body "'+m.body+'"');
      if(SHOTS) await p.screenshot({path:path.join(SHOTS,'builder-'+name.replace(/\W+/g,'_')+'.png')});
    }catch(e){ chk(false, name+': '+e.message); }
    finally { await s.close(); }
  }
}

/* ====================================================================== */
async function play(){
  phase('play','a real run: keys move the player, the clock runs, and nothing throws for a minute');
  const s=await H.open({file:FILE, viewport:{width:1280,height:720}});
  const p=s.page;
  try{
    await toMenu(p);
    /* walk a spread of sheets, one from each act, drawing every frame */
    const spread=[0, 20, 45, 90, 110, 140, 153, 175, 233, 260, 313, 340, 393, 420, 473, 500];
    for(const i of spread){
      await p.evaluate(n=>{ SAVE.unlocked=600; play(n); if(G.state==='intro') closeIntro(); }, i);
      await H.sleep(60);
      /* hold right and jump for a while, then check the world is still sane */
      await p.evaluate(()=>{ IN.r=1; });
      for(let k=0;k<3;k++){ await p.evaluate(()=>{ press('jump'); }); await H.sleep(90); }
      await p.evaluate(()=>{ IN.r=0; IN.jumpHeld=0; });
      const st=await p.evaluate(()=>({t:G.tick, x:P.x, y:P.y, ok:isFinite(P.x)&&isFinite(P.y),
                                      state:G.state, drew:(typeof G.grid!=='undefined'&&G.grid.length>0)}));
      chk(st.ok, 'sheet '+(i+1)+': the player stays at a real coordinate');
      chk(st.t>0, 'sheet '+(i+1)+': the simulation ran');
      chk(st.drew, 'sheet '+(i+1)+': the sheet has geometry');
    }
    chk(s.errors.length===0, 'nothing threw across '+spread.length+' sheets');
    if(s.errors.length) note(JSON.stringify(s.errors.slice(0,4)));
    /* the console must be quiet too, apart from the game's own SDK diary */
    const noise=s.console.filter(c=>c.type==='error'||c.type==='warning')
                         .filter(c=>!/favicon/i.test(c.text));
    chk(noise.length===0, 'and the console is clean');
    if(noise.length) note(JSON.stringify(noise.slice(0,4)));
  } finally { await s.close(); }
}

/* ====================================================================== */
const PHASES={boot, lifecycle, ads, rewarded, refused:rewardRefused, adblock,
              storage, focus, layout, resize, builder, play};

(async()=>{
  console.log('browsercheck — '+FILE+(ONLY?'  (only '+ONLY+')':''));
  for(const [name,fn] of Object.entries(PHASES)){
    if(!want(name)) continue;
    try{ await fn(); }
    catch(e){ PHASE=name; ok(false, 'phase threw: '+e.message); console.log('  BUG  phase threw: '+e.message); }
  }
  console.log('\n'+checks+' checks, '+bugs.length+' problems');
  for(const [ph,w] of bugs) console.log('  ✗ ['+ph+'] '+w);
  process.exit(bugs.length?1:0);
})();
