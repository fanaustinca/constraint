/* The CrazyGames submission build, generated once and written to two places:
   crazygames/index.html to upload, and index.html so GitHub Pages serves the
   very same bytes. Testing a different build than the one you submit is how a
   problem hides until the reviewer finds it, so there is one generator and
   both outputs are byte-identical. */
const fs=require('fs'), path=require('path');
const root=path.join(__dirname,'..');
function crazyHtml(){
  const src=fs.readFileSync(path.join(root,'game.html'),'utf8');
  const title=(src.match(/<title>([\s\S]*?)<\/title>/)||[,'CONSTRAINT'])[1];
  /* the dev unlock is for the artifact build only */
  const body=src.replace(/<title>[\s\S]*?<\/title>\s*/,'')
                 .replace(/const DEVCODE='[^']*';/, "const DEVCODE=null;")
                 /* this is the build with a real ad economy behind it */
                 .replace(/const CRAZY_BUILD=false;/, "const CRAZY_BUILD=true;")
                 /* and the rev-code box comes out of the markup, not just hidden */
                 .replace(/\s*<span class="codebox">[\s\S]*?<\/span>/, '');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no,viewport-fit=cover">
<meta name="color-scheme" content="dark">
<title>${title}</title>
<style>*{margin:0;padding:0}html,body{height:100%}</style>
<script src="https://sdk.crazygames.com/crazygames-sdk-v3.js"></script>
</head>
<body class="embed">
${body}
</body>
</html>
`;
}
module.exports={crazyHtml, root};
