import { randomInt, randomUUID } from './random.js';

export const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
export const requireThat = (condition, message, status) => { if (!condition) fail(message, status); };
export function deck() {
  const cards = [];
  for (let d = 0; d < 2; d++) for (let s = 0; s < 4; s++) for (let r = 1; r <= 13; r++) cards.push({ id: `${d}-${s}-${r}`, s, r });
  for (let i = cards.length - 1; i > 0; i--) { const j = randomInt(i + 1); [cards[i], cards[j]] = [cards[j], cards[i]]; }
  return cards;
}
export { isWild, meldValid, solveHand } from './cards.js';
import { solveHand } from './cards.js';
function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 6; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

export function newRoom(owner, options = {}) {
  const buyIn = Number(options.buyIn ?? 10);
  const code = String(options.code || generateRoomCode()).toUpperCase();
  return { rulesVersion:4, id: randomUUID(), code, name: options.name || 'Mesa de amigos', owner,
    clubId: options.clubId || null, tournamentId: options.tournamentId || null,
    private: !!options.private, capacity: Math.min(10, Math.max(2, options.capacity || 4)), points: options.points || 10,
    buyIn, pot: 0,
    players: [], status: 'waiting', round: 0, version: 0, messages: [], created: Date.now(), updated: Date.now() };
}
export function addPlayer(room, user) {
  if (room.players.some(p => p.id === user.id)) return;
  requireThat(room.status === 'waiting', 'Esta partida já começou.');
  requireThat(room.players.length < room.capacity, 'A mesa está cheia.');
  const buyIn = room.buyIn || 10;
  const initialChips = Math.max(10, (user.chips ?? 100) - buyIn);
  room.pot = (room.pot || 0) + buyIn;
  room.players.push({ id: user.id, name: user.name, avatar: user.avatar, bot:!!user.bot, points: room.points, hand: [], strikes: 0, chips: initialChips, pifado:false, folded:false, pendingReentry:false });
  touch(room);
}
export function touch(room) { room.version++; room.updated = Date.now(); }
export function nextSeat(room,from){
  for(let offset=1;offset<=room.players.length;offset++){const i=(from+offset+room.players.length)%room.players.length;if(room.players[i].points>0&&!room.players[i].folded)return i;}
  return -1;
}
export function startRound(room) {
  for(const p of room.players){p.pendingReentry=false;p.reentryRound=null;}
  const active = room.players.filter(p => p.points > 0);
  requireThat(active.length >= 2, 'São necessários pelo menos dois jogadores.');
  room.rulesVersion=4;room.botReactions={};room.deck = deck(); room.round++; room.status = 'dealing'; room.result = null; room.claims=[];room.offer=null;room.claimUntil=null;room.winner=null;
  room.discard = [];room.discardHistory=[];
  for (const p of room.players) { p.hand=[];p.strikes=0;p.closedOnly=false;p.lastDrawSource=null;p.drawnCardId=null;p.pifado=false;p.folded=false; }
  room.dealer=Number.isInteger(room.dealer)?nextSeat(room,room.dealer):room.players.indexOf(active.at(-1));
  room.turn=nextSeat(room,room.dealer);
  const order=[];let seat=room.turn;do{order.push(seat);seat=nextSeat(room,seat);}while(seat!==room.turn);
  room.decisionOrder=[...order];room.decisionIndex=0;room.decisionDeadline=null;
  const started=Date.now();room.deal={started,events:[],endsAt:started+500+order.length*3*480};
  for(let pass=0;pass<3;pass++)for(const i of order){
    const event={player:room.players[i].id,pass,count:3,at:started+500+room.deal.events.length*480};
    room.deal.events.push(event);
    for(let j=0;j<3;j++)room.players[i].hand.push(room.deck.pop());
  }
  // Deal the shuffled cards without inspecting their values. Then select the vira
  // uniformly among the remaining cards.

  const [vira]=room.deck.splice(randomInt(room.deck.length),1);
  room.vira=vira;
  const wildRank = vira.r === 13 ? 1 : vira.r + 1;
  const isRed = vira.s === 1 || vira.s === 2;
  room.wild = { r: wildRank, s: vira.s, suits: isRed ? [1, 2] : [0, 3] };
  room.phase='draw';room.deadline=room.deal.endsAt+45000;touch(room);
  room.botTurnKey=null;room.botNextAt=null;
}
function nextTurn(room) {
  room.turn=nextSeat(room,room.turn);
  room.phase = 'draw'; room.deadline = Date.now() + 45000;
}
export function canStartNextRound(room, now=Date.now()) {
  return room.status==='roundEnd' && room.players.filter(p=>p.points>0||p.pendingReentry).length>=2 &&
    (now>=room.nextRoundAt || !room.players.some(p=>!p.bot&&canReenter(room,p.id,now)));
}
export function finishRound(room, winners, penalty, melds = null) {
  for (const p of room.players) if (!winners.includes(p.id)) {
    if (!p.folded) {
      const before=p.points;p.points=Math.max(0,p.points-penalty);
      if(before>0&&p.points===0)p.reentryRound=room.round;
    }
  }
  room.result = { winners, penalty, melds, at: Date.now() };
  room.status = 'roundEnd';
  room.nextRoundAt = Date.now() + 12000;
  room.winner = null;room.claimUntil=null;room.offer=null;room.claims=[];
  touch(room);
}
export function winningPickup(hand,card,wild) {
  const all=[...hand,card],full=solveHand(all,wild);
  if(full)return {penalty:2,melds:full,discard:null};
  for(const c of hand){const melds=solveHand(all.filter(x=>x.id!==c.id),wild);if(melds)return {penalty:1,melds,discard:c.id};}
  return null;
}
export function declarePifado(room,uid) {
  const p=room.players.find(x=>x.id===uid);
  requireThat(room.status==='playing'&&p?.points>0&&!p.folded&&p.hand.length===9,'Avise quando tiver 9 cartas e estiver na rodada.');
  requireThat(!p.closedOnly,'Após bater errado, a batida precisa vir do monte fechado.');
  p.pifado=!p.pifado;touch(room);
}
export function canReenter(room,uid,now=Date.now()) {
  const p=room.players.find(x=>x.id===uid);
  return room.status==='roundEnd'&&now<room.nextRoundAt&&p?.points===0&&
    p.reentryRound===room.round&&!p.pendingReentry&&(p.chips??90)>=10&&
    room.players.filter(x=>x.points>0).length>=2;
}
function discardCard(room,card) {
  room.discardHistory||=[];
  room.discard.push(card);room.discardHistory.push({...card});
}
export function declineReentry(room,uid) {
  requireThat(canReenter(room,uid),'Reentrada indisponível.');
  room.players.find(p=>p.id===uid).reentryRound=null;touch(room);
}
export function reenter(room,uid) {
  const p=room.players.find(x=>x.id===uid);
  requireThat(canReenter(room,uid),'Reentrada disponível somente ao zerar, antes da próxima rodada, com pelo menos dois jogadores ativos.');
  requireThat((p.chips??90)>=10,'São necessárias 10 fichas fictícias.');
  p.points=Math.min(...room.players.filter(x=>x.points>0).map(x=>x.points));
  p.chips=(p.chips??90)-10;p.pendingReentry=true;p.reentryRound=null;touch(room);
}
function offerDiscard(room,uid) {
  const card=room.discard.at(-1);
  if(!card)return;
  if(room.lastAction?.type==='knock')return;
  const eligible=room.players.some(p=>p.id!==uid&&p.points>0&&!p.folded&&!p.closedOnly&&p.hand.length===9&&winningPickup(p.hand,card,room.wild));
  if(eligible){room.offer={cardId:card.id,from:uid};if(room.status!=='claiming'){room.status='offered';room.claimUntil=Date.now()+4000;}}
}
export function claimDiscard(room,uid,cardId) {
  requireThat(['offered','claiming'].includes(room.status)&&Date.now()<room.claimUntil,'A oportunidade de pegar já terminou.');
  const p=room.players.find(x=>x.id===uid),card=room.discard.at(-1);
  requireThat(card&&room.offer&&p?.points>0&&!p.folded&&!p.closedOnly&&p.hand.length===9&&room.offer.from!==uid&&card?.id===room.offer?.cardId&&card.id===cardId,'Esta carta não está disponível para você.');
  const win=winningPickup(p.hand,card,room.wild);requireThat(win,'Esta carta não fecha sua mão.');
  room.discard.pop();p.hand.push(card);p.lastDrawSource='discard';p.drawOrder=(room.drawOrder||0)+1;room.drawOrder=p.drawOrder;
  if(win.discard){const i=p.hand.findIndex(c=>c.id===win.discard);discardCard(room,p.hand.splice(i,1)[0]);}
  room.offer=null;addClaim(room,p,win.penalty,win.melds,card.id);
  if(win.discard)offerDiscard(room,uid);
}
export function claimKnock(room, uid, cardId, mode = 'auto') {
  requireThat(room.status === 'playing' || ['offered', 'claiming'].includes(room.status), 'A mesa não está disponível para batida.');
  requireThat(!room.lastAction || room.lastAction.type !== 'knock' || room.lastAction.player === uid, 'O jogador da vez já bateu nesta jogada.');
  const p = room.players.find(x => x.id === uid);
  const card = room.discard.at(-1);
  requireThat(card && card.id === cardId, 'A carta de descarte não está disponível.');
  requireThat(p && p.points > 0 && !p.folded && !p.closedOnly && p.hand.length === 9, 'Você não pode bater agora.');
  const win = winningPickup(p.hand, card, room.wild);
  requireThat(win, 'Esta carta não fecha sua mão.');
  if (mode === '10') {
    requireThat(win.penalty === 2, 'Sua mão não fecha com 10 cartas.');
  }
  room.discard.pop();
  p.hand.push(card);
  p.lastDrawSource = 'discard';
  p.drawOrder = (room.drawOrder || 0) + 1;
  room.drawOrder = p.drawOrder;
  if (win.discard) {
    const idx = p.hand.findIndex(c => c.id === win.discard);
    discardCard(room, p.hand.splice(idx, 1)[0]);
  }
  room.offer = null;
  addClaim(room, p, win.penalty, win.melds, card.id);
  if (win.discard) offerDiscard(room, uid);
  touch(room);
}
function addClaim(room,p,penalty,melds,sourceCard=null) {
  room.claims||=[];requireThat(!room.claims.some(c=>c.player===p.id),'Sua batida já está registrada.');
  room.claims.push({player:p.id,penalty,melds,sourceCard,order:p.drawOrder||0});
  if(room.status!=='claiming')room.claimUntil=Date.now()+3000;
  room.status='claiming';room.lastAction={type:'knock',player:p.id,at:Date.now()};touch(room);
}
export function resolveClaims(room) {
  const claims=room.claims||[];if(!claims.length)return;
  const priority=Math.max(...claims.map(c=>c.penalty));
  const candidates=claims.filter(c=>c.penalty===priority).sort((a,b)=>a.order-b.order);
  const unique=candidates.filter((c,i)=>!c.sourceCard||!candidates.slice(0,i).some(x=>x.sourceCard===c.sourceCard));
  const tie=priority===2&&unique.length>1;
  const winners=tie?unique.map(c=>c.player):[unique[0].player];
  finishRound(room,winners,tie?0:priority,unique[0].melds);room.result.tie=tie;
}
export function move(room, userId, action) {
  const contest=room.status==='claiming'&&action.type==='knock'&&Date.now()<room.claimUntil;
  requireThat(room.status === 'playing'||contest, 'A rodada não está disponível para esta jogada.');
  requireThat(Number.isInteger(action.version) && action.version === room.version, 'A mesa mudou. Aguarde a atualização e tente novamente.', 409);
  const p = contest?room.players.find(x=>x.id===userId):room.players[room.turn];
  requireThat(p?.id === userId&&p.points>0, 'Aguarde sua vez.');
  if (action.type === 'draw') {
    requireThat(room.phase === 'draw', 'Você já comprou uma carta.');
    requireThat(['deck', 'discard'].includes(action.source), 'Origem de carta inválida.');
    if (action.source === 'discard') {
      requireThat(room.discard.length, 'Não há carta no descarte.');
      p.hand.push(room.discard.pop());
    } else {
      if (!room.deck.length) {
        requireThat(room.discard.length > 1, 'O monte está vazio. Compre o descarte.');
        const top = room.discard.pop(); room.deck = room.discard; room.discard = [top];
        for (let i = room.deck.length - 1; i > 0; i--) { const j = randomInt(i + 1); [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]]; }
      }
      p.hand.push(room.deck.pop());
    }
    p.drawnCardId=p.hand.at(-1).id;p.lastDrawSource=action.source;p.drawOrder=(room.drawOrder||0)+1;room.drawOrder=p.drawOrder;
    room.phase = 'discard';
    room.lastAction={type:'draw',player:userId,source:action.source,at:Date.now()};
  } else if (action.type === 'discard' || action.type === 'knock') {
    requireThat((contest&&p.hand.length===10)||(!contest&&room.phase === 'discard'), 'Compre uma carta primeiro.');
    const idx = p.hand.findIndex(c => c.id === action.card);
    if (action.type === 'discard') {
      requireThat(idx >= 0, 'Selecione uma carta da sua mão.');
      discardCard(room,p.hand.splice(idx, 1)[0]); p.strikes = 0; nextTurn(room);
      room.lastAction={type:'discard',player:userId,card:room.discard.at(-1),at:Date.now()};
      offerDiscard(room,userId);
    } else {
      const withDiscard = action.card != null;
      requireThat(!withDiscard || idx >= 0, 'Carta inválida.');
      const hand = p.hand.filter((_, i) => !withDiscard || i !== idx);
      const groups = solveHand(hand, room.wild);
      requireThat(!p.closedOnly||p.lastDrawSource==='deck','Após bater errado, só é permitido bater comprando do monte fechado.');
      if(!groups){
        p.closedOnly=true;room.lastAction={type:'badKnock',player:userId,at:Date.now()};
        room.messages.push({name:'Mesa',text:`${p.name} bateu errado: recolhe as cartas e só pode bater comprando do monte fechado.`,at:Date.now()});
        room.messages=room.messages.slice(-30);touch(room);return;
      }
      if (withDiscard) discardCard(room,p.hand.splice(idx, 1)[0]);
      addClaim(room,p,withDiscard?1:2,groups);
      if(withDiscard)offerDiscard(room,userId);
      room.lastAction={type:'knock',player:userId,at:Date.now()};
    }
  } else fail('Jogada desconhecida.');
  touch(room);
}
export function decideRound(room, uid, choice) {
  requireThat(room.status === 'decision', 'A fase de decisão não está aberta.');
  const seat = room.decisionOrder?.[room.decisionIndex];
  const p = room.players[seat];
  requireThat(p && p.id === uid, 'Aguarde sua vez de decidir.');
  requireThat(['play', 'fold'].includes(choice), 'Opção inválida.');
  if (p.points <= 1 && choice === 'fold') fail('Com 1 ponto você é obrigado a jogar a rodada.');
  if (choice === 'fold') {
    p.folded = true;
    const before = p.points;
    p.points = Math.max(0, p.points - 1);
    if (before > 0 && p.points === 0) p.reentryRound = room.round;
    room.messages.push({ name: 'Mesa', text: `${p.name} correu da rodada (-1 ponto).`, at: Date.now() });
  } else {
    p.folded = false;
    if (p.points <= 1) {
      room.messages.push({ name: 'Mesa', text: `${p.name} tem 1 ponto e entra automaticamente na disputa.`, at: Date.now() });
    } else {
      room.messages.push({ name: 'Mesa', text: `${p.name} vai jogar a rodada.`, at: Date.now() });
    }
  }
  room.messages = room.messages.slice(-30);

  const playingSoFar = room.decisionOrder.slice(0, room.decisionIndex + 1).map(i => room.players[i]).filter(x => !x.folded && x.points > 0);
  const stillToDecide = room.decisionOrder.slice(room.decisionIndex + 1).map(i => room.players[i]).filter(x => x.points > 0);

  if (playingSoFar.length + stillToDecide.length <= 1) {
    for (const pl of room.players) {
      if (pl.folded && pl.hand && pl.hand.length > 0) {
        room.deck.push(...pl.hand);
        pl.hand = [];
      }
    }
    const winners = playingSoFar.length ? [playingSoFar[0].id] : (stillToDecide.length ? [stillToDecide[0].id] : []);
    finishRound(room, winners, 0, null);
    touch(room);
    return;
  }

  room.decisionIndex++;
  if (room.decisionIndex < room.decisionOrder.length) {
    room.decisionDeadline = Date.now() + 15000;
    const nextSeat = room.decisionOrder[room.decisionIndex];
    const nextPlayer = room.players[nextSeat];
    if (nextPlayer && nextPlayer.points <= 1) {
      decideRound(room, nextPlayer.id, 'play');
      return;
    }
  } else {
    let returned = 0;
    for (const pl of room.players) {
      if (pl.folded && pl.hand && pl.hand.length > 0) {
        room.deck.push(...pl.hand);
        returned += pl.hand.length;
        pl.hand = [];
      }
    }
    if (returned > 0) {
      for (let i = room.deck.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [room.deck[i], room.deck[j]] = [room.deck[j], room.deck[i]];
      }
      room.messages.push({ name: 'Mesa', text: `As cartas de quem correu voltaram ao monte e foram reembaralhadas.`, at: Date.now() });
      room.messages = room.messages.slice(-30);
    }

    const activePlaying = room.players.filter(x => !x.folded && x.points > 0);
    if (activePlaying.length <= 1) {
      finishRound(room, activePlaying.map(x => x.id), 0, null);
    } else {
      room.status = 'playing';
      room.phase = 'draw';
      room.turn = room.decisionOrder.find(s => !room.players[s].folded && room.players[s].points > 0);
      room.deadline = Date.now() + 45000;
      room.messages.push({ name: 'Mesa', text: `Partida iniciada! ${room.players[room.turn].name} começa comprando.`, at: Date.now() });
      room.messages = room.messages.slice(-30);
    }
  }
  touch(room);
}
export function tick(room, now = Date.now()) {
  if(room.status==='dealing'){
    if(now<room.deal.endsAt)return false;
    room.status='decision';
    room.decisionIndex=0;
    room.decisionDeadline=now+15000;
    touch(room);
    const firstSeat = room.decisionOrder?.[0];
    const firstPlayer = room.players[firstSeat];
    if (firstPlayer && firstPlayer.points <= 1) {
      decideRound(room, firstPlayer.id, 'play');
    }
    return true;
  }
  if(room.status==='decision'&&now>=room.decisionDeadline){
    const seat=room.decisionOrder?.[room.decisionIndex];
    const p=room.players[seat];
    if(p){decideRound(room,p.id,p.points<=1?'play':'fold');return true;}
  }
  if(['claiming','offered'].includes(room.status)&&now>=room.claimUntil){
    if(room.status==='claiming')resolveClaims(room);else{room.status='playing';room.offer=null;room.claimUntil=null;room.deadline=Date.now()+45000;touch(room);}return true;
  }
  if (room.status === 'roundEnd' && now >= room.nextRoundAt) {
    const active=room.players.filter(p=>p.points>0||p.pendingReentry);
    if(active.length<=1){
      room.status='finished';room.winner=active[0]?.id||null;
      if (room.winner && room.pot > 0) {
        const champ = room.players.find(p => p.id === room.winner);
        if (champ) {
          champ.chips = (champ.chips || 0) + room.pot;
          room.messages.push({ name: 'Mesa', text: `🏆 ${champ.name} venceu e faturou o pote de ${room.pot} fichas!`, at: Date.now() });
          room.messages = room.messages.slice(-30);
        }
      }
      touch(room);
    }else startRound(room);return true;
  }
  if (room.status !== 'playing' || now < room.deadline) return false;
  const p = room.players[room.turn]; p.strikes++;
  if (room.phase === 'discard') discardCard(room,p.hand.pop());
  if (p.strikes >= 3) p.points = 0;
  const active = room.players.filter(p => p.points > 0 && !p.folded);
  if (active.length <= 1) finishRound(room, active.map(p => p.id), 0);
  else nextTurn(room);
  room.messages.push({ name: 'Mesa', text: `${p.name}: tempo esgotado${p.points <= 0 ? ', eliminado por inatividade' : ', vez passada'}.`, at: now });
  room.messages = room.messages.slice(-30);if(room.status==='playing')offerDiscard(room,p.id);touch(room);return true;
}
export function roomView(room, uid) {
  requireThat(room.players.some(p => p.id === uid), 'Você não participa desta mesa.', 403);
  const now=Date.now(),dealing=room.status==='dealing';
  const arrived=dealing?room.deal.events.filter(e=>e.at+450<=now):[];
  const received=id=>dealing?arrived.filter(e=>e.player===id).length*3:room.players.find(p=>p.id===id).hand.length;
  const me=room.players.find(p=>p.id===uid),top=room.discard?.at(-1);
  const canClaim=!!(room.offer&&top?.id===room.offer.cardId&&room.offer.from!==uid&&!me.folded&&me.pifado&&!me.closedOnly&&me.points>0&&me.hand.length===9&&winningPickup(me.hand,top,room.wild));
  return { ...room, wild:dealing?null:room.wild, vira:dealing?null:room.vira, dealStage:dealing?arrived.length:null, canClaim, botReactions:undefined, claims:(room.claims||[]).map(c=>({player:c.player,penalty:c.penalty})), botTurnKey:undefined, botNextAt:undefined, deck: undefined, deckCount: dealing?104-arrived.length*3:room.deck?.length || 0, discard: undefined,
    discardTop: room.discard?.at(-1) || null, players: room.players.map(p => ({ ...p, pifado:p.id===uid?p.pifado:undefined, drawnCardId:p.id===uid?p.drawnCardId:undefined, hand: p.id === uid ? p.hand.slice(0,received(p.id)) : undefined, cardCount: received(p.id) })), serverTime: Date.now() };
}
