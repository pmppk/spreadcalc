// Where in the shoe does a fixed insurance count threshold stop making sense? (single deck, unbalanced count)
const E = require('../engine.js');
const o = E.normalizeRules({ decks:1, h17:true, das:false, bj:1.2, doubleRule:'9-11', boxes:+process.argv[3]||2, others:+process.argv[4]||0,
  autoPen:true, countSystem:'ub', strategy:'basic-ins' });
const sim = E.simulateCounts(o, +process.argv[2] || 3000000);
const rounds = [...new Set(Object.keys(sim.insDetail).map(k => +k.split('|')[0]))].sort((a,b)=>a-b);
console.log('rounds per shuffle:', sim.roundsPerShuffle, ' avg penetration', (sim.avgPen*100).toFixed(1)+'%');
for (const r of rounds) {
  const rows = Object.entries(sim.insDetail).filter(([k]) => +k.split('|')[0] === r).map(([k,v]) => ({c:+k.split('|')[1], ...v})).sort((a,b)=>a.c-b.c);
  const aces = rows.reduce((s,x)=>s+x.n,0), seen = rows.reduce((s,x)=>s+x.sumSeen,0)/aces;
  console.log(`\nRound ${r}: dealer aces ${aces}, avg cards already dealt at the offer ${seen.toFixed(1)}, natural count drift there ${(4*seen/52).toFixed(1)}`);
  console.log(' count at offer : ' + rows.filter(x=>x.n>=150).map(x=>String(x.c).padStart(6)).join(''));
  console.log(' EV / insured ace: ' + rows.filter(x=>x.n>=150).map(x=>(x.sumEV/x.n).toFixed(2).padStart(6)).join(''));
  const pos = rows.filter(x=>x.n>=150 && x.sumEV/x.n > 0).map(x=>x.c);
  console.log(' break-even: insurance is +EV from count', pos.length ? Math.min(...pos) : 'never', ' (best fixed threshold:',
    (() => { let best=null,bv=-1e9; for (let t=-4;t<=14;t++){ const v=rows.filter(x=>x.c>=t).reduce((s,x)=>s+x.sumEV,0); if(v>bv){bv=v;best=t;} } return best; })(), ')');
}
