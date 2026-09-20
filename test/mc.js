// Monte Carlo cross-check: deal real shuffled shoes (fresh shoe every round) and play the
// engine's total-dependent policy with true card removal. Compares against the analytic EV.
const E = require('../engine.js');
function rng(a){return function(){a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
function run(rulesIn, n, seed) {
  const rules = E.normalizeRules(Object.assign({strategy:'basic'}, rulesIn));
  const D = rules.decks, c0 = E.makeComposition(0, D);
  const pols = []; for (let u=1;u<=10;u++) pols[u] = E.derivePolicy(c0, rules, u);
  const rand = rng(seed||7);
  const total = 52*D, shoe = new Uint8Array(total);
  let sum = 0, sum2 = 0;
  for (let it=0; it<n; it++) {
    let i=0; for (let d=0;d<D;d++) for (let r=1;r<=10;r++){const k=r===10?16:4; for(let j=0;j<k;j++) shoe[i++]=r;}
    // partial shuffle: only need first ~30 cards
    for (let j=0;j<40;j++){const k=j+Math.floor(rand()*(total-j)); const t=shoe[j];shoe[j]=shoe[k];shoe[k]=t;}
    let pos=0; const draw=()=>shoe[pos++];
    const p1=draw(), up=draw(), p2=draw(), hole=draw();
    const dBJ = (up===1&&hole===10)||(up===10&&hole===1);
    const pBJ = (p1===1&&p2===10)||(p1===10&&p2===1);
    let res;
    if (dBJ) res = pBJ?0:-1;
    else if (pBJ) res = rules.bj;
    else {
      const pol = pols[up];
      const tot = (cards) => { let t=0,a=0; for(const c of cards){t+=c; if(c===1)a++;} return (a&&t+10<=21)?[t+10,1]:[t,0]; };
      // dealer final total lazily
      let dcache=null;
      const dealer = () => { if(dcache!==null) return dcache; const cs=[up,hole]; for(;;){const [t,s]=tot(cs); if(t>17||(t===17&&!(s&&rules.h17))){dcache=t;return t;} cs.push(draw());} };
      const settle = (t, bet) => { if(t>21) return -bet; const d=dealer(); return d>21?bet: t>d?bet: t<d?-bet:0; };
      const key = p1<=p2?p1*11+p2:p2*11+p1;
      const a0 = pol.init[key];
      const [t0,s0] = tot([p1,p2]);
      if (a0===4) res=-0.5;
      else {
        // hands: list of {cards, canDouble, aceSplitLocked}
        const play = (cards, isSplit, locked, k, rootR) => {
          // returns EV total for this hand (and any resplits)
          if (locked) { const [t]=tot(cards); return settle(t,1); }
          let first = true;
          for(;;){
            const [t,s]=tot(cards);
            if (t>21) return -1;
            let act;
            if (cards.length===2) {
              if (!isSplit) act = (first ? a0 : null);
              if (isSplit || act===null) { act = pol.ps[s][t]; }
              if (!isSplit && a0===3 && cards[0]===cards[1] && first) act = 3;
            } else act = pol.m[s][t];
            first=false;
            if (act===3) { return -99; }
            if (act===2 && cards.length===2 && (isSplit?rules.das:true)) {
              cards.push(draw()); const [t2]=tot(cards); return settle(t2,2);
            }
            if (act===1 || act===2) { cards.push(draw()); continue; }
            return settle(t,1);
          }
        };
        if (a0===3 && p1===p2) {
          // split handling with resplits
          let hands = [[p1]], done=0, val=0; const M=rules.maxHands;
          const q=[[p1]]; let count=2; const r=p1; const out=[];
          const work=[[p1],[p1]];
          while(work.length){
            const h=work.pop(); h.push(draw());
            const locked = (r===1 && !rules.hitSplitAces);
            if (h[1]===r && count<M && (r!==1||rules.resplitAces) && pol.rs[r*10+count]) { count++; work.push([r]); work.push([r]); continue; }
            out.push([h,locked]);
          }
          for (const [h,locked] of out) val += play(h,true,locked);
          res = val;
        } else if (a0===3) res = 0; // shouldn't happen
        else {
          const cards=[p1,p2];
          res = play(cards,false,false);
        }
      }
    }
    sum+=res; sum2+=res*res;
  }
  const mean=sum/n, sd=Math.sqrt(sum2/n-mean*mean);
  return { mc: mean, se: sd/Math.sqrt(n), an: E.compositionEV(c0, rules, null) };
}
module.exports = run;
if (require.main === module) {
  const cases = [
    ['1D S17 DAS', {decks:1,h17:false,das:true}],
    ['1D S17 noDAS', {decks:1,h17:false,das:false}],
    ['2D H17 DAS', {decks:2,h17:true,das:true}],
    ['6D S17 DAS', {decks:6,h17:false,das:true}],
  ];
  const N = +process.argv[2] || 3000000;
  for (const [n,r] of cases) { const o=run(r, N, 11); console.log(n.padEnd(14),'MC',(o.mc*100).toFixed(3),'+/-',(o.se*100).toFixed(3),' analytic',(o.an*100).toFixed(3)); }
}
