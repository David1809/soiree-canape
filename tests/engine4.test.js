const E=require(__dirname + '/../engine.js'),vm=require('vm'),fs=require('fs'),assert=require('assert');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname + '/../questions.js','utf8')+';this.Q=QUESTIONS',c);
let t=0,timers=[],out=[],rec=null;
const eng=new E.Engine({noHeartbeat:true,code:'ABCD',hasTv:true,bank:c.Q,broadcast:v=>out.push(v),now:()=>t,recordGame:p=>rec=p,
  getExcluded:()=>({cg001:true}),
  setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.push(h);return h;},clearTimeout:h=>{timers=timers.filter(x=>x!==h);}});
const tick=ms=>{t+=ms;timers.filter(h=>h.at<=t).forEach(h=>{timers=timers.filter(x=>x!==h);h.fn();});};
const last=()=>out[out.length-1];
['p1','p2','p3','p4'].forEach((p,i)=>eng.handle({t:'join',pid:p,name:'J'+i}));
eng.handle({t:'cmd',pid:'p1',cmd:'start',settings:{count:6,games:['culture'],finale:false,mode:'manches',pace:'rapide',diff:'facile',teams:true}});
assert.ok(eng.s.players.every(p=>p.team===0||p.team===1)); assert.equal(eng.s.players.filter(p=>p.team===0).length,2);
assert.ok(!eng.s.deck.some(d=>d.id==='cg001'),'excluded');
for(let r=1;r<=6;r++){ tick(3500); const cur=eng.s.cur; assert.equal(cur.time,14000,'pace rapide 20*0.7');
  const q=c.Q.culture.find(x=>x.id===cur.id); assert.ok(q.d<=2,'facile');
  eng.handle({t:'answer',pid:'p2',round:r,val:cur.a}); eng.handle({t:'answer',pid:'p1',round:r,val:cur.a});
  eng.handle({t:'answer',pid:'p3',round:r,val:(cur.a+1)%4}); eng.handle({t:'answer',pid:'p4',round:r,val:(cur.a+1)%4});
  eng.handle({t:'cmd',pid:'p1',cmd:'next'}); }
const v=last(); assert.equal(v.phase,'final'); console.log(JSON.stringify(v.titles)); assert.ok(rec && rec.length===4);
assert.ok(v.titles.p2[0].name==="L'Éclair"); assert.ok(v.titles.p3.length && v.titles.p4.length);
console.log('OK titles/teams/pace/diff/exclude');
