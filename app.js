// ============================================================
//   نقود الأفراح v2 — Wedding Money Tracker
//   Features: CRUD + Return Money + Occasions + Import/Export
//   Supabase Cloud Syncing Added
// ============================================================

const KEY = 'wm_records_v2';
const DELETIONS_KEY = 'wm_deletions';

const SUPABASE_URL = 'https://trasrfhvzyruppkgpfne.supabase.co';
const SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRyYXNyZmh2enlydXBwa2dwZm5lIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2MDE3MjYsImV4cCI6MjA5OTE3NzcyNn0.OOXNPbJiOCJg5qudL1CLsALvwuSNUueVQ_8X05peDiM';
let supabaseClient;
try {
  supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
} catch (e) {
  console.error("Supabase script CDN failed to load", e);
}

let records = [];
let activeFilter = 'all';

function getDeletions() {
  try { return JSON.parse(localStorage.getItem(DELETIONS_KEY)) || { people: [], payments: [], received: [] }; }
  catch { return { people: [], payments: [], received: [] }; }
}
function trackPersonDeletion(id) { const d=getDeletions(); if(!d.people.includes(id))d.people.push(id); localStorage.setItem(DELETIONS_KEY,JSON.stringify(d)); }
function trackPaymentDeletion(id) { const d=getDeletions(); if(!d.payments.includes(id))d.payments.push(id); localStorage.setItem(DELETIONS_KEY,JSON.stringify(d)); }
function trackReceivedDeletion(id) { const d=getDeletions(); if(!d.received)d.received=[]; if(!d.received.includes(id))d.received.push(id); localStorage.setItem(DELETIONS_KEY,JSON.stringify(d)); }
function clearDeletionsTrack() { localStorage.removeItem(DELETIONS_KEY); }

function setSyncStatus(type,text) {
  const el=document.getElementById('syncStatus'); if(!el)return;
  el.textContent=text;
  if(type==='syncing')el.style.color='#a78bfa';
  else if(type==='synced')el.style.color='#34d399';
  else if(type==='offline')el.style.color='#fbbf24';
  else el.style.color='#fb7185';
}

function save() { localStorage.setItem(KEY,JSON.stringify(records)); syncWithSupabase(); }

function load() {
  try { records=JSON.parse(localStorage.getItem(KEY))||[]; } catch { records=[]; }
  records.forEach(r=>{
    if(!Array.isArray(r.returns))r.returns=[];
    if(!Array.isArray(r.received)){
      r.received=[];
      if(r.amount){r.received.push({id:uid(),amount:+r.amount,occasion:r.occasion||'زفاف إكرامي وفاطمة',date:new Date().toISOString().slice(0,10),note:r.note||''});}
    }
    delete r.amount; delete r.occasion;
  });
}

