// Measures per-box variance and the covariance between two boxes that face the same dealer hand
// (real shuffled shoe, engine's basic-strategy policy). Used for the multi-box variance constants.
const E = require('../engine.js');
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function measure(rulesIn, n, seed) {
  const rules = E.normalizeRules(Object.assign({strategy:'basic'}, rulesIn));
  const D = rules.decks, c0 = E.makeComposition(0, D);
  const pols = []; for (let u=1;u<=10;u++) pols[u] = E.derivePolicy(c0, rules, u);
  const rand = rng(seed||5), total = 52*D, shoe = new Uint8Array(total);
  const tot = (cs) => { let t=0,a=0; for(const c of cs){t+=c; if(c===1)a++;} return (a&&t+10<=21)?[t+10,1]:[t,0]; };
  let s1=0,s2=0,sxy=0,sx=0,sy=0,cnt=0;
  for (let it=0; it<n; it++) {
    let i=0; for (let d=0;d<D;d++) for (let r=1;r<=10;r++){const k=r===10?16:4; for(let j=0;j<k;j++) shoe[i++]=r;}
    for (let j=0;j<60;j++){const k=j+Math.floor(rand()*(total-j)); const t=shoe[j];shoe[j]=shoe[k];shoe[k]=t;}
    let pos=0; const draw=()=>shoe[pos++];
    const a=[draw(),draw()], b=[draw(),draw()], up=draw(), hole=draw();
    const dBJ=(up===1&&hole===10)||(up===10&&hole===1), pol=pols[up];
    let dc=null;
    const dealer=()=>{ if(dc!==null) return dc; const cs=[up,hole]; for(;;){const [t,s]=tot(cs); if(t>17||(t===17&&!(s&&rules.h17))){dc=t;return t;} cs.push(draw());} };
    const settle=(t,bet)=>{ if(t>21) return -bet; const d=dealer(); return d>21?bet:t>d?bet:t<d?-bet:0; };
    const spot=(p1,p2)=>{
      const nat=(p1===1&&p2===10)||(p1===10&&p2===1);
      if (dBJ) return nat?0:-1; if (nat) return rules.bj;
      const key=p1<=p2?p1*11+p2:p2*11+p1, a0=pol.init[key];
      if (a0===4) return -0.5;
      const play=(cards,isSplit,locked)=>{
        if (locked) return settle(tot(cards)[0],1);
        let first=true;
        for(;;){ const [t,s]=tot(cards); if(t>21) return -1;
          let act = cards.length===2 ? (isSplit?pol.ps[s][t]:a0) : pol.m[s][t];
          if (act===undefined) act=0; first=false;
          if (act===2 && cards.length===2) { cards.push(draw()); return settle(tot(cards)[0],2); }
          if (act===1||act===2) { cards.push(draw()); continue; }
          return settle(t,1); }
      };
      if (a0===3 && p1===p2) {
        const r=p1, M=rules.maxHands, work=[[r],[r]], out=[]; let count=2, val=0;
        while(work.length){ const h=work.pop(); h.push(draw());
          if (h[1]===r && count<M && (r!==1||rules.resplitAces) && pol.rs[r*10+count]) { count++; work.push([r]); work.push([r]); continue; }
          out.push(h); }
        for (const h of out) val+=play(h,true,r===1&&!rules.hitSplitAces);
        return val;
      }
      return play([p1,p2],false,false);
    };
    const x=spot(a[0],a[1]), y=spot(b[0],b[1]);
    s1+=x*x+y*y; sx+=x+y; sxy+=x*y; sy+=x*y; cnt++;
  }
  const mean=sx/(2*cnt), varr=s1/(2*cnt)-mean*mean, cov=sxy/cnt-mean*mean;
  return { mean, var: varr, cov, rho: cov/varr };
}
if (require.main === module) {
  const n=+process.argv[2]||4000000;
  for (const [nm,r] of [['6D H17 DAS',{decks:6,h17:true}],['1D S17 DAS',{decks:1,h17:false}],['6D S17 noDAS',{decks:6,h17:false,das:false}]]) {
    const o=measure(r,n); console.log(nm.padEnd(14),'var/box',o.var.toFixed(3),'cov',o.cov.toFixed(3),'rho',o.rho.toFixed(3));
  }
}
module.exports = measure;
