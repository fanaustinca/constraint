/* Shared puppeteer harness: a local http server over the repo, a page with the
   Poki CDN request intercepted, and a mock SDK that records every call in
   order. Nothing here talks to the real CDN unless you ask it to (sdk:'real'),
   so a run is offline-repeatable and an adblocked load is one option away.

   The mock is deliberately a *recorder*, not a stub that also fakes UI: what
   Poki checks is the order and the count of the lifecycle calls, and those are
   only meaningful if the page believes the SDK is real. */
const http=require('http'), fs=require('fs'), path=require('path');

/* puppeteer is not a dependency of this repo — the repo ships one HTML file and
   has no package.json. Install it anywhere and point NODE_PATH at it:
     mkdir -p ~/.cbrowser && cd ~/.cbrowser
     echo '{"name":"cbrowser","private":true}' > package.json
     npm i puppeteer
   npm init -y cannot be used here: it names the package after the directory,
   and npm rejects a name beginning with a dot.
     NODE_PATH=~/.cbrowser/node_modules node tools/browsercheck.js            */
function puppet(){
  try{ return require('puppeteer'); }
  catch(e){
    console.error('This tool needs puppeteer. Install it somewhere and set NODE_PATH:\n'+
      '  mkdir -p ~/.cbrowser && cd ~/.cbrowser\n'+
      '  echo \'{"name":"cbrowser","private":true}\' > package.json\n'+
      '  npm i puppeteer\n'+
      '  NODE_PATH=$HOME/.cbrowser/node_modules node tools/browsercheck.js');
    process.exit(2);
  }
}
const root=path.join(__dirname,'..');
const CDN='https://game-cdn.poki.com/scripts/v2/poki-sdk.js';

function serve(){
  return new Promise(res=>{
    const s=http.createServer((req,rep)=>{
      const u=decodeURIComponent(req.url.split('?')[0]);
      /* the browser asks for this on its own; a 404 for it is console noise
         that has nothing to do with the game */
      if(u==='/favicon.ico'){ rep.writeHead(204); rep.end(); return; }
      const f=path.join(root, u==='/'?'/index.html':u);
      if(!f.startsWith(root)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){ rep.writeHead(404); rep.end('no'); return; }
      const t=f.endsWith('.html')?'text/html':f.endsWith('.js')?'text/javascript':'text/plain';
      rep.writeHead(200,{'content-type':t+'; charset=utf-8','cache-control':'no-store'});
      rep.end(fs.readFileSync(f));
    });
    s.listen(0,'127.0.0.1',()=>res({server:s, port:s.address().port}));
  });
}

/* The mock SDK, as a script the page loads in place of Poki's. It has to be a
   plain string: it runs in the page, not here. Ad breaks resolve on a timer so
   that "is the game frozen while an ad is up" is an observable window. */
function mockSdk(o={}){
  const ms=o.adMs===undefined?300:o.adMs;
  return `
window.__poki={calls:[], t0:performance.now()};
function __rec(n,d){ window.__poki.calls.push({n:n, at:Math.round(performance.now()-window.__poki.t0), d:d===undefined?null:d}); }
window.PokiSDK={
  init(){ __rec('init'); return new Promise(r=>setTimeout(()=>r({}), ${o.initMs===undefined?30:o.initMs})); },
  gameLoadingFinished(){ __rec('gameLoadingFinished'); },
  gameplayStart(){ __rec('gameplayStart'); },
  gameplayStop(){ __rec('gameplayStop'); },
  setDebug(){}, gameLoadingStart(){ __rec('gameLoadingStart'); },
  commercialBreak(onStart){ __rec('commercialBreak');
    window.__poki.adUp=true;
    if(onStart) onStart();
    return new Promise(r=>setTimeout(()=>{ window.__poki.adUp=false; __rec('commercialBreak:end'); r(); }, ${ms})); },
  rewardedBreak(opt){ __rec('rewardedBreak', opt&&opt.size);
    window.__poki.adUp=true;
    if(opt&&opt.onStart) opt.onStart();
    return new Promise(r=>setTimeout(()=>{ window.__poki.adUp=false; __rec('rewardedBreak:end', ${o.reward===false?'false':'true'}); r(${o.reward===false?'false':'true'}); }, ${ms})); },
  happyTime(){ __rec('happyTime'); },
  captureError(){}, shareableURL(){ return Promise.resolve(''); },
  getURLParam(){ return ''; }
};
`;
}

async function open(opts={}){
  const puppeteer=puppet();
  const {port, server}=await serve();
  const browser=await puppeteer.launch({
    headless:'new',
    args:['--no-sandbox','--disable-setuid-sandbox','--enable-unsafe-swiftshader',
          '--autoplay-policy=no-user-gesture-required','--mute-audio'].concat(opts.args||[])
  });
  const page=await browser.newPage();
  const errors=[], console_=[];
  page.on('pageerror', e=>errors.push(String(e && e.message || e)));
  page.on('console', m=>console_.push({type:m.type(), text:m.text()}));
  page.on('requestfailed', r=>console_.push({type:'requestfailed', text:r.url()}));

  const external=[];
  await page.setRequestInterception(true);
  page.on('request', r=>{
    const u=r.url();
    if(u.startsWith(`http://127.0.0.1:${port}`)) return r.continue();
    external.push(u);
    if(u===CDN){
      if(opts.sdk==='block') return r.abort('blockedbyclient');   /* adblock */
      if(opts.sdk==='real')  return r.continue();
      return r.respond({status:200, contentType:'text/javascript', body:mockSdk(opts)});
    }
    if(opts.sdk==='real') return r.continue();
    r.abort('blockedbyclient');
  });

  if(opts.device) await page.emulate(opts.device);
  else if(opts.viewport) await page.setViewport(opts.viewport);

  const file=opts.file||'poki/index.html';
  await page.goto(`http://127.0.0.1:${port}/${file}`, {waitUntil:'load', timeout:30000});
  return {browser, page, server, errors, console:console_, external, port,
    close: async()=>{ await browser.close(); server.close(); }};
}

const calls = page => page.evaluate(()=>window.__poki? window.__poki.calls.map(c=>c.n) : []);
const callRecords = page => page.evaluate(()=>window.__poki? window.__poki.calls : []);
const state = page => page.evaluate(()=>({
  state: G.state, lvl: G.lvl, inAd: ADS.inAd, playing: ADS.playing,
  announced: ADS.announced, ready: ADS.ready, absent: ADS.absent, audio: A.on
}));
/* the page has no timers we can await on, so poll for the condition */
async function until(page, fn, ms=8000, label='condition'){
  const t=Date.now();
  while(Date.now()-t<ms){
    if(await page.evaluate(fn)) return true;
    await new Promise(r=>setTimeout(r,50));
  }
  throw new Error('timed out waiting for '+label);
}
const sleep = ms => new Promise(r=>setTimeout(r,ms));

module.exports={open, puppet, calls, callRecords, state, until, sleep, mockSdk, CDN, root};