let isSyncing=false;
async function syncWithSupabase() {
  if(!supabaseClient||isSyncing)return;
  isSyncing=true;
  setSyncStatus('syncing','🔄 جاري المزامنة مع السحاب...');
  try {
    const d=getDeletions();
    if(d.people.length>0){const{error:e}=await supabaseClient.from('people').delete().in('id',d.people);if(!e)d.people=[];}
    if(d.received&&d.received.length>0){const{error:e}=await supabaseClient.from('received_gifts').delete().in('id',d.received);if(!e)d.received=[];}
    if(d.payments.length>0){const{error:e}=await supabaseClient.from('payments').delete().in('id',d.payments);if(!e)d.payments=[];}
    localStorage.setItem(DELETIONS_KEY,JSON.stringify(d));
    const{data:dbPeople,error:pe}=await supabaseClient.from('people').select('*');
    const{data:dbReceived,error:re}=await supabaseClient.from('received_gifts').select('*');
    const{data:dbPayments,error:payE}=await supabaseClient.from('payments').select('*');
    if(pe||re||payE){setSyncStatus('offline','⚠️ وضع غير متصل (محلي)');isSyncing=false;return;}
    dbPeople.forEach(rp=>{
      let lp=records.find(x=>x.id===rp.id);
      if(!lp){lp={id:rp.id,name:rp.name,side:rp.side,note:rp.note||'',received:[],returns:[]};records.push(lp);}
      else{lp.name=rp.name;lp.side=rp.side;lp.note=rp.note||'';}
      const rGifts=dbReceived.filter(x=>x.person_id===rp.id);
      rGifts.forEach(rg=>{let lpGift=lp.received.find(x=>x.id===rg.id);if(!lpGift){lp.received.push({id:rg.id,amount:+rg.amount,occasion:rg.occasion||'',date:rg.date,note:rg.note||''});}else{lpGift.amount=+rg.amount;lpGift.occasion=rg.occasion||'';lpGift.date=rg.date;lpGift.note=rg.note||'';}});
      const rPays=dbPayments.filter(x=>x.person_id===rp.id);
      rPays.forEach(rp=>{let lpPay=lp.returns.find(x=>x.id===rp.id);if(!lpPay){lp.returns.push({id:rp.id,amount:+rp.amount,date:rp.date,note:rp.note||''});}else{lpPay.amount=+rp.amount;lpPay.date=rp.date;lpPay.note=rp.note||'';}});
    });
    if(records.length>0){
      await supabaseClient.from('people').upsert(records.map(r=>({id:r.id,name:r.name,side:r.side,note:r.note||''})));
      const receivedToUpsert=[];records.forEach(r=>r.received.forEach(g=>receivedToUpsert.push({id:g.id,person_id:r.id,amount:+g.amount,occasion:g.occasion||'',date:g.date||new Date().toISOString().slice(0,10),note:g.note||''})));
      if(receivedToUpsert.length>0)await supabaseClient.from('received_gifts').upsert(receivedToUpsert);
      const paymentsToUpsert=[];records.forEach(r=>r.returns.forEach(p=>paymentsToUpsert.push({id:p.id,person_id:r.id,amount:+p.amount,date:p.date||new Date().toISOString().slice(0,10),note:p.note||''})));
      if(paymentsToUpsert.length>0)await supabaseClient.from('payments').upsert(paymentsToUpsert);
    }
    localStorage.setItem(KEY,JSON.stringify(records));
    setSyncStatus('synced','☁️ متصل بالسحاب ومُزامَن');
    render();
  } catch(err){setSyncStatus('offline','⚠️ فشل الاتصال بالسحاب (محلي)');}
  finally{isSyncing=false;}
}

function uid(){return Date.now().toString(36)+Math.random().toString(36).slice(2,7);}

let activeWorkspace=localStorage.getItem('wm_workspace')||'all';
function switchWorkspace(ws){
  activeWorkspace=ws;localStorage.setItem('wm_workspace',ws);
  document.querySelectorAll('.wtab').forEach(b=>b.classList.remove('active'));
  const tab=document.getElementById('wtab-'+ws);if(tab)tab.classList.add('active');
  const groomCard=document.querySelector('.groom-card'),brideCard=document.querySelector('.bride-card'),totalLabel=document.querySelector('.total-card .sl');
  if(ws==='krami'){if(groomCard)groomCard.style.display='none';if(brideCard)brideCard.style.display='none';if(totalLabel)totalLabel.textContent='إجمالي نقود إكرامي';}
  else if(ws==='fatima'){if(groomCard)groomCard.style.display='none';if(brideCard)brideCard.style.display='none';if(totalLabel)totalLabel.textContent='إجمالي نقود فاطمة';}
  else{if(groomCard)groomCard.style.display='flex';if(brideCard)brideCard.style.display='flex';if(totalLabel)totalLabel.textContent='إجمالي النقود المشتركة';}
  const ktab=document.getElementById('ftab-krami'),ftab=document.getElementById('ftab-fatima');
  if(ktab&&ftab){if(ws!=='all'){ktab.style.display='none';ftab.style.display='none';if(activeFilter==='krami'||activeFilter==='fatima'){activeFilter='all';document.querySelectorAll('.ftab').forEach(b=>b.classList.remove('active'));document.getElementById('ftab-all').classList.add('active');}}else{ktab.style.display='';ftab.style.display='';}}
  updateStats();render();
}

