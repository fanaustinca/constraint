const {run}=require('./harness.js');
run(`
function esc(lvl,attempts,frames){
  let n=0;
  for(let a=0;a<attempts;a++){
    G.state='play'; loadLevel(lvl);
    let dir=0,holdT=0,jt=0;
    for(let f=0;f<frames;f++){
      if(P.dead) respawn();
      const t=Math.sign(G.exit.x-(P.x+7))||1;
      if(--holdT<=0){ holdT=8+Math.floor(Math.random()*22); dir=Math.random()<0.75?t:(Math.random()<.5?1:-1); }
      IN.l=dir<0?1:0; IN.r=dir>0?1:0; IN.d=Math.random()<0.02?1:0;
      if(jt>0){jt--;IN.jumpHeld=1;}else IN.jumpHeld=0;
      if(Math.random()<0.10){press('jump');jt=4+Math.floor(Math.random()*16);}
      if(G.ab.dash&&Math.random()<0.03) IN.dashP=1;
      step();
      if(!P.dead && (P.x<-1 || P.x>COLS*TS-14+1 || P.y<-1)) n++;
      if(G.state==='done') break;
    }
  }
  return n;
}`);
let tot=0;
for(let i=0;i<153;i++) tot+=run(`esc(${i},4,1800)`);
console.log('out-of-bounds frames across all 153 sheets:', tot);
