/* CrazyGames build: the same game, wrapped full-screen with their SDK.
   This is the ONLY build that loads anything external. index.html gets the
   identical bytes — see tools/crazyhtml.js. */
const fs=require('fs'), path=require('path');
const {crazyHtml, root}=require('./crazyhtml.js');
const out=crazyHtml();
fs.mkdirSync(path.join(root,'crazygames'),{recursive:true});
fs.writeFileSync(path.join(root,'crazygames','index.html'),out);
console.log('crazygames/index.html built —', out.length, 'bytes');
