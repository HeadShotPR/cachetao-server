import { arrangeGroups } from './cards.js';
import { randomInt, randomUUID } from './random.js';
import { addPlayer, isWild, meldValid, move, requireThat, solveHand, touch, winningPickup, claimDiscard, decideRound } from './game.js';

// This evaluator only receives the bot's hand and public information.
export function handQuality(hand, wild) {
  const groups=[];
  for(let mask=1;mask<(1<<hand.length);mask++) {
    const cards=hand.filter((_,i)=>mask&(1<<i));
    if(cards.length>=3 && meldValid(cards,wild))groups.push({mask,size:cards.length});
  }
  const memo=new Map();
  function best(mask) {
    if(memo.has(mask))return memo.get(mask);
    const rest=hand.filter((_,i)=>mask&(1<<i));
    let score=rest.reduce((v,c)=>v+(isWild(c,wild)?24:0)-c.r*.015,0);
    for(let i=0;i<rest.length;i++)for(let j=i+1;j<rest.length;j++){
      const a=rest[i],b=rest[j];
      if(a.r===b.r && a.s!==b.s)score+=7;
      if(a.s===b.s && a.r!==b.r){const distance=Math.abs(a.r-b.r);score+=distance===1||distance===12?8:distance===2||distance===11?3:0;}
    }
    for(const g of groups)if((mask&g.mask)===g.mask)score=Math.max(score,g.size*100+best(mask^g.mask));
    memo.set(mask,score);return score;
  }
  return best((1<<hand.length)-1);
}
export function bestDiscard(hand,wild) {
  let best=null;
  for(let i=0;i<hand.length;i++) {
    const remaining=hand.filter((_,j)=>j!==i);
    const wins=!!solveHand(remaining,wild);
    const score=wins?10000:handQuality(remaining,wild);
    if(!best || score>best.score)best={card:hand[i].id,score,wins};
  }
  return best;
}
export function decideBot({hand,wild,phase,discardTop,deckCount,canRecycle=false}) {
  if(phase==='draw') {
    if(discardTop){
      const combined=[...hand,discardTop];
      if(solveHand(combined,wild))return {type:'draw',source:'discard'};
      const choice=bestDiscard(combined,wild);
      if(choice.wins || (choice.card!==discardTop.id && choice.score>handQuality(hand,wild)+1))return {type:'draw',source:'discard'};
    }
    return {type:'draw',source:deckCount===0&&!canRecycle&&discardTop?'discard':'deck'};
  }
  if(solveHand(hand,wild))return {type:'knock',card:null};
  const choice=bestDiscard(hand,wild);
  return {type:choice.wins?'knock':'discard',card:choice.card};
}
export function setBots(room,count) {
  requireThat(room.status==='waiting','Ajuste os bots antes de começar.');
  const humans=room.players.filter(p=>!p.bot);
  requireThat(Number.isInteger(count)&&count>=0&&count<=room.capacity-humans.length,'Quantidade de bots inválida.');
  const existing=room.players.filter(p=>p.bot);
  room.players=[...humans,...existing.slice(0,count)];
  const names=['Lia','Caio','Bia','Davi','Leo','Gabi','Enzo','Mia','Theo','Lucas'];
  for(let i=existing.length;i<count;i++)addPlayer(room,{id:'bot-'+randomUUID(),name:names[i]+' · Bot',avatar:(i+2)%6,bot:true});
  room.practice=count>0;touch(room);
}
function ready(hand,wild){
  if(arrangeGroups(hand,wild).filter(g=>g.valid).reduce((n,g)=>n+g.cards.length,0)<6)return false;
  const options=[];
  for(let s=0;s<4;s++)for(let r=1;r<=13;r++)options.push({id:`potential-${s}-${r}`,r,s});
  return options.some(c=>winningPickup(hand,c,wild));
}
export function stepBots(room,now=Date.now()) {
  if(['offered','claiming'].includes(room.status)&&room.offer){
    const card=room.discard.at(-1);if(card?.id!==room.offer.cardId)return false;
    room.botReactions||={};
    const eligible=room.players.filter(p=>p.bot&&p.id!==room.offer.from&&p.points>0&&!p.folded&&!p.closedOnly&&p.hand.length===9&&winningPickup(p.hand,card,room.wild));
    let changed=false;
    for(const p of eligible){const key=`${room.round}:${card.id}:${room.claimUntil}:${p.id}`;if(!room.botReactions[key]){room.botReactions[key]=now+500+randomInt(1300);changed=true;}}
    const first=eligible.sort((a,b)=>room.botReactions[`${room.round}:${card.id}:${room.claimUntil}:${a.id}`]-room.botReactions[`${room.round}:${card.id}:${room.claimUntil}:${b.id}`])[0];
    if(first&&now>=room.botReactions[`${room.round}:${card.id}:${room.claimUntil}:${first.id}`]){claimDiscard(room,first.id,card.id);return true;}
    return changed;
  }
  if (room.status === 'decision') {
    const currentSeat = room.decisionOrder?.[room.decisionIndex];
    const player = room.players[currentSeat];
    if (!player || !player.bot) return false;
    const key = `decision:${room.round}:${player.id}:${room.decisionIndex}`;
    if (room.botTurnKey !== key) {
      room.botTurnKey = key;
      room.botNextAt = now + 750 + randomInt(600);
      return true;
    }
    if (now < room.botNextAt) return false;
    const q = handQuality(player.hand, room.wild);
    const hasWild = player.hand.some(c => isWild(c, room.wild));
    const melds = arrangeGroups(player.hand, room.wild).filter(g => g.valid);
    let choice = 'play';
    if (player.points <= 1) {
      choice = 'play';
    } else if (melds.length === 0 && !hasWild && q < 40 && Math.random() < 0.6) {
      choice = 'fold';
    }
    decideRound(room, player.id, choice);
    room.botTurnKey = null;
    room.botNextAt = null;
    return true;
  }
  if(room.status!=='playing')return false;
  const player=room.players[room.turn];if(!player?.bot)return false;
  const key=`${room.round}:${room.turn}:${room.phase}:${player.hand.map(c=>c.id).join(',')}`;
  if(room.botTurnKey!==key){room.botTurnKey=key;room.botNextAt=now+1000+randomInt(450);return true;}
  if(now<room.botNextAt)return false;
  const action=decideBot({hand:player.hand.map(c=>({...c})),wild:room.wild,phase:room.phase,discardTop:room.discard.at(-1),deckCount:room.deck.length,canRecycle:room.discard.length>1});
  move(room,player.id,{...action,version:room.version});
  if(player.hand.length===9&&!player.closedOnly&&!player.pifado&&ready(player.hand,room.wild)){player.pifado=true;touch(room);}
  room.botTurnKey=null;room.botNextAt=null;return true;
}
