const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const os = require('node:os');
const { createServer } = require('../serve.cjs');

function app(fetcher, protocol='http:') {
  const elements = new Map();
  const get = id => { if (!elements.has(id)) elements.set(id,{textContent:''}); return elements.get(id); };
  const main={inert:false};
  const document={getElementById:get,querySelector:()=>main,addEventListener(){}};
  const localStorage={getItem(){return null;},setItem(){},removeItem(){}};
  const context={localStorage,window:{DEMO_DATA:require('../dist/demo-data.js'),location:{protocol}},document,fetch:fetcher,AbortController,setTimeout,clearTimeout};
  vm.createContext(context);
  let source=fs.readFileSync(path.join(__dirname,'../dist/app.js'),'utf8');
  source=source.replace("  document.addEventListener('DOMContentLoaded',init);", "  els.persistenceStatus=document.getElementById('persistenceStatus');els.workbookStatus=document.getElementById('workbookStatus');refresh=function(){};hideResults=function(){};window.api={mergeWorkbook:mergeWorkbook,load:loadAnchoredWorkbook,apply:applyImported,state:serializable,save:saveLocal,restore:restoreDisk};");
  vm.runInContext(source,context);
  return {api:context.window.api,context,get,main};
}
const workbook=()=>({ourDecks:['A','B','C','D','E'],opponentDecks:['W','X','Y','Z'],rates:Array.from({length:5},()=>Array(4).fill(.7)),opponentRates:Array.from({length:5},()=>Array(4).fill(null)),demo:false});

