const {run}=require('./harness.js');
run(require('fs').readFileSync('./solvability.js','utf8').match(/run\(`([\s\S]*?)`\)/)[1]);
const L=run(`LEVELS.length`)-1;
const t0=Date.now();
const r=run(`botTest(${L}, 60, 120000)`);
console.log('The Last Sketch:', JSON.stringify(r), `(${((Date.now()-t0)/1000).toFixed(0)}s)`);
if(!r.solved){
  run(`
  function far(lvl,att,fr){
    let best=0;
    for(let a=0;a<att;a++){
      G.state='play'; loadLevel(lvl);
      let dir=0,holdT=0,jt=0;
      for(let f=0;f<fr;f++){
        if(P.dead) respawn();
        const t=Math.sign(G.exit.x-(P.x+7))||1;
        if(--holdT<=0){ holdT=8+Math.floor(Math.random()*22); dir=Math.random()<0.92?t:-t; }
        IN.l=dir<0?1:0; IN.r=dir>0?1:0;
        if(jt>0){jt--;IN.jumpHeld=1;}else IN.jumpHeld=0;
        if(Math.random()<0.11){press('jump');jt=4+Math.floor(Math.random()*16);}
        if(G.ab.dash&&Math.random()<0.04) IN.dashP=1;
        step();
        if(P.x>best) best=P.x;
        if(G.state==='done') return {solved:true};
      }
    }
    return {furthestCol:Math.round(best/24), ofCols:COLS,
            stuckAtSegment:LEVELS[lvl].chunks[Math.floor(Math.round(best/24)/16)]};
  }`);
  console.log('progress:', JSON.stringify(run(`far(${L},8,120000)`)));
}
