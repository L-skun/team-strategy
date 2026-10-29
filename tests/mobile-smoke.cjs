const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{pathToFileURL}=require('node:url'),assert=require('node:assert/strict');
const {chromium}=require('playwright');const exporter=require('../dist/xlsx-export.js');
(async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-mobile-'));let browser;
 const fixture=path.join(temp,'rates.xlsx');const data={ourDecks:['A','B','C','D'],opponentDecks:['W','X','Y','Z'],rates:Array.from({length:4},()=>Array(4).fill(.5)),opponentRates:Array.from({length:4},()=>Array(4).fill(null))};fs.writeFileSync(fixture,exporter.create(data));
 const fiveFixture=path.join(temp,'rates-five.xlsx');fs.writeFileSync(fiveFixture,exporter.create({...data,ourDecks:['A','B','C','D','E'],rates:Array.from({length:5},()=>Array(4).fill(.5)),opponentRates:Array.from({length:5},()=>Array(4).fill(null))}));
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const native of [false,true]){
   const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true});
   if(native)await context.addInitScript(()=>{window.saved='';window.AndroidBridge={readState:()=>window.saved,saveState:value=>{window.saved=value;return '{}';},readWorkbook:()=>'{'+'"empty":true}',openWorkbook:()=>{},saveExcel:(base64,mode,version)=>{window.nativeExport={base64,mode,version};},exportFile:()=>{}};});
   const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));let network=0;page.on('request',request=>{if(/^https?:/.test(request.url()))network++;});
   await page.goto(pathToFileURL((fs.existsSync(path.resolve(__dirname,'../../团队赛策略台-手机离线版.html'))?path.resolve(__dirname,'../../团队赛策略台-手机离线版.html'):path.resolve(__dirname,'../downloads/团队赛策略台-手机离线版.html'))).href);
   await page.waitForFunction(()=>!document.querySelector('main').inert&&document.querySelector('#persistenceStatus').textContent.includes('已保存'));
   await page.locator('#excelInput').setInputFiles(fixture);await page.waitForFunction(()=>document.querySelector('#ourDeckList').textContent==='ABCD');
   await page.locator('#topN').selectOption('all');await page.locator('#solveButton').click();await page.waitForFunction(()=>!document.querySelector('#resultContent').hidden);
   assert.equal(await page.locator('.result-card').count(),4);assert.equal(await page.locator('.branch-group').count(),16);assert.equal(await page.locator('.branch-group').first().locator('.branch').count(),1);
   await page.locator('#excelInput').setInputFiles(fiveFixture);await page.waitForFunction(()=>document.querySelector('#ourDeckList').textContent==='ABCDE');await page.locator('#topN').selectOption('all');await page.locator('#solveButton').click();await page.waitForFunction(()=>!document.querySelector('#resultContent').hidden);
   const orders=await page.locator('.branch-group').first().locator('.branch-order').allTextContents();assert.equal(orders.length,3);assert.equal(new Set(orders.map(order=>order.split(/ → |、/).sort().join(','))).size,3);
   await page.locator('#clearOpponent').click();assert.equal(await page.locator('#opponentDeckList input:checked').count(),0);
   if(native){await page.locator('#excelSaveMode').selectOption('new');await page.locator('#saveExcelButton').click();assert.equal(await page.evaluate(()=>window.nativeExport.mode),'new');assert.ok((await page.evaluate(()=>window.saved)).includes('"topN":"all"'));}
   else{const downloaded=page.waitForEvent('download');await page.locator('#saveExcelButton').click();const download=await downloaded;assert.match(download.suggestedFilename(),/\.xlsx$/);}
   assert.equal(network,0);assert.deepEqual(errors,[]);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));await context.close();
  }
  console.log('Mobile offline checks passed: no network, real XLSX import, same BP scores and alternatives, clear selection, XLSX download and native bridge handoff.');
 }finally{if(browser)await browser.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
