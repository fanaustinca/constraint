/* deliberate.js — a bot that plays on rules instead of dice.
 *
 * solvability.js jumps at random. That is the right tool for "is there a way
 * through at all", and the wrong one for any sheet whose answer is "do not jump
 * here, then jump exactly here" — a stretch of ceiling with spikes under it
 * followed by a spike on the floor is a shape random play cannot survive, and
 * it will report that sheet failed on every run forever.
 *
 * Sheet 4 (FIXED / "Chamfer") was carried as an open item for exactly that
 * reason. This bot clears it in 593 frames with no deaths: it holds right,
 * jumps for a hazard, a hole or a wall ahead, and never jumps while there is
 * something overhead to jump into. Nothing random, so a pass is a pass.
 *
 *   node tools/deliberate.js            all 600
 *   node tools/deliberate.js 3 4        just sheet 4 (0-based, half open)
 *
 * A sheet this bot fails is not necessarily unfair — it has no idea about
 * phase timing, portals, moving platforms or anything needing a route rather
 * than a direction. It is evidence about the sheets it clears, not the others.
 */
const {run}=require('./harness.js');

run(`
function deliberate(lvl, frames){
  G.state='play'; loadLevel(lvl);
  IN.l=IN.r=IN.u=IN.d=IN.jumpHeld=0; IN.r=1;
  const SOLID='#SInu=MH';
  let jt=0, best=1e9, deaths=0;
  for(let f=0;f<frames;f++){
    if(P.dead){ deaths++; respawn(); }
    const cx=Math.floor((P.x+7)/24), cy=Math.floor((P.y+9)/24);
    let danger=false, hole=false, roofed=false, wall=false;
    for(let d=1; d<=2; d++){
      const c=cx+d; if(c<0||c>=COLS) break;
      for(let r=cy-1;r<=cy+1;r++){ const t=(G.grid[r]||[])[c]; if(t==='^'||t==='v') danger=true; }
      if(((G.grid[cy+1]||[])[c])==='.' && ((G.grid[cy+2]||[])[c])==='.') hole=true;
    }
    { const t=(G.grid[cy]||[])[cx+1]; if(t && SOLID.indexOf(t)>=0) wall=true; }
    /* the rule the dice cannot learn: never jump into what is above you */
    for(let r=cy-1;r>=cy-3;r--){ const t=(G.grid[r]||[])[cx]; if(t==='v'||t==='#') roofed=true; }
    if((danger||hole||wall) && P.ground && jt<=0 && !roofed){ press('jump'); jt=13; }
    if(jt>0){ jt--; IN.jumpHeld=1; } else IN.jumpHeld=0;
    try{ step(); }catch(e){ return {crash:e.message+' @f'+f}; }
    const d=Math.abs(G.exit.x-(P.x+7)); if(d<best) best=d;
    if(G.state==='done') return {won:true, f:f, deaths:deaths};
  }
  return {won:false, col:+(P.x/24).toFixed(1), best:Math.round(best), deaths:deaths};
}`);

const N=run(`LEVELS.length`);
const A=+(process.argv[2]||0), B=Math.min(N, +(process.argv[3]||N));
let ok=0; const fails=[];
for(let i=A;i<B;i++){
  const cols=run(`LEVELS[${i}].chunks.length*16`);
  const r=run(`deliberate(${i}, ${Math.max(4000, cols*90)})`);
  if(r.won){
    ok++;
    if(B-A<=8) console.log('WON  ', String(i+1).padStart(3), run(`LEVELS[${i}].name`),
                           '—', r.f+' frames, '+r.deaths+' deaths');
  } else {
    fails.push(i+1);
    if(B-A<=8) console.log(r.crash?'CRASH':'no   ', String(i+1).padStart(3),
                           run(`LEVELS[${i}].name`), '—', r.crash||('reached col '+r.col));
  }
}
/* Not a score. A cleared sheet is proof that sheet has a way through that
   needs no luck; an uncleared one says only that this bot does not know how to
   play it — it cannot collect a part, ride a platform, time a phase block, take
   a portal or use a dash. Read the first number, ignore the second. */
console.log('\nproved solvable without luck: '+ok+' of the '+(B-A)+' looked at');
if(B-A>8) console.log('the other '+fails.length+' are beyond what this bot knows how to do,'
                      +' which is not evidence either way');
