/* pull the <script> body out of index.html so node can run the game headless */
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const s=fs.readFileSync(path.join(root,'index.html'),'utf8');
const js=s.slice(s.indexOf('<script>')+8, s.lastIndexOf('</scr'+'ipt>'));
fs.mkdirSync(path.join(root,'build'),{recursive:true});
fs.writeFileSync(path.join(root,'build','game.js'), js);
console.log('build/game.js written —', js.length, 'bytes');