function totalReceived(r){return(r.received||[]).reduce((s,x)=>s+ +x.amount,0);}
function totalReturned(r){return(r.returns||[]).reduce((s,x)=>s+ +x.amount,0);}
function calcDiff(r){return totalReturned(r)-totalReceived(r);}
function returnStatus(r){const ret=totalReturned(r),rec=totalReceived(r);if(ret<=0)return'pending';if(ret>=rec)return'done';return'partial';}

function calcStats(){
  const ws=activeWorkspace==='all'?records:records.filter(r=>r.side===activeWorkspace);
  const total=ws.reduce((s,r)=>s+totalReceived(r),0);
  const groom=records.filter(r=>r.side==='krami').reduce((s,r)=>s+totalReceived(r),0);
  const bride=records.filter(r=>r.side==='fatima').reduce((s,r)=>s+totalReceived(r),0);
  const returned=ws.reduce((s,r)=>s+r.returns.reduce((a,x)=>a+ +x.amount,0),0);
  const pending=ws.filter(r=>returnStatus(r)==='pending').length;
  const netBalance=returned-total;
  return{total,groom,bride,count:ws.length,returned,pending,netBalance};
}

function updateStats(){
  const s=calcStats();
  anim('sTotal',s.total);anim('sGroom',s.groom);anim('sBride',s.bride);anim('sCount',s.count);anim('sReturned',s.returned);anim('sPending',s.pending);
  const balEl=document.getElementById('sBalance');
  if(balEl){const bal=s.netBalance;balEl.textContent=(bal>=0?'+':'')+bal.toLocaleString('ar-EG');balEl.style.color=bal>0?'#34d399':bal<0?'#fbbf24':'#f4c430';}
}

function anim(id,target){
  const el=document.getElementById(id);if(!el)return;
  const from=parseInt(el.textContent.replace(/D/g,''))||0,diff=target-from,steps=25;let i=0;
  const t=setInterval(()=>{i++;el.textContent=Math.round(from+diff*(i/steps)).toLocaleString('ar-EG');if(i>=steps)clearInterval(t);},18);
}

function diffCell(r){
  const diff=calcDiff(r),paid=totalReturned(r);
  if(paid===0)return '<span class="diff-badge zero">— لم تدفع</span>';
  if(diff>0)return '<span class="diff-badge pos">➕ '+diff.toLocaleString('ar-EG')+' ج</span>';
  if(diff===0)return '<span class="diff-badge eq">⚖️ تعادل</span>';
  return '<span class="diff-badge neg">➖ '+Math.abs(diff).toLocaleString('ar-EG')+' ج</span>';
}

function statusBadge(r){const st=returnStatus(r),labels={pending:'⏳ لم تدفع',partial:'🔄 دفعت جزء',done:'✅ دفعت'};return '<span class="tbadge '+st+'">'+labels[st]+'</span>';}

function setFilter(f){
  activeFilter=f;document.querySelectorAll('.ftab').forEach(b=>b.classList.remove('active'));
  const tab=document.getElementById('ftab-'+f);if(tab)tab.classList.add('active');render();
}

function getFiltered(){
  const q=(document.getElementById('searchInput')?.value||'').trim().toLowerCase();
  return records.filter(r=>{
    if(activeWorkspace!=='all'&&r.side!==activeWorkspace)return false;
    if(activeFilter==='krami'&&r.side!=='krami')return false;
    if(activeFilter==='fatima'&&r.side!=='fatima')return false;
    if(activeFilter==='pending'&&returnStatus(r)!=='pending')return false;
    if(activeFilter==='done'&&returnStatus(r)!=='done')return false;
    if(activeFilter==='overpaid'&&calcDiff(r)<=0)return false;
    const hasOcc=(r.received||[]).some(g=>(g.occasion||'').toLowerCase().includes(q));
    if(q&&!r.name.toLowerCase().includes(q)&&!hasOcc&&!(r.note||'').toLowerCase().includes(q))return false;
    return true;
  });
}

