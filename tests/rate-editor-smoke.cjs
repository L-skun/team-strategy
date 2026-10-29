const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),{createServer}=require('../serve.cjs'),exporter=require('../dist/xlsx-export.js');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-rate-editor-'));let browser;
 const fixture={ourDecks:['A','B','C','D','E'],opponentDecks:['W','X','Y','Z','V'],rates:[[.5,.4,null,.1,.95],[.1,.2,.3,.4,.5],[.6,.7,.8,.9,1],[.2,.3,.4,.5,.6],[.3,.4,.5,.6,.7]],opponentRates:Array.from({length:5},()=>Array(5).fill(null))};fixture.opponentRates[0][0]=0;fixture.opponentRates[4][4]=.5;
 const workbookFile=path.join(temp,'fixture.xlsx');fs.writeFileSync(workbookFile,exporter.create(fixture));const stateFile=path.join(temp,'state.json');const server=createServer({workbookFile,stateFile});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const mode of ['pc','offline','native']){
   const context=await browser.newContext(mode==='pc'?{}:{viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   if(mode==='native')await context.addInitScript(()=>{window.AndroidBridge={readState:()=>localStorage.getItem('nativeSaved')||'',saveState:value=>{localStorage.setItem('nativeSaved',value);return '{}';},readWorkbook:()=>'{"empty":true}',openWorkbook(){},saveExcel(){},exportFile(){}};});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(mode==='pc'?'http://127.0.0.1:'+server.address().port:pathToFileURL((fs.existsSync(path.resolve(__dirname,'../../团队赛策略台-手机离线版.html'))?path.resolve(__dirname,'../../团队赛策略台-手机离线版.html'):path.resolve(__dirname,'../downloads/团队赛策略台-手机离线版.html'))).href);
   const settled=()=>page.waitForFunction(()=>!document.querySelector('main').inert&&document.querySelector('#persistenceStatus').textContent.includes('已保存'));
   const snapshot=()=>page.evaluate(()=>JSON.parse(localStorage.getItem('team-strategy-state-v1')));
   const bulk=async(axis,target,operation,value,scope='selected')=>{
    await page.locator('#bulkScope').selectOption(scope);await page.locator('#bulkAxis').selectOption(axis);await page.locator('#bulkTarget').selectOption(String(target));await page.locator('#bulkMode').selectOption(operation);await page.locator('#bulkValue').fill(String(value));await page.locator('#applyBulk').click();
   };
   await settled();await page.locator('#excelInput').setInputFiles(workbookFile);await page.waitForFunction(()=>document.querySelector('#ourDeckList').textContent==='ABCDE');
   await page.locator('#opponentViewTab').click();assert.equal(await page.locator('.rate-input').first().inputValue(),'0');await page.locator('.rate-reset').first().click();assert.equal((await snapshot()).opponentRates[0][0],null);
   await page.locator('#correction').evaluate(input=>{input.value='.1';input.dispatchEvent(new Event('input',{bubbles:true}));});assert.equal(await page.locator('.rate-input').first().inputValue(),'60');
   await page.locator('.rate-input').first().fill('150');assert.ok(await page.locator('.rate-input').first().evaluate(input=>input.classList.contains('invalid')));await page.locator('.rate-reset').first().click();assert.equal(await page.locator('.rate-input').first().inputValue(),'60');
   await page.locator('#ourViewTab').click();await page.locator('.rate-input').first().fill('60');await page.locator('#opponentViewTab').click();assert.equal(await page.locator('.rate-input').first().inputValue(),'50');
   await page.locator('#opponentDeckList input').nth(4).uncheck();await page.locator('#ourViewTab').click();await page.locator('.bulk-editor summary').click();
   await bulk('row',0,'points',10);let saved=await snapshot();assert.deepEqual(saved.rates[0],[.7,.5,null,.2,.95]);assert.match(await page.locator('#bulkStatus').textContent(),/跳过 1/);assert.equal(saved.rates[1][0],.1);
   await bulk('column',1,'relative',-50);saved=await snapshot();assert.equal(saved.rates[0][1],.25);assert.equal(saved.rates[1][1],.1);
   await bulk('row',0,'set',42);saved=await snapshot();assert.deepEqual(saved.rates[0],[.42,.42,.42,.42,.95]);
   await bulk('row',0,'set',90,'pool');saved=await snapshot();assert.deepEqual(saved.rates[0],[.9,.9,.9,.9,.9]);
   const ourBefore=JSON.stringify(saved.rates);await page.locator('#opponentViewTab').click();await bulk('row',1,'points',-10);saved=await snapshot();assert.equal(JSON.stringify(saved.rates),ourBefore);assert.equal(saved.opponentRates[0][1],.1);assert.equal(saved.opponentRates[1][1],.9);assert.equal(saved.opponentRates[0][2],null);
   await bulk('column',2,'relative',10);saved=await snapshot();assert.equal(saved.opponentRates[2][0],.55);assert.equal(saved.opponentRates[2][1],.715);assert.equal(saved.opponentRates[4][0],null);
   const qBefore=JSON.stringify(saved.opponentRates);await bulk('row',1,'relative',-101);assert.match(await page.locator('#bulkStatus').textContent(),/-100/);assert.equal(JSON.stringify((await snapshot()).opponentRates),qBefore);
   await page.locator('#resetOpponentAll').click();saved=await snapshot();assert.ok(saved.opponentRates.flat().every(value=>value===null));assert.equal(saved.opponentRates[4][4],null);
   const persistedNulls=await page.evaluate(async()=>{const state=JSON.parse(localStorage.getItem('team-strategy-state-v1'));const reimported=await importMatchupWorkbook(MatchupWorkbook.create(state));return reimported.opponentRates.flat().every(value=>value===null);});assert.equal(persistedNulls,true);
   await settled();await page.reload();await settled();saved=await snapshot();assert.equal(saved.rates[0][0],.9);assert.ok(saved.opponentRates.flat().every(value=>value===null));assert.equal(saved.selectedOpponent.length,4);
   assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
   await context.close();console.log('Rate editor checks passed: '+mode);
  }
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
