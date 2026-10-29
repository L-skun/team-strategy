const fs=require('node:fs'),path=require('node:path');
const project=path.resolve(__dirname,'..');
let html=fs.readFileSync(path.join(project,'dist/index.html'),'utf8');
html=html.replace('<link rel="stylesheet" href="styles.css">',()=>'<style>'+fs.readFileSync(path.join(project,'dist/styles.css'),'utf8')+'</style>');
html=html.replace(/<script src="([^"]+)"><\/script>/g,(_,file)=>'<script>'+fs.readFileSync(path.join(project,'dist',file),'utf8').replace(/<\/script/gi,'<\\/script')+'</script>');
html=html.replace('</head>','<script>window.MOBILE_OFFLINE=true;</script></head>');
html=html.replace('<title>团队赛 Ban / Pick 策略台</title>','<title>团队赛策略台 · 手机离线版</title>');
html=html.replace('重新读取 Excel（覆盖界面胜率）','选择 Excel 文件');
const output=path.join(project,'..','团队赛策略台-手机离线版.html');fs.writeFileSync(output,html);console.log('Built: '+output);
