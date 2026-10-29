const test=require('node:test');
const assert=require('node:assert/strict');
const editor=require('../dist/rate-edit.js');
const fixture=()=>({rates:[[.1,.2,null],[.4,.5,.6]],opponentRates:[[null,0,.3],[.8,null,.1]],correction:.2,view:'our',axis:'row',target:0,mode:'points',amount:10,ourIndices:[0,1],opponentIndices:[0,1,2]});

test('fixed rates, percentage points, and relative percentages have distinct arithmetic',()=>{
  assert.equal(editor.adjust(.5,'set',10).value,.1);
  assert.equal(editor.adjust(.5,'points',10).value,.6);
  assert.equal(editor.adjust(.5,'relative',10).value,.55);
  assert.equal(editor.adjust(.5,'points',-10).value,.4);
  assert.equal(editor.adjust(.5,'relative',-10).value,.45);
  assert.equal(editor.adjust(.5,'relative',-100).value,0);
  assert.deepEqual(editor.adjust(.95,'points',10),{value:1,clipped:true});
  assert.deepEqual(editor.adjust(.05,'points',-10),{value:0,clipped:true});
  assert.deepEqual(editor.adjust(0,'relative',10),{value:0,clipped:false});
});
test('our row and column adjustment uses only the selected rectangular range',()=>{
  const input=fixture(),before=structuredClone(input);
  let result=editor.plan(input);
  assert.deepEqual(result.changes,[{row:0,col:0,value:.2},{row:0,col:1,value:.3}]);assert.equal(result.skipped,1);
  result=editor.plan({...input,axis:'column',target:1,ourIndices:[1]});assert.deepEqual(result.changes,[{row:1,col:1,value:.6}]);
  assert.deepEqual(input,before);
});
test('opponent row means one opponent across our decks, column means one of our decks',()=>{
  const input={...fixture(),view:'opponent',mode:'set',amount:55};
  assert.deepEqual(editor.plan({...input,target:1}).changes,[{row:0,col:1,value:.55},{row:1,col:1,value:.55}]);
  assert.deepEqual(editor.plan({...input,axis:'column',target:1}).changes,[{row:1,col:0,value:.55},{row:1,col:1,value:.55},{row:1,col:2,value:.55}]);
});
test('automatic opponent values use current correction and preserve explicit zero',()=>{
  const input={...fixture(),view:'opponent',axis:'column',target:0,mode:'relative',amount:-10};
  const result=editor.plan(input);
  assert.deepEqual(result.changes,[{row:0,col:0,value:.9},{row:0,col:1,value:0},{row:0,col:2,value:.27}]);assert.equal(result.automatic,1);
});
test('setting fills blanks; relative and point adjustments skip missing baselines',()=>{
  let input=fixture();assert.equal(editor.plan({...input,mode:'set',amount:0}).changes.length,3);
  input.opponentRates[0][2]=null;
  const result=editor.plan({...input,view:'opponent',axis:'row',target:2});assert.equal(result.skipped,1);assert.equal(result.changes.length,1);
});
test('invalid amounts and targets fail before producing edits',()=>{
  for(const amount of [NaN,Infinity,'10',null])assert.throws(()=>editor.plan({...fixture(),amount}));
  assert.throws(()=>editor.plan({...fixture(),mode:'set',amount:101}));
  assert.throws(()=>editor.plan({...fixture(),mode:'set',amount:-1}));
  assert.throws(()=>editor.plan({...fixture(),mode:'relative',amount:-101}));
  assert.throws(()=>editor.plan({...fixture(),mode:'unknown'}));
  assert.throws(()=>editor.plan({...fixture(),axis:'unknown'}));
  assert.throws(()=>editor.plan({...fixture(),target:8}));
});
