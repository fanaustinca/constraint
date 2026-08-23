const fs=require('fs'), vm=require('vm');
const path=require('path');
const src=fs.readFileSync(path.join(__dirname,'..','build','game.js'),'utf8');

const noop=()=>{};
const ctxProxy=new Proxy({},{get:(t,k)=>{
  if(k==='canvas') return {width:0,height:0};
  if(k==='roundRect') return undefined;
  if(k==='createPattern') return ()=>({});
  if(k==='setTransform') return noop;
  return t[k]!==undefined?t[k]:noop;
}, set:()=>true});
/* getElementById hands back the same object for the same id, the way a browser
   does. Without it a classList change the game makes is invisible to a test —
   the probe reads a different object than the one the game touched, and every
   DOM assertion quietly passes or quietly fails for the wrong reason. */
const _els={};
function el(id){
  if(id!==undefined && _els[id]) return _els[id];
  const e={
  classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
  style:{}, innerHTML:'', textContent:'', value:'', disabled:false,
  appendChild:noop, addEventListener:noop, removeEventListener:noop,
  querySelectorAll:()=>[], getContext:()=>ctxProxy, width:0, height:0,
  onclick:null };
  e.classList={ _s:new Set(),
    add(c){this._s.add(c)}, remove(c){this._s.delete(c)},
    toggle(c,on){ on===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c))
                                : (on?this._s.add(c):this._s.delete(c)); },
    contains(c){ return this._s.has(c); } };
  if(id!==undefined) _els[id]=e;
  return e; }
const store={};
const sandbox={
  console,
  document:{ getElementById:id=>el(id), createElement:()=>el(), querySelectorAll:()=>[],
             addEventListener:noop, body:el() },
  window:{ devicePixelRatio:1, AudioContext:null },
  addEventListener:noop, removeEventListener:noop,
  matchMedia:()=>({matches:false, addEventListener:noop}),
  devicePixelRatio:1,
  requestAnimationFrame:()=>0,
  performance:{now:()=>0},
  setTimeout:()=>0, clearTimeout:noop,
  localStorage:{getItem:k=>store[k]||null,setItem:(k,v)=>store[k]=v,removeItem:k=>delete store[k]},
  Math, Date, JSON, Array, Object, String, Number, Proxy,
};
sandbox.window.AudioContext=function(){ throw new Error('no audio'); };
sandbox.globalThis=sandbox;
vm.createContext(sandbox);
vm.runInContext(src,sandbox,{filename:'game.js'});
module.exports={sandbox, run:(code)=>vm.runInContext(code,sandbox)};
