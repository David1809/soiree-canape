const E=require(__dirname + '/../engine.js'),vm=require('vm'),fs=require('fs'),assert=require('assert');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname + '/../questions.js','utf8')+';this.Q=QUESTIONS',c);
let t=0,timers=[],out=[];
const eng=new E.Engine({noHeartbeat:true,code:'ABCD',hasTv:true,bank:c.Q,broadcast:v=>out.push(v),now:()=>t,
  setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.push(h);return h;},clearTimeout:h=>{timers=timers.filter(x=>x!==h);}});
const tick=ms=>{t+=ms;timers.filter(h=>h.at<=t).forEach(h=>{timers=timers.filter(x=>x!==h);h.fn();});};
const last=()=>out[out.length-1];
['p1','p2','p3','p4'].forEach((p,i)=>eng.handle({t:'join',pid:p,name:'J'+i}));
eng.handle({t:'cmd',pid:'p1',cmd:'start',settings:{count:8,games:['pyramide','croquis'],finale:false}});
const giv={},draw={};
for(let r=1;r<=8;r++){
  tick(3500); const cur=eng.s.cur; let v=last(); assert.equal(v.phase,'question'); assert.equal(v.cur.a,undefined);
  if(cur.g==='pyramide'){
    giv[cur.giver]=(giv[cur.giver]||0)+1; assert.notEqual(cur.giver,cur.partner);
    eng.handle({t:'pyr',pid:cur.giver,round:r,ok:true}); assert.equal(last().phase,'question'); // pas encore annoncé
    eng.handle({t:'announce',pid:cur.partner,round:r,n:1}); assert.equal(eng.s.cur.step,'announce'); // pas le donneur
    eng.handle({t:'announce',pid:cur.giver,round:r,n:2}); assert.equal(eng.s.cur.step,'play'); assert.equal(eng.s.cur.n,2);
    eng.handle({t:'pyr',pid:cur.giver,round:r,ok:true}); v=last();
    assert.equal(v.phase,'reveal'); assert.equal(v.result[cur.giver].pts,20); assert.equal(v.result[cur.partner].pts,20);
  } else {
    draw[cur.drawer]=(draw[cur.drawer]||0)+1;
    const others=['p1','p2','p3','p4'].filter(p=>p!==cur.drawer);
    eng.handle({t:'guess',pid:cur.drawer,round:r,text:cur.a}); // dessinateur ignoré
    eng.handle({t:'guess',pid:others[0],round:r,text:'zzzzzz'}); assert.equal(last().fb[others[0]].res,'no');
    eng.handle({t:'guess',pid:others[1],round:r,text:cur.a.toUpperCase()+'s'});
    eng.handle({t:'guess',pid:others[0],round:r,text:cur.a});
    v=last(); assert.equal(v.phase,'question'); assert.equal(v.cur.found.length,2);
    // le 3e joueur ne trouve pas -> fin au chrono
    tick(60000); v=last(); assert.equal(v.phase,'reveal');
    assert.equal(v.result[others[1]].pts,30); assert.equal(v.result[others[0]].pts,20); assert.equal(v.result[others[2]].pts,0); assert.equal(v.result[cur.drawer].pts,20);
  }
  eng.handle({t:'cmd',pid:'p1',cmd:'next'});
}
console.log('givers',giv,'drawers',draw);
// annonce non faite -> 3 indices automatiquement
// Joueur hors ligne : on n'attend plus
const e2=new E.Engine({noHeartbeat:true,code:'X',hasTv:true,bank:c.Q,broadcast:v=>out.push(v),now:()=>t,
  setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.push(h);return h;},clearTimeout:h=>{timers=timers.filter(x=>x!==h);}});
['a','b','c'].forEach(p=>e2.handle({t:'join',pid:p,name:p}));
e2.handle({t:'cmd',pid:'a',cmd:'start',settings:{count:3,games:['culture'],finale:false}});
tick(3500); e2.handle({t:'answer',pid:'a',round:1,val:0}); e2.handle({t:'answer',pid:'b',round:1,val:1});
assert.equal(e2.s.phase,'question');
tick(5000); e2.seen.a=t; e2.seen.b=t; t+=26000; e2.seen.a=t; e2.seen.b=t; e2.checkActive();
assert.equal(e2.s.phase,'reveal','closes when only offline player is missing'); assert.equal(e2.s.players[2].off,true);
e2.handle({t:'ping',pid:'c'}); assert.equal(e2.s.players[2].off,false);
console.log('OK pyramide/croquis/offline');