function render(){
  const filtered=getFiltered(),tbody=document.getElementById('tbody'),empty=document.getElementById('emptyMsg');
  if(!tbody)return;
  if(filtered.length===0){tbody.innerHTML='';empty.style.display='block';updateStats();return;}
  empty.style.display='none';
  const html=filtered.map((r,i)=>{
    const ret=totalReturned(r),rec=totalReceived(r);
    const retStr=ret>0?'<span class="tret">'+ret.toLocaleString('ar-EG')+' ج</span>':'<span class="tnote">—</span>';
    const occasions=[...new Set((r.received||[]).map(g=>g.occasion).filter(Boolean))];
    const occStr=occasions.length>0?'<div class="tocc-wrap">'+occasions.map(o=>'<span class="tocc">'+esc(o)+'</span>').join('')+'</div>':'<span class="tnote">—</span>';
    return '<tr><td class="tnum">'+(i+1)+'</td><td class="tname">'+esc(r.name)+'</td><td class="tamt">'+rec.toLocaleString('ar-EG')+' ج</td><td><span class="tbadge '+r.side+'">'+(r.side==='krami'?'🤵 إكرامي':'👰 فاطمة')+'</span></td><td>'+occStr+'</td><td>'+statusBadge(r)+'</td><td>'+retStr+'</td><td>'+diffCell(r)+'</td><td class="tnote">'+esc(r.note||'—')+'</td><td><div class="tactions"><button class="tbtn edit" onclick="openEdit(''+r.id+'')" title="تعديل الاسم والجانب">✏️</button><button class="tbtn add-rec" onclick="openReceive(''+r.id+'')" title="💰 استلمت منه مناسبة جديدة">💰 أخذت</button><button class="tbtn ret" onclick="openReturn(''+r.id+'')" title="💸 رددت له دفعة">💸 رددت</button><button class="tbtn hist" onclick="openHistory(''+r.id+'')" title="📋 سجل كشف الحساب">📋 سجل ('+(r.received||[]).length+'/'+(r.returns||[]).length+')</button><button class="tbtn del" onclick="del(''+r.id+'')" title="🗑️ حذف الشخص">🗑️</button></div></td></tr>';
  }).join('');
  tbody.innerHTML=html;updateStats();
}

function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');}

function refreshOccasionList(){const dl=document.getElementById('occasionList');if(!dl)return;const occ=[...new Set(records.map(r=>r.occasion).filter(Boolean))];dl.innerHTML=occ.map(o=>'<option value="'+esc(o)+'"></option>').join('');}

function openAdd(){document.getElementById('modTitle').textContent='إضافة شخص جديد';document.getElementById('fId').value='';document.getElementById('fName').value='';document.getElementById('fAmount').value='';document.getElementById('fSide').value=activeWorkspace!=='all'?activeWorkspace:'';document.getElementById('fOccasion').value='';document.getElementById('fNote').value='';refreshOccasionList();openOv('ovMain');setTimeout(()=>document.getElementById('fName').focus(),80);}
function openEdit(id){const r=records.find(x=>x.id===id);if(!r)return;document.getElementById('modTitle').textContent='تعديل السجل';document.getElementById('fId').value=r.id;document.getElementById('fName').value=r.name;const firstGift=r.received&&r.received[0]?r.received[0]:{amount:0,occasion:''};document.getElementById('fAmount').value=firstGift.amount;document.getElementById('fSide').value=r.side;document.getElementById('fOccasion').value=firstGift.occasion||'';document.getElementById('fNote').value=r.note||'';refreshOccasionList();openOv('ovMain');}
function closeAdd(){closeOv('ovMain');}

