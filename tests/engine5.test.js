const E=require(__dirname + '/../engine.js'),vm=require('vm'),fs=require('fs'),assert=require('assert');
const c={};vm.createContext(c);vm.runInContext(fs.readFileSync(__dirname + '/../questions.js','utf8')+';this.Q=QUESTIONS',c);
let t=0,timers=[],out=[];
const mk=()=>new E.Engine({noHeartbeat:true,code:'ABCD',hasTv:true,bank:c.Q,broadcast:v=>out.push(v),now:()=>t,
  setTimeout:(fn,ms)=>{const h={fn,at:t+ms};timers.push(h);return h;},clearTimeout:h=>{timers=timers.filter(x=>x!==h);}});
const tick=ms=>{t+=ms;timers.filter(h=>h.at<=t).forEach(h=>{timers=timers.filter(x=>x!==h);h.fn();});};
const ping=(e,pids)=>pids.forEach(p=>e.handle({t:'ping',pid:p}));
// 1. le capitaine quitte en pleine partie -> retour au salon, nouveau capitaine
let e=mk(); ['p1','p2','p3'].forEach((p,i)=>e.handle({t:'join',pid:p,name:'J'+i}));
assert.equal(e.s.captain,'p1');
e.handle({t:'cmd',pid:'p1',cmd:'start',settings:{count:5,games:['culture'],finale:false}});
tick(3500); assert.equal(e.s.phase,'question');
e.handle({t:'leave',pid:'p1'});
assert.equal(e.s.phase,'lobby'); assert.equal(e.s.captain,'p2'); assert.equal(e.s.players.length,2); assert.equal(e.s.round,0);
assert.ok(e.s.players.every(p=>p.score===0)); assert.equal(timers.length,0,'plus de chrono');
// un joueur normal qui part ne stoppe pas la partie
e.handle({t:'cmd',pid:'p2',cmd:'start',settings:{count:5,games:['culture'],finale:false}});
tick(3500); e.handle({t:'leave',pid:'p3'}); assert.equal(e.s.phase,'question');
// 2. capitaine injoignable -> un joueur présent prend le relais
e=mk(); ['a','b'].forEach(p=>e.handle({t:'join',pid:p,name:p}));
e.handle({t:'cmd',pid:'a',cmd:'start',settings:{count:5,games:['culture'],finale:false}});
for(let i=0;i<8;i++){ tick(4000); ping(e,['b']); e.checkActive(); }
assert.equal(e.s.captain,'b'); assert.notEqual(e.s.phase,'lobby');
// 3. tout le monde injoignable plus d'une minute -> retour au QR code, joueurs fantômes retirés
for(let i=0;i<30;i++){ tick(4000); e.checkActive(); }
assert.equal(e.s.phase,'lobby'); assert.equal(e.s.players.length,0); assert.equal(e.s.captain,null);
// on peut rejoindre et relancer
e.handle({t:'join',pid:'c',name:'c'}); assert.equal(e.s.captain,'c');
console.log('OK capitaine parti / relais / abandon');
