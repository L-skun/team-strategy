(function(root,factory){var api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.RateEdit=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  function checkAmount(mode,amount){
    if(typeof amount!=='number'||!Number.isFinite(amount))throw new Error('请输入有效的调整数值');
    if(mode==='set'){if(amount<0||amount>100)throw new Error('固定胜率必须为 0–100%');}
    else if(mode==='relative'){if(amount < -100)throw new Error('按比例减少不能低于 -100%');}
    else if(mode!=='points')throw new Error('未知调整方式');
  }
  function adjust(value,mode,amount){
    checkAmount(mode,amount);
    if(mode!=='set'&&(typeof value!=='number'||!Number.isFinite(value)||value<0||value>1))throw new Error('原胜率必须为 0–1');
    var raw=mode==='set'?amount/100:mode==='points'?value+amount/100:value*(1+amount/100);
    return {value:Math.round(Math.max(0,Math.min(1,raw))*1e12)/1e12,clipped:raw<0||raw>1};
  }
  // Matrices always use our row / opponent column, even when the UI is transposed.
  function plan(input){
    checkAmount(input.mode,input.amount);
    if(input.view!=='our'&&input.view!=='opponent')throw new Error('未知胜率视角');
    if(input.axis!=='row'&&input.axis!=='column')throw new Error('请选择整行或整列');
    var opponent=input.view==='opponent',axisIsOur=(input.axis==='row')!==opponent;
    var targets=axisIsOur?input.ourIndices:input.opponentIndices;
    if(!targets.includes(input.target))throw new Error('请选择要调整的卡组');
    var matrix=opponent?input.opponentRates:input.rates,changes=[],skipped=0,clipped=0,automatic=0;
    input.ourIndices.forEach(function(row){input.opponentIndices.forEach(function(col){
      if((axisIsOur?row:col)!==input.target)return;
      var value=matrix[row][col],auto=opponent&&value==null;
      if(auto){var base=input.rates[row][col];value=base==null?null:Math.max(0,Math.min(1,1-base+input.correction));}
      if(input.mode!=='set'&&value==null){skipped+=1;return;}
      var result=adjust(value,input.mode,input.amount);changes.push({row:row,col:col,value:result.value});
      if(result.clipped)clipped+=1;if(auto)automatic+=1;
    });});
    return {changes:changes,skipped:skipped,clipped:clipped,automatic:automatic};
  }
  return {adjust:adjust,plan:plan};
});
