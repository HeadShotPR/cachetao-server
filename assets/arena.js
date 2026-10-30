import { canStartNextRound, canReenter, winningPickup } from './game.js';
import { recognizeManual, purchaseMeld, groupLabel } from './hand-groups.js';
import { seatPosition } from './dealing.js';
import { arrangeGroups, isWild, meldValid, solveHand } from './cards.js';
const ranks=['','A','2','3','4','5','6','7','8','9','10','J','Q','K'],suits=['♣','♦','♥','♠'];
export function arena(room,user,selected,sortMode,{escape,avatar,card,manualGroups,floatingId}) {
  const me=room.players.find(p=>p.id===user.id),playing=room.status==='playing',waiting=room.status==='waiting';
  const contest=room.status==='claiming',offered=room.status==='offered';
  const mine=playing&&room.players[room.turn]?.id===user.id,turn=room.players[room.turn];
  const ownIndex=room.players.findIndex(p=>p.id===user.id);
  const other=Array.from({length:room.players.length-1},(_,i)=>room.players[(ownIndex+i+1)%room.players.length]);
  const dealing=room.status==='dealing',dealer=room.players[room.dealer];
  const floating=me.hand.find(c=>c.id===floatingId),purchase=floating?purchaseMeld(me.hand,floating.id,room.wild):null;
  const groupedHand=me.hand.filter(c=>c.id!==floating?.id);
  const sorted=[...groupedHand].sort((a,b)=>sortMode==='rank'?a.r-b.r||a.s-b.s:a.s-b.s||a.r-b.r);
  const groups=sortMode==='manual'&&manualGroups?recognizeManual(manualGroups,groupedHand,room.wild):sortMode==='groups'?arrangeGroups(sorted,room.wild):[{cards:sorted,valid:false}];
  const n=groupedHand.length,g=groups.length,width=Math.min(72,Math.max(48,innerWidth*.14)),available=Math.min(innerWidth-32,820);
  const overlap=n>g?Math.max(26-width,Math.min(0,(available-g*width-(g-1)*10)/(n-g)-width)):0;
  const survivors=room.players.filter(p=>p.points>0||p.pendingReentry),continues=survivors.length>=2;
  const nextReady=canStartNextRound(room,Date.now()+(room.clockOffset||0));
  const reentryAvailable=canReenter(room,user.id,Date.now()+(room.clockOffset||0));
  const reentryPoints=Math.min(...room.players.filter(p=>p.points>0).map(p=>p.points));
  const onTurnDiscard=mine&&room.phase==='discard'&&me.hand.length===10;
  const canBati10OnTurn=onTurnDiscard&&!!solveHand(me.hand,room.wild);
  const canBati9OnTurn=onTurnDiscard&&(selected?!!solveHand(me.hand.filter(c=>c.id!==selected),room.wild):me.hand.some(c=>solveHand(me.hand.filter(x=>x.id!==c.id),room.wild)));

  const offTurnEligible=!mine&&!me.folded&&me.points>0&&me.hand.length===9&&room.discardTop&&(!room.lastAction||room.lastAction.type!=='knock');
  const winOffTurn=offTurnEligible?winningPickup(me.hand,room.discardTop,room.wild):null;
  const canBati10OffTurn=!!(winOffTurn&&winOffTurn.penalty===2);
  const canBati9OffTurn=!!(winOffTurn&&winOffTurn.discard);

  const canBati10Contest=contest&&me.hand.length===10&&!!solveHand(me.hand,room.wild);
  const canBati10=canBati10OnTurn||canBati10OffTurn||canBati10Contest;
  const canBati=canBati9OnTurn||canBati9OffTurn;

  const isDecision=room.status==='decision';
  const decidingSeat=isDecision&&room.decisionOrder?room.decisionOrder[room.decisionIndex]:null;
  const decider=decidingSeat!=null?room.players[decidingSeat]:null;
  const myTurnToDecide=isDecision&&decider?.id===user.id;
  const turnText=dealing?`${escape(dealer.name)} distribui · 3 cartas por vez ↺`:isDecision?(myTurnToDecide?(me.points<=1?'Sua vez: com 1 ponto você é obrigado a jogar a rodada!':'Sua vez de decidir: vai jogar a rodada ou correr (-1 ponto)?'):`${escape(decider?.name||'Jogador')} escolhe se vai jogar ou correr…`):waiting?(room.offline?'Complete os lugares e distribua as cartas':room.practice?'Treino com bots pronto':'Aguardando amigos entrarem…'):playing?(me.folded?'Você correu desta rodada (-1 ponto). Aguarde o final…':mine?(room.phase==='draw'?'Sua vez: compre uma carta':'Escolha uma carta para descartar'):`${escape(turn.name)}${turn.bot?' está pensando…':' está jogando'}`):contest?'Conferindo batidas: 10 tem prioridade':offered?'Aguardando próxima jogada':room.status==='finished'?'Partida encerrada':`Rodada concluída — ${continues?'a partida continua':'encerrando partida'}`;
  const winner=room.result?room.players.find(p=>p.id===(room.winner||room.result.winners[0])):null;
  return `<div class="arena-page"><div class="arena-top"><button class="arena-icon" data-action="back-lobby" aria-label="Voltar às salas">‹</button><div><strong>${escape(room.name)}</strong><small>${room.offline?'TREINO OFFLINE':room.practice?'TREINO COM BOTS':'SALA ONLINE'} · ${room.points} PONTOS${room.pot?` · POTE: ${room.pot} FICHAS`:''}</small></div><button class="arena-icon" data-action="settings" aria-label="Configurações">⚙</button></div>
  <div class="arena-status" role="status">${turnText}${dealing||playing||contest||offered||isDecision||room.status==='roundEnd'?' <span class="timer" id="timer"></span>':''}</div>
  <div class="arena-table ${waiting?'waiting':''} players-${room.players.length}"><div class="arena-inlay"></div><div class="arena-watermark">CM<small>CACHETÃO</small>${room.pot?`<span style="display:block;font:bold 11px Arial;color:#fcd34d;margin-top:5px;letter-spacing:1px;text-shadow:0 1px 4px #000;">POTE: ${room.pot} FICHAS</span>`:''}</div>
    ${other.map((p,i)=>`<div class="arena-seat seat-${i} ${(playing&&turn.id===p.id)||(isDecision&&decider?.id===p.id)?'active':''} ${p.points<=0?'out':''} ${p.folded?'folded':''}" data-player="${p.id}" style="left:${seatPosition(i+1,room.players.length).left}%;top:${seatPosition(i+1,room.players.length).top}%"><span class="seat-name">${escape(p.name)}</span>${avatar(p)}${dealer?.id===p.id?'<span class="dealer-badge">DISTRIBUIDOR</span>':''}<span class="seat-points">${p.points} <small>pts</small></span>${p.folded?'<span class="folded-badge" style="position:absolute;top:42px;font:bold 7px Arial;background:#8b2525;color:#fff;border-radius:4px;padding:2px 3px;">CORREU</span>':p.bot?'<span class="bot-label">BOT</span>':''}<span class="seat-cards">${p.cardCount?'▱ '+p.cardCount:''}</span></div>`).join('')}
    ${waiting?`<div class="arena-wait"><span class="eyebrow">${room.code?`SALA ${room.code}`:'MESA ONLINE'}</span><h2>A mesa é sua.</h2><p>${room.players.length}/${room.capacity} amigos na mesa${room.practice?` · ${room.players.filter(p=>p.bot).length} bots`:''}</p>${room.offline?'':'<button class="gold" data-action="copy-code">Copiar convite</button>'}${room.owner===user.id?`${room.practice?`<button data-action="fill-bots" ${room.players.length===room.capacity?'disabled':''}>Completar com bots</button>`:''}<button class="start-green" data-action="start" ${room.players.length<2?'disabled':''}>Distribuir cartas</button>`:''}</div>`:` ${!dealing&&room.wild?`<div class="arena-wild"><div style="display:flex;gap:3px">${(room.wild.suits||[room.wild.s]).map(s=>card({r:room.wild.r,s},{disabled:true,wild:room.wild})).join('')}</div><span>Coringas${room.vira?` (Vira: ${ranks[room.vira.r]}${suits[room.vira.s]})`:''}</span></div>`:''}<div class="arena-piles"><div class="pile"><button class="playing-card back" data-action="draw" data-source="deck" aria-label="Comprar do monte" ${!mine||room.phase!=='draw'||me.folded?'disabled':''}></button><small>MONTE · ${room.deckCount}</small></div><div class="pile">${room.discardTop?card(room.discardTop,{action:'draw-discard',disabled:!mine||room.phase!=='draw'||me.folded}):'<div class="empty-pile"></div>'}<small>DESCARTE</small></div></div><div class="arena-table-label">Cachetão <small>#${room.code} · Rodada ${room.round} · ↺ anti-horário</small></div>`}
    <div class="arena-self ${(mine&&playing)||(myTurnToDecide)?'active':''} ${me.folded?'folded':''}" data-player="${user.id}"><span class="seat-name">${escape(me.name)}</span>${avatar(me)}${dealer?.id===me.id?'<span class="dealer-badge">DISTRIBUIDOR</span>':''}<span class="seat-points">${me.points} <small>pts</small></span>${me.folded?'<span class="folded-badge" style="position:absolute;top:44px;font:bold 8px Arial;background:#8b2525;color:#fff;border-radius:4px;padding:2px 4px;">VOCÊ CORREU</span>':''}</div>
    ${room.result&&['finished','roundEnd'].includes(room.status)?`<div class="arena-result"><div class="win-rays">✦</div><span class="eyebrow">${room.status==='finished'?'FIM DA PARTIDA':'BATIDA CONFIRMADA'}</span><h2>${room.result.tie?'Empate — ninguém perde pontos':escape(winner?.name||'Rodada encerrada')}</h2><p>${room.result.penalty?`Adversários que continuaram perdem ${room.result.penalty} ponto${room.result.penalty>1?'s':''}${room.result.penalty===2?' (batida de 10)':''}.`:room.status==='finished'?'Partida encerrada.':'Ninguém perde pontos.'}</p>${room.result.melds?`<div class="winning-groups">${room.result.melds.map(gr=>`<span>${gr.map(c=>`<b class="${c.s===1||c.s===2?'red':''}">${c.joker?'★':ranks[c.r]+suits[c.s]}</b>`).join('')}</span>`).join('')}</div>`:''}${room.status==='roundEnd'?`<p class="round-continuation">${continues?'A partida continua.':'Último jogador com pontos. Reentrada bloqueada.'}<br>${survivors.map(p=>`${escape(p.name)}: ${p.points} ponto${(p.points)===1?'':'s'}`).join(' · ')}</p><button class="start-green" data-action="next" ${!nextReady||me.points<=0?'disabled':''}>${continues?'Próxima rodada':'Encerrando partida'}</button>`:'<button class="start-green" data-action="back-lobby">Voltar às salas</button>'}</div>`:''}
  </div>
  <div class="arena-controls">${waiting?'<button class="ghost small" data-action="leave">Sair da sala</button>':isDecision?(myTurnToDecide?(me.points<=1?`<button class="start-green decision-button" data-action="decide-play">Jogar a rodada</button><span style="font-size:11px;color:#facc15;padding:6px 10px;background:#854d0e33;border-radius:6px;border:1px solid #ca8a04;">Com 1 ponto você é obrigado a jogar</span>`:`<button class="start-green decision-button" data-action="decide-play">Jogar rodada</button><button class="ghost decision-button fold-btn" data-action="decide-fold" style="border-color:#d9534f;color:#ff9999;">Correr (-1 pt)</button>`):`<div style="font-size:11px;color:#cbd5e1;padding:8px 12px;background:#1e293b88;border-radius:6px;border:1px solid #475569;">Aguardando ${escape(decider?.name||'adversário')}…</div>`):`<button class="arena-sort" data-action="sort" aria-label="Organizar cartas">⇄ <span>${sortMode==='manual'?'Manual':sortMode==='groups'?'Jogos':sortMode==='suit'?'Naipes':'Valores'}</span></button><button class="discard-button" data-action="discard" ${!mine||room.phase!=='discard'||!selected||me.folded?'disabled':''}>Descartar</button><button class="start-green knock-button bati-btn" data-action="bati" ${canBati?'':'disabled'}>BATI</button><button class="start-gold knock-button bati-10-btn" data-action="bati-10" ${canBati10?'':'disabled'}>BATI DE 10</button>`}${room.offline?'':'<button class="arena-icon chat-button" data-action="chat" aria-label="Chat da sala">•••</button>'}</div>
  ${!waiting?'<button class="discard-history-button" data-action="view-discards">Ver descartes</button>':''}
  ${me.pendingReentry?`<div class="reentry-panel">Reentrada confirmada · ${me.points} pontos · cartas na próxima rodada</div>`:me.points===0&&room.status!=='finished'?`<div class="reentry-panel">${reentryAvailable?`<strong>Você zerou. Decida agora, antes da próxima rodada.</strong><button data-action="reenter">Reentrar com ${reentryPoints} pontos · 10 fichas fictícias</button><button data-action="declineReentry">Sair da disputa</button>`:'Eliminado · reentrada indisponível.'}<small>Saldo: ${me.chips??90} fichas · sem valor em dinheiro</small></div>`:''}
  ${room.status==='roundEnd'?'<p class="reentry-note">Aguarde até 12s na mesa. Com dois jogadores com pontos, a próxima rodada começa automaticamente.</p>':''}
  ${!waiting&&!dealing&&me.points>0?'<div class="hand-tools"><span>Arraste para organizar</span><button data-action="new-hand-group">＋ Novo grupo</button></div>':''}
  ${floating?`<div class="drawn-card-zone" aria-label="Carta comprada">${card(floating,{action:'select-card',selected:floating.id===selected,wild:room.wild})}<div><strong>Carta comprada</strong><small>${purchase?'Completa '+groupLabel(purchase,room.wild).toLowerCase():'Arraste para um grupo ou selecione para descartar'}</small><button data-action="keep-drawn">Juntar aos jogos</button></div></div>`:''}
  ${!waiting?`<div class="arena-hand" aria-label="Suas cartas" style="--card-width:${width}px;--overlap:${overlap}px">${groups.map((group,index)=>{const label=groupLabel(group,room.wild);return `<div data-group="${index}" class="hand-group ${group.valid?'valid':''}"><div class="group-cards">${group.cards.map(c=>card(c,{action:'select-card',selected:c.id===selected,wild:room.wild,disabled:(!playing&&!contest&&!isDecision)||me.points<=0||me.folded})).join('')}</div><span class="group-label">${label}</span></div>`;}).join('')}</div>`:''}
  <div class="arena-footer"><span>${room.offline?(me.closedOnly?'Batida somente pelo monte fechado':'Offline · salvo neste aparelho'):room.practice?'Bots identificados · sem apostas':`Sala online com amigos · Convite #${room.code}`}</span>${playing||room.status==='roundEnd'?'<button data-action="resign">Desistir</button>':''}</div></div>`;
}
export function animateAction(previous,room,userId) {
  const action=room.lastAction;
  if(previous?.id!==room.id||!action||action.at===previous?.lastAction?.at||room.round!==previous?.round||matchMedia('(prefers-reduced-motion: reduce)').matches)return;
  if(!['draw','discard'].includes(action.type))return;
  const seat=document.querySelector(`[data-player="${action.player}"] .avatar`);
  const pile=document.querySelector(action.source==='discard'||action.type==='discard'?'.arena-piles .pile:last-child':'.arena-piles .pile:first-child');
  const target=action.player===userId?document.querySelector('.arena-hand'):seat;
  if(!pile||!target)return;
  const start=(action.type==='draw'?pile:target).getBoundingClientRect(),end=(action.type==='draw'?target:pile).getBoundingClientRect();
  const el=document.createElement('div');el.className='flying-card playing-card '+(action.type==='draw'?'back':'');
  if(action.card)el.textContent=action.card.joker?'★':ranks[action.card.r]+suits[action.card.s];
  document.body.appendChild(el);
  el.style.left=start.x+start.width/2-25+'px';el.style.top=start.y+start.height/2-35+'px';
  const animation=el.animate([{transform:'translate(0,0) rotate(-8deg)',opacity:1},{transform:`translate(${end.x+end.width/2-start.x-start.width/2}px,${end.y+end.height/2-start.y-start.height/2}px) rotate(4deg)`,opacity:.2}],{duration:480,easing:'cubic-bezier(.2,.7,.2,1)'});
  animation.onfinish=()=>el.remove();
}