function saveMain(e){
  e.preventDefault();
  const id=document.getElementById('fId').value,rec={name:document.getElementById('fName').value.trim(),amount:+document.getElementById('fAmount').value,side:document.getElementById('fSide').value,occasion:document.getElementById('fOccasion').value.trim(),note:document.getElementById('fNote').value.trim()};
  if(!rec.name||!rec.amount||!rec.side)return;
  if(id){const idx=records.findIndex(x=>x.id===id);if(idx!==-1){records[idx].name=rec.name;records[idx].side=rec.side;records[idx].note=rec.note;if(!Array.isArray(records[idx].received))records[idx].received=[];if(records[idx].received[0]){records[idx].received[0].amount=rec.amount;records[idx].received[0].occasion=rec.occasion;}else{records[idx].received.push({id:uid(),amount:rec.amount,occasion:rec.occasion,date:new Date().toISOString().slice(0,10),note:''});}}}
  else{const newPersonId=uid();records.push({id:newPersonId,name:rec.name,side:rec.side,note:rec.note,returns:[],received:[{id:uid(),amount:rec.amount,occasion:rec.occasion,date:new Date().toISOString().slice(0,10),note:''}]});toast('✅ تمت الإضافة!');}
  save();render();closeAdd();
}

function del(id){const r=records.find(x=>x.id===id);if(!r)return;if(!confirm('هل تحذف "'+r.name+'"؟'))return;trackPersonDeletion(id);r.returns.forEach(x=>trackPaymentDeletion(x.id));(r.received||[]).forEach(x=>trackReceivedDeletion(x.id));records=records.filter(x=>x.id!==id);save();render();toast('🗑️ تم الحذف');}
function clearAll(){if(!confirm('⚠️ هل تمسح كل البيانات نهائياً؟'))return;records.forEach(r=>{trackPersonDeletion(r.id);r.returns.forEach(x=>trackPaymentDeletion(x.id));});records=[];save();render();toast('🗑️ تم مسح الكل');}

function openReturn(id){
  const r=records.find(x=>x.id===id);if(!r)return;document.getElementById('rId').value=id;
  const ret=totalReturned(r),rec=totalReceived(r),diff=calcDiff(r);
  const diffLabel=diff>0?'➕ دفعت <strong style="color:#34d399">'+diff.toLocaleString('ar-EG')+' ج</strong> أكتر مما أخذت':diff<0?'➖ لم تدفع بعد <strong style="color:#fbbf24">'+Math.abs(diff).toLocaleString('ar-EG')+' ج</strong> من ما أخذت':ret>0?'⚖️ تعادل تماماً':'⏳ لم تدفع له بعد';
  document.getElementById('returnInfo').innerHTML='<strong>الاسم:</strong> '+esc(r.name)+'<br><strong>أخذت منه إجمالاً:</strong> '+rec.toLocaleString('ar-EG')+' ج<br><strong>دفعت له حتى الآن:</strong> '+ret.toLocaleString('ar-EG')+' ج<br><strong>الفرق الحالي:</strong> '+diffLabel;
  document.getElementById('rAmount').value=diff<0?Math.abs(diff):'';document.getElementById('rDate').value=new Date().toISOString().slice(0,10);document.getElementById('rNote').value='';
  const hist=document.getElementById('returnHistory');
  hist.innerHTML=r.returns.length===0?'':'<h3>سجل دفعاتك له:</h3>'+r.returns.map(x=>'<div class="rh-item"><span class="rh-amt">'+( +x.amount).toLocaleString('ar-EG')+' ج</span><span>'+esc(x.note||'—')+'</span><span class="rh-date">'+( x.date||'')+'</span><button class="tbtn del" onclick="delReturn(''+id+'',''+x.id+'')">✕</button></div>').join('');
  openOv('ovReturn');setTimeout(()=>document.getElementById('rAmount').focus(),80);
}
function closeReturn(){closeOv('ovReturn');}
function saveReturn(e){e.preventDefault();const id=document.getElementById('rId').value,amt=+document.getElementById('rAmount').value,date=document.getElementById('rDate').value,note=document.getElementById('rNote').value.trim();if(!amt||amt<=0)return;const r=records.find(x=>x.id===id);if(!r)return;r.returns.push({id:uid(),amount:amt,date,note});save();render();closeReturn();const st=returnStatus(r);toast(st==='done'?'✅ تم الرد الكامل لـ '+r.name+'!':st==='partial'?'🔄 تم رد جزء من مبلغ '+r.name:'🔄 تم تسجيل الرد');}
function delReturn(rid,xid){const r=records.find(x=>x.id===rid);if(!r)return;if(!confirm('حذف هذه الدفعة؟'))return;trackPaymentDeletion(xid);r.returns=r.returns.filter(x=>x.id!==xid);save();render();openReturn(rid);}