test('fixed workbook endpoint returns exact source bytes, disables caching and restricts methods',async()=>{
  const temporary=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-endpoint-'));
  const workbookFile=path.join(temporary,'fixture.xlsx');const original=require('../dist/xlsx-export.js').create(workbook());fs.writeFileSync(workbookFile,original);
  const server=createServer({workbookFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const base='http://127.0.0.1:'+server.address().port;
    const response=await fetch(base+'/data/matchups.xlsx');
    assert.equal(response.status,200);assert.equal(response.headers.get('cache-control'),'no-store');
    assert.match(response.headers.get('content-type'),/spreadsheetml/);
    assert.deepEqual(Buffer.from(await response.arrayBuffer()),Buffer.from(original));
    assert.equal((await fetch(base+'/data/matchups.xlsx',{method:'HEAD'})).status,200);
    assert.equal((await fetch(base+'/data/matchups.xlsx',{method:'POST'})).status,405);
    assert.equal((await fetch(base+'/background.txt')).status,404);
  } finally {await new Promise(resolve=>server.close(resolve));fs.rmSync(temporary,{recursive:true,force:true});}
});

test('Excel wins over saved rates while compatible settings survive and renamed decks reconcile',()=>{
  const {api}=app();let saved=workbook();Object.assign(saved,{selectedOur:['A','B','C','D','E'],selectedOpponent:['W','X','Y','Z'],excludedOur:['A'],topN:'all',mode:'robust',pairing:'random',correction:.3});
  api.apply(saved);const updated=workbook();updated.rates[0][0]=.91;api.mergeWorkbook(updated);
  let state=api.state();assert.equal(state.rates[0][0],.91);assert.equal(state.topN,'all');assert.equal(state.mode,'robust');assert.equal(state.pairing,'random');assert.equal(state.correction,.3);assert.equal(state.excludedOur[0],'A');
  const changed=workbook();changed.ourDecks=['A','B','C','F'];changed.rates=changed.rates.slice(0,4);changed.opponentRates=changed.opponentRates.slice(0,4);api.mergeWorkbook(changed);
  state=api.state();assert.deepEqual(Array.from(state.selectedOur),changed.ourDecks);assert.equal(state.excludedOur.length,0);
});

test('startup reads fresh workbook and unlocks UI; failures preserve state',async()=>{
  let requests=0;const {api,context,get,main}=app(async(url,options)=>{assert.equal(url,'data/matchups.xlsx');assert.equal(options.cache,'no-store');requests++;return {ok:true,arrayBuffer:async()=>new ArrayBuffer(0)};});
  context.window.importMatchupWorkbook=async()=>workbook();
  await api.load();assert.equal(requests,1);assert.equal(api.state().rates[0][0],.7);assert.equal(main.inert,false);assert.match(get('workbookStatus').textContent,/已检查/);
  const before=JSON.stringify(api.state());context.fetch=async()=>({ok:false,status:404});await api.load();assert.equal(JSON.stringify(api.state()),before);assert.match(get('workbookStatus').textContent,/未找到/);assert.equal(main.inert,false);
  context.fetch=async()=>({ok:true,arrayBuffer:async()=>new ArrayBuffer(0)});context.window.importMatchupWorkbook=async()=>{throw Error('格式错误');};await api.load();assert.equal(JSON.stringify(api.state()),before);assert.match(get('workbookStatus').textContent,/格式错误/);
});

test('file opening explains local server without attempting network access',async()=>{
  const {api,get}=app(()=>{throw Error('unexpected fetch');},'file:');await api.load();assert.match(get('workbookStatus').textContent,/团队赛策略台.exe/);
});


test('disk state survives server restart, rejects foreign origins, and stays outside static files',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'team-strategy-test-'));
  const stateFile=path.join(dir,'state.json');let server;
  async function start(){server=createServer({stateFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return 'http://127.0.0.1:'+server.address().port;}
  async function stop(){await new Promise(resolve=>server.close(resolve));}
  try{
    let base=await start();assert.equal((await fetch(base+'/api/state')).status,404);
    const state={...workbook(),correction:.37,topN:'all'};
    let response=await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify(state)});assert.equal(response.status,200);
    assert.equal(JSON.parse(fs.readFileSync(stateFile)).correction,.37);
    assert.equal((await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json',Origin:'https://example.com'},body:JSON.stringify(state)})).status,403);
    assert.equal((await fetch(base+'/api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:'invalid'})).status,400);
    assert.equal((await fetch(base+'/.local/state.json')).status,404);
    await stop();base=await start();response=await fetch(base+'/api/state');assert.deepEqual(await response.json(),state);
  }finally{if(server&&server.listening)await stop();fs.rmSync(dir,{recursive:true,force:true});}
});

test('unchanged Excel keeps saved rates and defaults, updated Excel replaces rates only',async()=>{
  let version='same';const {api,context}=app(async()=>({ok:true,headers:{get:()=>version},arrayBuffer:async()=>new ArrayBuffer(0)}));
  const saved={...workbook(),workbookVersion:'same',topN:'all',correction:.34};saved.rates[0][0]=.88;api.apply(saved);
  context.window.importMatchupWorkbook=async()=>workbook();await api.load();assert.equal(api.state().rates[0][0],.88);assert.equal(api.state().correction,.34);
  version='updated';await api.load();assert.equal(api.state().rates[0][0],.7);assert.equal(api.state().topN,'all');assert.equal(api.state().correction,.34);assert.equal(api.state().workbookVersion,'updated');
});

test('frontend saves complete state to project and restores it without browser storage',async()=>{
  let stored;
  const {api,context,get}=app(async(url,options)=>{
    assert.equal(url,'api/state');
    if(options.method==='PUT'){stored=JSON.parse(options.body);return {ok:true};}
    return {ok:true,json:async()=>stored};
  });
  const saved={...workbook(),topN:2,correction:.41,workbookVersion:'v1'};saved.rates[0][0]=.82;api.apply(saved);await api.save();
  assert.equal(stored.topN,2);assert.equal(stored.correction,.41);assert.equal(stored.rates[0][0],.82);assert.match(get('persistenceStatus').textContent,/已保存/);
  api.apply(workbook());await api.restore();assert.equal(api.state().rates[0][0],.82);assert.equal(api.state().correction,.41);
  context.fetch=async()=>{throw Error('offline');};await api.save();assert.match(get('persistenceStatus').textContent,/保存失败/);
});


test('Excel save creates a new file, backs up overwrite, and refuses stale or malformed input',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-excel-'));const workbookFile=path.join(dir,'original.xlsx');const stateFile=path.join(dir,'state.json');
 const source=Buffer.from('original bytes');fs.writeFileSync(workbookFile,source);
 const server=createServer({stateFile,workbookFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const base='http://127.0.0.1:'+server.address().port;
 try{
  const initial=await fetch(base+'/data/matchups.xlsx');const version=initial.headers.get('X-Workbook-Version');
  const send=body=>fetch(base+'/api/workbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
  let response=await send({mode:'new',data:workbook()});assert.equal(response.status,200);let saved=await response.json();assert.ok(fs.existsSync(saved.path));assert.deepEqual(fs.readFileSync(workbookFile),source);
  response=await send({mode:'overwrite',data:workbook(),expectedVersion:version});assert.equal(response.status,200);saved=await response.json();assert.deepEqual(fs.readFileSync(saved.backup),source);assert.equal(fs.readFileSync(workbookFile).readUInt32LE(0),0x04034b50);
  response=await send({mode:'overwrite',data:workbook(),expectedVersion:version});assert.equal(response.status,409);
  const bad=workbook();bad.rates[0][0]=1.2;assert.equal((await send({mode:'new',data:bad})).status,400);
  assert.equal((await send({mode:'../../outside',data:workbook()})).status,400);
 }finally{await new Promise(resolve=>server.close(resolve));fs.rmSync(dir,{recursive:true,force:true});}
});
