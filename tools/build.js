/* Writes index.html — what GitHub Pages serves. This is deliberately the same
   build that goes to Poki, SDK and all, so the public URL and the submission
   are never two different games. */
const fs=require('fs'), path=require('path');
const {pokiHtml, root}=require('./pokihtml.js');
const out=pokiHtml();
fs.writeFileSync(path.join(root,'index.html'),out);
console.log('index.html built from game.html (Poki build) —', out.length, 'bytes');
