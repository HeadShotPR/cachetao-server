import { newRoom, addPlayer, startRound, roomView, move, tick, touch, requireThat, declarePifado, reenter, claimDiscard, canStartNextRound, declineReentry, decideRound, claimKnock } from './game.js';
import { setBots, stepBots } from './bots.js';

// Local practice has no network, account, or online statistics dependency.
export class OfflineGame {
  constructor(storage) {
    this.storage = storage;
    this.user = { id:'local-player', name:'Você', avatar:0, wins:0, guest:true };
    this.room = null; this.paused = false;
    try {
      const saved = JSON.parse(storage.getItem('cm.offline.v1'));
      if (saved?.schema === 1 && [3, 4].includes(saved.room?.rulesVersion) && saved.room?.players?.some(p=>p.id===this.user.id)) {
        this.room = saved.room;
        this.room.deadline = Date.now() + (saved.remaining ?? 45000);
        if(this.room.status==='dealing'&&this.room.deal){const shift=Date.now()-(saved.savedAt||Date.now());this.room.deal.started+=shift;this.room.deal.endsAt+=shift;for(const e of this.room.deal.events)e.at+=shift;}
        this.room.nextRoundAt = Date.now() + (saved.nextRemaining ?? 12000);
        if(this.room.claimUntil)this.room.claimUntil=Date.now()+(saved.claimRemaining??3000);
        this.room.botReactions={};this.room.botTurnKey = null; this.room.botNextAt = null;
      }
    } catch { /* A damaged save must not prevent starting a new game. */ }
  }
  save() {
    const r=this.room;
    try { this.storage.setItem('cm.offline.v1', JSON.stringify({schema:1,savedAt:Date.now(),room:r,
      remaining:r?Math.max(0,r.deadline-Date.now()):0,
      claimRemaining:r?.claimUntil?Math.max(0,r.claimUntil-Date.now()):null,
      nextRemaining:r?Math.max(0,(r.nextRoundAt||0)-Date.now()):0})); }
    catch { /* Gameplay remains available if storage is full or unavailable. */ }
  }
  pause() {
    if(this.paused)return;
    this.pauseAt=Date.now(); this.save(); this.paused=true;
  }
  resume() {
    if(!this.paused)return;
    const elapsed=Date.now()-this.pauseAt,r=this.room;
    if(r){if(r.status==='dealing'&&r.deal){r.deal.started+=elapsed;r.deal.endsAt+=elapsed;for(const e of r.deal.events)e.at+=elapsed;}r.deadline+=elapsed;if(r.nextRoundAt)r.nextRoundAt+=elapsed;if(r.botNextAt)r.botNextAt+=elapsed;if(r.claimUntil)r.claimUntil+=elapsed;for(const key in r.botReactions)r.botReactions[key]+=elapsed;}
    this.paused=false;
  }
  advance(now=Date.now()) {
    if(this.paused||!this.room)return;
    const changed=tick(this.room,now);
    const botChanged=stepBots(this.room,now);
    if(changed||botChanged)this.save();
  }
  request(path,body) {
    const uid=this.user.id;
    if(path==='/lobby')return {user:this.user,rooms:[],myRooms:this.room&&this.room.status!=='finished'?[{
      id:this.room.id,name:this.room.name,status:this.room.status,practice:true}]:[]};
    if(path==='/logout'){this.pause();return {ok:true};}
    if(path==='/practice'||path==='/rooms'){
      const capacity=Number(body?.capacity??4),points=Number(body?.points??10);
      const count=path==='/practice'?capacity-1:Number(body?.bots??capacity-1);
      requireThat(Number.isInteger(capacity)&&capacity>=2&&capacity<=10,'Escolha de 2 a 10 lugares.');
      requireThat([5,7,10].includes(points),'Escolha 5, 7 ou 10 pontos.');
      requireThat(Number.isInteger(count)&&count>=0&&count<capacity,'Escolha os bots sem ultrapassar os lugares.');
      const buyIn = Number(body?.buyIn ?? 10);
      const r=newRoom(uid,{name:String(body?.name||'Mesa Cachetão').slice(0,48),capacity,points,buyIn,private:true});
      r.offline=true;r.code='OFFLINE';addPlayer(r,this.user);setBots(r,count);
      if(path==='/practice')startRound(r);
      this.room=r;this.paused=false;this.save();return structuredClone(roomView(r,uid));
    }
    const match=path.match(/^\/rooms\/([^/]+)(?:\/(\w+))?$/),r=this.room;
    requireThat(match&&r&&match[1]===r.id,'Treino não encontrado.');
    const action=match[2];
    if(!action)this.advance();
    else if(action==='decide')decideRound(r,uid,body.choice);
    else if(action==='claim-knock')claimKnock(r,uid,body.cardId,body.mode);
    else if(action==='pifado')declarePifado(r,uid);
    else if(action==='claim')claimDiscard(r,uid,body.card);
    else if(action==='reenter')reenter(r,uid);
    else if(action==='declineReentry')declineReentry(r,uid);
    else if(action==='move')move(r,uid,body);
    else if(action==='start'){requireThat(r.status==='waiting','A partida já começou.');startRound(r);}
    else if(action==='next'){requireThat(r.status==='roundEnd'&&r.players[0].points>0,'Aguarde o fim da rodada.');requireThat(canStartNextRound(r),'Aguarde a janela de reentrada ou o resultado da partida.');startRound(r);}
    else if(action==='bots')setBots(r,body.count);
    else if(action==='leave'){requireThat(r.status==='waiting','Use Desistir durante a partida.');this.room=null;this.save();return {ok:true};}
    else if(action==='resign'){
      requireThat(['playing','roundEnd'].includes(r.status),'A partida já terminou.');
      r.players[0].points=0;r.status='finished';r.result={winners:[],penalty:0,at:Date.now()};r.winner=null;touch(r);
    } else requireThat(false,'Recurso disponível apenas nas salas online.');
    this.save();return structuredClone(roomView(r,uid));
  }
}
