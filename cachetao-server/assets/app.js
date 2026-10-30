import { isWild, solveHand } from './cards.js';
import { recognizeManual, integratePurchase } from './hand-groups.js';
import { animateDealing, stopDealing } from './dealing.js';
import { syncGroups, moveCard, installHandDrag } from './hand-layout.js';
import { OfflineGame } from './offline.js';
import { arena, animateAction } from './arena.js';
const $ = (s) => document.querySelector(s);
const escape = (v) => String(v ?? '').replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const android = location.hostname === 'appassets.androidplatform.net';
let base = localStorage.getItem('aurora.server') || (android ? '' : location.origin);
let savedMode = localStorage.getItem('cm.mode');
let offline = savedMode ? savedMode === 'offline' : (android && !base);
const localGame = new OfflineGame(localStorage);
localGame.pause();
let token = offline ? 'offline' : localStorage.getItem('aurora.token') || '';
let renderedRoom = null;
let user = null, lobby = null, room = null, page = 'lobby', selected = null, sortMode = 'groups', authMode = 'login', connected = true, pending = false, lastView = '', previousHand = new Set(), pollBusy = false, roomWanted = null;
let muted = localStorage.getItem('aurora.muted') === '1';
const ranks = ['','A','2','3','4','5','6','7','8','9','10','J','Q','K'];
const suits = ['♣','♦','♥','♠'];
const brand = `<div class="brand"><img src="/assets/mark.svg" alt=""><div><strong>CACHETÃO CM</strong><small>CACHETÃO & COMPANHIA</small></div></div>`;
const avatar = (p) => `<span class="avatar a${Number(p.avatar)||0}">${escape(p.name?.slice(0,1).toUpperCase() || '?')}</span>`;
function toast(text) { $('#toast').textContent = text; $('#toast').classList.add('show'); clearTimeout(toast.timer); toast.timer = setTimeout(() => $('#toast').classList.remove('show'),4000); }
function sound(type='card') {
  if (muted) return;
  try { const ctx = sound.ctx ||= new (window.AudioContext || window.webkitAudioContext)(); ctx.resume(); const o=ctx.createOscillator(),g=ctx.createGain(); o.type='sine'; o.frequency.setValueAtTime(type==='win'?660:340,ctx.currentTime); o.frequency.exponentialRampToValueAtTime(type==='win'?990:140,ctx.currentTime+.12); g.gain.setValueAtTime(.045,ctx.currentTime);g.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.18);o.connect(g);g.connect(ctx.destination);o.start();o.stop(ctx.currentTime+.2); } catch {}
}
async function api(path,body) {
  if(offline)return localGame.request(path,body);
  if (!base) throw new Error('Informe o endereço do servidor em Configurar conexão.');
  let response;
  try { response = await fetch(base + '/api' + path,{method:body === undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(token?{Authorization:'Bearer '+token}:{})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(9000)}); }
  catch { connected=false; throw new Error('Sem conexão com o servidor. Confira o endereço e sua rede.'); }
  const result=await response.json();
  if (!response.ok) { if(response.status===401 && !['/login','/register'].includes(path)){ token='';localStorage.removeItem('aurora.token');user=null;room=null;roomWanted=null;renderAuth(); } throw new Error(result.error || 'Não foi possível concluir.'); }
  connected=true;return result;
}
function header() { return `<header>${brand}<div class="header-right"><span class="connection">${offline?'SEM INTERNET':connected?'CONECTADO':'RECONECTANDO'}</span>${user?`<div class="profile">${avatar(user)}<div><strong>${escape(user.name)}</strong><small>${user.wins} vitórias</small></div></div><button class="ghost small" data-action="settings" aria-label="Configurações">⚙</button>`:''}</div></header>`; }
function navigation(){return `<nav aria-label="Navegação principal">${[['lobby','♧','Salas'],['rules','☷','Como jogar']].map(([id,icon,text])=>`<button data-page="${id}" class="${page===id?'active':''}"><span class="ico">${icon}</span>${text}</button>`).join('')}<div class="nav-note">CACHETA CM<br>Salas e treino com bots<br>Versão 0.8.6</div></nav>`;}
function empty(title,text,action='',label='') { return `<div class="empty"><span class="empty-symbol">♧</span><h3>${title}</h3><p>${text}</p>${action?`<button class="small" data-action="${action}">${label}</button>`:''}</div>`; }
function renderAuth() {
  stopDealing();
  $('#app').innerHTML = `<div class="auth-screen"><section class="auth-art">${brand}<div><div class="eyebrow">A SUA PRÓXIMA BOA PARTIDA</div><h1>Na mesa,<br>todos se encontram.</h1><p>O prazer da cacheta. A companhia dos amigos. Um novo lugar para jogar.</p></div><span class="connection">SALAS ONLINE · TREINO COM BOTS</span></section><section class="auth-pane"><div class="auth-form">${brand}<div class="eyebrow">BEM-VINDO À MESA</div><h2>${authMode==='login'?'Bom ter você aqui.':'O próximo jogo é seu.'}</h2><p>Entre, encontre sua turma e distribua as cartas.</p><div class="tabs"><button class="${authMode==='login'?'active':''}" data-auth="login">Entrar</button><button class="${authMode==='register'?'active':''}" data-auth="register">Criar conta</button></div><form id="auth"><label>Seu nome de jogador<input name="name" autocomplete="username" minlength="3" maxlength="24" required placeholder="Como vamos chamar você?"></label><label>Senha<input name="password" type="password" minlength="8" maxlength="128" autocomplete="${authMode==='login'?'current-password':'new-password'}" required placeholder="Pelo menos 8 caracteres"></label><p id="auth-error" class="error" role="alert"></p><button class="gold" type="submit">${authMode==='login'?'Entrar na Cacheta CM':'Criar minha conta'} <span aria-hidden="true">→</span></button><details ${!base?'open':''}><summary>Configurar conexão</summary><label>Endereço do servidor Render<input name="server" type="url" value="${escape(base)}" placeholder="https://seu-app.onrender.com"></label><p>Para jogar com amigos, todos precisam usar o mesmo servidor no Render (HTTPS).</p></details></form><button class="gold wide" data-action="guest-practice" style="margin-top:18px">Jogar sem internet →</button><p class="auth-note">O treino com bots funciona sem internet, sem conta e sem configurar servidor. Sua partida fica salva neste aparelho. Jogo gratuito, sem apostas. Esta versão de teste salva sua conta no servidor escolhido. Guarde sua senha: a recuperação por e-mail ainda não está disponível.</p></div></section></div>`;
}
function roomTile(r){return `<article class="tile"><span class="tile-icon">♧</span><span class="badge">${r.practice?'COM BOTS':'ONLINE'}</span><h3>${escape(r.name)}</h3><p>${r.bots? r.bots+' bots identificados nesta sala.':'Entre e convide seus amigos.'}</p><div class="meta"><span>${r.count}/${r.capacity} lugares</span><span>${r.points} pontos</span>${r.buyIn?`<span>Entrada: ${r.buyIn} fichas</span>`:''}</div><button class="gold" data-action="join-room" data-code="${escape(r.code)}" ${r.count>=r.capacity?'disabled':''}>${r.count>=r.capacity?'Sala cheia':'Entrar na sala →'}</button></article>`;}
function offlineLobbyPage(){return `<section class="hero rooms-hero"><div class="eyebrow">CACHETA CM · MODO OFFLINE</div><h1>Sua mesa.<br>Em qualquer lugar.</h1><p>Jogue com bots sem internet, sem conta e sem configurar nada. Um novo treino substitui o anterior.</p><div class="actions"><button class="gold" data-action="practice">Jogar com bots →</button><button data-action="create-room">Personalizar treino</button></div><span class="hero-tag">SALAS DE 2 A 10 LUGARES · SALVO NESTE APARELHO</span></section>${lobby.myRooms.length?`<div class="section-head"><h2>Seu treino salvo</h2></div><div class="list-item"><div class="grow"><h3>${escape(lobby.myRooms[0].name)}</h3><p>Continue de onde parou.</p></div><button class="gold" data-action="open-room" data-id="${escape(lobby.myRooms[0].id)}">Continuar treino</button></div>`:''}<section class="info-panel" style="margin-top:24px"><h2>Jogar com amigos</h2><p>As salas entre pessoas precisam de um servidor online. O treino com bots funciona inteiramente neste aparelho.</p><button data-action="online-mode">Configurar jogo online</button></section>`;}
function lobbyPage(){if(offline)return offlineLobbyPage();return `<section class="hero rooms-hero"><div class="eyebrow">CACHETA CM · ESCOLHA SUA SALA</div><h1>A próxima mão<br>já pode começar.</h1><p>Experimente contra bots ou crie uma sala para jogar com amigos (2 a 10 pessoas).</p><div class="actions"><button class="gold" data-action="guest-practice">Jogar sem internet →</button><button data-action="create-room">＋ Criar sala</button></div><span class="hero-tag">2 A 10 LUGARES · SALAS PAGAS E TREINO</span></section>${lobby.myRooms.length?`<div class="section-head"><h2>Suas salas</h2></div><div class="list">${lobby.myRooms.map(r=>`<div class="list-item"><span>♧</span><div class="grow"><h3>${escape(r.name)}</h3><p>${r.practice?'Treino com bots':'Sala online'} · ${r.status==='waiting'?'Aguardando início':'Em andamento'}</p></div><button class="small gold" data-action="open-room" data-id="${r.id}">Voltar à sala</button></div>`).join('')}</div>`:''}<div class="section-head row"><div><h2>Salas abertas</h2><p>Salas com bots são identificadas antes de entrar.</p></div><button class="small" data-action="join-code">Tenho um código</button></div>${lobby.rooms.length?`<div class="cards-grid">${lobby.rooms.map(roomTile).join('')}</div>`:empty('Monte sua sala.','Você pode completar os lugares com bots e jogar agora.','create-room','Criar sala')}<div class="footer-note">SALAS DE 2 A 10 LUGARES · SALAS PAGAS COM FICHAS E TREINO COM BOTS</div>`;}
function rulesPage(){return `<div class="page-title"><h1>Como jogar Cachetão</h1><p>Regras oficiais do Cachetão CM · Versão 0.8.6</p></div><div class="two-columns"><section class="info-panel"><h2>104 cartas e 4 coringas</h2><p>Dois baralhos de 52 cartas, sem jokers impressos: 104 cartas. Cada participante recebe 9 cartas. A vira define os coringas da rodada: são as cartas de valor imediatamente seguinte nos dois naipes da mesma cor da vira (ex: vira 5♦ de ouros gera 6♦ e 6♥ como coringas; vira K♠ de espadas gera A♠ e A♣). Com dois baralhos, há sempre 4 coringas em disputa.</p></section><section class="info-panel"><h2>Decisão: Jogar ou Correr</h2><p>Com as 9 cartas em mãos, os jogadores escolhem por ordem na mesa se vão disputar a rodada ou correr:</p><p>• <strong>Correr:</strong> O jogador larga a mão e perde apenas <strong>1 ponto</strong>, evitando o risco de perder 2 pontos para uma batida de 10.</p><p>• <strong>Cartas de volta ao monte:</strong> As cartas de quem corre voltam ao monte e são reembaralhadas na hora.</p><p>• <strong>Regra do 1 Ponto:</strong> Quem estiver com apenas 1 ponto restante é <strong>obrigado a jogar a rodada</strong>, sem opção de correr.</p></section><section class="info-panel"><h2>Batida: "BATI" e "BATI DE 10"</h2><p>Não há mais botão de 'Armado'. Você tem diretamente os botões <strong>BATI</strong> (9 cartas) e <strong>BATI DE 10</strong> (10 cartas):</p><p>• <strong>Na sua vez:</strong> Compre e clique em BATI (selecionando um descarte) ou BATI DE 10 (usando todas as 10 cartas).</p><p>• <strong>Fora da sua vez (Pegar e Bater):</strong> Se qualquer adversário descartar a carta que você precisa para bater, mesmo fora da sua vez você pode tocar em <strong>BATI</strong> ou <strong>BATI DE 10</strong>. A carta vem direto para sua mão e a batida é confirmada automaticamente (a não ser que o jogador da vez tenha batido na mesma jogada).</p><p>• <strong>Penalidade:</strong> Batida simples de 9 custa 1 ponto aos perdedores. Batida de 10 custa <strong>2 pontos</strong>.</p></section><section class="info-panel"><h2>Salas pagas e 2 a 10 Jogadores</h2><p>As salas suportam de <strong>2 a 10 participantes</strong> (pessoas reais ou bots de treino).</p><p>Nas salas pagas, cada jogador paga uma taxa de entrada (buy-in) em fichas do jogo. As fichas formam o <strong>Pote da Mesa</strong>, entregue integralmente ao grande campeão que eliminar os adversários.</p><p>Todos começam com 10 pontos. Quem zera é eliminado.</p></section></div>`;}
function renderLobby(){stopDealing();if(!lobby||!user)return;$('#app').innerHTML=header()+`<div class="layout">${navigation()}<main>${page==='rules'?rulesPage():lobbyPage()}</main></div>`;}
function card(c,{action='',selected:falseSelected=false,wild=null,disabled=false}={}) { if(!c)return '<div class="playing-card back" aria-label="Carta virada"></div>';if(c.joker)return `<button class="playing-card joker-card ${falseSelected?'selected':''}" ${action?`data-action="${action}" data-id="${c.id}"`:''} ${disabled?'disabled':''} aria-label="Coringa impresso${falseSelected?', selecionada':''}" aria-pressed="${falseSelected}"><span>★</span><span class="big-suit">★</span><span class="wild-label">CORINGA</span></button>`;return `<button class="playing-card ${c.s===1||c.s===2?'red':''} ${falseSelected?'selected':''}" ${action?`data-action="${action}" data-id="${c.id}"`:''} ${disabled?'disabled':''} aria-label="${ranks[c.r]} de ${['paus','ouros','copas','espadas'][c.s]}${falseSelected?', selecionada':''}" aria-pressed="${falseSelected}"><span>${ranks[c.r]}<br><span class="corner">${suits[c.s]}</span></span><span class="big-suit">${suits[c.s]}</span><span class="bottom">${ranks[c.r]} ${suits[c.s]}</span>${isWild(c,wild)?'<span class="wild-label">CORINGA</span>':''}</button>`; }
let layoutKey='',manualGroups=null,integratedDraw=null;
const drawToken=()=>{const p=room?.players.find(p=>p.id===user?.id);return p?.drawnCardId?`${handKey()}:${p.drawOrder}`:null;};
function floatingCard(){const p=room?.players.find(p=>p.id===user?.id);return room?.status==='playing'&&room.players[room.turn]?.id===user?.id&&room.phase==='discard'&&drawToken()!==integratedDraw?p?.drawnCardId:null;}
const handKey=()=>room&&user?`${room.id}:${room.round}:${user.id}`:'';
function handContext(){
  if(!room||!user)return null;
  const groups=[...document.querySelectorAll('.arena-hand .group-cards')].map(g=>[...g.querySelectorAll('[data-id]')].map(c=>c.dataset.id));const fresh=document.querySelector('.drawn-card-zone [data-id]');if(fresh)groups.push([fresh.dataset.id]);return {key:handKey(),groups};
}
function saveLayout(){try{localStorage.setItem('cm.hand.layout',JSON.stringify({key:layoutKey,groups:manualGroups,integratedDraw}));}catch{}}
function commitHand(groups,id,index,before){
  const hand=room?.players.find(p=>p.id===user?.id)?.hand;
  if(!hand?.some(c=>c.id===id))return renderRoom();
  manualGroups=recognizeManual(moveCard(groups,id,index,before),hand,room.wild).map(g=>g.cards.map(c=>c.id));if(id===floatingCard())integratedDraw=drawToken();sortMode='manual';selected=id;saveLayout();renderRoom();
}
const handDrag=installHandDrag({getContext:handContext,commit:commitHand,redraw:()=>renderRoom()});
function renderRoom(){
  if(handDrag.busy()||!room||!user)return;const me=room.players.find(p=>p.id===user.id);if(!me)return;
  if(!me.hand.some(c=>c.id===selected))selected=null;
  if(layoutKey!==handKey()){layoutKey=handKey();manualGroups=null;integratedDraw=null;sortMode='groups';try{const saved=JSON.parse(localStorage.getItem('cm.hand.layout'));if(saved?.key===layoutKey){integratedDraw=saved.integratedDraw||null;if(Array.isArray(saved.groups)){manualGroups=saved.groups;sortMode='manual';}}}catch{}}
  if(manualGroups){manualGroups=syncGroups(manualGroups,me.hand);saveLayout();}
  const previous=renderedRoom;$('#app').innerHTML=arena(room,user,selected,sortMode,{escape,avatar,card,manualGroups,floatingId:floatingCard()});
  for(const el of document.querySelectorAll('.arena-hand [data-id]'))if(!previousHand.has(el.dataset.id))el.classList.add('dealt');
  previousHand=new Set(me.hand.map(c=>c.id));animateAction(previous,room,user.id);if(!pending&&previous?.lastAction?.at!==room.lastAction?.at&&room.lastAction)sound(room.lastAction.type==='knock'?'win':'card');renderedRoom=room;updateTimer();animateDealing(room);if($("#modal").open&&$("#modal").dataset.discards===room.id)$("#discard-history-content").innerHTML=discardHistoryContent();
}
function updateTimer(){const el=$('#timer');if(el&&room){const seconds=Math.max(0,Math.ceil(((room.status==='dealing'?room.deal.endsAt:room.status==='decision'?room.decisionDeadline:room.status==='roundEnd'?room.nextRoundAt:room.claimUntil||room.deadline)-Date.now()-(room.clockOffset||0))/1000));el.textContent=seconds+'s';}}
function showModal(title,content,form=''){const m=$('#modal');delete m.dataset.discards;m.innerHTML=`<div class="row"><h2>${title}</h2><button class="ghost small" data-action="close" aria-label="Fechar">✕</button></div>${content}${form}`;if(!m.open)m.showModal();}
function discardHistoryContent(){const history=room.discardHistory||[];return `<p>Rodada ${room.round} · mais recentes primeiro. Inclui cartas já recolhidas; uma carta pode aparecer mais de uma vez se foi descartada novamente. O turno continua contando.</p>${history.length?`<div class="discard-history-grid">${history.map((c,i)=>({c,n:i+1})).reverse().map(({c,n})=>`<div><small>${n}º descarte</small>${card(c,{disabled:true})}</div>`).join('')}</div>`:'<p>Nenhuma carta descartada nesta rodada.</p>'}`;}
function showDiscardHistory(){showModal('Cartas descartadas',`<div id="discard-history-content">${discardHistoryContent()}</div>`);$('#modal').dataset.discards=room.id;}
const buttons=(label)=>`<p class="error" id="modal-error" role="alert"></p><div class="actions"><button type="button" class="ghost" data-action="close">Cancelar</button><button class="gold" type="submit">${label}</button></div>`;
function createRoomModal(){showModal(offline?'Personalizar treino':'Criar sala',offline?'<p>Escolha seus adversários e lugares (2 a 10). Ao criar, o treino salvo será substituído.</p>':'<p>Jogue com amigos, pessoas reais ou complete com bots de treino.</p>',`<form id="create-room"><label>Nome da sala<input name="name" maxlength="48" minlength="2" value="Sala de ${escape(user.name)}" required></label><div class="two-columns"><label>Lugares (2 a 10)<select name="capacity">${[2,3,4,5,6,7,8,9,10].map(n=>`<option ${n===4?'selected':''}>${n}</option>`).join('')}</select></label><label>Pontos<select name="points"><option selected>10</option><option>7</option><option>5</option></select></label></div><div class="two-columns"><label>Entrada (Pote)<select name="buyIn"><option value="10" selected>10 fichas</option><option value="20">20 fichas</option><option value="50">50 fichas</option><option value="100">100 fichas</option><option value="0">Grátis (0)</option></select></label><label>Bots de treino<select name="bots">${offline?'':'<option value="0">Sem bots (Pessoas reais)</option>'}${[1,2,3,4,5,6,7,8,9].map(n=>`<option value="${n}" ${offline&&n===3?'selected':''}>${n} bot${n>1?'s':''}</option>`).join('')}</select></label></div>${offline?'':'<label class="check"><input type="checkbox" name="private"> Sala privada, apenas por código</label>'}${buttons('Criar sala')}</form>`);}
async function refreshLobby(render=true){const data=await api('/lobby');lobby=data;user=data.user;if(render&&!room)renderLobby();}
async function openRoom(id){roomWanted=id;const data=await api('/rooms/'+id);if(roomWanted!==id)return;room=data;room.clockOffset=data.serverTime-Date.now();selected=null;lastView='';previousHand=new Set();renderRoom();}
async function roomAction(action,body={}){if(!room)return;const data=await api('/rooms/'+room.id+'/'+action,body);if(action==='leave'){room=null;roomWanted=null;await refreshLobby();}else{room=data;room.clockOffset=data.serverTime-Date.now();renderRoom();if(data.lastAction?.type==='badKnock')toast('Batida inválida. Agora você só pode bater comprando do monte fechado.');sound(data.status==='roundEnd'||data.status==='finished'?'win':'card');}}
document.addEventListener('click',async e=>{
  const b=e.target.closest('button');if(!b||b.disabled)return;
  if(b.dataset.auth){authMode=b.dataset.auth;renderAuth();return;}
  if(b.dataset.page){page=b.dataset.page;room=null;roomWanted=null;renderLobby();return;}
  const action=b.dataset.action;if(!action)return;
  if(action==='close'){$('#modal').close();return;}
  if(action==='select-card'){selected=selected===b.dataset.id?null:b.dataset.id;renderRoom();sound();return;}
  if(action==='new-hand-group'){if(!selected){toast('Arraste uma carta para Novo grupo ou selecione uma carta primeiro.');return;}const context=handContext();if(context)commitHand(context.groups,selected,context.groups.length,null);return;}
  if(action==='keep-drawn'){const id=floatingCard(),context=handContext();if(id&&context){const hand=room.players.find(p=>p.id===user.id).hand;manualGroups=integratePurchase(context.groups,hand,id,room.wild);integratedDraw=drawToken();sortMode='manual';saveLayout();renderRoom();}return;}
  if(action==='sort'){integratedDraw=drawToken();manualGroups=null;saveLayout();sortMode=sortMode==='groups'?'suit':sortMode==='suit'?'rank':'groups';renderRoom();return;}
  if(pending)return;
  try{
    pending=true;
    if(action==='online-mode'){localGame.pause();offline=false;localStorage.setItem('cm.mode','online');token=localStorage.getItem('aurora.token')||'';user=null;room=null;roomWanted=null;renderAuth();}
    else if(action==='create-room')createRoomModal();
    else if(action==='practice'||action==='guest-practice'){
      if(action==='guest-practice'){offline=true;localStorage.setItem('cm.mode','offline');token='offline';user=localGame.user;localGame.resume();}
      const r=await api('/practice',{});await openRoom(r.id);
    }
    else if(action==='fill-bots')await roomAction('bots',{count:room.capacity-room.players.filter(p=>!p.bot).length});
    else if(action==='join-code')showModal('Convite para a sala','<p>Digite o código que você recebeu.</p>',`<form id="${action}"><label>Código do convite<input name="code" minlength="8" maxlength="8" required autocapitalize="characters" placeholder="A1B2C3D4"></label>${buttons('Entrar')}</form>`);
    else if(action==='join-room'){const r=await api('/join',{code:b.dataset.code});await openRoom(r.id);}
    else if(action==='open-room'){if(offline)localGame.resume();await openRoom(b.dataset.id);}
    else if(action==='back-lobby'){if(offline)localGame.pause();room=null;roomWanted=null;await refreshLobby();}
    else if(action==='copy-code'){try{await navigator.clipboard.writeText(room.code);toast('Código copiado: '+room.code);}catch{toast('Código da mesa: '+room.code);}}
    else if(action==='view-discards')showDiscardHistory();
    else if(action==='claim')await roomAction('claim',{card:room.discardTop?.id});
    else if(action==='decide-play')await roomAction('decide',{choice:'play'});
    else if(action==='decide-fold')await roomAction('decide',{choice:'fold'});
    else if(action==='bati'||action==='bati-10'){
      const is10=action==='bati-10',me=room.players.find(p=>p.id===user.id);
      const mine=room.status==='playing'&&room.players[room.turn]?.id===user.id;
      if(mine&&room.phase==='discard'){
        if(is10){await roomAction('move',{type:'knock',card:null,version:room.version});}
        else{
          let cardToDiscard=selected;
          if(!cardToDiscard&&me){const found=me.hand.find(c=>solveHand(me.hand.filter(x=>x.id!==c.id),room.wild));if(found)cardToDiscard=found.id;}
          await roomAction('move',{type:'knock',card:cardToDiscard,version:room.version});
        }
        selected=null;renderRoom();
      }else if(room.discardTop){
        await roomAction('claim-knock',{cardId:room.discardTop.id,mode:is10?'10':'9'});
      }
    }
    else if(['start','next','leave','pifado','reenter','declineReentry'].includes(action))await roomAction(action);
    else if(action==='draw'||action==='draw-discard')await roomAction('move',{type:'draw',source:action==='draw-discard'?'discard':'deck',version:room.version});
    else if(action==='discard'||action==='knock'){await roomAction('move',{type:action,card:selected,version:room.version});selected=null;renderRoom();}
    else if(action==='resign')showModal('Desistir da partida?','<p>Você será eliminado desta partida.</p>',`<form id="resign">${buttons('Confirmar desistência')}</form>`);
    else if(action==='chat')showModal('Conversa da mesa',`<div class="chat-list">${room.messages.length?room.messages.map(m=>`<div class="chat-msg"><strong>${escape(m.name)}:</strong> ${escape(m.text)}</div>`).join(''):'<p>Deseje uma boa partida à turma.</p>'}</div>`,`<form id="chat"><label>Mensagem<input name="text" maxlength="160" required placeholder="Boa partida!"></label>${buttons('Enviar')}</form>`);
    else if(action==='settings')showModal('Do seu jeito',`<p>Cacheta CM · versão de teste 0.8.6</p><p>${offline?'Modo offline · partida salva neste aparelho':'Servidor: '+escape(base)}</p><div class="list"><button data-action="toggle-sound">${muted?'Ativar':'Desativar'} sons das cartas</button><button data-action="logout">${offline?'Voltar ao início':'Sair da conta'}</button></div>`);
    else if(action==='toggle-sound'){muted=!muted;localStorage.setItem('aurora.muted',muted?'1':'0');$('#modal').close();toast(muted?'Som desligado.':'Som ligado.');}
    else if(action==='logout'&&offline){localGame.pause();room=null;roomWanted=null;$('#modal').close();await refreshLobby();}
    else if(action==='logout'){await api('/logout',{});token='';user=null;room=null;roomWanted=null;localStorage.removeItem('aurora.token');$('#modal').close();renderAuth();}
  }catch(err){toast(err.message);if(room){try{await openRoom(room.id);}catch{}}}finally{pending=false;}
});
document.addEventListener('submit',async e=>{
  e.preventDefault();if(pending)return;pending=true;
  const f=e.target,values=Object.fromEntries(new FormData(f)),submit=f.querySelector('[type=submit]');if(submit)submit.disabled=true;
  try{
    if(f.id==='auth'){
      const input=values.server.trim().replace(/\/$/,'');const url=new URL(input);
      if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw new Error('Informe apenas o endereço do servidor, como https://jogo.exemplo.com.');
      base=url.origin;localStorage.setItem('aurora.server',base);
      const result=await api('/'+authMode,{name:values.name,password:values.password});token=result.token;user=result.user;localStorage.setItem('aurora.token',token);await refreshLobby();
    }else if(f.id==='create-room'){const r=await api('/rooms',{...values,capacity:Number(values.capacity),points:Number(values.points),buyIn:Number(values.buyIn||0),private:values.private==='on',bots:Number(values.bots||0)});$('#modal').close();await openRoom(r.id);}
    else if(f.id==='join-code'){const r=await api('/join',values);$('#modal').close();await openRoom(r.id);}
    else if(f.id==='chat'){await roomAction('chat',values);$('#modal').close();}
    else if(f.id==='resign'){await roomAction('resign');$('#modal').close();}
  }catch(err){const error=f.id==='auth'?$('#auth-error'):$('#modal-error');if(error)error.textContent=err.message;else toast(err.message);}finally{pending=false;if(submit)submit.disabled=false;}
});
setInterval(updateTimer,1000);
setInterval(async()=>{
  if(!token||!user||pending||pollBusy||document.hidden)return;
  pollBusy=true;
  try{
    if(room){const id=room.id;const data=await api('/rooms/'+id);if(roomWanted!==id||room?.id!==id||data.version<room.version)return;data.clockOffset=data.serverTime-Date.now();const signature=data.version+'-'+data.status+'-'+data.dealStage;room=data;if(lastView!==signature){lastView=signature;renderRoom();}}
    else{const old=JSON.stringify(lobby);await refreshLobby(false);if(!room&&JSON.stringify(lobby)!==old&&!$('#modal').open)renderLobby();}
  }catch(err){if(room){const banner=$('.arena-status');if(banner)banner.textContent='Reconectando ao servidor…';}}finally{pollBusy=false;}
},700);
window.addEventListener('resize',()=>{if(room)renderRoom();});
renderAuth();
if(token&&(offline||base)){try{await refreshLobby();}catch(err){toast(err.message);}}

document.addEventListener('visibilitychange',()=>{if(offline){if(document.hidden)localGame.pause();else if(room)localGame.resume();}});
window.addEventListener('pagehide',()=>{if(offline)localGame.pause();});

document.addEventListener('visibilitychange',()=>{if(document.hidden)stopDealing();else lastView='';});
