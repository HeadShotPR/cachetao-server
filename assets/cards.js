export const isRedSuit = (s) => s === 1 || s === 2;
export const isSameColor = (s1, s2) => isRedSuit(s1) === isRedSuit(s2);

export const isWild = (c, wild) => {
  if (!c || c.joker || !wild) return false;
  if (c.r !== wild.r) return false;
  if (Array.isArray(wild.suits)) return wild.suits.includes(c.s);
  if (wild.s !== undefined) return isSameColor(c.s, wild.s);
  return false;
};
// One joker per meld. Ace may be low or high, never wrap around K-A-2.
export function meldValid(cards, wild) {
  if (cards.length < 3 || cards.length > 13) return false;
  if (cards.some(c=>c.joker)) return false;
  const naturals = cards.filter(c => !isWild(c, wild));
  if (cards.length - naturals.length > 1 || naturals.length < 2) return false;
  if (naturals.every(c => c.r === naturals[0].r)) {
    const counts = {};
    for (const c of naturals) counts[c.s] = (counts[c.s] || 0) + 1;
    const maxCount = Math.max(...Object.values(counts));
    const distinctSuits = Object.keys(counts).length;

    if (cards.length === 3) {
      // Trinca: não pode ter 2 naipes iguais! Todos os naipes devem ser diferentes.
      if (maxCount === 1) return true;
    } else if (cards.length === 4) {
      // Quadra (bater de 10): 4 naipes diferentes OU 3 naipes diferentes + a 4ª carta com naipe igual.
      // Proíbe 2 pares de naipes repetidos (ex: 2 de espadas e 2 de copas) e 3 do mesmo naipe.
      if (maxCount <= 2) {
        if (naturals.length === 4 && distinctSuits >= 3) return true;
        if (naturals.length === 3 && distinctSuits >= 2) return true;
      }
    }
    return false;
  }
  if (!naturals.every(c => c.s === naturals[0].s)) return false;
  return [false, true].some(high => {
    const ranks = naturals.map(c => high && c.r === 1 ? 14 : c.r).sort((a,b) => a-b);
    return new Set(ranks).size === ranks.length && ranks.at(-1) - ranks[0] < cards.length;
  });
}
export function solveHand(hand, wild) {
  if (![9, 10].includes(hand.length) || new Set(hand.map(c => c.id)).size !== hand.length) return null;
  const memo = new Set();
  function solve(mask) {
    if (!mask) return [];
    if (memo.has(mask)) return null;
    const first = mask & -mask;
    for (let sub = mask; sub; sub = (sub - 1) & mask) {
      if (!(sub & first)) continue;
      const group = hand.filter((_, i) => sub & (1 << i));
      if (!meldValid(group, wild)) continue;
      const rest = solve(mask ^ sub);
      if (rest) return [group, ...rest];
    }
    memo.add(mask); return null;
  }
  return solve((1 << hand.length) - 1);
}
export function arrangeGroups(hand,wild) {
  const full=solveHand(hand,wild);if(full)return full.map(cards=>({cards,valid:true}));
  const groups=[];
  for(let mask=1;mask<(1<<hand.length);mask++){
    const cards=hand.filter((_,i)=>mask&(1<<i));
    if(cards.length>=3&&meldValid(cards,wild))groups.push({mask,cards});
  }
  const memo=new Map();
  function visit(mask){
    if(memo.has(mask))return memo.get(mask);
    let best={score:0,groups:[],rest:mask};
    for(const g of groups)if((mask&g.mask)===g.mask){const tail=visit(mask^g.mask),score=tail.score+g.cards.length;if(score>best.score)best={score,groups:[{cards:g.cards,valid:true},...tail.groups],rest:tail.rest};}
    memo.set(mask,best);return best;
  }
  const result=visit((1<<hand.length)-1),loose=hand.filter((_,i)=>result.rest&(1<<i));
  return [...result.groups,...(loose.length?[{cards:loose,valid:false}]:[])];
}
