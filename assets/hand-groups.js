import {arrangeGroups,isWild} from './cards.js';
import {syncGroups} from './hand-layout.js';
export function groupLabel(group,wild){
  if(!group?.valid)return 'Em formação';
  const natural=group.cards.filter(c=>!isWild(c,wild));
  return natural.every(c=>c.r===natural[0].r)?group.cards.length>=5?'Quina':group.cards.length===4?'Quadra':'Trinca':'Sequência';
}
// Recognize melds even when a manually assembled group also contains loose cards.
export function recognizeManual(groups,hand,wild){
  return syncGroups(groups,hand).flatMap(ids=>arrangeGroups(ids.map(id=>hand.find(c=>c.id===id)),wild));
}
export function purchaseMeld(hand,id,wild){
  return arrangeGroups(hand,wild).find(g=>g.valid&&g.cards.some(c=>c.id===id))||null;
}
export function integratePurchase(groups,hand,id,wild){
  const clean=syncGroups(groups,hand),meld=purchaseMeld(hand,id,wild);
  if(!meld)return clean;
  const ids=new Set(meld.cards.map(c=>c.id));
  const destination=clean.findIndex(g=>g.some(c=>c!==id&&ids.has(c)));
  const result=[];
  clean.forEach((g,i)=>{if(i===destination)result.push([...ids]);const rest=g.filter(c=>!ids.has(c));if(rest.length)result.push(rest);});
  if(destination<0)result.push([...ids]);
  return result;
}
