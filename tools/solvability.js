const {run}=require('./harness.js');
run(`
function botTest(lvl, attempts, frames){
  let best=1e9;
  for(let a=0;a<attempts;a++){
    G.state='play'; loadLevel(lvl);
    let dir=0, holdT=0, jt=0;
    for(let f=0;f<frames;f++){
      if(P.dead) respawn();
      /* when every file is required, go for the nearest one first */
      let tx=G.exit.x;
      if(G.allParts && G.parts<G.partsTotal){
        let bd=1e9;
        for(const g of G.gems){ if(g.got) continue;
          const d=Math.abs(g.x-P.x)+Math.abs(g.y-P.y)*0.4;
          if(d<bd){ bd=d; tx=g.x; } }
      }
      const towards=Math.sign(tx-(P.x+7))||1;
      if(--holdT<=0){ holdT=8+Math.floor(Math.random()*22); dir=Math.random()<0.92?towards:-towards; }
      IN.l=dir<0?1:0; IN.r=dir>0?1:0; IN.u=0; IN.d=Math.random()<0.02?1:0;
      if(jt>0){ jt--; IN.jumpHeld=1; } else IN.jumpHeld=0;
      if(Math.random()<0.11){ press("jump"); jt=4+Math.floor(Math.random()*16); }
      if(G.ab.dash && Math.random()<0.04) IN.dashP=1;
      try{ step(); }catch(e){ return {crash:e.message+' @f'+f}; }
      const d=Math.abs(G.exit.x-(P.x+7)); if(d<best) best=d;
      if(G.state==='done') return {solved:true, tries:a+1, parts:G.parts+'/'+G.partsTotal};
    }
  }
  return {solved:false, best:Math.round(best)};
}`);
const N=run(`LEVELS.length`);
const A=+(process.argv[2]||0), B=Math.min(N, +(process.argv[3]||N));
let ok=0; const fails=[];
for(let i=A;i<B;i++){
  const cols=run(`LEVELS[${i}].chunks.length*16`);
  const r=run(`botTest(${i}, 45, ${Math.max(14000, cols*150)})`);
  const nm=run(`LEVELS[${i}].name`), wc=run(`WORLDS[LEVELS[${i}].w].code`);
  if(r.solved) ok++;
  else { fails.push(i+1); console.log((r.crash?'CRASH':'FAIL '),String(i+1).padStart(3),wc.padEnd(12),nm.padEnd(16), r.crash||('stuck '+r.best+'px out')); }
}
console.log('\nsolved '+ok+'/'+(B-A)+(fails.length?('  failed: '+fails.join(', ')):''));
