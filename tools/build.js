/* game.html is the artifact source: no <!doctype>, no <head> — the artifact
   platform supplies those. GitHub Pages does not, so wrap it for standalone use. */
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'game.html'),'utf8');
const title=(src.match(/<title>([\s\S]*?)<\/title>/)||[,'CONSTRAINT'])[1];
/* the dev unlock is for the artifact build only */
const body=src.replace(/<title>[\s\S]*?<\/title>\s*/,'')
               .replace(/const DEVCODE='[^']*';/, "const DEVCODE=null;");
const out=`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<meta name="description" content="A precision platformer rendered as a CAD sketch. 153 sheets, six acts.">
<title>${title}</title>
<style>*{margin:0;padding:0}</style>
</head>
<body>
${body}
</body>
</html>
`;
fs.writeFileSync(path.join(root,'index.html'),out);
console.log('index.html built from game.html —', out.length, 'bytes');