function openReceive(id){
  const r=records.find(x=>x.id===id);if(!r)return;document.getElementById('recPersonId').value=id;
  const rec=totalReceived(r);
  document.getElementById('receiveInfo').innerHTML='<strong>الاسم:</strong> '+esc(r.name)+'<br><strong>الدفتر:</strong> '+(r.side==='krami'?'🤵 إكرامي':'👰 فاطمة')+'<br><strong>إجمالي ما استلمته منه حتى الآن:</strong> '+rec.toLocaleString('ar-EG')+' ج';
  document.getElementById('recAmount').value='';document.getElementById('recOccasion').value='';document.getElementById('recDate').value=new Date().toISOString().slice(0,10);document.getElementById('recNote').value='';
  const hist=document.getElementById('receiveHistory');
  hist.innerHTML=(!r.received||r.received.length===0)?'':'<h3>سجل المبالغ المستلمة منه:</h3>'+r.received.map(x=>'<div class="rh-item"><span class="rh-amt amt-in">'+( +x.amount).toLocaleString('ar-EG')+' ج</span><span class="tocc tocc-small">'+esc(x.occasion||'—')+'</span><span class="rh-date">'+( x.date||'')+'</span><button class="tbtn del" onclick="delReceive(''+id+'',''+x.id+'')">✕</button></div>').join('');
  openOv('ovReceive');setTimeout(()=>document.getElementById('recAmount').focus(),80);
}
function closeReceive(){closeOv('ovReceive');}
function saveReceive(e){e.preventDefault();const id=document.getElementById('recPersonId').value,amt=+document.getElementById('recAmount').value,occasion=document.getElementById('recOccasion').value.trim(),date=document.getElementById('recDate').value,note=document.getElementById('recNote').value.trim();if(!amt||amt<=0||!occasion)return;const r=records.find(x=>x.id===id);if(!r)return;if(!r.received)r.received=[];r.received.push({id:uid(),amount:amt,occasion,date,note});save();render();closeReceive();toast('💰 تم تسجيل استلام '+amt+' ج بنجاح!');}
function delReceive(rid,xid){const r=records.find(x=>x.id===rid);if(!r)return;if(r.received.length<=1){toast('⚠️ يجب أن يحتوي السجل على مناسبة استلام واحدة على الأقل.','warn');return;}if(!confirm('هل تحذف مناسبة الاستلام هذه؟'))return;trackReceivedDeletion(xid);r.received=r.received.filter(x=>x.id!==xid);save();render();openReceive(rid);}

