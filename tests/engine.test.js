const path=__dirname + '/../';
const E=require(path+'engine.js');
const vm=require('vm'),fs=require('fs');
const ctx={};vm.createContext(ctx);vm.runInContext(fs.readFileSync(path+'questions.js','utf8')+';this.Q=QUESTIONS;',ctx);
const bank=ctx.Q;
let t=1000, timers=[], out=[], persisted=0, played={};
const eng=new E.Engine({noHeartbeat:true,code:'ABCD',hasTv:true,bank,
  broadcast:(v,rem)=>out.push({v,rem}),persist:()=>persisted++,
  markPlayed:id=>played[id]=1,getPlayed:()=>({}),now:()=>t,
  setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.push(h);return h;},
  clearTimeout:h=>{timers=timers.filter(x=>x!==h);}});
function tick(ms){t+=ms;timers.filter(h=>h.at<=t).forEach(h=>{timers=timers.filter(x=>x!==h);h.fn();});}
const last=()=>out[out.length-1].v;
const assert=require('assert');
eng.handle({t:'join',pid:'p1',name:'Papa',color:0});
eng.handle({t:'join',pid:'p2',name:'Maman',color:0});
eng.handle({t:'join',pid:'p3',name:'  Tom  ',color:2});
assert.equal(last().players.length,3); assert.equal(last().players[1].color,1); assert.equal(last().captain,'p1');
eng.handle({t:'cmd',pid:'p2',cmd:'start'}); assert.equal(last().phase,'lobby','non-captain cannot start');
eng.handle({t:'cmd',pid:'p1',cmd:'start',settings:{count:8,games:['culture','estimation','bad']}});
let v=last(); assert.equal(v.phase,'draw'); assert.equal(v.deck.length,8);
for(let i=1;i<8;i++) assert.notEqual(v.deck[i],v.deck[i-1],'no repeat');
assert.equal(v.deck.filter(g=>g==='culture').length,4);
let totals={p1:0,p2:0,p3:0};
for(let r=1;r<=8;r++){
  tick(3500); v=last(); assert.equal(v.phase,'question'); assert.equal(v.round,r);
  assert.equal(v.cur.a,undefined,'answer hidden');
  const cur=eng.s.cur;
  if(cur.g==='culture'){
    tick(1000); eng.handle({t:'answer',pid:'p2',round:r,val:cur.a});
    tick(500); eng.handle({t:'answer',pid:'p1',round:r,val:cur.a});
    assert.equal(last().answers.p1,undefined,'answers hidden');
    eng.handle({t:'answer',pid:'p1',round:r,val:(cur.a+1)%4}); // double answer ignored
    tick(500); eng.handle({t:'answer',pid:'p3',round:r,val:(cur.a+1)%4});
    v=last(); assert.equal(v.phase,'reveal');
    const m=v.mult; assert.equal(v.result.p2.pts,30*m); assert.equal(v.result.p1.pts,20*m); assert.equal(v.result.p3.pts,0);
  } else {
    eng.handle({t:'answer',pid:'p1',round:r,val:cur.a+10});
    eng.handle({t:'answer',pid:'p2',round:r,val:cur.a-10});
    // p3 doesn't answer -> timer closes
    tick(30000); v=last(); assert.equal(v.phase,'reveal');
    const m=v.mult; assert.equal(v.result.p1.pts,30*m); assert.equal(v.result.p2.pts,30*m); assert.equal(v.result.p3.pts,0);
  }
  assert.equal(v.mult, r>5?2:1);
  for(const p of ['p1','p2','p3']) totals[p]+=v.result[p].pts;
  eng.handle({t:'cmd',pid:'p1',cmd:'next'});
}
v=last(); assert.equal(v.phase,'final');
for(const p of v.players) assert.equal(p.score,totals[p.pid]);
assert.equal(Object.keys(played).length,8);
// reload/resume mid-question
eng.handle({t:'cmd',pid:'p1',cmd:'rematch'}); tick(3500);
const saved=JSON.parse(JSON.stringify(eng.s)); timers=[];
const eng2=new E.Engine({noHeartbeat:true,code:'ABCD',state:saved,bank,broadcast:(v,rem)=>out.push({v,rem}),now:()=>t,
  setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.push(h);return h;},clearTimeout:h=>{timers=timers.filter(x=>x!==h);}});
tick(31000); assert.equal(last().phase,'reveal','resumed timer closes question');
// deck larger than bank
const d=E.buildDeck(40,['estimation'],bank,{}); assert.equal(d.length,40);
console.log('OK', totals, 'persisted',persisted);
