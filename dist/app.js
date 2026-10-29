(function(){
  'use strict';
  var STORAGE_KEY='team-strategy-state-v1';
  var demo=window.DEMO_DATA||{ourDecks:[],opponentDecks:[],rates:[],opponentRates:[],demo:true};
  var state=makeState(demo);
  var matrixView='our';
  var els={};
  var nativeBridge=window.AndroidBridge||null;
  var workbookVersion=null,loading=true,saveTimer=null,saveQueue=Promise.resolve();

  function makeState(data){
    var ours=(data.ourDecks||[]).map(String), opps=(data.opponentDecks||[]).map(String);
    return {ourDecks:ours,opponentDecks:opps,selectedOur:ours.slice(0,Math.min(6,ours.length)),selectedOpponent:opps.slice(0,Math.min(6,opps.length)),rates:cloneMatrix(data.rates),opponentRates:cloneMatrix(data.opponentRates),customOpponents:[],excludedOur:[],topN:5,correction:.2,pairing:'ordered',mode:'predictive',demo:data.demo!==false,invalidCells:{}};
  }
  function cloneMatrix(m){return (m||[]).map(function(row){return (row||[]).map(function(v){return v==null?null:Number(v);});});}
  function $(id){return document.getElementById(id);}
  async function init(){
    ['opponentResetTools','resetOpponentAll','bulkScope','bulkAxis','bulkTarget','bulkTargetLabel','bulkMode','bulkValue','bulkValueLabel','bulkHelp','applyBulk','bulkStatus','clearOpponent','editDeckSide','editDeckName','deckNameInput','addDeck','renameDeck','deleteDeck','excelSaveMode','saveExcelButton','excelSaveStatus','persistenceStatus','reloadWorkbook','workbookStatus','excludedOurList','availableOurCount','topN','resultTitle','engineDot','engineStatus','demoNotice','ourDeckList','opponentDeckList','ourCount','opponentCount','deckError','matrixWrap','matrixContext','matrixError','correction','correctionValue','correctionHelp','solveButton','saveButton','exportButton','importInput','excelInput','resetButton','saveStatus','emptyState','resultContent','resultList','resultSummary','addOpponentForm','newOpponentName'].forEach(function(id){els[id]=$(id);});
    bindEvents(); restoreLocal(); refresh(); checkEngine();
    document.querySelector("main").inert=true;
    await restoreDisk();
    await loadAnchoredWorkbook();
    loading=false;document.querySelector("main").inert=false;
    scheduleSave();
  }
  function mergeWorkbook(data){
    var previous=serializable();
    var selectedOur=previous.selectedOur.filter(function(name){return data.ourDecks.includes(name);}).slice(0,6);
    var selectedOpponent=previous.selectedOpponent.filter(function(name){return data.opponentDecks.includes(name);}).slice(0,6);
    if(selectedOur.length<4)selectedOur=data.ourDecks.slice(0,6);
    if(selectedOpponent.length<4)selectedOpponent=data.opponentDecks.slice(0,6);
    var excluded=previous.excludedOur.filter(function(name){return selectedOur.includes(name);});
    if(selectedOur.length-excluded.length<4)excluded=[];
    applyImported(Object.assign({},data,{selectedOur:selectedOur,selectedOpponent:selectedOpponent,excludedOur:excluded,topN:previous.topN,correction:previous.correction,pairing:previous.pairing,mode:previous.mode,demo:false}));
  }
  function nativeBytes(base64){var text=atob(base64),bytes=new Uint8Array(text.length);for(var i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);return bytes;}
  function nativeBase64(bytes){var chunks=[];for(var i=0;i<bytes.length;i+=8192)chunks.push(String.fromCharCode.apply(null,bytes.subarray(i,i+8192)));return btoa(chunks.join(''));}
  async function applyNativeWorkbook(payload,force){
    if(payload.error)throw new Error(payload.error);
    var data=await window.importMatchupWorkbook(nativeBytes(payload.base64));
    if(force||payload.version!==workbookVersion)mergeWorkbook(data);
    workbookVersion=payload.version;refresh();hideResults();els.workbookStatus.textContent='已读取手机文件：'+payload.name+'；胜率和设置自动保存在手机。';
  }
  window.onNativeWorkbook=async function(text){try{await applyNativeWorkbook(JSON.parse(text),true);scheduleSave();}catch(error){els.workbookStatus.textContent='读取失败：'+error.message;}};
  window.onNativeExcelSaved=function(text){var result=JSON.parse(text);if(result.error){els.excelSaveStatus.textContent=result.error;return;}if(result.mode==='overwrite')workbookVersion=result.version;els.excelSaveStatus.textContent=result.cancelled?'已取消保存':'已保存文件：'+result.name+(result.backup?'（原文件已备份至应用私有目录）':'');scheduleSave();};
  async function loadAnchoredWorkbook(){
    if(nativeBridge){
      try{var payload=JSON.parse(nativeBridge.readWorkbook());if(payload.empty){els.workbookStatus.textContent='手机离线模式：点击“选择手机 Excel”导入卡组与胜率；已有保存会自动恢复。';return;}await applyNativeWorkbook(payload,false);}catch(error){els.workbookStatus.textContent='手机 Excel 读取失败：'+error.message+'；保留已保存数据。';}return;
    }
    if(window.MOBILE_OFFLINE){els.workbookStatus.textContent='手机离线版：导入 Excel 或 JSON 即可使用，修改后自动保存在当前浏览器。';return;}

    if(window.location.protocol==='file:'){
      els.workbookStatus.textContent='请双击项目根目录的“团队赛策略台.exe”启动，即可自动读取 Excel 并保存到项目文件夹。直接打开 HTML 时，仅使用浏览器保存和手动导入。';
      return;
    }
    var main=document.querySelector('main');main.inert=true;
    els.workbookStatus.textContent='正在读取锚定文件：团队赛卡组对局分析.xlsx…';
    var controller=new AbortController(),timeout=setTimeout(function(){controller.abort();},15000);
    try{
      var response=await fetch('data/matchups.xlsx',{cache:'no-store',signal:controller.signal});
      if(!response.ok)throw new Error(response.status===404?'未找到锚定文件':'读取失败（HTTP '+response.status+'）');
      var data=await window.importMatchupWorkbook(await response.arrayBuffer());
      var version=response.headers&&response.headers.get('X-Workbook-Version');
      var useSaved=version&&version===workbookVersion;
      if(!useSaved)mergeWorkbook(data);
      workbookVersion=version||null;refresh();hideResults();
      els.workbookStatus.textContent='已检查锚定 Excel：文件有更新时载入新卡组和胜率；未变更时恢复控制台已保存的胜率。界面修改默认自动保存到本机，点击“保存 Excel”可写入表格。';
    }catch(error){
      els.workbookStatus.textContent='未能自动载入团队赛卡组对局分析.xlsx：'+(error.name==='AbortError'?'读取超时':error.message)+'。当前保留本机保存或示例数据，可手动导入 Excel。';
    }finally{clearTimeout(timeout);main.inert=false;}
  }
  function bindEvents(){
    els.resetOpponentAll.addEventListener('click',function(){
      state.opponentRates=state.ourDecks.map(function(){return state.opponentDecks.map(function(){return null;});});
      Object.keys(state.invalidCells).forEach(function(key){if(key.indexOf('opponent-')===0)delete state.invalidCells[key];});
      hideResults();renderMatrix();scheduleSave();els.bulkStatus.textContent='已将全部 '+(state.ourDecks.length*state.opponentDecks.length)+' 场对手视角胜率复位为自动补正（含未选卡组）。';
    });
    ['bulkScope','bulkAxis','bulkMode'].forEach(function(id){els[id].addEventListener('change',function(){renderBulkEditor();els.bulkStatus.textContent='';});});
    els.applyBulk.addEventListener('click',applyBulk);

    els.clearOpponent.addEventListener('click',function(){state.selectedOpponent=[];els.deckError.textContent='';hideResults();renderDecks();renderMatrix();scheduleSave();});
    els.editDeckSide.addEventListener('change',renderDeckEditor);
    els.addDeck.addEventListener('click',function(){editDeck('add');});
    els.renameDeck.addEventListener('click',function(){editDeck('rename');});
    els.deleteDeck.addEventListener('click',function(){editDeck('delete');});
    els.saveExcelButton.addEventListener('click',saveExcel);

    window.addEventListener('pagehide',function(){if(!loading)saveLocal();});
    document.querySelector('main').addEventListener('input',function(event){if(!loading&&(event.target.classList.contains('rate-input')||event.target.id==='correction'))scheduleSave();});
    document.querySelector('main').addEventListener('change',function(event){if(!loading&&event.target.type!=='file')scheduleSave();});
    if(nativeBridge)els.reloadWorkbook.textContent='选择手机 Excel（授权读取/覆盖）';
    els.reloadWorkbook.addEventListener('click',async function(){if(nativeBridge){nativeBridge.openWorkbook();return;}if(window.MOBILE_OFFLINE){els.excelInput.click();return;}loading=true;var oldVersion=workbookVersion;workbookVersion=null;await loadAnchoredWorkbook();if(workbookVersion===null)workbookVersion=oldVersion;loading=false;scheduleSave();});
    els.addOpponentForm.addEventListener('submit',addOpponent);
    els.topN.addEventListener('change',function(){state.topN=this.value==='all'?'all':Number(this.value);hideResults();});
    document.querySelectorAll('.segment').forEach(function(btn){btn.addEventListener('click',function(){matrixView=btn.dataset.view;document.querySelectorAll('.segment').forEach(function(b){var active=b===btn;b.classList.toggle('active',active);b.setAttribute('aria-selected',String(active));});renderMatrix();});});
    els.correction.addEventListener('input',function(){state.correction=Number(this.value);hideResults();updateCorrection();if(matrixView==='opponent')renderMatrix();});
    document.querySelectorAll('input[name=pairing]').forEach(function(r){r.addEventListener('change',function(){if(r.checked){state.pairing=r.value;hideResults();}});});
    document.querySelectorAll('input[name=mode]').forEach(function(r){r.addEventListener('change',function(){if(r.checked){state.mode=r.value;hideResults();}});});
    els.solveButton.addEventListener('click',solve);
    els.saveButton.addEventListener('click',saveLocal);
    els.exportButton.addEventListener('click',exportJSON);
    els.importInput.addEventListener('change',importJSON);
    els.excelInput.addEventListener('change',importExcel);
    els.resetButton.addEventListener('click',resetDemo);
  }
  function refresh(){
    els.demoNotice.hidden=!state.demo;
    els.correction.value=state.correction;
    document.querySelector('input[name=pairing][value="'+state.pairing+'"]').checked=true;
    document.querySelector('input[name=mode][value="'+state.mode+'"]').checked=true;
    renderDecks();renderMatrix();updateCorrection();
  }
  function renderDecks(){
    els.ourDeckList.innerHTML='';els.opponentDeckList.innerHTML='';
    state.ourDecks.forEach(function(name){els.ourDeckList.appendChild(deckCard(name,'our',state.selectedOur.includes(name),false));});
    state.opponentDecks.forEach(function(name){els.opponentDeckList.appendChild(deckCard(name,'opponent',state.selectedOpponent.includes(name),state.customOpponents.includes(name)));});
    renderExclusions();updateCounts();updateTopN();renderDeckEditor();
  }
  function renderDeckEditor(){
    var previous=els.editDeckName.value,names=els.editDeckSide.value==='opponent'?state.opponentDecks:state.ourDecks;
    els.editDeckName.replaceChildren();names.forEach(function(name){var option=document.createElement('option');option.value=name;option.textContent=name;els.editDeckName.appendChild(option);});
    if(names.includes(previous))els.editDeckName.value=previous;
  }
  function editDeck(action){
    if(Object.keys(state.invalidCells).length){showError('请先修正无效胜率，再修改卡组池。');return;}
    var side=els.editDeckSide.value==='opponent'?'opponent':'our',names=side==='our'?state.ourDecks:state.opponentDecks,name=els.deckNameInput.value.trim(),old=els.editDeckName.value,index=names.indexOf(old);
    if(action!=='delete'&&(!name||names.some(function(n){return n.toLocaleLowerCase()===name.toLocaleLowerCase();}))){showError('请输入不重复的卡组名称。');return;}
    if(action==='add'){
      if(names.length>=100){showError('每方卡组池最多 100 套。');return;}
      names.push(name);
      if(side==='our'){state.rates.push(Array(state.opponentDecks.length).fill(null));state.opponentRates.push(Array(state.opponentDecks.length).fill(null));if(state.selectedOur.length<6)state.selectedOur.push(name);}
      else{state.rates.forEach(function(row){row.push(null);});state.opponentRates.forEach(function(row){row.push(null);});state.customOpponents.push(name);if(state.selectedOpponent.length<6)state.selectedOpponent.push(name);}
    }else{
      if(index<0)return;
      if(action==='delete'){
        if(names.length<=1){showError('每方卡组池至少保留一套。');return;}
        if(!window.confirm('删除“'+old+'”及其全部胜率？保存 Excel 后将同步删除。'))return;
        names.splice(index,1);if(side==='our'){state.rates.splice(index,1);state.opponentRates.splice(index,1);}else{state.rates.forEach(function(row){row.splice(index,1);});state.opponentRates.forEach(function(row){row.splice(index,1);});}
      }else names[index]=name;
      (side==='our'?['selectedOur','excludedOur']:['selectedOpponent','customOpponents']).forEach(function(key){state[key]=state[key].map(function(n){return n===old?(action==='delete'?null:name):n;}).filter(function(n){return n!==null;});});
      if(side==='our'&&state.selectedOur.length-state.excludedOur.length<4)state.excludedOur=[];
    }
    els.deckNameInput.value='';els.deckError.textContent='';hideResults();renderDecks();renderMatrix();scheduleSave();showStatus('卡组池已更新，点击“保存 Excel”可写入文件。');
  }
  function downloadFile(bytes,mime,name){
    if(nativeBridge){nativeBridge.exportFile(nativeBase64(bytes),mime,name);return;}
    var url=URL.createObjectURL(new Blob([bytes],{type:mime})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(function(){URL.revokeObjectURL(url);},1000);
  }
  async function saveExcel(){
    if(Object.keys(state.invalidCells).length){els.excelSaveStatus.textContent='请先修正所有无效胜率。';return;}
    els.saveExcelButton.disabled=true;
    try{
      var data=serializable();window.MatchupWorkbook.validate(data);
      var mode=els.excelSaveMode.value;
      if(nativeBridge){nativeBridge.saveExcel(nativeBase64(window.MatchupWorkbook.create(data)),mode,workbookVersion||'');els.excelSaveStatus.textContent='请在手机文件选择器中完成保存。';return;}
      if(window.location.protocol==='file:'||window.MOBILE_OFFLINE){
        if(mode==='overwrite')throw new Error('直接打开 HTML 不能覆盖磁盘文件，请使用 EXE 或另存为新 Excel。');
        downloadFile(window.MatchupWorkbook.create(data),'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','团队赛卡组对局分析.xlsx');els.excelSaveStatus.textContent='已生成新 Excel，请在下载位置查看。';return;
      }
      var response=await fetch('api/workbook',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({mode:mode,data:data,expectedVersion:workbookVersion})});var result=await response.json();
      if(!response.ok)throw new Error(result.error||'保存失败');
      if(mode==='overwrite')workbookVersion=result.version;
      els.excelSaveStatus.textContent='已保存：'+result.path+(result.backup?'；原文件备份：'+result.backup:'');scheduleSave();
    }catch(error){els.excelSaveStatus.textContent=error.message;}finally{els.saveExcelButton.disabled=false;}
  }
  function updateTopN(){
    els.topN.replaceChildren();
    for(var i=1;i<=Math.max(state.selectedOpponent.length,state.topN==='all'?0:state.topN);i++){var option=document.createElement('option');option.value=i;option.textContent='前 '+i+' 个';els.topN.appendChild(option);}
    var all=document.createElement('option');all.value='all';all.textContent='全部（'+state.selectedOpponent.length+' 个）';els.topN.appendChild(all);
    // Keep the saved preference even when this match has fewer opponents.
    els.topN.value=String(state.topN);
  }
  function renderExclusions(){
    els.excludedOurList.replaceChildren();
    state.selectedOur.forEach(function(name){
      var label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
      input.type='checkbox';input.checked=state.excludedOur.includes(name);text.textContent=name;
      input.addEventListener('change',function(){
        if(input.checked&&state.selectedOur.length-state.excludedOur.length<=4){showError('除去“我不想上”的卡组后，至少需要保留 4 套。');input.checked=false;return;}
        if(input.checked)state.excludedOur.push(name);else state.excludedOur=state.excludedOur.filter(function(n){return n!==name;});
        els.deckError.textContent='';hideResults();renderExclusions();
      });
      label.append(input,text);els.excludedOurList.appendChild(label);
    });
    els.availableOurCount.textContent='可出战 '+(state.selectedOur.length-state.excludedOur.length)+' 套';
  }
  function deckCard(name,side,selected,custom){
    var label=document.createElement('label');label.className='deck-card'+(selected?' selected':'');label.title=name;
    var input=document.createElement('input');input.type='checkbox';input.checked=selected;input.addEventListener('change',function(){toggleDeck(side,name,input.checked);});
    var check=document.createElement('span');check.className='deck-check';
    var text=document.createElement('span');text.className='deck-name';text.textContent=name;
    label.append(input,check,text);
    if(custom){var tag=document.createElement('span');tag.className='custom-tag';tag.textContent='临时';label.appendChild(tag);}
    return label;
  }
  function toggleDeck(side,name,want){
    var key=side==='our'?'selectedOur':'selectedOpponent', list=state[key];
    if(want&&list.length>=6){showError('每方最多选择 6 套卡组。');renderDecks();return;}
    if(side==='our'&&!want&&!state.excludedOur.includes(name)&&state.excludedOur.length&&list.length-state.excludedOur.length<=4){showError('除去“我不想上”的卡组后，至少需要保留 4 套。');renderDecks();return;}
    if(side==='our'&&!want)state.excludedOur=state.excludedOur.filter(function(n){return n!==name;});
    if(want&&!list.includes(name))list.push(name);if(!want)state[key]=list.filter(function(n){return n!==name;});
    hideResults();renderDecks();renderMatrix();
  }
  function updateCounts(){
    [['ourCount',state.selectedOur.length],['opponentCount',state.selectedOpponent.length]].forEach(function(x){els[x[0]].textContent=x[1]+' / 6';els[x[0]].classList.toggle('invalid',x[1]<4||x[1]>6);});
  }
  function addOpponent(e){
    e.preventDefault();var name=els.newOpponentName.value.trim();
    if(state.opponentDecks.length>=100){showError('对手卡组池最多 100 套。');return;}
    if(!name)return;if(state.opponentDecks.some(function(n){return n.toLowerCase()===name.toLowerCase();})){showError('这个对手卡组已经存在。');return;}
    state.opponentDecks.push(name);state.customOpponents.push(name);if(state.selectedOpponent.length<6)state.selectedOpponent.push(name);
    state.rates.forEach(function(row){row.push(null);});state.opponentRates.forEach(function(row){row.push(null);});
    els.newOpponentName.value='';hideResults();renderDecks();renderMatrix();scheduleSave();showStatus('已添加，请填写该卡组对阵所有已选我方卡组的胜率。');
  }
  function selectedIndices(names,selected){return selected.map(function(n){return names.indexOf(n);}).filter(function(i){return i>=0;});}
  function matrixValue(row,col,view){var matrix=view==='our'?state.rates:state.opponentRates;return matrix[row]&&matrix[row][col]!=null?matrix[row][col]:null;}
  function setMatrixValue(row,col,view,value){var matrix=view==='our'?state.rates:state.opponentRates;while(matrix.length<=row)matrix.push([]);matrix[row][col]=value;delete state.invalidCells[view+'-'+row+'-'+col];hideResults();}
  function bulkIndices(){
    var all=els.bulkScope.value==='pool';
    return {ours:all?state.ourDecks.map(function(_,i){return i;}):selectedIndices(state.ourDecks,state.selectedOur),opponents:all?state.opponentDecks.map(function(_,i){return i;}):selectedIndices(state.opponentDecks,state.selectedOpponent)};
  }
  function renderBulkEditor(){
    var indices=bulkIndices(),axisIsOur=(els.bulkAxis.value==='row')!==(matrixView==='opponent'),targets=axisIsOur?indices.ours:indices.opponents,previous=els.bulkTarget.value,names=axisIsOur?state.ourDecks:state.opponentDecks;
    els.bulkTargetLabel.textContent=(axisIsOur?'我方':'对手')+'卡组（'+(els.bulkAxis.value==='row'?'行':'列')+'）';
    els.bulkTarget.replaceChildren();targets.forEach(function(idx){var option=document.createElement('option');option.value=idx;option.textContent=names[idx];els.bulkTarget.appendChild(option);});
    if(targets.some(function(idx){return String(idx)===previous;}))els.bulkTarget.value=previous;
    els.applyBulk.disabled=!indices.ours.length||!indices.opponents.length;
    var mode=els.bulkMode.value;els.bulkValue.removeAttribute('max');els.bulkValue.removeAttribute('min');
    if(mode==='set'){els.bulkValueLabel.textContent='统一胜率（%）';els.bulkValue.min='0';els.bulkValue.max='100';els.bulkValue.placeholder='例如 50';els.bulkHelp.textContent='将指定行/列统一设为该胜率，例如输入 50 全部设为 50%，也可填充空白。';}
    else if(mode==='points'){els.bulkValueLabel.textContent='增减值（百分点）';els.bulkValue.placeholder='例如 10 或 -10';els.bulkHelp.textContent='输入 10：50% → 60%；输入 -10：50% → 40%。结果限制在 0–100%。';}
    else{els.bulkValueLabel.textContent='相对增减（%）';els.bulkValue.min='-100';els.bulkValue.placeholder='例如 10 或 -10';els.bulkHelp.textContent='输入 10：50% × 1.10 = 55%；输入 -10：50% × 0.90 = 45%。结果限制在 0–100%。';}
    els.bulkHelp.textContent+=' 增减时跳过无原胜率的格子；对手自动估算格按当前补正值调整，调整后变为手动值，可复位。';
  }
  function applyBulk(){
    try{
      var raw=els.bulkValue.value.trim();if(!raw)throw new Error('请输入调整数值');
      var indices=bulkIndices(),mode=els.bulkMode.value,target=Number(els.bulkTarget.value),axisIsOur=(els.bulkAxis.value==='row')!==(matrixView==='opponent');
      if(!indices.ours.length||!indices.opponents.length)throw new Error('请先选择要调整的对局');
      if(mode!=='set'){
        var invalid=Object.keys(state.invalidCells).some(function(key){var parts=key.split('-'),r=Number(parts[1]),c=Number(parts[2]);return indices.ours.includes(r)&&indices.opponents.includes(c)&&(axisIsOur?r:c)===target&&(parts[0]===matrixView||matrixView==='opponent');});
        if(invalid)throw new Error('指定行/列有无效输入，请先修正，或使用“统一设为固定胜率”覆盖。');
      }
      var plan=window.RateEdit.plan({rates:state.rates,opponentRates:state.opponentRates,correction:state.correction,view:matrixView,axis:els.bulkAxis.value,target:target,mode:mode,amount:Number(raw),ourIndices:indices.ours,opponentIndices:indices.opponents});
      plan.changes.forEach(function(change){setMatrixValue(change.row,change.col,matrixView,change.value);});
      renderMatrix();scheduleSave();els.bulkStatus.textContent='已调整 '+plan.changes.length+' 场'+(plan.skipped?'；跳过 '+plan.skipped+' 个无原胜率的格子':'')+(plan.clipped?'；'+plan.clipped+' 场已限制至 0–100%':'')+(plan.automatic?'；'+plan.automatic+' 个自动估算格已变为手动值':'')+'。';
    }catch(error){els.bulkStatus.textContent=error.message;}
  }
  function renderMatrix(){
    var rows=selectedIndices(state.ourDecks,state.selectedOur),cols=selectedIndices(state.opponentDecks,state.selectedOpponent);
    renderBulkEditor();els.opponentResetTools.hidden=matrixView!=='opponent';
    var opponent=matrixView==='opponent';els.matrixContext.textContent=opponent?'每格为对手卡组击败我方卡组的概率。留空时按补正规则自动估算。':'每格为我方卡组击败对手卡组的概率。临时添加的对手卡组必须完整填写。';
    if(!rows.length||!cols.length){els.matrixWrap.innerHTML='<div class="empty-state"><p>请先选择双方卡组。</p></div>';return;}
    var table=document.createElement('table');table.className='rate-table';
    var thead=document.createElement('thead'),hr=document.createElement('tr'),corner=document.createElement('th');corner.textContent=opponent?'对手卡组 ↓ / 我方 →':'我方卡组 ↓ / 对手 →';hr.appendChild(corner);
    var shownRows=opponent?cols:rows,shownCols=opponent?rows:cols;
    shownCols.forEach(function(idx){var th=document.createElement('th');th.textContent=opponent?state.ourDecks[idx]:state.opponentDecks[idx];hr.appendChild(th);});thead.appendChild(hr);table.appendChild(thead);
    var tbody=document.createElement('tbody');shownRows.forEach(function(ridx){var tr=document.createElement('tr'),name=document.createElement('td');name.textContent=opponent?state.opponentDecks[ridx]:state.ourDecks[ridx];tr.appendChild(name);shownCols.forEach(function(cidx){var ourRow=opponent?cidx:ridx,oppCol=opponent?ridx:cidx;tr.appendChild(rateCell(ourRow,oppCol,matrixView));});tbody.appendChild(tr);});table.appendChild(tbody);
    els.matrixWrap.replaceChildren(table);
  }
  function rateCell(row,col,view){
    var td=document.createElement('td'),wrap=document.createElement('div');wrap.className='rate-input-wrap';var input=document.createElement('input');input.className='rate-input';input.type='number';input.min='0';input.max='100';input.step='any';input.inputMode='decimal';input.setAttribute('aria-label',(view==='our'?'我方 '+state.ourDecks[row]+' 对手 '+state.opponentDecks[col]:'对手 '+state.opponentDecks[col]+' 对我方 '+state.ourDecks[row])+' 胜率百分比');
    var key=view+'-'+row+'-'+col,value=matrixValue(row,col,view),isAuto=view==='opponent'&&value==null;if(Object.prototype.hasOwnProperty.call(state.invalidCells,key)){input.value=state.invalidCells[key];input.classList.add('invalid');}else if(isAuto){var base=matrixValue(row,col,'our');if(base!=null)input.value=Math.round(Math.min(1,1-base+state.correction)*1000)/10;input.placeholder='自动';input.classList.add('is-auto');}else if(value!=null)input.value=Math.round(value*1000)/10;
    colorRate(input);input.addEventListener('input',function(){var raw=input.value.trim();if(resetButton)resetButton.disabled=false;hideResults();if(raw===''){setMatrixValue(row,col,view,null);if(resetButton)resetButton.disabled=true;input.className='rate-input'+(view==='opponent'?' is-auto':'');if(view==='opponent'){var base=matrixValue(row,col,'our');input.value=base==null?'':Math.round(Math.min(1,1-base+state.correction)*100);}colorRate(input);return;}var n=Number(raw),invalid=!Number.isFinite(n)||n<0||n>100;input.classList.toggle('invalid',invalid);if(invalid)state.invalidCells[key]=raw;else setMatrixValue(row,col,view,n/100);colorRate(input);});
    var pct=document.createElement('span');pct.className='percent-mark';pct.textContent='%';wrap.append(input,pct);td.appendChild(wrap);
    var resetButton;
    if(view==='opponent'){
      resetButton=document.createElement('button');resetButton.type='button';resetButton.className='rate-reset';resetButton.textContent='复位';resetButton.disabled=isAuto&&!Object.prototype.hasOwnProperty.call(state.invalidCells,key);resetButton.setAttribute('aria-label','对手 '+state.opponentDecks[col]+' 对我方 '+state.ourDecks[row]+' 复位为自动补正');
      resetButton.addEventListener('click',function(){setMatrixValue(row,col,'opponent',null);renderMatrix();scheduleSave();els.bulkStatus.textContent='已复位：'+state.opponentDecks[col]+' 对 '+state.ourDecks[row]+'，随我方胜率和信心补正自动更新。';});td.appendChild(resetButton);
    }
    return td;
  }
  function colorRate(input){input.classList.remove('rate-low','rate-even','rate-high');var n=Number(input.value);if(input.value==='')return;if(n<45)input.classList.add('rate-low');else if(n>55)input.classList.add('rate-high');else input.classList.add('rate-even');}
  function updateCorrection(){var pct=Math.round(state.correction*100);els.correctionValue.textContent='+'+pct+'%';els.correctionHelp.textContent='对手视角未填写的格子，将使用“我方败率 + '+pct+'%”估算，最高不超过 100%。';}
  function validate(){
    els.deckError.textContent='';els.matrixError.textContent='';
    if(state.selectedOur.length<4||state.selectedOur.length>6||state.selectedOpponent.length<4||state.selectedOpponent.length>6){showError('请为双方各选择 4–6 套卡组。');scrollToSection('decks');return false;}
    if(state.selectedOur.length-state.excludedOur.length<4){showError('除去“我不想上”的卡组后，至少需要保留 4 套。');scrollToSection('decks');return false;}
    var rows=selectedIndices(state.ourDecks,state.selectedOur),cols=selectedIndices(state.opponentDecks,state.selectedOpponent),missing=[];
    var activeInvalid=Object.keys(state.invalidCells).some(function(key){var parts=key.split('-'),r=Number(parts[1]),c=Number(parts[2]);return rows.includes(r)&&cols.includes(c);});
    if(activeInvalid){els.matrixError.textContent='存在超出 0–100% 范围的胜率，请先修正红色输入框。';scrollToSection('matrix');return false;}
    rows.forEach(function(r){cols.forEach(function(c){var custom=state.customOpponents.includes(state.opponentDecks[c]);if(matrixValue(r,c,'our')==null&&(custom||true))missing.push(state.ourDecks[r]+' × '+state.opponentDecks[c]);});});
    if(missing.length){els.matrixError.textContent='我方视角仍有 '+missing.length+' 个胜率未填写（包括 '+missing.slice(0,2).join('、')+(missing.length>2?'…':'')+'）。';matrixView='our';document.querySelector('[data-view=our]').click();scrollToSection('matrix');return false;}
    return true;
  }
  function buildPayload(){
    var rows=selectedIndices(state.ourDecks,state.selectedOur),cols=selectedIndices(state.opponentDecks,state.selectedOpponent);
    return {topN:state.topN,excludedOurIndices:state.excludedOur.map(function(name){return state.selectedOur.indexOf(name);}),rates:rows.map(function(r){return cols.map(function(c){return matrixValue(r,c,'our');});}),opponentRates:rows.map(function(r){return cols.map(function(c){return matrixValue(r,c,'opponent');});}),correction:state.correction,ourNames:state.selectedOur.slice(),opponentNames:state.selectedOpponent.slice(),pairing:state.pairing,mode:state.mode};
  }
  function checkEngine(){var ready=window.StrategyEngine&&typeof window.StrategyEngine.solve==='function';els.engineDot.className='status-dot '+(ready?'ready':'missing');els.engineStatus.textContent=ready?'计算引擎已就绪':'计算引擎待加载';return ready;}
  function solve(){
    if(!validate())return;if(!checkEngine()){els.emptyState.innerHTML='<div class="empty-mark">…</div><h2>计算引擎待加载</h2><p>界面数据已准备好，加载计算模块后即可生成真实推荐。</p>';scrollToSection('results');return;}
    els.solveButton.disabled=true;els.solveButton.querySelector('span').textContent='正在计算…';
    Promise.resolve().then(function(){return window.StrategyEngine.solve(buildPayload());}).then(function(result){renderResults(result);}).catch(function(err){els.emptyState.hidden=false;els.resultContent.hidden=true;els.emptyState.innerHTML='<div class="empty-mark">!</div><h2>暂时无法完成计算</h2><p>'+escapeText(err&&err.message?err.message:'计算模块返回异常，请检查输入。')+'</p>';}).finally(function(){els.solveButton.disabled=false;els.solveButton.querySelector('span').textContent='计算推荐策略';scrollToSection('results');});
  }
  function renderResults(result){
    var list=result&&Array.isArray(result.strategies)?result.strategies:[];if(!list.length)throw new Error('没有找到合法策略，请检查卡组数量与胜率数据。');els.resultList.innerHTML='';
    els.resultTitle.textContent='推荐策略 '+(state.topN==='all'?'全部（'+list.length+' 个）':'Top '+list.length);
    var mode=result.mode||state.mode,pairing=result.pairing||state.pairing,banProbs=result.opponentBanProbabilities||[];
    list.forEach(function(s,i){var card=document.createElement('article');card.className='result-card';var banName=state.selectedOpponent[s.banOpponentIndex]||'—';
      card.innerHTML='<div class="rank"><small>RANK</small>#'+(i+1)+'</div><div class="strategy-main"><h3>禁用对手：'+escapeText(banName)+'</h3><div class="strategy-tags"><span class="tag ban">'+(mode==='robust'?'稳健保障':'主观预测')+'</span></div></div><div class="win-rate">'+formatRate(s.score)+'<small>'+(mode==='robust'?'保障胜率':'模型胜率')+'</small></div>';
      var response=document.createElement('div');response.className='response-plan';response.innerHTML='<strong>我方实际被 Ban 后的应对（按不同卡组组合推荐）</strong><div class="branches">'+(s.branches||[]).map(function(b){return branchHTML(b,mode,pairing,banProbs);}).join('')+'</div>';card.appendChild(response);
      if(i===0&&result.assumptions&&result.assumptions.length){var assumptions=document.createElement('div');assumptions.className='assumptions';assumptions.textContent='模型假设：'+result.assumptions.join('；');card.appendChild(assumptions);}els.resultList.appendChild(card);
    });
    els.resultSummary.textContent=(state.demo?'⚠ 随机示例数据，仅供体验 · ':'')+'所选模型内排名 · '+(mode==='robust'?'稳健保障':'假设对手采用主观保守策略')+' · '+(pairing==='ordered'?'同时暗排':'随机配对');els.resultSummary.classList.toggle('demo-result-warning',state.demo);els.emptyState.hidden=true;els.resultContent.hidden=false;
  }
  function branchHTML(branch,mode,pairing,banProbs){
    var banned=state.selectedOur[branch.bannedOurIndex]||'未知卡组',names=(branch.ourOrder||[]).map(function(idx){return state.selectedOur[idx]||('?'+idx);}),separator=pairing==='ordered'?' → ':'、',detail='';
    if(mode==='robust'&&branch.worstOpponentOrder)detail='；最坏对阵 '+branch.worstOpponentOrder.map(function(idx){return state.selectedOpponent[idx]||('?'+idx);}).join(separator);
    if(mode==='predictive'&&Number.isFinite(banProbs[branch.bannedOurIndex]))detail='；被禁概率 '+formatRate(banProbs[branch.bannedOurIndex]);
    if(mode==='predictive'&&branch.predictedOpponentOrders&&branch.predictedOpponentOrders.length){var predictions=branch.predictedOpponentOrders,lead=predictions[0],oppNames=(lead.order||[]).map(function(idx){return state.selectedOpponent[idx]||('?'+idx);});detail+='；对手候选对阵（示例） '+oppNames.join(separator)+(Number.isFinite(lead.probability)?'（'+formatRate(lead.probability)+'）':'')+(predictions.length>1?'，另含 '+(predictions.length-1)+' 种同模型情形':'');}
    var options=branch.options||[branch];
    return '<div class="branch-group"><strong>若 '+escapeText(banned)+' 被禁</strong>'+options.map(function(option,i){var order=option.ourOrder.map(function(idx){return state.selectedOur[idx];}).join(separator);var extra=detail;if(mode==='robust')extra='；最坏对阵 '+(option.worstOpponentOrder||[]).map(function(idx){return state.selectedOpponent[idx];}).join(separator);return '<div class="branch"><span class="branch-ban">第 '+(i+1)+' 选</span><span class="branch-order">'+escapeText(order)+'</span><span class="branch-score">'+formatRate(option.score)+escapeText(extra)+'</span></div>';}).join('')+'</div>';
  }
  function asArray(v){return Array.isArray(v)?v:(v==null?[]:[v]);}
  function formatRate(v){var n=Number(v);if(!Number.isFinite(n))return '—';if(n<=1)n*=100;return n.toFixed(1)+'%';}
  function escapeText(v){var d=document.createElement('div');d.textContent=v==null?'':String(v);return d.innerHTML;}
  function serializable(){return {version:1,workbookVersion:workbookVersion,topN:state.topN,excludedOur:state.excludedOur,ourDecks:state.ourDecks,opponentDecks:state.opponentDecks,selectedOur:state.selectedOur,selectedOpponent:state.selectedOpponent,rates:state.rates,opponentRates:state.opponentRates,customOpponents:state.customOpponents,correction:state.correction,pairing:state.pairing,mode:state.mode,demo:state.demo};}
  function scheduleSave(){
    if(loading)return;clearTimeout(saveTimer);
    try{localStorage.setItem(STORAGE_KEY,JSON.stringify(serializable()));}catch(error){}
    if(nativeBridge&&!Object.keys(state.invalidCells).length){var nativeSaved=JSON.parse(nativeBridge.saveState(JSON.stringify(serializable())));if(nativeSaved.error){els.persistenceStatus.textContent='手机保存失败：'+nativeSaved.error;return;}}
    els.persistenceStatus.textContent='有修改，正在保存…';
    saveTimer=setTimeout(function(){saveLocal();},450);
  }
  async function restoreDisk(){
    if(nativeBridge){try{var raw=nativeBridge.readState();if(raw){applyImported(JSON.parse(raw));refresh();}}catch(error){els.persistenceStatus.textContent='手机保存读取失败：'+error.message;}return;}
    if(window.location.protocol==='file:'||window.MOBILE_OFFLINE)return;
    var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},5000);
    try{
      var response=await fetch('api/state',{cache:'no-store',signal:controller.signal});
      if(response.status===404)return;
      if(!response.ok)throw new Error('HTTP '+response.status);
      applyImported(await response.json());refresh();
      els.persistenceStatus.textContent='已恢复项目文件夹中的胜率和默认设置。';
    }catch(error){els.persistenceStatus.textContent='项目保存读取失败，暂用浏览器备份：'+error.message;}
    finally{clearTimeout(timer);}
  }
  function saveLocal(){
    clearTimeout(saveTimer);
    if(Object.keys(state.invalidCells).length){els.persistenceStatus.textContent='存在无效胜率，请修正后保存。';return Promise.resolve();}
    var snapshot=JSON.stringify(serializable()),browserSaved=false;
    try{localStorage.setItem(STORAGE_KEY,snapshot);browserSaved=true;}catch(error){}
    saveQueue=saveQueue.catch(function(){}).then(async function(){
      if(nativeBridge){var result=JSON.parse(nativeBridge.saveState(snapshot));els.persistenceStatus.textContent=result.error?'手机保存失败：'+result.error:'已保存胜率和默认设置到手机';return;}
      if(window.location.protocol==='file:'||window.MOBILE_OFFLINE){
        els.persistenceStatus.textContent=browserSaved?'已保存到当前浏览器。使用 EXE 启动可保存到项目文件夹。':'保存失败，请导出 JSON 备份。';return;
      }
      var controller=new AbortController(),timer=setTimeout(function(){controller.abort();},5000);
      try{
        var response=await fetch('api/state',{method:'PUT',headers:{'Content-Type':'application/json'},body:snapshot,signal:controller.signal,keepalive:true});
        if(!response.ok)throw new Error('HTTP '+response.status);
        els.persistenceStatus.textContent='已保存胜率和默认设置 · 项目文件夹 team-strategy/.local/state.json';
      }catch(error){els.persistenceStatus.textContent='项目文件保存失败：'+error.message+(browserSaved?'；已保留浏览器备份。':'；请导出 JSON 备份。');}
      finally{clearTimeout(timer);}
    });
    return saveQueue;
  }
  function restoreLocal(){try{var raw=localStorage.getItem(STORAGE_KEY);if(raw)applyImported(JSON.parse(raw),false);}catch(e){localStorage.removeItem(STORAGE_KEY);}}
  function exportJSON(){downloadFile(new TextEncoder().encode(JSON.stringify(serializable(),null,2)),'application/json','team-strategy-'+new Date().toISOString().slice(0,10)+'.json');showStatus('请选择 JSON 保存位置。');}
  function importJSON(e){var file=e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(){try{var version=workbookVersion;applyImported(JSON.parse(reader.result),true);workbookVersion=version;refresh();hideResults();scheduleSave();showStatus('已导入 '+file.name+'。');}catch(err){showStatus('导入失败：'+err.message,true);}finally{e.target.value='';}};reader.readAsText(file);}
  function importExcel(e){var file=e.target.files[0];if(!file)return;if(typeof window.importMatchupWorkbook!=='function'){showStatus('Excel 解析模块尚未加载。',true);e.target.value='';return;}file.arrayBuffer().then(window.importMatchupWorkbook).then(function(data){var version=workbookVersion;applyImported(data,false);workbookVersion=version;state.demo=false;refresh();hideResults();scheduleSave();showStatus('已导入 '+file.name+'。');}).catch(function(err){showStatus('Excel 导入失败：'+(err.message||'无法读取文件'),true);}).finally(function(){e.target.value='';});}
  function normalizeDeckNames(value,label){
    if(!Array.isArray(value))throw new Error(label+'必须是数组');var seen={};
    return value.map(function(name,index){if(typeof name!=='string'||!name.trim())throw new Error(label+'第 '+(index+1)+' 项名称为空');var clean=name.trim(),key=clean.toLocaleLowerCase();if(seen[key])throw new Error(label+'存在重复名称：“'+clean+'”');seen[key]=true;return clean;});
  }
  function normalizeMatrix(value,rows,cols,label,optional){
    if(value==null&&optional)return Array.from({length:rows},function(){return Array(cols).fill(null);});
    if(!Array.isArray(value)||value.length!==rows)throw new Error(label+'行数应为 '+rows+'，实际为 '+(Array.isArray(value)?value.length:'非数组'));
    return value.map(function(row,r){if(!Array.isArray(row)||row.length!==cols)throw new Error(label+'第 '+(r+1)+' 行应有 '+cols+' 列');return row.map(function(cell,c){if(cell===null)return null;if(typeof cell!=='number'||!Number.isFinite(cell)||cell<0||cell>1)throw new Error(label+'第 '+(r+1)+' 行第 '+(c+1)+' 列必须是 0–1 数值或 null');return cell;});});
  }
  function normalizeSelection(value,available,label,fallback){
    if(value==null)return fallback.slice();if(!Array.isArray(value))throw new Error(label+'必须是数组');var seen={};
    return value.map(function(name,index){if(typeof name!=='string'||!name.trim())throw new Error(label+'第 '+(index+1)+' 项无效');var clean=name.trim(),match=available.find(function(candidate){return candidate===clean;});if(!match)throw new Error(label+'包含未知卡组：“'+clean+'”');return match;}).filter(function(name){var key=name.toLocaleLowerCase();if(seen[key])return false;seen[key]=true;return true;});
  }
  function applyImported(data){
    if(!data||typeof data!=='object')throw new Error('文件格式不正确');
    var ourDecks=normalizeDeckNames(data.ourDecks,'我方卡组'),opponentDecks=normalizeDeckNames(data.opponentDecks,'对手卡组');
    var cleaned={ourDecks:ourDecks,opponentDecks:opponentDecks,rates:normalizeMatrix(data.rates,ourDecks.length,opponentDecks.length,'我方胜率矩阵',false),opponentRates:normalizeMatrix(data.opponentRates,ourDecks.length,opponentDecks.length,'对手胜率矩阵',true),demo:data.demo===true};
    var next=makeState(cleaned);next.selectedOur=normalizeSelection(data.selectedOur,ourDecks,'已选我方卡组',next.selectedOur);next.selectedOpponent=normalizeSelection(data.selectedOpponent,opponentDecks,'已选对手卡组',next.selectedOpponent);next.customOpponents=normalizeSelection(data.customOpponents,opponentDecks,'临时对手卡组',[]);next.correction=Number.isFinite(Number(data.correction))?Math.max(0,Math.min(.5,Number(data.correction))):.2;next.pairing=data.pairing==='random'?'random':'ordered';next.mode=data.mode==='robust'?'robust':'predictive';next.excludedOur=normalizeSelection(data.excludedOur,next.selectedOur,'我不想上的卡组',[]);if(next.excludedOur.length&&next.selectedOur.length-next.excludedOur.length<4)throw new Error('除去“我不想上”的卡组后至少需要 4 套');next.topN=data.topN==='all'?'all':(Number.isInteger(data.topN)&&data.topN>=1&&data.topN<=6?data.topN:5);state=next;workbookVersion=typeof data.workbookVersion==='string'?data.workbookVersion:null;
  }
  function resetDemo(){state=makeState(demo);localStorage.removeItem(STORAGE_KEY);refresh();hideResults();scheduleSave();showStatus('已恢复随机示例数据。');}
  function hideResults(){els.emptyState.hidden=false;els.resultContent.hidden=true;}
  function scrollToSection(id){var target=document.getElementById(id);if(target)target.scrollIntoView({behavior:'smooth',block:'start'});}
  function showError(msg){els.deckError.textContent=msg;}
  function showStatus(msg,error){els.saveStatus.textContent=msg;els.saveStatus.style.color=error?'var(--red)':'var(--teal)';clearTimeout(showStatus.timer);showStatus.timer=setTimeout(function(){els.saveStatus.textContent='';},3500);}
  document.addEventListener('DOMContentLoaded',init);
})();
