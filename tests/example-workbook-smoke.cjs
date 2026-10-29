const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{pathToFileURL}=require('node:url');
const {chromium}=require('playwright'),{createServer}=require('../serve.cjs');
(async()=>{
 const example=path.resolve(__dirname,'../examples/团队赛胜率填写示例.xlsx');const temp=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-example-'));let browser;
 const server=createServer({workbookFile:example,stateFile:path.join(temp,'state.json')});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  for(const mobile of [false,true]){
   const context=await browser.newContext(mobile?{viewport:{width:390,height:844},isMobile:true,hasTouch:true}:{});const page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
   await page.goto(mobile?pathToFileURL(path.resolve(__dirname,'../downloads/团队赛策略台-手机离线版.html')).href:'http://127.0.0.1:'+server.address().port);
   await page.waitForFunction(()=>!document.querySelector('main').inert);
   if(mobile)await page.locator('#excelInput').setInputFiles(example);
   await page.waitForFunction(()=>document.querySelector('#ourDeckList').textContent.includes('示例我方A'),{},{timeout:5000}).catch(async error=>{console.log({mobile,status:await page.locator('#workbookStatus').textContent(),importStatus:await page.locator('#saveStatus').textContent(),errors});throw error;});
   const data=await page.evaluate(()=>JSON.parse(localStorage.getItem('team-strategy-state-v1')));
   assert.equal(data.ourDecks.length,6);assert.equal(data.opponentDecks.length,6);assert.equal(data.rates[0][0],.5);assert.equal(data.rates[0][1],.6);assert.equal(data.rates[5][5],.505);
   assert.equal(data.opponentRates[0][0],.55);assert.equal(data.opponentRates[2][1],.65);assert.equal(data.opponentRates[3][2],.4);assert.equal(data.opponentRates[5][4],0);assert.equal(data.opponentRates[0][1],null);assert.equal(data.opponentRates.flat().filter(value=>value===null).length,32);
   await page.locator('#opponentViewTab').click();assert.equal(await page.locator('.rate-input').first().inputValue(),'55');assert.equal(await page.locator('.rate-input').nth(6).inputValue(),'60');assert.ok(await page.locator('.rate-input').nth(6).evaluate(input=>input.classList.contains('is-auto')));
   assert.equal(await page.locator('.rate-input').nth(29).inputValue(),'0');assert.equal(await page.locator('.rate-input').nth(29).evaluate(input=>input.classList.contains('is-auto')),false);
   await page.locator('#solveButton').click();await page.waitForFunction(()=>!document.querySelector('#resultContent').hidden);assert.equal(await page.locator('.result-card').count(),5);assert.match(await page.locator('.assumptions').textContent(),/32 个空值/);assert.deepEqual(errors,[]);
   await context.close();
  }
  console.log('Example workbook passed: PC and mobile import, 6x6 matrix, transposed opponent values, blank-versus-zero semantics and BP calculation.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
