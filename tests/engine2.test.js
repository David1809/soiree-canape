const E=require(__dirname + '/../engine.js'),vm=require('vm'),fs=require('fs'),assert=require('assert');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname + '/../questions.js','utf8')+';this.Q=QUESTIONS',c);
let t=0,timers=[],out=[];
const eng=new E.Engine({noHeartbeat:true,code:'ABCD',hasTv:true,bank:c.Q,broadcast:v=>out.push(v),now:()=>t,
  setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.push(h);return h;},clearTimeout:h=>{timers=timers.filter(x=>x!==h);}});
const tick=ms=>{t+=ms;timers.filter(h=>h.at<=t).forEach(h=>{timers=timers.filter(x=>x!==h);h.fn();});};
const last=()=>out[out.length-1];
['p1','p2','p3'].forEach((p,i)=>eng.handle({t:'join',pid:p,name:'J'+i}));
eng.handle({t:'cmd',pid:'p1',cmd:'start',settings:{count:6,games:['bluff','ordre'],finale:false}});
let sawB=0,sawO=0;
for(let r=1;r<=6;r++){
  tick(3500); const cur=eng.s.cur; let v=last();
  assert.equal(v.phase,'question'); assert.equal(v.cur.a,undefined); assert.equal(v.cur.order,undefined);
  if(cur.g==='bluff'){ sawB++;
    eng.handle({t:'answer',pid:'p1',round:r,val:cur.a.toUpperCase()}); // truth -> rejected
    assert.equal(last().reject.p1.why,'truth'); assert.ok(!last().answered.includes('p1'));
    eng.handle({t:'answer',pid:'p1',round:r,val:'Un truc inventé'});
    eng.handle({t:'answer',pid:'p2',round:r,val:'un truc invente'}); // dup
    assert.equal(last().reject.p2.why,'dup');
    eng.handle({t:'answer',pid:'p2',round:r,val:'Une autre idée farfelue'});
    eng.handle({t:'answer',pid:'p3',round:r,val:'Troisième mensonge'});
    v=last(); assert.equal(v.phase,'vote'); assert.equal(v.options.length,4); assert.ok(v.options.every(o=>o.by===undefined));
    const opt=eng.s.options, truth=opt.find(o=>o.by===null), l1=opt.find(o=>o.by==='p1');
    eng.handle({t:'vote',pid:'p1',round:r,opt:l1.id}); // own -> ignored
    assert.ok(!last().answered.includes('p1'));
    eng.handle({t:'vote',pid:'p1',round:r,opt:truth.id});
    eng.handle({t:'vote',pid:'p2',round:r,opt:l1.id});
    eng.handle({t:'vote',pid:'p3',round:r,opt:l1.id});
    v=last(); assert.equal(v.phase,'reveal');
    assert.equal(v.result.p1.pts,25); assert.equal(v.result.p1.fooled,2); assert.equal(v.result.p2.pts,0);
  } else { sawO++;
    eng.handle({t:'answer',pid:'p1',round:r,val:cur.order.slice()});
    eng.handle({t:'answer',pid:'p2',round:r,val:[cur.order[1],cur.order[0],cur.order[2],cur.order[3]]});
    eng.handle({t:'answer',pid:'p3',round:r,val:[0,0,1,2]}); // invalid
    tick(30000); v=last(); assert.equal(v.phase,'reveal');
    assert.equal(v.result.p1.pts,30); assert.equal(v.result.p2.pts,10); assert.equal(v.result.p3.pts,0);
    assert.ok(Array.isArray(v.cur.order));
  }
  eng.handle({t:'cmd',pid:'p1',cmd:'next'});
}
assert.equal(last().phase,'final'); console.log('OK bluff',sawB,'ordre',sawO);
// bluff with no lies -> reveal directly
