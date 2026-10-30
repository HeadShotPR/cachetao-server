// Presentation only: moving cards never changes the authoritative hand or score.
export function syncGroups(groups, hand) {
  const live=new Set(hand.map(c=>c.id)),seen=new Set();
  const result=(groups||[]).filter(Array.isArray).map(g=>g.filter(id=>{
    if(!live.has(id)||seen.has(id))return false;seen.add(id);return true;
  })).filter(g=>g.length);
  const fresh=hand.filter(c=>!seen.has(c.id)).map(c=>c.id);
  if(fresh.length)result.push(fresh);
  return result;
}
export function moveCard(groups,id,targetIndex,beforeId=null) {
  const result=groups.map(g=>[...g]);
  if(!result.some(g=>g.includes(id)))return result;
  if(beforeId===id)return result;
  const target=result[targetIndex]||[];
  for(const g of result){const i=g.indexOf(id);if(i>=0)g.splice(i,1);}
  const index=beforeId?target.indexOf(beforeId):-1;
  target.splice(index<0?target.length:index,0,id);
  if(!result.includes(target))result.push(target);
  return result.filter(g=>g.length);
}

export function installHandDrag({getContext,commit,redraw}) {
  let drag=null,suppressClickUntil=0;
  const clear=()=>{if(!drag)return;drag.ghost?.remove();drag.source.classList.remove('drag-source');document.querySelectorAll('.drop-target').forEach(e=>e.classList.remove('drop-target'));drag=null;};
  document.addEventListener('pointerdown',e=>{
    const source=e.target.closest('.arena-hand [data-action="select-card"], .drawn-card-zone [data-action="select-card"]');
    if(!source||source.disabled||e.button!==0||drag)return;
    const context=getContext();if(!context)return;
    drag={source,id:source.dataset.id,pointer:e.pointerId,x:e.clientX,y:e.clientY,context,active:false,target:null};
    source.setPointerCapture(e.pointerId);
  });
  document.addEventListener('pointermove',e=>{
    if(!drag||drag.pointer!==e.pointerId)return;
    if(!drag.active&&Math.hypot(e.clientX-drag.x,e.clientY-drag.y)<8)return;
    e.preventDefault();
    if(!drag.active){
      drag.active=true;drag.source.classList.add('drag-source');
      drag.ghost=drag.source.cloneNode(true);drag.ghost.className+=' drag-ghost';drag.ghost.removeAttribute('id');drag.ghost.removeAttribute('data-action');
      const rect=drag.source.getBoundingClientRect();drag.ghost.style.width=rect.width+'px';drag.ghost.style.height=rect.height+'px';document.body.append(drag.ghost);
    }
    const hand=document.querySelector('.arena-hand');if(hand){const r=hand.getBoundingClientRect();if(e.clientY>=r.top&&e.clientY<=r.bottom){if(e.clientX<r.left+24)hand.scrollLeft-=12;else if(e.clientX>r.right-24)hand.scrollLeft+=12;}}
    drag.ghost.style.left=e.clientX-24+'px';drag.ghost.style.top=e.clientY-50+'px';
    document.querySelectorAll('.drop-target').forEach(el=>el.classList.remove('drop-target'));
    const hit=document.elementFromPoint(e.clientX,e.clientY);
    const fresh=hit?.closest('[data-action="new-hand-group"]'),group=hit?.closest('.hand-group');
    drag.target=null;
    if(fresh){fresh.classList.add('drop-target');drag.target={index:drag.context.groups.length,before:null};}
    else if(group){
      group.classList.add('drop-target');const cards=[...group.querySelectorAll('[data-id]')];
      const before=cards.find(el=>{const r=el.getBoundingClientRect();return e.clientX<r.left+Math.min(r.width,30)/2;});
      drag.target={index:Number(group.dataset.group),before:before?.dataset.id||null};
    }
  },{passive:false});
  document.addEventListener('pointerup',e=>{
    if(!drag||drag.pointer!==e.pointerId)return;
    const current=drag,context=getContext();clear();
    if(current.active){
      suppressClickUntil=Date.now()+350;
      if(current.target&&context?.key===current.context.key)commit(current.context.groups,current.id,current.target.index,current.target.before);
      else redraw();
    }
  });
  document.addEventListener('pointercancel',()=>{const active=!!drag;clear();if(active)redraw();});
  document.addEventListener('click',e=>{if(Date.now()<suppressClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  window.addEventListener('blur',()=>{clear();redraw();});
  return {busy:()=>!!drag,cancel:clear};
}
