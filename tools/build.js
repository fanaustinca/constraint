/* Writes index.html — what GitHub Pages serves. This is deliberately the same
   build that goes to CrazyGames, SDK and all, so the public URL and the
   submission are never two different games. */
const fs=require('fs'), path=require('path');
const {crazyHtml, root}=require('./crazyhtml.js');
const out=crazyHtml();
fs.writeFileSync(path.join(root,'index.html'),out);
console.log('index.html built from game.html (CrazyGames build) —', out.length, 'bytes');
