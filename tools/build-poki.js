/* Poki build: the same game, wrapped full-screen with their SDK.
   This is the ONLY build that loads anything external. */
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
const src=fs.readFileSync(path.join(root,'game.html'),'utf8');
const title=(src.match(/<title>([\s\S]*?)<\/title>/)||[,'CONSTRAINT'])[1];
const body=src.replace(/<title>[\s\S]*?<\/title>\s*/,'');
const out=`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>*{margin:0;padding:0}html,body{height:100%}</style>
<script src="https://game-cdn.poki.com/scripts/v2/poki-sdk.js"></script>
</head>
<body class="embed">
${body}
</body>
</html>
`;
fs.mkdirSync(path.join(root,'poki'),{recursive:true});
fs.writeFileSync(path.join(root,'poki','index.html'),out);
console.log('poki/index.html built —', out.length, 'bytes');
