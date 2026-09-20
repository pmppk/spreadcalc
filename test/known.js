// Fresh-shoe basic-strategy house edge vs. published (Wizard of Odds) figures.
const E = require('../engine.js');
const cases = [
  ['8D S17 DAS RSA-no, split4, 3:2', {decks:8,h17:false,das:true}, 0.43],
  ['8D H17 DAS', {decks:8,h17:true,das:true}, 0.65],
  ['6D S17 DAS', {decks:6,h17:false,das:true}, 0.42],
  ['6D H17 DAS', {decks:6,h17:true,das:true}, 0.64],
  ['6D H17 DAS LS', {decks:6,h17:true,das:true,surrender:true}, 0.55],
  ['6D S17 DAS 6:5', {decks:6,h17:false,das:true,bj:1.2}, 1.81],
  ['2D S17 DAS', {decks:2,h17:false,das:true}, 0.19],
  ['1D S17 DAS', {decks:1,h17:false,das:true}, 0.00],
  ['1D S17 noDAS 3:2', {decks:1,h17:false,das:false}, 0.17],
  ['1D H17 DAS 6:5', {decks:1,h17:true,das:true,bj:1.2}, 1.4],
];
for (const [n, r, ref] of cases) {
  const rules = E.normalizeRules(Object.assign({strategy:'basic'}, r));
  const c = E.makeComposition(0, rules.decks);
  const t = Date.now();
  const ev = E.compositionEV(c, rules, null);
  console.log(n.padEnd(34), 'house edge', (-ev*100).toFixed(3).padStart(7), '%  (ref ~', ref, ')', Date.now()-t, 'ms');
}
