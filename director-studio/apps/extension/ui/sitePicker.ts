/** Runs inside an opaque website iframe. It only emits a validated selection; it cannot edit project state. */
export const SITE_PICKER_SCRIPT = `<script>(function(){
  let picking=false;
  const box=document.createElement('div');box.style.cssText='position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #5ba1ff;background:#5ba1ff22;display:none';
  document.addEventListener('DOMContentLoaded',()=>document.body.append(box));
  function selector(el){if(el.id)return '#'+CSS.escape(el.id);let parts=[];while(el&&el!==document.body){let index=1;let previous=el;while((previous=previous.previousElementSibling))if(previous.tagName===el.tagName)index++;parts.unshift(el.tagName.toLowerCase()+':nth-of-type('+index+')');el=el.parentElement;}return 'body > '+parts.join(' > ');}
  window.addEventListener('message',(event)=>{if(event.source===parent&&event.data?.type==='studio-pick-mode'){picking=!!event.data.enabled;box.style.display='none';document.body.style.cursor=picking?'crosshair':'';}});
  document.addEventListener('mousemove',(event)=>{if(!picking||!(event.target instanceof Element))return;let r=event.target.getBoundingClientRect();Object.assign(box.style,{display:'block',left:r.left+'px',top:r.top+'px',width:r.width+'px',height:r.height+'px'});});
  document.addEventListener('click',(event)=>{if(!picking||!(event.target instanceof Element))return;event.preventDefault();event.stopImmediatePropagation();let el=event.target,r=el.getBoundingClientRect();parent.postMessage({type:'studio-pick',page:location.hash.slice(1)||'/',selector:selector(el),text:(el.textContent||'').replace(/\\s+/g,' ').trim().slice(0,120),tag:el.tagName.toLowerCase(),bbox:{x:r.left+scrollX,y:r.top+scrollY,width:r.width,height:r.height}},'*');},true);
})();</script>`;
