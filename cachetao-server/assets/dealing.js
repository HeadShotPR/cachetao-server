// Seats increase counter-clockwise from the viewer at the bottom of the table.
export function seatPosition(offset,count){
  const angle=-Math.PI/2+offset*2*Math.PI/count;
  return {left:50+48*Math.cos(angle),top:50-47*Math.sin(angle)};
}
let frame=null,activeKey='',seen=new Set();
export function stopDealing(){cancelAnimationFrame(frame);frame=null;activeKey='';seen.clear();document.querySelectorAll('.deal-flight').forEach(e=>e.remove());}
export function animateDealing(room){
  if(document.hidden||room.status!=='dealing'){stopDealing();return;}
  const key=room.id+':'+room.round;
  if(activeKey!==key){stopDealing();activeKey=key;}
  cancelAnimationFrame(frame);
  const reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function update(){
    const now=Date.now()+(room.clockOffset||0);
    for(let i=0;i<room.deal.events.length;i++){
      const event=room.deal.events[i];if(event.at>now||seen.has(i))continue;seen.add(i);
      if(now-event.at>480)continue;
      const from=document.querySelector(`[data-player="${room.players[room.dealer].id}"] .avatar`),to=document.querySelector(`[data-player="${event.player}"] .avatar`);
      if(!from||!to)continue;
      const a=from.getBoundingClientRect(),b=to.getBoundingClientRect();
      for(let j=0;j<3;j++){
        const card=document.createElement('div');card.className='playing-card back deal-flight';card.setAttribute('aria-hidden','true');document.body.append(card);
        card.style.left=(reduced?b.x+b.width/2+j*6:a.x+a.width/2)-18+'px';card.style.top=(reduced?b.y+b.height/2:a.y+a.height/2)-25+'px';
        const self=event.player===room.players[room.dealer].id;
        const dx=b.x+b.width/2-a.x-a.width/2,dy=b.y+b.height/2-a.y-a.height/2;
        const animation=card.animate(reduced?[{opacity:0},{opacity:1,offset:.2},{opacity:1,offset:.8},{opacity:0}]:[{transform:'translate(0,0) rotate(-10deg)',opacity:1},{transform:`translate(${self?45:dx*.55}px,${self?-70:dy*.55}px) rotate(2deg)`,opacity:1},{transform:`translate(${dx+j*5}px,${dy+j*2}px) rotate(8deg)`,opacity:0}],{duration:310,delay:j*65,easing:'ease-out',fill:'both'});
        animation.onfinish=()=>card.remove();
      }
    }
    if(now<room.deal.endsAt)frame=requestAnimationFrame(update);
  }
  update();
}
