(function(){
  'use strict';
  var STORAGE_KEY='team-strategy-state-v1';
  var demo=window.DEMO_DATA||{ourDecks:[],opponentDecks:[],rates:[],opponentRates:[],demo:true};
  var state=makeState(demo);
  var matrixView='our';
  var els={};

  function makeState(data){
    var ours=(data.ourDecks||[]).map(String), opps=(data.opponentDecks||[]).map(String);
    return {ourDecks:ours,opponentDecks:opps,selectedOur:ours.slice(0,Math.min(6,ours.length)),selectedOpponent:opps.slice(0,Math.min(6,opps.length)),rates:cloneMatrix(data.rates),opponentRates:cloneMatrix(data.opponentRates),customOpponents:[],correction:.2,pairing:'ordered',mode:'predictive',demo:data.demo!==false,invalidCells:{}};
  }
  function cloneMatrix(m){return (m||[]).map(function(row){return (row||[]).map(function(v){return v==null?null:Number(v);});});}
  function $(id){return document.getElementById(id);}
  function init(){
    ['engineDot','engineStatus','demoNotice','ourDeckList','opponentDeckList','ourCount','opponentCount','deckError','matrixWrap','matrixContext','matrixError','correction','correctionValue','correctionHelp','solveButton','saveButton','exportButton','importInput','excelInput','resetButton','saveStatus','emptyState','resultContent','resultList','resultSummary','addOpponentForm','newOpponentName'].forEach(function(id){els[id]=$(id);});
    bindEvents(); restoreLocal(); refresh(); checkEngine();
  }
  function bindEvents(){
    els.addOpponentForm.addEventListener('submit',addOpponent);
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
    updateCounts();
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
    if(want&&!list.includes(name))list.push(name);if(!want)state[key]=list.filter(function(n){return n!==name;});
    hideResults();renderDecks();renderMatrix();
  }
  function updateCounts(){
    [['ourCount',state.selectedOur.length],['opponentCount',state.selectedOpponent.length]].forEach(function(x){els[x[0]].textContent=x[1]+' / 6';els[x[0]].classList.toggle('invalid',x[1]<4||x[1]>6);});
  }
  function addOpponent(e){
    e.preventDefault();var name=els.newOpponentName.value.trim();
    if(!name)return;if(state.opponentDecks.some(function(n){return n.toLowerCase()===name.toLowerCase();})){showError('这个对手卡组已经存在。');return;}
    state.opponentDecks.push(name);state.customOpponents.push(name);if(state.selectedOpponent.length<6)state.selectedOpponent.push(name);
    state.rates.forEach(function(row){row.push(null);});state.opponentRates.forEach(function(row){row.push(null);});
    els.newOpponentName.value='';hideResults();renderDecks();renderMatrix();showStatus('已添加，请填写该卡组对阵所有已选我方卡组的胜率。');
  }
  function selectedIndices(names,selected){return selected.map(function(n){return names.indexOf(n);}).filter(function(i){return i>=0;});}
  function matrixValue(row,col,view){var matrix=view==='our'?state.rates:state.opponentRates;return matrix[row]&&matrix[row][col]!=null?matrix[row][col]:null;}
  function setMatrixValue(row,col,view,value){var matrix=view==='our'?state.rates:state.opponentRates;while(matrix.length<=row)matrix.push([]);matrix[row][col]=value;delete state.invalidCells[view+'-'+row+'-'+col];hideResults();}
  function renderMatrix(){
    var rows=selectedIndices(state.ourDecks,state.selectedOur),cols=selectedIndices(state.opponentDecks,state.selectedOpponent);
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
    var td=document.createElement('td'),wrap=document.createElement('div');wrap.className='rate-input-wrap';var input=document.createElement('input');input.className='rate-input';input.type='number';input.min='0';input.max='100';input.step='1';input.inputMode='decimal';input.setAttribute('aria-label',(view==='our'?'我方 '+state.ourDecks[row]+' 对手 '+state.opponentDecks[col]:'对手 '+state.opponentDecks[col]+' 对我方 '+state.ourDecks[row])+' 胜率百分比');
    var key=view+'-'+row+'-'+col,value=matrixValue(row,col,view),isAuto=view==='opponent'&&value==null;if(Object.prototype.hasOwnProperty.call(state.invalidCells,key)){input.value=state.invalidCells[key];input.classList.add('invalid');}else if(isAuto){var base=matrixValue(row,col,'our');if(base!=null)input.value=Math.round(Math.min(1,1-base+state.correction)*100);input.placeholder='自动';input.classList.add('is-auto');}else if(value!=null)input.value=Math.round(value*1000)/10;
    colorRate(input);input.addEventListener('input',function(){var raw=input.value.trim();hideResults();if(raw===''){setMatrixValue(row,col,view,null);input.className='rate-input'+(view==='opponent'?' is-auto':'');if(view==='opponent'){var base=matrixValue(row,col,'our');input.value=base==null?'':Math.round(Math.min(1,1-base+state.correction)*100);}colorRate(input);return;}var n=Number(raw),invalid=!Number.isFinite(n)||n<0||n>100;input.classList.toggle('invalid',invalid);if(invalid)state.invalidCells[key]=raw;else setMatrixValue(row,col,view,n/100);colorRate(input);});
    var pct=document.createElement('span');pct.className='percent-mark';pct.textContent='%';wrap.append(input,pct);td.appendChild(wrap);return td;
  }
  function colorRate(input){input.classList.remove('rate-low','rate-even','rate-high');var n=Number(input.value);if(input.value==='')return;if(n<45)input.classList.add('rate-low');else if(n>55)input.classList.add('rate-high');else input.classList.add('rate-even');}
  function updateCorrection(){var pct=Math.round(state.correction*100);els.correctionValue.textContent='+'+pct+'%';els.correctionHelp.textContent='对手视角未填写的格子，将使用“我方败率 + '+pct+'%”估算，最高不超过 100%。';}
  function validate(){
    els.deckError.textContent='';els.matrixError.textContent='';
    if(state.selectedOur.length<4||state.selectedOur.length>6||state.selectedOpponent.length<4||state.selectedOpponent.length>6){showError('请为双方各选择 4–6 套卡组。');scrollToSection('decks');return false;}
    var rows=selectedIndices(state.ourDecks,state.selectedOur),cols=selectedIndices(state.opponentDecks,state.selectedOpponent),missing=[];
    var activeInvalid=Object.keys(state.invalidCells).some(function(key){var parts=key.split('-'),r=Number(parts[1]),c=Number(parts[2]);return rows.includes(r)&&cols.includes(c);});
    if(activeInvalid){els.matrixError.textContent='存在超出 0–100% 范围的胜率，请先修正红色输入框。';scrollToSection('matrix');return false;}
    rows.forEach(function(r){cols.forEach(function(c){var custom=state.customOpponents.includes(state.opponentDecks[c]);if(matrixValue(r,c,'our')==null&&(custom||true))missing.push(state.ourDecks[r]+' × '+state.opponentDecks[c]);});});
    if(missing.length){els.matrixError.textContent='我方视角仍有 '+missing.length+' 个胜率未填写（包括 '+missing.slice(0,2).join('、')+(missing.length>2?'…':'')+'）。';matrixView='our';document.querySelector('[data-view=our]').click();scrollToSection('matrix');return false;}
    return true;
  }
  function buildPayload(){
    var rows=selectedIndices(state.ourDecks,state.selectedOur),cols=selectedIndices(state.opponentDecks,state.selectedOpponent);
    return {rates:rows.map(function(r){return cols.map(function(c){return matrixValue(r,c,'our');});}),opponentRates:rows.map(function(r){return cols.map(function(c){return matrixValue(r,c,'opponent');});}),correction:state.correction,ourNames:state.selectedOur.slice(),opponentNames:state.selectedOpponent.slice(),pairing:state.pairing,mode:state.mode};
  }
  function checkEngine(){var ready=window.StrategyEngine&&typeof window.StrategyEngine.solve==='function';els.engineDot.className='status-dot '+(ready?'ready':'missing');els.engineStatus.textContent=ready?'计算引擎已就绪':'计算引擎待加载';return ready;}
  function solve(){
    if(!validate())return;if(!checkEngine()){els.emptyState.innerHTML='<div class="empty-mark">…</div><h2>计算引擎待加载</h2><p>界面数据已准备好，加载计算模块后即可生成真实推荐。</p>';scrollToSection('results');return;}
    els.solveButton.disabled=true;els.solveButton.querySelector('span').textContent='正在计算…';
    Promise.resolve().then(function(){return window.StrategyEngine.solve(buildPayload());}).then(function(result){renderResults(result);}).catch(function(err){els.emptyState.hidden=false;els.resultContent.hidden=true;els.emptyState.innerHTML='<div class="empty-mark">!</div><h2>暂时无法完成计算</h2><p>'+escapeText(err&&err.message?err.message:'计算模块返回异常，请检查输入。')+'</p>';}).finally(function(){els.solveButton.disabled=false;els.solveButton.querySelector('span').textContent='计算推荐策略';scrollToSection('results');});
  }
  function renderResults(result){
    var list=result&&Array.isArray(result.strategies)?result.strategies.slice(0,5):[];if(!list.length)throw new Error('没有找到合法策略，请检查卡组数量与胜率数据。');els.resultList.innerHTML='';
    var mode=result.mode||state.mode,pairing=result.pairing||state.pairing,banProbs=result.opponentBanProbabilities||[];
    list.forEach(function(s,i){var card=document.createElement('article');card.className='result-card';var banName=state.selectedOpponent[s.banOpponentIndex]||'—';
      card.innerHTML='<div class="rank"><small>RANK</small>#'+(i+1)+'</div><div class="strategy-main"><h3>禁用对手：'+escapeText(banName)+'</h3><div class="strategy-tags"><span class="tag ban">'+(mode==='robust'?'稳健保障':'主观预测')+'</span></div></div><div class="win-rate">'+formatRate(s.score)+'<small>'+(mode==='robust'?'保障胜率':'模型胜率')+'</small></div>';
      var response=document.createElement('div');response.className='response-plan';response.innerHTML='<strong>我方实际被 Ban 后的应对</strong><div class="branches">'+(s.branches||[]).map(function(b){return branchHTML(b,mode,pairing,banProbs);}).join('')+'</div>';card.appendChild(response);
      if(i===0&&result.assumptions&&result.assumptions.length){var assumptions=document.createElement('div');assumptions.className='assumptions';assumptions.textContent='模型假设：'+result.assumptions.join('；');card.appendChild(assumptions);}els.resultList.appendChild(card);
    });
    els.resultSummary.textContent=(state.demo?'⚠ 随机示例数据，仅供体验 · ':'')+'所选模型内排名 · '+(mode==='robust'?'稳健保障':'假设对手采用主观保守策略')+' · '+(pairing==='ordered'?'同时暗排':'随机配对');els.resultSummary.classList.toggle('demo-result-warning',state.demo);els.emptyState.hidden=true;els.resultContent.hidden=false;
  }
  function branchHTML(branch,mode,pairing,banProbs){
    var banned=state.selectedOur[branch.bannedOurIndex]||'未知卡组',names=(branch.ourOrder||[]).map(function(idx){return state.selectedOur[idx]||('?'+idx);}),separator=pairing==='ordered'?' → ':'、',detail='';
    if(mode==='robust'&&branch.worstOpponentOrder)detail='；最坏对阵 '+branch.worstOpponentOrder.map(function(idx){return state.selectedOpponent[idx]||('?'+idx);}).join(separator);
    if(mode==='predictive'&&Number.isFinite(banProbs[branch.bannedOurIndex]))detail='；被禁概率 '+formatRate(banProbs[branch.bannedOurIndex]);
    if(mode==='predictive'&&branch.predictedOpponentOrders&&branch.predictedOpponentOrders.length){var predictions=branch.predictedOpponentOrders,lead=predictions[0],oppNames=(lead.order||[]).map(function(idx){return state.selectedOpponent[idx]||('?'+idx);});detail+='；对手候选对阵（示例） '+oppNames.join(separator)+(Number.isFinite(lead.probability)?'（'+formatRate(lead.probability)+'）':'')+(predictions.length>1?'，另含 '+(predictions.length-1)+' 种同模型情形':'');}
    return '<div class="branch"><span class="branch-ban">若 '+escapeText(banned)+' 被禁</span><span class="branch-order">'+escapeText(names.join(separator))+'</span><span class="branch-score">'+formatRate(branch.score)+escapeText(detail)+'</span></div>';
  }
  function asArray(v){return Array.isArray(v)?v:(v==null?[]:[v]);}
  function formatRate(v){var n=Number(v);if(!Number.isFinite(n))return '—';if(n<=1)n*=100;return n.toFixed(1)+'%';}
  function escapeText(v){var d=document.createElement('div');d.textContent=v==null?'':String(v);return d.innerHTML;}
  function serializable(){return {version:1,ourDecks:state.ourDecks,opponentDecks:state.opponentDecks,selectedOur:state.selectedOur,selectedOpponent:state.selectedOpponent,rates:state.rates,opponentRates:state.opponentRates,customOpponents:state.customOpponents,correction:state.correction,pairing:state.pairing,mode:state.mode,demo:state.demo};}
  function saveLocal(){try{localStorage.setItem(STORAGE_KEY,JSON.stringify(serializable()));showStatus('已保存到此设备。');}catch(e){showStatus('保存失败：浏览器不允许本地存储。',true);}}
  function restoreLocal(){try{var raw=localStorage.getItem(STORAGE_KEY);if(raw)applyImported(JSON.parse(raw),false);}catch(e){localStorage.removeItem(STORAGE_KEY);}}
  function exportJSON(){var blob=new Blob([JSON.stringify(serializable(),null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='team-strategy-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(function(){URL.revokeObjectURL(url);},500);showStatus('JSON 已导出。');}
  function importJSON(e){var file=e.target.files[0];if(!file)return;var reader=new FileReader();reader.onload=function(){try{applyImported(JSON.parse(reader.result),true);refresh();hideResults();showStatus('已导入 '+file.name+'。');}catch(err){showStatus('导入失败：'+err.message,true);}finally{e.target.value='';}};reader.readAsText(file);}
  function importExcel(e){var file=e.target.files[0];if(!file)return;if(typeof window.importMatchupWorkbook!=='function'){showStatus('Excel 解析模块尚未加载。',true);e.target.value='';return;}file.arrayBuffer().then(window.importMatchupWorkbook).then(function(data){applyImported(data,false);state.demo=false;refresh();hideResults();showStatus('已导入 '+file.name+'。');}).catch(function(err){showStatus('Excel 导入失败：'+(err.message||'无法读取文件'),true);}).finally(function(){e.target.value='';});}
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
    var next=makeState(cleaned);next.selectedOur=normalizeSelection(data.selectedOur,ourDecks,'已选我方卡组',next.selectedOur);next.selectedOpponent=normalizeSelection(data.selectedOpponent,opponentDecks,'已选对手卡组',next.selectedOpponent);next.customOpponents=normalizeSelection(data.customOpponents,opponentDecks,'临时对手卡组',[]);next.correction=Number.isFinite(Number(data.correction))?Math.max(0,Math.min(.5,Number(data.correction))):.2;next.pairing=data.pairing==='random'?'random':'ordered';next.mode=data.mode==='robust'?'robust':'predictive';state=next;
  }
  function resetDemo(){state=makeState(demo);localStorage.removeItem(STORAGE_KEY);refresh();hideResults();showStatus('已恢复随机示例数据。');}
  function hideResults(){els.emptyState.hidden=false;els.resultContent.hidden=true;}
  function scrollToSection(id){var target=document.getElementById(id);if(target)target.scrollIntoView({behavior:'smooth',block:'start'});}
  function showError(msg){els.deckError.textContent=msg;}
  function showStatus(msg,error){els.saveStatus.textContent=msg;els.saveStatus.style.color=error?'var(--red)':'var(--teal)';clearTimeout(showStatus.timer);showStatus.timer=setTimeout(function(){els.saveStatus.textContent='';},3500);}
  document.addEventListener('DOMContentLoaded',init);
})();
