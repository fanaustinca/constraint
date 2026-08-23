/* The builder: share codes, remixing an official sheet, and what each theme
   does to a custom sheet. Ad and SDK behaviour lives in tools/pokicheck.js.

     node tools/buildercheck.js                                             */
const {run, ink}=require(require('path').join(__dirname,'harness.js'));
let fail=0;
const ok=(c,m)=>{ if(!c){ console.log('FAIL '+m); fail++; } else console.log('  ok  '+m); };

/* ---- share code v2 round trip, and v1 still readable ---- */
const g=run('blankGrid(64)');
const c2=run('encodeGrid(blankGrid(64),64,"winter")');
ok(/^CS2\.64\.winter\./.test(c2), 'v2 code names the theme');
const d2=run('decodeGrid('+JSON.stringify(c2)+')');
ok(d2 && d2.cols===64 && d2.theme==='winter', 'v2 round trips');
const v1=run('(()=>{const c=encodeGrid(blankGrid(64),64,"code"); return "CS1.64."+c.split(".").slice(3).join(".");})()');
const d1=run('decodeGrid('+JSON.stringify(v1)+')');
ok(d1 && d1.cols===64 && d1.theme==='blueprint', 'v1 code still loads, as blueprint');
ok(run('decodeGrid("CS2.64.winter.garbage")')===null, 'a broken v2 body is rejected');

/* body that begins with a lowercase tile char must not be mistaken for a theme */
const trick=run('(()=>{const g=blankGrid(64); g[0][0]="w"; for(let x=1;x<64;x++) g[0][x]="."; return encodeGrid(g,64,"space");})()');
const dt=run('decodeGrid('+JSON.stringify(trick)+')');
ok(dt && dt.theme==='space' && dt.g[0][0]==='w', 'lowercase-leading body is not read as the theme');

/* ---- remix: every official sheet comes out editable ---- */
const n=run('LEVELS.length');
let bad=[];
for(let i=0;i<n;i++){
  const r=run(`(()=>{const d=gridFromLevel(${i}); if(!d) return "null";
    let P=0,X=0,cols=d.cols;
    if(d.g.length!==ROWS) return "rows";
    for(const row of d.g){ if(row.length!==cols) return "width"; for(const ch of row){ if(ch==="P")P++; else if(ch==="X")X++; } }
    if(P!==1||X!==1) return "spawn/exit "+P+"/"+X;
    if(cols<32||cols>1088) return "cols "+cols;
    const code=encodeGrid(d.g,cols,"blueprint"); const back=decodeGrid(code);
    if(!back||back.cols!==cols) return "code";
    for(let y=0;y<ROWS;y++) for(let x=0;x<cols;x++) if(back.g[y][x]!==d.g[y][x]) return "mismatch";
    return "ok";})()`);
  if(r!=='ok') bad.push(i+':'+r);
}
ok(bad.length===0, 'all '+n+' sheets remix + re-encode cleanly'+(bad.length?' — '+bad.slice(0,6).join(', '):''));

/* ---- themes drive loadCustom ---- */
const themes=run('BTHEMES.map(t=>t.k)');
for(const k of themes){
  const r=run(`(()=>{ ED.theme=${JSON.stringify(k)}; const d=gridFromLevel(0);
    loadCustom(d.g,d.cols);
    return {rmode:G.rmode, g:G.gscale, a:G.ascale, eat:G.eatOn, w:G.weather, ch:G.chaos, spawn:!!G.spawn,
            powder:G.grid.some(r=>r.indexOf("w")>=0)};})()`);
  const want=run(`bTheme(${JSON.stringify(k)}).mod`);
  ok(r.rmode===(want.render||'normal'), k+': render mode');
  ok(r.g===(want.gravity||1) && r.a===(want.accel||1), k+': gravity/accel');
  ok(r.eat===!!want.eat, k+': cursor');
  ok(!r.powder, k+': no powder dropped into a hand-drawn sheet');
  ok(r.spawn, k+': still has a spawn');
}

/* ---- every palette entry has to be visible once you place it ----
   Spawn, exit, parts, keys, datums and both portal ends are lifted out of the
   grid when a sheet loads, so drawTiles() has no case for them. Portals used to
   fall straight through that gap: placeable, saved, and playable, but nothing
   on screen until you hit test. */
run('openBuild(); ED.cols=32; G.cam=0;');
const blank=()=>run(`ED.grid=Array.from({length:ROWS},()=>Array(ED.cols).fill('.'));`);
const invisible=[];
for(const [ch,name] of run('PALETTE.map(p=>[p[0],p[1]])')){
  if(ch==='.') continue;
  blank();
  const base=ink(()=>run('drawEditor()'));
  run(`ED.grid[8][10]=${JSON.stringify(ch)};`);
  const drawn=ink(()=>run('drawEditor()'))-base;
  ok(drawn>0, 'builder draws '+name+' ['+ch+']'+(drawn>0?'':' — nothing on screen'));
  if(drawn<=0) invisible.push(ch);
}
ok(invisible.length===0, 'no palette entry is invisible in the builder'+
   (invisible.length?' — '+invisible.join(' '):''));
blank();

/* ---- ownership ---- */
ok(run('themeOwned("blueprint")')===true, 'blueprint is free');
ok(run('themeOwned("cursor")')===true, 'the cursor is free');
ok(run('themeOwned("code")')===false, 'code starts locked');
run('SAVE.unl.th.code=1');
ok(run('themeOwned("code")')===true, 'code unlocks');
run('delete SAVE.unl.th.code');

console.log(fail? '\n'+fail+' FAILED' : '\nall clear');
process.exit(fail?1:0);