function openHistory(id){
  const r=records.find(x=>x.id===id);if(!r)return;
  document.getElementById('histTitle').textContent='📋 كشف حساب — '+r.name;
  const rec=totalReceived(r),ret=totalReturned(r),diff=calcDiff(r);
  const diffLabel=diff>0?'<span style="color:#34d399">➕ دفعت أكتر بـ '+diff.toLocaleString('ar-EG')+' ج</span>':diff<0?'<span style="color:#fbbf24">➖ باقي له '+Math.abs(diff).toLocaleString('ar-EG')+' ج</span>':'<span style="color:#f4c430">⚖️ تعادل</span>';
  document.getElementById('histPersonBar').innerHTML='<div class="hpb-item">💰 أخذت منه: <strong>'+rec.toLocaleString('ar-EG')+' ج</strong></div><div class="hpb-item">💸 دفعت له: <strong>'+ret.toLocaleString('ar-EG')+' ج</strong></div><div class="hpb-item">⚡ الفرق: '+diffLabel+'</div><span class="tbadge '+r.side+'" style="margin-right:auto">'+(r.side==='krami'?'🤵 إكرامي':'👰 فاطمة')+'</span>';
  const events=[];
  (r.received||[]).forEach(x=>events.push({type:'receive',id:x.id,amount:+x.amount,date:x.date||'',occasion:x.occasion||'مناسبة غير محددة',note:x.note||''}));
  (r.returns||[]).forEach(x=>events.push({type:'return',id:x.id,amount:+x.amount,date:x.date||'',occasion:'دفعت له',note:x.note||''}));
  events.sort((a,b)=>(a.date||'0000').localeCompare(b.date||'0000'));
  const timeline=document.getElementById('histTimeline');
  if(events.length===0){timeline.innerHTML='<div class="hist-empty">💭 لا توجد أي معاملات مسجلة بعد.</div>';document.getElementById('histTotal').innerHTML='';}
  else{
    let running=0;
    timeline.innerHTML=events.map((x,i)=>{
      if(x.type==='receive')running-=x.amount;else running+=x.amount;
      const balLabel=running>0?'<span class="diff-badge pos">➕ '+running.toLocaleString('ar-EG')+' ج لي</span>':running<0?'<span class="diff-badge neg">➖ '+Math.abs(running).toLocaleString('ar-EG')+' له</span>':'<span class="diff-badge eq">⚖️ تعادل</span>';
      const dateStr=x.date?new Date(x.date).toLocaleDateString('ar-EG',{year:'numeric',month:'long',day:'numeric'}):'—';
      const typeLabel=x.type==='receive'?'<span class="tbadge pending" style="background:rgba(251,191,36,.15); color:#fbbf24; border:1px solid rgba(251,191,36,.3)">💰 أخذت منه</span>':'<span class="tbadge done">💸 دفعت له</span>';
      return '<div class="hist-row"><div class="hist-num">'+(i+1)+'</div><div class="hist-info"><div class="hist-row-top"><span class="hist-date">📅 '+dateStr+'</span>'+typeLabel+'<span class="hist-amt" style="'+(x.type==='receive'?'color:#fbbf24; background:rgba(251,191,36,.12); border-color:rgba(251,191,36,.25);':'')+'">'+x.amount.toLocaleString('ar-EG')+' ج</span></div><div style="font-size:0.85rem; color:#fff; font-weight:bold; margin-top:0.15rem;">'+(x.type==='receive'?'المناسبة: '+esc(x.occasion):'البيان: رد مبلغ')+'</div>'+(x.note?'<div class="hist-note">📝 '+esc(x.note)+'</div>':'')+'<div class="hist-running">الرصيد بعد هذه العملية: '+balLabel+'</div></div></div>';
    }).join('');
    document.getElementById('histTotal').innerHTML='<div class="hist-total-row"><span>إجمالي المستلم: <strong>'+rec.toLocaleString('ar-EG')+' ج</strong></span><span>إجمالي المدفوع: <strong>'+ret.toLocaleString('ar-EG')+' ج</strong></span><span>العمليات: '+events.length+'</span></div>';
  }
  document.getElementById('histPayBtn').onclick=()=>{closeHistory();openReturn(id);};
  openOv('ovHistory');
}
function closeHistory(){closeOv('ovHistory');}

function openImport(){openOv('ovImport');}
function closeImport(){closeOv('ovImport');}

function doImport(){
  const raw=(document.getElementById('impTxt').value||'').trim();if(!raw){toast('⚠️ لا يوجد بيانات','warn');return;}
  let added=0,skipped=0;
  raw.split('\n').forEach(line=>{line=line.trim();if(!line)return;const p=line.split(',').map(s=>s.trim()),name=p[0]||'',amount=+(p[1])||0,side=(p[2]||'').toLowerCase(),occasion=p[3]||'زفاف إكرامي وفاطمة',note=p[4]||'';if(!name||!amount||!['krami','fatima'].includes(side)){skipped++;return;}records.push({id:uid(),name,side,note,returns:[],received:[{id:uid(),amount,occasion,date:new Date().toISOString().slice(0,10),note:''}]});added++;});
  save();render();closeImport();document.getElementById('impTxt').value='';toast('✅ استيراد '+added+' سجل'+(skipped?' (تجاهل '+skipped+')':''));
}

