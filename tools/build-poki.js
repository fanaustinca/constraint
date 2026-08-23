/* Poki build: the same game, wrapped full-screen with their SDK.
   This is the ONLY build that loads anything external. index.html gets the
   identical bytes — see tools/pokihtml.js. */
const fs=require('fs'), path=require('path');
const {pokiHtml, root}=require('./pokihtml.js');
const out=pokiHtml();
fs.mkdirSync(path.join(root,'poki'),{recursive:true});
fs.writeFileSync(path.join(root,'poki','index.html'),out);
console.log('poki/index.html built —', out.length, 'bytes');
