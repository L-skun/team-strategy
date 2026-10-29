const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const workbookExport = require('./dist/xlsx-export.js');

const root = path.resolve(__dirname, 'dist');
const workbook = path.resolve(__dirname, '..', '团队赛卡组对局分析.xlsx');
const types = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function createServer(options = {}) {
const stateFile = options.stateFile || path.resolve(__dirname, '.local', 'state.json');
const workbookFile = options.workbookFile || workbook;
return http.createServer((request, response) => {
  if (request.url === '/api/workbook') {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(request.headers.host || '') || (request.headers.origin && request.headers.origin !== 'http://' + request.headers.host)) { response.writeHead(403).end(); return; }
    if (request.method !== 'POST') { response.writeHead(405).end(); return; }
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) { response.writeHead(415).end(); return; }
    let chunks=[],size=0;
    request.on('data', chunk => { size+=chunk.length; if(size<=2*1024*1024)chunks.push(chunk); });
    request.on('end', () => {
      if(size>2*1024*1024){response.writeHead(413).end();return;}
      let input,bytes;
      try { input=JSON.parse(Buffer.concat(chunks));if(input.mode!=='overwrite'&&input.mode!=='new')throw Error('请选择覆盖或新建');bytes=Buffer.from(workbookExport.create(input.data)); }
      catch(error){response.writeHead(400,{'Content-Type':'application/json'}).end(JSON.stringify({error:error.message}));return;}
      const version=crypto.createHash('sha256').update(bytes).digest('hex');
      try {
        const stamp=new Date().toISOString().replace(/[:.]/g,'-')+'-'+crypto.randomBytes(3).toString('hex');
        let target=workbookFile,backup=null;
        if(input.mode==='overwrite'){
          const current=fs.existsSync(target)?fs.readFileSync(target):null;
          const currentVersion=current?crypto.createHash('sha256').update(current).digest('hex'):null;
          if(currentVersion!==(input.expectedVersion||null)){response.writeHead(409,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Excel 已在外部更新，请先重新读取 Excel；或选择另存为新文件，避免覆盖他人修改。'}));return;}
          if(current){const dir=path.join(path.dirname(stateFile),'excel-backups');fs.mkdirSync(dir,{recursive:true});backup=path.join(dir,'覆盖前-'+stamp+'.xlsx');fs.writeFileSync(backup,current,{flag:'wx'});}
          const temp=target+'.'+stamp+'.tmp';
          try{fs.writeFileSync(temp,bytes,{flag:'wx'});fs.renameSync(temp,target);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
        }else{
          target=path.join(path.dirname(workbookFile),'团队赛卡组对局分析-'+stamp+'.xlsx');fs.writeFileSync(target,bytes,{flag:'wx'});
        }
        response.writeHead(200,{'Content-Type':'application/json'}).end(JSON.stringify({name:path.basename(target),path:target,version:version,backup:backup}));
      }catch(error){response.writeHead(500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'保存失败，请关闭占用文件的 Excel 后重试：'+error.message}));}
    });
    return;
  }
  if (request.url === '/api/health') {
    response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    response.end(JSON.stringify({ app: 'team-strategy', protocolVersion: 2, directory: __dirname, pid: process.pid }));
    return;
  }
  if (request.url === '/api/state') {
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(request.headers.host || '')) { response.writeHead(403).end(); return; }
    const origin = request.headers.origin;
    if (origin && origin !== 'http://' + request.headers.host) {
      response.writeHead(403).end('Forbidden'); return;
    }
    if (request.method === 'GET') {
      fs.readFile(stateFile, (error, bytes) => {
        response.writeHead(error ? (error.code === 'ENOENT' ? 404 : 500) : 200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
        response.end(error ? '{}' : bytes);
      });
      return;
    }
    if (request.method !== 'PUT') { response.writeHead(405, { Allow: 'GET, PUT' }).end(); return; }
    if (!/^application\/json(?:;|$)/i.test(request.headers['content-type'] || '')) { response.writeHead(415).end(); return; }
    let bytes = 0, chunks = [], tooLarge = false;
    request.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) { tooLarge = true; chunks = []; } else if (!tooLarge) chunks.push(chunk);
    });
    request.on('end', () => {
      if (tooLarge) { response.writeHead(413).end(); return; }
      let value;
      try {
        value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        if (!value || !Array.isArray(value.ourDecks) || !Array.isArray(value.opponentDecks) || !Array.isArray(value.rates)) throw Error('Invalid state');
      } catch { response.writeHead(400).end('Invalid JSON state'); return; }
      try {
        fs.mkdirSync(path.dirname(stateFile), { recursive: true });
        fs.writeFileSync(stateFile + '.tmp', JSON.stringify(value, null, 2), 'utf8');
        fs.renameSync(stateFile + '.tmp', stateFile);
        response.writeHead(200, { 'Content-Type': 'application/json' }).end('{"saved":true}');
      } catch { response.writeHead(500).end('Unable to save state'); }
    });
    return;
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.writeHead(405, { Allow: 'GET, HEAD' }).end('Method Not Allowed');
    return;
  }
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
  } catch {
    response.writeHead(400).end('Bad Request');
    return;
  }

  const relative = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const isWorkbook = pathname === '/data/matchups.xlsx';
  const file = isWorkbook ? workbookFile : path.resolve(root, relative);
  if (!isWorkbook && file !== root && !file.startsWith(root + path.sep)) {
    response.writeHead(403).end('Forbidden');
    return;
  }

  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) {
      response.writeHead(404).end('Not Found');
      return;
    }
    if (isWorkbook) {
      fs.readFile(file, (readError, bytes) => {
        if (readError) { response.writeHead(500).end('Unable to read workbook'); return; }
        response.writeHead(200, { 'Content-Type': types['.xlsx'], 'Cache-Control': 'no-store', 'X-Workbook-Version': crypto.createHash('sha256').update(bytes).digest('hex') });
        response.end(request.method === 'HEAD' ? undefined : bytes);
      });
      return;
    }
    response.writeHead(200, {
      'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    });
    if (request.method === 'HEAD') {
      response.end();
      return;
    }
    const stream = fs.createReadStream(file);
    stream.on('error', () => {
      if (!response.headersSent) response.writeHead(500);
      response.end();
    });
    stream.pipe(response);
  });
});
}

if (require.main === module) createServer().listen(Number(process.argv[2]) || 4173, '127.0.0.1', () => {
  console.log('Team strategy local server ready');
  console.log('Workbook: ' + workbook);
});

module.exports = { createServer };
