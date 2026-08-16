const fs=require('fs'), vm=require('vm');
const src=fs.readFileSync('../build/game.js','utf8');

const noop=()=>{};
const ctxProxy=new Proxy({},{get:(t,k)=>{
  if(k==='canvas') return {width:0,height:0};
  if(k==='roundRect') return undefined;
  if(k==='createPattern') return ()=>({});
  if(k==='setTransform') return noop;
  return t[k]!==undefined?t[k]:noop;
}, set:()=>true});
function el(){ const e={
  classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},
  style:{}, innerHTML:'', textContent:'', value:'', disabled:false,
  appendChild:noop, addEventListener:noop, removeEventListener:noop,
  querySelectorAll:()=>[], getContext:()=>ctxProxy, width:0, height:0,
  onclick:null };
  return e; }
const store={};
const sandbox={
  console,
  document:{ getElementById:()=>el(), createElement:()=>el(), querySelectorAll:()=>[],
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