function loadImageData(){
  if(records.length>0&&!confirm('⚠️ سيُضاف إلى الموجود. هل تكمل؟'))return;
  INITIAL_DATA.forEach(d=>{records.push({id:uid(),name:d.name,side:d.side,note:d.note||'',returns:[],received:[{id:uid(),amount:d.amount,occasion:d.occasion||'زفاف إكرامي وفاطمة',date:new Date().toISOString().slice(0,10),note:''}]});});
  save();render();closeImport();toast('✅ تم تحميل '+INITIAL_DATA.length+' سجل من الصورة!');
}

function exportCSV(){
  if(!records.length){toast('⚠️ لا يوجد بيانات','warn');return;}
  const BOM='\uFEFF',hdr=['#','الاسم','إجمالي المبلغ المستلم','الجانب','المناسبات','الملاحظة','المردود له','حالة الرد','تاريخ آخر رد'];
  const rows=records.map((r,i)=>{const ret=totalReturned(r),rec=totalReceived(r),last=r.returns.length?r.returns[r.returns.length-1].date:'',st=returnStatus(r),stLabel=st==='done'?'تم الرد':st==='partial'?'جزئي':'لم يُرد',occasions=(r.received||[]).map(g=>g.occasion).join(' | ');return[i+1,'"'+r.name+'"',rec,r.side==='krami'?'إكرامي':'فاطمة','"'+occasions+'"','"'+(r.note||'')+'"',ret,stLabel,last].join(',');});
  const csv=BOM+[hdr.join(','),...rows].join('\n'),a=document.createElement('a');a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));a.download='نقود_الأفراح.csv';a.click();toast('📊 تم التصدير!');
}

function openOv(id){document.getElementById(id).classList.add('open');}
function closeOv(id){document.getElementById(id).classList.remove('open');}
function ovClick(e,ovId,closeFn){if(e.target.id===ovId)window[closeFn]();}

let _toastTimer;
function toast(msg){const el=document.getElementById('toast');if(!el)return;el.textContent=msg;el.classList.add('show');clearTimeout(_toastTimer);_toastTimer=setTimeout(()=>el.classList.remove('show'),3200);}

document.addEventListener('keydown',e=>{if(e.key==='Escape')['ovMain','ovReturn','ovImport'].forEach(closeOv);if(e.ctrlKey&&e.key==='n'){e.preventDefault();openAdd();}});

const INITIAL_DATA=[
  {name:'محمد ذب',amount:200,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'عم جتي',amount:200,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'عطتي صباح',amount:400,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'أم حكيم',amount:200,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'لمن كمون',amount:200,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'عم أكرامي',amount:200,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'عاطي حكيم',amount:500,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'ماما أوراق',amount:400,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'مصطفي طه',amount:500,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'محمد حكيم',amount:500,side:'krami',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'ربيعة',amount:100,side:'fatima',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'ميادة سوسة',amount:150,side:'fatima',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'بختة بنتي',amount:200,side:'fatima',occasion:'زفاف كرامي وفاطمة',note:''},
  {name:'سوسة طه',amount:400,side:'fatima',occasion:'زفاف كرامي وفاطمة',note:''},
];

let deferredPrompt;
document.addEventListener('DOMContentLoaded',()=>{
  load();
  if('serviceWorker'in navigator){navigator.serviceWorker.register('./sw.js').then(reg=>console.log('SW Registered',reg)).catch(err=>console.log('SW failed',err));}
  syncWithSupabase();
  switchWorkspace(localStorage.getItem('wm_workspace')||'all');
});

window.addEventListener('beforeinstallprompt',(e)=>{e.preventDefault();deferredPrompt=e;const btn=document.getElementById('installBtn');if(btn)btn.style.display='inline-flex';});
window.addEventListener('appinstalled',(evt)=>{const btn=document.getElementById('installBtn');if(btn)btn.style.display='none';toast('🎉 تم تثبيت التطبيق بنجاح!');});
function installApp(){const btn=document.getElementById('installBtn');if(!deferredPrompt){toast('⚠️ التثبيت غير متاح حالياً.');return;}deferredPrompt.prompt();deferredPrompt.userChoice.then(c=>{deferredPrompt=null;if(btn)btn.style.display='none';});}
