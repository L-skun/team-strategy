const assert=require('node:assert/strict');
const fs=require('node:fs');const os=require('node:os');const path=require('node:path');
const {chromium}=require('playwright');const {createServer}=require('../serve.cjs');
(async()=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'strategy-browser-'));
 const stateFile=path.join(directory,'state.json');const workbookFile=path.join(directory,'fixture.xlsx');fs.writeFileSync(workbookFile,require('../dist/xlsx-export.js').create(require('../dist/demo-data.js')));const server=createServer({stateFile,workbookFile});let browser;
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
 try{
  browser=await chromium.launch({headless:true,channel:'msedge'});
  let context=await browser.newContext();let page=await context.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>!document.querySelector('main').inert&&document.querySelector('#persistenceStatus').textContent.includes('已保存'));
  console.log('Workbook status: '+await page.locator('#workbookStatus').textContent());
  assert.match(await page.locator('#workbookStatus').textContent(),/已检查/);
  const original=await page.locator('.rate-input').first().inputValue();
  await page.locator('#topN').selectOption('all');
  await page.locator('#correction').evaluate(input=>{input.value='0.33';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new Event('change',{bubbles:true}));});
  await page.locator('.rate-input').first().fill('64.5');await page.locator('.rate-input').first().press('Tab');
  await page.waitForFunction(()=>document.querySelector('#persistenceStatus').textContent.includes('已保存'));
  let stored=JSON.parse(fs.readFileSync(stateFile));assert.equal(stored.topN,'all');assert.equal(stored.correction,.33);assert.equal(stored.rates[0][0],.645);
  await context.close();context=await browser.newContext();page=await context.newPage();page.on('pageerror',error=>errors.push(error.message));
  await page.goto(url);await page.waitForFunction(()=>!document.querySelector('main').inert&&document.querySelector('#persistenceStatus').textContent.includes('已保存'));
  assert.equal(await page.locator('#topN').inputValue(),'all');assert.equal(await page.locator('#correction').inputValue(),'0.33');assert.equal(await page.locator('.rate-input').first().inputValue(),'64.5');
  await page.locator('#reloadWorkbook').click();await page.waitForFunction(()=>!document.querySelector('main').inert&&document.querySelector('#persistenceStatus').textContent.includes('已保存'));
  assert.equal(await page.locator('.rate-input').first().inputValue(),original);assert.equal(await page.locator('#correction').inputValue(),'0.33');
  const exported=await page.evaluate(async()=>{
    const data={ourDecks:['多龙 & <一>','B','C','D'],opponentDecks:['甲','乙','丙','丁'],rates:[[0,1,null,.645],[.5,.5,.5,.5],[.1,.2,.3,.4],[.9,.8,.7,.6]],opponentRates:[[null,0,1,null],[null,null,null,null],[null,null,null,null],[null,null,null,null]]};
    const bytes=MatchupWorkbook.create(data),again=await importMatchupWorkbook(bytes);
    if(JSON.stringify(data.ourDecks)!==JSON.stringify(again.ourDecks)||JSON.stringify(data.rates)!==JSON.stringify(again.rates)||JSON.stringify(data.opponentRates)!==JSON.stringify(again.opponentRates))throw Error('XLSX roundtrip mismatch');const same={...data,opponentDecks:data.ourDecks.slice()};const sameAgain=await importMatchupWorkbook(MatchupWorkbook.create(same));if(JSON.stringify(same.opponentRates)!==JSON.stringify(sameAgain.opponentRates))throw Error('Overlapping roster orientation mismatch');return bytes.length;
  });assert.ok(exported>0);
  const previouslyChecked=await page.locator('#opponentDeckList input:checked').count();await page.locator('#clearOpponent').click();assert.equal(await page.locator('#opponentDeckList input:checked').count(),0);
  for(let i=0;i<previouslyChecked;i++)await page.locator('#opponentDeckList input').nth(i).check();
  await page.locator('.deck-editor summary').click();await page.locator('#deckNameInput').fill('测试卡组 & 一');await page.locator('#renameDeck').click();assert.equal(await page.locator('#ourDeckList .deck-name').first().textContent(),'测试卡组 & 一');
  await page.locator('#excelSaveMode').selectOption('new');await page.locator('#saveExcelButton').click();await page.waitForFunction(()=>document.querySelector('#excelSaveStatus').textContent.includes('已保存'));
  assert.equal(fs.readdirSync(directory).filter(name=>name.startsWith('团队赛卡组对局分析-')&&name.endsWith('.xlsx')).length,1);
  await page.locator('#excelSaveMode').selectOption('overwrite');await page.locator('#saveExcelButton').click();await page.waitForFunction(()=>document.querySelector('#excelSaveStatus').textContent.includes('原文件备份'));
  await page.reload();await page.waitForFunction(()=>!document.querySelector('main').inert&&document.querySelector('#persistenceStatus').textContent.includes('已保存'));assert.equal(await page.locator('#ourDeckList .deck-name').first().textContent(),'测试卡组 & 一');
  await page.setViewportSize({width:390,height:844});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth));assert.deepEqual(errors,[]);
  console.log('Browser checks passed: actual Excel import, auto-save, clean-browser restore, explicit Excel reload, mobile width, no page errors.');
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));fs.rmSync(directory,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
