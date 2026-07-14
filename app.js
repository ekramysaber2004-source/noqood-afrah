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

// ── Deletion Tracking for Offline-to-Online Sync ──────────────
function getDeletions() {
  let d;
  try {
    d = JSON.parse(localStorage.getItem(DELETIONS_KEY)) || {};
  } catch {
    d = {};
  }
  if (!d.people) d.people = [];
  if (!d.payments) d.payments = [];
  if (!d.received) d.received = [];
  return d;
}

function trackPersonDeletion(id) {
  const d = getDeletions();
  if (!d.people.includes(id)) d.people.push(id);
  localStorage.setItem(DELETIONS_KEY, JSON.stringify(d));
}

function trackPaymentDeletion(id) {
  const d = getDeletions();
  if (!d.payments.includes(id)) d.payments.push(id);
  localStorage.setItem(DELETIONS_KEY, JSON.stringify(d));
}

function trackReceivedDeletion(id) {
  const d = getDeletions();
  if (!d.received) d.received = [];
  if (!d.received.includes(id)) d.received.push(id);
  localStorage.setItem(DELETIONS_KEY, JSON.stringify(d));
}

function clearDeletionsTrack() {
  localStorage.removeItem(DELETIONS_KEY);
}

// ── Sync UI Status ───────────────────────────────────────────
function setSyncStatus(type, text) {
  const el = document.getElementById('syncStatus');
  if (!el) return;
  el.textContent = text;
  if (type === 'syncing') {
    el.style.color = '#a78bfa'; // Purple
  } else if (type === 'synced') {
    el.style.color = '#34d399'; // Green
  } else if (type === 'offline') {
    el.style.color = '#fbbf24'; // Amber
  } else {
    el.style.color = '#fb7185'; // Red (error)
  }
}

// ── Persist ─────────────────────────────────────────────────
function save() {
  localStorage.setItem(KEY, JSON.stringify(records));
  // Trigger background sync
  syncWithSupabase();
}

function load() {
  try { records = JSON.parse(localStorage.getItem(KEY)) || []; }
  catch { records = []; }
  
  // Data Migration: Upgrade old flat structures to multiple-occasion structure
  records.forEach(r => {
    if (!Array.isArray(r.returns)) r.returns = [];
    
    // Migrate old received gifts structure
    if (!Array.isArray(r.received)) {
      r.received = [];
      // If the old record had amount, migrate it as a received gift
      if (r.amount) {
        r.received.push({
          id: uid(),
          amount: +r.amount,
          occasion: r.occasion || 'زفاف إكرامي وفاطمة',
          date: new Date().toISOString().slice(0, 10),
          note: r.note || ''
        });
      }
    }
    // Clean up deprecated root-level values so they don't cause confusion
    delete r.amount;
    delete r.occasion;
  });
}

// ── Supabase Sync Engine ─────────────────────────────────────
let isSyncing = false;
let lastLocalSyncTime = 0;
async function syncWithSupabase() {
  if (!supabaseClient) return;
  if (isSyncing) return;
  isSyncing = true;
  setSyncStatus('syncing', '🔄 جاري المزامنة مع السحاب...');

  try {
    // 1. Process tracked deletions first
    const d = getDeletions();
    if (d.people.length > 0) {
      const { error: delPeopleErr } = await supabaseClient.from('people').delete().in('id', d.people);
      if (delPeopleErr) {
        console.error("Error deleting people from Supabase:", delPeopleErr);
      } else {
        d.people = [];
      }
    }
    if (d.received && d.received.length > 0) {
      const { error: delRecErr } = await supabaseClient.from('received_gifts').delete().in('id', d.received);
      if (delRecErr) {
        console.error("Error deleting received gifts from Supabase:", delRecErr);
      } else {
        d.received = [];
      }
    }
    if (d.payments.length > 0) {
      const { error: delPayErr } = await supabaseClient.from('payments').delete().in('id', d.payments);
      if (delPayErr) {
        console.error("Error deleting payments from Supabase:", delPayErr);
      } else {
        d.payments = [];
      }
    }
    localStorage.setItem(DELETIONS_KEY, JSON.stringify(d));

    // 2. Fetch remote records from all 3 tables
    const { data: dbPeople, error: pe } = await supabaseClient.from('people').select('*');
    const { data: dbReceived, error: re } = await supabaseClient.from('received_gifts').select('*');
    const { data: dbPayments, error: payE } = await supabaseClient.from('payments').select('*');

    if (pe || re || payE) {
      console.warn("Supabase fetch error, running offline", pe, re, payE);
      setSyncStatus('offline', '⚠️ وضع غير متصل (محلي)');
      isSyncing = false;
      return;
    }

    // 3. Reconcile remote to local
    dbPeople.forEach(rp => {
      // Skip if this person is marked for deletion locally
      if (d.people.includes(rp.id)) return;

      let lp = records.find(x => x.id === rp.id);
      if (!lp) {
        lp = {
          id: rp.id,
          name: rp.name,
          side: rp.side,
          note: rp.note || '',
          received: [],
          returns: []
        };
        records.push(lp);
      } else {
        lp.name = rp.name;
        lp.side = rp.side;
        lp.note = rp.note || '';
      }

      // Reconcile received gifts (ما أخذته منه)
      const rGifts = dbReceived.filter(x => x.person_id === rp.id);
      rGifts.forEach(rg => {
        // Skip if this gift is marked for deletion locally
        if (d.received && d.received.includes(rg.id)) return;

        let lpGift = lp.received.find(x => x.id === rg.id);
        if (!lpGift) {
          lp.received.push({
            id: rg.id,
            amount: +rg.amount,
            occasion: rg.occasion || '',
            date: rg.date,
            note: rg.note || ''
          });
        } else {
          lpGift.amount = +rg.amount;
          lpGift.occasion = rg.occasion || '';
          lpGift.date = rg.date;
          lpGift.note = rg.note || '';
        }
      });

      // Reconcile payments returned (ما رددته له)
      const rPays = dbPayments.filter(x => x.person_id === rp.id);
      rPays.forEach(pay => {
        // Skip if this payment is marked for deletion locally
        if (d.payments.includes(pay.id)) return;

        let lpPay = lp.returns.find(x => x.id === pay.id);
        if (!lpPay) {
          lp.returns.push({
            id: pay.id,
            amount: +pay.amount,
            date: pay.date,
            note: pay.note || ''
          });
        } else {
          lpPay.amount = +pay.amount;
          lpPay.date = pay.date;
          lpPay.note = pay.note || '';
        }
      });
    });

    // 4. Push local changes to remote
    if (records.length > 0) {
      // Upsert people
      const peopleToUpsert = records.map(r => ({
        id: r.id,
        name: r.name,
        side: r.side,
        note: r.note || ''
      }));
      await supabaseClient.from('people').upsert(peopleToUpsert);

      // Upsert received gifts
      const receivedToUpsert = [];
      records.forEach(r => {
        r.received.forEach(g => {
          receivedToUpsert.push({
            id: g.id,
            person_id: r.id,
            amount: +g.amount,
            occasion: g.occasion || '',
            date: g.date || new Date().toISOString().slice(0, 10),
            note: g.note || ''
          });
        });
      });
      if (receivedToUpsert.length > 0) {
        await supabaseClient.from('received_gifts').upsert(receivedToUpsert);
      }

      // Upsert payments (returns)
      const paymentsToUpsert = [];
      records.forEach(r => {
        r.returns.forEach(p => {
          paymentsToUpsert.push({
            id: p.id,
            person_id: r.id,
            amount: +p.amount,
            date: p.date || new Date().toISOString().slice(0, 10),
            note: p.note || ''
          });
        });
      });
      if (paymentsToUpsert.length > 0) {
        await supabaseClient.from('payments').upsert(paymentsToUpsert);
      }
    }

    // Save final state back to LocalStorage and update UI
    localStorage.setItem(KEY, JSON.stringify(records));
    setSyncStatus('synced', '☁️ متصل بالسحاب ومُزامَن');
    lastLocalSyncTime = Date.now();
    render();
  } catch (err) {
    console.error("Sync error", err);
    setSyncStatus('offline', '⚠️ فشل الاتصال بالسحاب (محلي)');
  } finally {
    isSyncing = false;
  }
}


// ── Realtime Synchronization & Event Debouncing ─────────────
let realtimeChannel;
let syncTimeout;

function setupRealtime() {
  if (!supabaseClient) return;

  // If already subscribed, don't re-subscribe
  if (realtimeChannel) return;

  const handleChanges = (payload) => {
    console.log('Realtime DB change event:', payload);
    
    // Ignore events from our own local writes (last 3.5 seconds) to prevent infinite sync loops
    if (Date.now() - lastLocalSyncTime < 3500) {
      console.log('Ignoring realtime event matching our own local write.');
      return;
    }
    
    debounceSync();
  };

  try {
    realtimeChannel = supabaseClient
      .channel('public-db-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'received_gifts' }, handleChanges)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'payments' }, handleChanges)
      .subscribe((status) => {
        console.log('Realtime subscription status:', status);
        if (status === 'SUBSCRIBED') {
          console.log('Successfully connected to Supabase Realtime channel.');
        }
      });
  } catch (e) {
    console.error('Error setting up Supabase Realtime:', e);
  }
}

function debounceSync() {
  clearTimeout(syncTimeout);
  syncTimeout = setTimeout(() => {
    if (!isSyncing) {
      console.log('Triggering debounced sync from Realtime event...');
      syncWithSupabase();
    }
  }, 1500); // 1.5s delay to buffer multiple changes
}

// Re-sync when the page visibility changes (user locks/unlocks mobile or switches tabs)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    console.log('App visible, triggering sync...');
    if (!isSyncing) {
      syncWithSupabase();
    }
  }
});


function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}


// ── Active Workspace Switcher (Separation) ───────────────────
let activeWorkspace = localStorage.getItem('wm_workspace') || 'all';

function switchWorkspace(ws) {
  activeWorkspace = ws;
  localStorage.setItem('wm_workspace', ws);

  // Update wtab active state
  document.querySelectorAll('.wtab').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('wtab-' + ws);
  if (tab) tab.classList.add('active');

  // Adjust card labels and show/hide groom/bride cards in hybrid view
  const groomCard = document.querySelector('.groom-card');
  const brideCard = document.querySelector('.bride-card');
  const totalLabel = document.querySelector('.total-card .sl');

  if (ws === 'krami') {
    if (groomCard) groomCard.style.display = 'none';
    if (brideCard) brideCard.style.display = 'none';
    if (totalLabel) totalLabel.textContent = 'إجمالي نقود إكرامي';
  } else if (ws === 'fatima') {
    if (groomCard) groomCard.style.display = 'none';
    if (brideCard) brideCard.style.display = 'none';
    if (totalLabel) totalLabel.textContent = 'إجمالي نقود فاطمة';
  } else {
    // all
    if (groomCard) groomCard.style.display = 'flex';
    if (brideCard) brideCard.style.display = 'flex';
    if (totalLabel) totalLabel.textContent = 'إجمالي النقود المشتركة';
  }

  // Update tabs showing side columns - hide side filter tabs if in single workspace
  const ktab = document.getElementById('ftab-krami');
  const ftab = document.getElementById('ftab-fatima');
  if (ktab && ftab) {
    if (ws !== 'all') {
      ktab.style.display = 'none';
      ftab.style.display = 'none';
      if (activeFilter === 'krami' || activeFilter === 'fatima') {
        activeFilter = 'all';
        document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
        document.getElementById('ftab-all').classList.add('active');
      }
    } else {
      ktab.style.display = '';
      ftab.style.display = '';
    }
  }

  updateStats();
  render();
}

// ── Stats ────────────────────────────────────────────────────
function totalReceived(r) {
  return (r.received || []).reduce((s, x) => s + +x.amount, 0);
}

function calcStats() {
  const wsRecords = activeWorkspace === 'all'
    ? records
    : records.filter(r => r.side === activeWorkspace);

  const total       = wsRecords.reduce((s, r) => s + totalReceived(r), 0);
  const groom       = records.filter(r => r.side === 'krami').reduce((s, r) => s + totalReceived(r), 0);
  const bride       = records.filter(r => r.side === 'fatima').reduce((s, r) => s + totalReceived(r), 0);
  const returned    = wsRecords.reduce((s, r) => s + r.returns.reduce((a, x) => a + +x.amount, 0), 0);
  const pending     = wsRecords.filter(r => returnStatus(r) === 'pending').length;
  const netBalance  = returned - total;
  return { total, groom, bride, count: wsRecords.length, returned, pending, netBalance };
}

function updateStats() {
  const s = calcStats();
  anim('sTotal', s.total);
  anim('sGroom', s.groom);
  anim('sBride', s.bride);
  anim('sCount', s.count);
  anim('sReturned', s.returned);
  anim('sPending', s.pending);
  // صافي الفرق: show with sign
  const balEl = document.getElementById('sBalance');
  if (balEl) {
    const bal = s.netBalance;
    balEl.textContent = (bal >= 0 ? '+' : '') + bal.toLocaleString('ar-EG');
    balEl.style.color = bal > 0 ? '#34d399' : bal < 0 ? '#fbbf24' : '#f4c430';
  }
}

function anim(id, target) {
  const el = document.getElementById(id);
  if (!el) return;
  const from = parseInt(el.textContent.replace(/\D/g, '')) || 0;
  const diff = target - from;
  const steps = 25;
  let i = 0;
  const t = setInterval(() => {
    i++;
    el.textContent = Math.round(from + diff * (i / steps)).toLocaleString('ar-EG');
    if (i >= steps) clearInterval(t);
  }, 18);
}

// ── Return helpers ───────────────────────────────────────────
function totalReturned(r) {
  return (r.returns || []).reduce((s, x) => s + +x.amount, 0);
}

function returnStatus(r) {
  const ret = totalReturned(r);
  const rec = totalReceived(r);
  if (ret <= 0) return 'pending';    // لم تدفع له بعد
  if (ret >= rec) return 'done';      // دفعت نفس المبلغ أو أكتر
  return 'partial';                   // دفعت جزء
}

// diff = دفعت له − أخذت منه
// +X  ⇒ دفعت أكتر (أنت كريم)
// 0   ⇒ تعادل
// -X  ⇒ ما دفعتش بعد أو دفعت أقل
function calcDiff(r) {
  return totalReturned(r) - totalReceived(r);
}

function diffCell(r) {
  const diff = calcDiff(r);
  const paid = totalReturned(r);
  if (paid === 0) {
    return `<span class="diff-badge zero">— لم تدفع</span>`;
  }
  if (diff > 0) {
    return `<span class="diff-badge pos">➕ ${diff.toLocaleString('ar-EG')} ج</span>`;
  }
  if (diff === 0) {
    return `<span class="diff-badge eq">⚖️ تعادل</span>`;
  }
  // diff < 0
  return `<span class="diff-badge neg">➖ ${Math.abs(diff).toLocaleString('ar-EG')} ج</span>`;
}

function statusBadge(r) {
  const st = returnStatus(r);
  const labels = {
    pending: '⏳ لم تدفع',
    partial: '🔄 دفعت جزء',
    done: '✅ دفعت'
  };
  return `<span class="tbadge ${st}">${labels[st]}</span>`;
}

// ── Filter & Render ──────────────────────────────────────────
function setFilter(f) {
  activeFilter = f;
  document.querySelectorAll('.ftab').forEach(b => b.classList.remove('active'));
  const tab = document.getElementById('ftab-' + f);
  if (tab) tab.classList.add('active');
  render();
}

function getFiltered() {
  const q = (document.getElementById('searchInput')?.value || '').trim().toLowerCase();
  return records.filter(r => {
    // 1. Filter by Workspace Notebook
    if (activeWorkspace !== 'all' && r.side !== activeWorkspace) return false;

    // 2. Filter by side sub-tab (only when viewing shared notebook)
    if (activeFilter === 'krami' && r.side !== 'krami') return false;
    if (activeFilter === 'fatima' && r.side !== 'fatima') return false;
    if (activeFilter === 'pending' && returnStatus(r) !== 'pending') return false;
    if (activeFilter === 'done' && returnStatus(r) !== 'done') return false;
    if (activeFilter === 'overpaid' && calcDiff(r) <= 0) return false;  // دفعت أكتر
    
    const hasOcc = (r.received || []).some(g => (g.occasion || '').toLowerCase().includes(q));
    if (q && !r.name.toLowerCase().includes(q) && !hasOcc && !(r.note || '').toLowerCase().includes(q)) return false;
    return true;
  });
}

function render() {
  const filtered = getFiltered();
  const tbody = document.getElementById('tbody');
  const empty = document.getElementById('emptyMsg');

  if (!tbody) return;

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    updateStats();
    return;
  }

  empty.style.display = 'none';

  const html = filtered.map((r, i) => {
    const ret = totalReturned(r);
    const rec = totalReceived(r);
    const retStr = ret > 0
      ? `<span class="tret">${ret.toLocaleString('ar-EG')} ج</span>`
      : `<span class="tnote">—</span>`;
      
    // List all unique occasions
    const occasions = (r.received || []).map(g => g.occasion).filter(Boolean);
    const uniqueOccasions = [...new Set(occasions)];
    const occStr = uniqueOccasions.length > 0
      ? `<div class="tocc-wrap">${uniqueOccasions.map(o => `<span class="tocc">${esc(o)}</span>`).join('')}</div>`
      : `<span class="tnote">—</span>`;

    return `<tr>
      <td class="tnum">${i + 1}</td>
      <td class="tname">${esc(r.name)}</td>
      <td class="tamt">${rec.toLocaleString('ar-EG')} ج</td>
      <td><span class="tbadge ${r.side}">${r.side === 'krami' ? '🤵 إكرامي' : '👰 فاطمة'}</span></td>
      <td>${occStr}</td>
      <td>${statusBadge(r)}</td>
      <td>${retStr}</td>
      <td>${diffCell(r)}</td>
      <td class="tnote">${esc(r.note || '—')}</td>
      <td>
        <div class="tactions">
          <button class="tbtn edit" onclick="openEdit('${r.id}')" title="تعديل الاسم والجانب">✏️</button>
          <button class="tbtn add-rec" onclick="openReceive('${r.id}')" title="💰 استلمت منه مناسبة جديدة">💰 أخذت</button>
          <button class="tbtn ret"  onclick="openReturn('${r.id}')" title="💸 رددت له دفعة">💸 رددت</button>
          <button class="tbtn hist" onclick="openHistory('${r.id}')" title="📋 سجل كشف الحساب">📋 سجل (${(r.received || []).length}/${(r.returns || []).length})</button>
          <button class="tbtn del"  onclick="del('${r.id}')" title="🗑️ حذف الشخص">🗑️</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  tbody.innerHTML = html;
  updateStats();
}

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Occasion datalist ────────────────────────────────────────
function refreshOccasionList() {
  const dl = document.getElementById('occasionList');
  if (!dl) return;
  const occasions = [...new Set(records.map(r => r.occasion).filter(Boolean))];
  dl.innerHTML = occasions.map(o => `<option value="${esc(o)}"></option>`).join('');
}

// ── Add / Edit Modal ─────────────────────────────────────────
function openAdd() {
  document.getElementById('modTitle').textContent = 'إضافة شخص جديد';
  document.getElementById('fId').value = '';
  document.getElementById('fName').value = '';
  document.getElementById('fAmount').value = '';
  // Default dropdown side selection to match current workspace
  document.getElementById('fSide').value = activeWorkspace !== 'all' ? activeWorkspace : '';
  document.getElementById('fOccasion').value = '';
  document.getElementById('fNote').value = '';
  refreshOccasionList();
  openOv('ovMain');
  setTimeout(() => document.getElementById('fName').focus(), 80);
}

function openEdit(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  document.getElementById('modTitle').textContent = 'تعديل السجل';
  document.getElementById('fId').value = r.id;
  document.getElementById('fName').value = r.name;
  const firstGift = r.received && r.received[0] ? r.received[0] : { amount: 0, occasion: '' };
  document.getElementById('fAmount').value = firstGift.amount;
  document.getElementById('fSide').value = r.side;
  document.getElementById('fOccasion').value = firstGift.occasion || '';
  document.getElementById('fNote').value = r.note || '';
  refreshOccasionList();
  openOv('ovMain');
}

function closeAdd() { closeOv('ovMain'); }

function saveMain(e) {
  e.preventDefault();
  const id = document.getElementById('fId').value;
  const rec = {
    name: document.getElementById('fName').value.trim(),
    amount: +document.getElementById('fAmount').value,
    side: document.getElementById('fSide').value,
    occasion: document.getElementById('fOccasion').value.trim(),
    note: document.getElementById('fNote').value.trim(),
  };
  if (!rec.name || !rec.amount || !rec.side) return;

  if (id) {
    const idx = records.findIndex(x => x.id === id);
    if (idx !== -1) {
      records[idx].name = rec.name;
      records[idx].side = rec.side;
      records[idx].note = rec.note;
      if (!Array.isArray(records[idx].received)) records[idx].received = [];
      if (records[idx].received[0]) {
        records[idx].received[0].amount = rec.amount;
        records[idx].received[0].occasion = rec.occasion;
      } else {
        records[idx].received.push({
          id: uid(),
          amount: rec.amount,
          occasion: rec.occasion,
          date: new Date().toISOString().slice(0, 10),
          note: ''
        });
      }
    }
    toast('✅ تم التعديل!');
  } else {
    const newPersonId = uid();
    records.push({
      id: newPersonId,
      name: rec.name,
      side: rec.side,
      note: rec.note,
      returns: [],
      received: [{
        id: uid(),
        amount: rec.amount,
        occasion: rec.occasion,
        date: new Date().toISOString().slice(0, 10),
        note: ''
      }]
    });
    toast('✅ تمت الإضافة!');
  }
  save(); render(); closeAdd();
}

// ── Delete ───────────────────────────────────────────────────
function del(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  if (!confirm(`هل تحذف "${r.name}" (${r.amount} ج)؟`)) return;
  // Track deletions for Cloud sync
  trackPersonDeletion(id);
  r.returns.forEach(x => trackPaymentDeletion(x.id));
  (r.received || []).forEach(x => trackReceivedDeletion(x.id));

  records = records.filter(x => x.id !== id);
  save(); render();
  toast('🗑️ تم الحذف');
}

function clearAll() {
  if (!confirm('⚠️ هل تمسح كل البيانات نهائياً؟')) return;
  // Track all deletions for Cloud sync
  records.forEach(r => {
    trackPersonDeletion(r.id);
    r.returns.forEach(x => trackPaymentDeletion(x.id));
  });
  records = [];
  save(); render();
  toast('🗑️ تم مسح الكل');
}

// ── Return Money Modal ───────────────────────────────────────
function openReturn(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  document.getElementById('rId').value = id;

  const ret = totalReturned(r);
  const rec = totalReceived(r);
  const diff = calcDiff(r);   // دفعت له − أخذت منه
  const diffLabel = diff > 0
    ? `➕ دفعت <strong style="color:#34d399">${diff.toLocaleString('ar-EG')} ج</strong> أكتر مما أخذت`
    : diff < 0
      ? `➖ لم تدفع بعد <strong style="color:#fbbf24">${Math.abs(diff).toLocaleString('ar-EG')} ج</strong> من ما أخذت`
      : ret > 0 ? `⚖️ تعادل تماماً` : `⏳ لم تدفع له بعد`;

  document.getElementById('returnInfo').innerHTML =
    `<strong>الاسم:</strong> ${esc(r.name)}<br>
     <strong>أخذت منه إجمالاً:</strong> ${rec.toLocaleString('ar-EG')} ج<br>
     <strong>دفعت له حتى الآن:</strong> ${ret.toLocaleString('ar-EG')} ج<br>
     <strong>الفرق الحالي:</strong> ${diffLabel}`;

  // اقترح مبلغ الدفع: لو diff سالب (=لسه مدفعتش كفاية) اقترح المبلغ المتبقي
  document.getElementById('rAmount').value = diff < 0 ? Math.abs(diff) : '';
  document.getElementById('rDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('rNote').value = '';

  // Show return history
  const hist = document.getElementById('returnHistory');
  if (r.returns.length === 0) {
    hist.innerHTML = '';
  } else {
    hist.innerHTML = `<h3>سجل دفعاتك له:</h3>` +
      r.returns.map(x => `
        <div class="rh-item">
          <span class="rh-amt">${(+x.amount).toLocaleString('ar-EG')} ج</span>
          <span>${esc(x.note || '—')}</span>
          <span class="rh-date">${x.date || ''}</span>
          <button class="tbtn del" onclick="delReturn('${id}','${x.id}')" title="حذف هذا الرد">✕</button>
        </div>`).join('');
  }

  openOv('ovReturn');
  setTimeout(() => document.getElementById('rAmount').focus(), 80);
}

function closeReturn() { closeOv('ovReturn'); }

function saveReturn(e) {
  e.preventDefault();
  const id = document.getElementById('rId').value;
  const amt = +document.getElementById('rAmount').value;
  const date = document.getElementById('rDate').value;
  const note = document.getElementById('rNote').value.trim();
  if (!amt || amt <= 0) return;

  const r = records.find(x => x.id === id);
  if (!r) return;
  r.returns.push({ id: uid(), amount: amt, date, note });
  save(); render(); closeReturn();

  const st = returnStatus(r);
  const msg = st === 'done' ? `✅ تم الرد الكامل لـ ${r.name}!`
    : st === 'partial' ? `🔄 تم رد جزء من مبلغ ${r.name}`
      : `🔄 تم تسجيل الرد`;
  toast(msg);
}

// ── Receive Money Modal (استلام نقود جديدة) ───────────────────
function openReceive(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;
  document.getElementById('recPersonId').value = id;

  const rec = totalReceived(r);
  document.getElementById('receiveInfo').innerHTML =
    `<strong>الاسم:</strong> ${esc(r.name)}<br>
     <strong>الدفتر:</strong> ${r.side === 'krami' ? '🤵 إكرامي' : '👰 فاطمة'}<br>
     <strong>إجمالي ما استلمته منه حتى الآن:</strong> ${rec.toLocaleString('ar-EG')} ج`;

  document.getElementById('recAmount').value = '';
  document.getElementById('recOccasion').value = '';
  document.getElementById('recDate').value = new Date().toISOString().slice(0, 10);
  document.getElementById('recNote').value = '';

  // Show receive history
  const hist = document.getElementById('receiveHistory');
  if (!r.received || r.received.length === 0) {
    hist.innerHTML = '';
  } else {
    hist.innerHTML = `<h3>سجل المبالغ المستلمة منه:</h3>` +
      r.received.map(x => `
        <div class="rh-item">
          <span class="rh-amt amt-in">${(+x.amount).toLocaleString('ar-EG')} ج</span>
          <span class="tocc tocc-small">${esc(x.occasion || '—')}</span>
          <span class="rh-date">${x.date || ''}</span>
          <button class="tbtn del" onclick="delReceive('${id}','${x.id}')" title="حذف هذا الاستلام">✕</button>
        </div>`).join('');
  }

  openOv('ovReceive');
  setTimeout(() => document.getElementById('recAmount').focus(), 80);
}

function closeReceive() { closeOv('ovReceive'); }

function saveReceive(e) {
  e.preventDefault();
  const id = document.getElementById('recPersonId').value;
  const amt = +document.getElementById('recAmount').value;
  const occasion = document.getElementById('recOccasion').value.trim();
  const date = document.getElementById('recDate').value;
  const note = document.getElementById('recNote').value.trim();
  if (!amt || amt <= 0 || !occasion) return;

  const r = records.find(x => x.id === id);
  if (!r) return;
  if (!r.received) r.received = [];
  r.received.push({ id: uid(), amount: amt, occasion, date, note });
  save(); render(); closeReceive();
  toast(`💰 تم تسجيل استلام ${amt} ج بنجاح!`);
}

function delReceive(rid, xid) {
  const r = records.find(x => x.id === rid);
  if (!r) return;
  if (r.received.length <= 1) {
    toast('⚠️ يجب أن يحتوي السجل على مناسبة استلام واحدة على الأقل. لحذف الشخص بالكامل اضغط على زر الحذف الرئيسي.', 'warn');
    return;
  }
  if (!confirm('هل تحذف مناسبة الاستلام هذه؟')) return;
  trackReceivedDeletion(xid);
  r.received = r.received.filter(x => x.id !== xid);
  save(); render();
  openReceive(rid); // refresh
}

// ── Unified History Modal (سجل المعاملات المشترك) ─────────────
function openHistory(id) {
  const r = records.find(x => x.id === id);
  if (!r) return;

  // Title
  document.getElementById('histTitle').textContent = `📋 كشف حساب — ${r.name}`;

  const rec = totalReceived(r);
  const ret = totalReturned(r);
  const diff = calcDiff(r);
  const diffLabel = diff > 0
    ? `<span style="color:#34d399">➕ دفعت أكتر بـ ${diff.toLocaleString('ar-EG')} ج</span>`
    : diff < 0
      ? `<span style="color:#fbbf24">➖ باقي له ${Math.abs(diff).toLocaleString('ar-EG')} ج</span>`
      : `<span style="color:#f4c430">⚖️ تعادل</span>`;

  document.getElementById('histPersonBar').innerHTML =
    `<div class="hpb-item">💰 أخذت منه: <strong>${rec.toLocaleString('ar-EG')} ج</strong></div>` +
    `<div class="hpb-item">💸 دفعت له: <strong>${ret.toLocaleString('ar-EG')} ج</strong></div>` +
    `<div class="hpb-item">⚡ الفرق: ${diffLabel}</div>` +
    `<span class="tbadge ${r.side}" style="margin-right:auto">${r.side === 'krami' ? '🤵 إكرامي' : '👰 فاطمة'}</span>`;

  // Merge all events chronologically
  const events = [];
  (r.received || []).forEach(x => {
    events.push({
      type: 'receive',
      id: x.id,
      amount: +x.amount,
      date: x.date || '',
      occasion: x.occasion || 'مناسبة غير محددة',
      note: x.note || ''
    });
  });
  (r.returns || []).forEach(x => {
    events.push({
      type: 'return',
      id: x.id,
      amount: +x.amount,
      date: x.date || '',
      occasion: 'دفعت له',
      note: x.note || ''
    });
  });

  // Sort events chronologically (date ascending)
  events.sort((a, b) => (a.date || '0000').localeCompare(b.date || '0000'));

  const timeline = document.getElementById('histTimeline');
  if (events.length === 0) {
    timeline.innerHTML = `<div class="hist-empty">💭 لا توجد أي معاملات مسجلة بعد.</div>`;
    document.getElementById('histTotal').innerHTML = '';
  } else {
    let running = 0;
    timeline.innerHTML = events.map((x, i) => {
      if (x.type === 'receive') {
        running -= x.amount; // receiving increases what we owe
      } else {
        running += x.amount; // returning reduces what we owe (moves positive)
      }

      const balanceLabel = running > 0
        ? `<span class="diff-badge pos">➕ ${running.toLocaleString('ar-EG')} ج لي</span>`
        : running < 0
          ? `<span class="diff-badge neg">➖ ${Math.abs(running).toLocaleString('ar-EG')} له</span>`
          : `<span class="diff-badge eq">⚖️ تعادل</span>`;

      const dateStr = x.date
        ? new Date(x.date).toLocaleDateString('ar-EG', { year: 'numeric', month: 'long', day: 'numeric' })
        : '—';

      const typeLabel = x.type === 'receive'
        ? `<span class="tbadge pending" style="background:rgba(251,191,36,.15); color:#fbbf24; border:1px solid rgba(251,191,36,.3)">💰 أخذت منه</span>`
        : `<span class="tbadge done">💸 دفعت له</span>`;

      return `<div class="hist-row">
        <div class="hist-num">${i + 1}</div>
        <div class="hist-info">
          <div class="hist-row-top">
            <span class="hist-date">📅 ${dateStr}</span>
            ${typeLabel}
            <span class="hist-amt" style="${x.type === 'receive' ? 'color:#fbbf24; background:rgba(251,191,36,.12); border-color:rgba(251,191,36,.25);' : ''}">${x.amount.toLocaleString('ar-EG')} ج</span>
          </div>
          <div style="font-size:0.85rem; color:#fff; font-weight:bold; margin-top:0.15rem;">
            ${x.type === 'receive' ? `المناسبة: ${esc(x.occasion)}` : `البيان: رد مبلغ`}
          </div>
          ${x.note ? `<div class="hist-note">📝 ${esc(x.note)}</div>` : ''}
          <div class="hist-running">
            الرصيد بعد هذه العملية: ${balanceLabel}
          </div>
        </div>
      </div>`;
    }).join('');

    document.getElementById('histTotal').innerHTML =
      `<div class="hist-total-row">
        <span>إجمالي المستلم: <strong>${rec.toLocaleString('ar-EG')} ج</strong></span>
        <span>إجمالي المدفوع: <strong>${ret.toLocaleString('ar-EG')} ج</strong></span>
        <span>العمليات: ${events.length}</span>
      </div>`;
  }

  // Set action click
  document.getElementById('histPayBtn').onclick = () => {
    closeHistory();
    openReturn(id);
  };

  openOv('ovHistory');
}

function closeHistory() { closeOv('ovHistory'); }

function delFromHistory(rid, xid) {
  if (!confirm('حذف هذه الدفعة من السجل؟')) return;
  const r = records.find(x => x.id === rid);
  if (!r) return;
  trackPaymentDeletion(xid);
  r.returns = r.returns.filter(x => x.id !== xid);
  save(); render(); openHistory(rid); // refresh
  toast('🗑️ تم حذف الدفعة');
}

// ── Import Modal & Tabs ───────────────────────────────────────
let parsedExcelRows = [];
let parsedExcelHeaders = [];

function openImport() {
  resetExcelImport();
  // Reset tabs to excel by default
  switchImportTab('excel');
  openOv('ovImport');
  
  // Set up drop zone drag-and-drop event listeners
  const dropZone = document.getElementById('fileDropZone');
  if (dropZone) {
    // Prevent default drag behaviors
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, e => {
        e.preventDefault();
        e.stopPropagation();
      }, false);
    });

    ['dragenter', 'dragover'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.add('dragover');
      }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
      dropZone.addEventListener(eventName, () => {
        dropZone.classList.remove('dragover');
      }, false);
    });

    dropZone.addEventListener('drop', e => {
      const dt = e.dataTransfer;
      const files = dt.files;
      if (files.length) {
        const fileInput = document.getElementById('excelFileInput');
        if (fileInput) {
          fileInput.files = files;
          handleExcelFileSelect({ target: { files } });
        }
      }
    }, false);
  }
}

function closeImport() {
  closeOv('ovImport');
  resetExcelImport();
}

function switchImportTab(tab) {
  document.querySelectorAll('.import-tab').forEach(b => b.classList.remove('active'));
  
  const contentExcel = document.getElementById('tabContent-excel');
  const contentText = document.getElementById('tabContent-text');
  
  if (contentExcel) contentExcel.style.display = 'none';
  if (contentText) contentText.style.display = 'none';
  
  const activeTabBtn = document.getElementById('itab-' + tab);
  if (activeTabBtn) activeTabBtn.classList.add('active');
  
  const contentEl = document.getElementById('tabContent-' + tab);
  if (contentEl) contentEl.style.display = 'block';
}

function handleExcelFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = function(evt) {
    try {
      const data = new Uint8Array(evt.target.result);
      const workbook = XLSX.read(data, { type: 'array' });
      
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];
      
      // Parse as 2D array: header: 1 returns array of arrays, defval: "" covers empty cells
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" });
      
      // Filter out completely empty rows
      const validRows = rawRows.filter(row => row.some(cell => String(cell).trim() !== ""));
      
      if (validRows.length < 2) {
        toast('⚠️ الملف فارغ أو لا يحتوي على صفوف بيانات كافية');
        return;
      }

      parsedExcelHeaders = validRows[0].map((h, i) => String(h).trim() || `العمود ${i + 1}`);
      parsedExcelRows = validRows.slice(1);
      
      document.getElementById('loadedFileName').textContent = file.name;
      document.getElementById('loadedRowsCount').textContent = parsedExcelRows.length;

      // Populate Column Selects
      populateMappingSelects();
      
      // Show Mapping & Hide Drop Zone
      document.getElementById('fileDropZone').style.display = 'none';
      document.getElementById('excelMappingSection').style.display = 'block';
      
      // Guess columns
      autoGuessExcelMappings();
      
      // Render Preview
      updateExcelPreview();
      
    } catch (err) {
      console.error(err);
      toast('⚠️ حدث خطأ أثناء قراءة ملف الاكسل');
    }
  };
  
  reader.readAsArrayBuffer(file);
}

function populateMappingSelects() {
  const selects = ['mapName', 'mapAmount', 'mapSide', 'mapOccasion', 'mapNote'];
  selects.forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    
    // Clear old options
    el.innerHTML = '';
    
    // For optional fields, add an empty/skipped option
    if (id === 'mapSide' || id === 'mapOccasion' || id === 'mapNote') {
      const opt = document.createElement('option');
      opt.value = '-1';
      opt.textContent = '-- تجاهل أو استخدم الافتراضي --';
      el.appendChild(opt);
    } else {
      const opt = document.createElement('option');
      opt.value = '';
      opt.textContent = '-- اختر العمود --';
      el.appendChild(opt);
    }
    
    // Populate column options
    parsedExcelHeaders.forEach((header, index) => {
      const opt = document.createElement('option');
      opt.value = index;
      opt.textContent = `${header} (العمود ${index + 1})`;
      el.appendChild(opt);
    });
  });
}

function autoGuessExcelMappings() {
  const guess = (keywords, selectsId) => {
    const idx = parsedExcelHeaders.findIndex(h => {
      const lowerH = h.toLowerCase().replace(/\s+/g, '');
      return keywords.some(k => lowerH.includes(k) || k.includes(lowerH));
    });
    const el = document.getElementById(selectsId);
    if (el && idx !== -1) {
      el.value = idx;
    }
  };

  guess(['الاسم', 'اسم', 'name', 'كامل'], 'mapName');
  guess(['المبلغ', 'القيمة', 'الفلوس', 'amount', 'value', 'جنيه', 'فلوس'], 'mapAmount');
  guess(['الجانب', 'الدفتر', 'الطرف', 'side', 'type', 'دفتر'], 'mapSide');
  guess(['المناسبة', 'المناسبه', 'occasion', 'البيان'], 'mapOccasion');
  guess(['ملاحظة', 'ملاحظات', 'note', 'notes'], 'mapNote');
}

function updateExcelPreview() {
  const mapNameIdx = document.getElementById('mapName').value;
  const mapAmtIdx = document.getElementById('mapAmount').value;
  const mapSideIdx = document.getElementById('mapSide').value;
  const mapOccIdx = document.getElementById('mapOccasion').value;
  const mapNoteIdx = document.getElementById('mapNote').value;
  
  const defaultSide = document.getElementById('excelDefaultSide').value;
  const defaultOcc = document.getElementById('excelDefaultOccasion').value.trim() || 'زفاف إكرامي وفاطمة';
  
  const tbody = document.getElementById('excelPreviewBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  // Preview first 3 rows
  const previewRows = parsedExcelRows.slice(0, 3);
  if (previewRows.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color:var(--muted)">لا توجد صفوف للمعاينة</td></tr>';
    return;
  }

  previewRows.forEach(row => {
    const rawName = mapNameIdx !== '' ? String(row[mapNameIdx] || '').trim() : '';
    
    let rawAmt = 0;
    if (mapAmtIdx !== '') {
      const amtStr = String(row[mapAmtIdx]).replace(/[^\d.]/g, '');
      rawAmt = parseFloat(amtStr) || 0;
    }
    
    // Normalize Side
    let sideVal = defaultSide;
    if (mapSideIdx !== '-1' && mapSideIdx !== '') {
      const rawSide = String(row[mapSideIdx] || '').toLowerCase().trim();
      if (rawSide.includes('إكرامي') || rawSide.includes('اكرامي') || rawSide.includes('groom') || rawSide.includes('krami') || rawSide.includes('عريس')) {
        sideVal = 'krami';
      } else if (rawSide.includes('فاطمة') || rawSide.includes('فاطمه') || rawSide.includes('bride') || rawSide.includes('fatima') || rawSide.includes('عروس')) {
        sideVal = 'fatima';
      }
    }
    
    const sideText = sideVal === 'krami' ? '🤵 إكرامي' : '👰 فاطمة';
    const rawOcc = (mapOccIdx !== '-1' && mapOccIdx !== '') ? String(row[mapOccIdx] || '').trim() : defaultOcc;
    const rawNote = (mapNoteIdx !== '-1' && mapNoteIdx !== '') ? String(row[mapNoteIdx] || '').trim() : '';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${esc(rawName || '—')}</td>
      <td><strong style="color:var(--gold)">${rawAmt ? rawAmt.toLocaleString('ar-EG') + ' ج' : '—'}</strong></td>
      <td><span class="tbadge ${sideVal}">${sideText}</span></td>
      <td><span class="tocc tocc-small">${esc(rawOcc || '—')}</span></td>
      <td style="color:var(--muted)">${esc(rawNote || '—')}</td>
    `;
    tbody.appendChild(tr);
  });
}

function importMappedExcelData() {
  const mapNameIdx = document.getElementById('mapName').value;
  const mapAmtIdx = document.getElementById('mapAmount').value;
  const mapSideIdx = document.getElementById('mapSide').value;
  const mapOccIdx = document.getElementById('mapOccasion').value;
  const mapNoteIdx = document.getElementById('mapNote').value;
  
  if (mapNameIdx === '' || mapAmtIdx === '') {
    toast('⚠️ يرجى تحديد أعمدة الاسم والمبلغ للمواصلة');
    return;
  }

  const defaultSide = document.getElementById('excelDefaultSide').value;
  const defaultOcc = document.getElementById('excelDefaultOccasion').value.trim() || 'زفاف إكرامي وفاطمة';
  const mergeExisting = document.getElementById('excelMergeExisting').checked;

  let added = 0;
  let merged = 0;
  let skipped = 0;

  parsedExcelRows.forEach(row => {
    const name = String(row[mapNameIdx] || '').trim();
    const rawAmtVal = String(row[mapAmtIdx] || '').replace(/[^\d.]/g, '');
    const amount = parseFloat(rawAmtVal) || 0;

    if (!name || amount <= 0) {
      skipped++;
      return;
    }

    // Determine Side
    let side = defaultSide;
    if (mapSideIdx !== '-1' && mapSideIdx !== '') {
      const rawSide = String(row[mapSideIdx] || '').toLowerCase().trim();
      if (rawSide.includes('إكرامي') || rawSide.includes('اكرامي') || rawSide.includes('groom') || rawSide.includes('krami') || rawSide.includes('عريس')) {
        side = 'krami';
      } else if (rawSide.includes('فاطمة') || rawSide.includes('فاطمه') || rawSide.includes('bride') || rawSide.includes('fatima') || rawSide.includes('عروس')) {
        side = 'fatima';
      }
    }

    const occasion = (mapOccIdx !== '-1' && mapOccIdx !== '') ? String(row[mapOccIdx] || '').trim() : defaultOcc;
    const note = (mapNoteIdx !== '-1' && mapNoteIdx !== '') ? String(row[mapNoteIdx] || '').trim() : '';

    let existingPerson = null;
    if (mergeExisting) {
      existingPerson = records.find(r => r.name.trim().toLowerCase() === name.toLowerCase() && r.side === side);
    }

    if (existingPerson) {
      // Append gift to existing person
      if (!existingPerson.received) existingPerson.received = [];
      existingPerson.received.push({
        id: uid(),
        amount: amount,
        occasion: occasion || defaultOcc,
        date: new Date().toISOString().slice(0, 10),
        note: note
      });
      // Append note to existing person if necessary
      if (note) {
        if (!existingPerson.note) {
          existingPerson.note = note;
        } else if (!existingPerson.note.includes(note)) {
          existingPerson.note = `${existingPerson.note} | ${note}`;
        }
      }
      merged++;
    } else {
      // Create new person
      records.push({
        id: uid(),
        name,
        side,
        note,
        returns: [],
        received: [{
          id: uid(),
          amount: amount,
          occasion: occasion || defaultOcc,
          date: new Date().toISOString().slice(0, 10),
          note: ''
        }]
      });
      added++;
    }
  });

  save();
  render();
  closeImport();
  
  let successMsg = `✅ تم الاستيراد بنجاح!`;
  if (added > 0) successMsg += ` (تمت إضافة ${added} شخص)`;
  if (merged > 0) successMsg += ` (تم دمج ${merged} هدية)`;
  if (skipped > 0) successMsg += ` (تجاهل ${skipped} صفوف)`;
  toast(successMsg);
}

function resetExcelImport() {
  parsedExcelRows = [];
  parsedExcelHeaders = [];
  
  const fileInput = document.getElementById('excelFileInput');
  if (fileInput) fileInput.value = '';
  
  const mappingSection = document.getElementById('excelMappingSection');
  const dropZone = document.getElementById('fileDropZone');
  
  if (mappingSection) mappingSection.style.display = 'none';
  if (dropZone) dropZone.style.display = 'flex';
}

function doImport() {
  const raw = (document.getElementById('impTxt').value || '').trim();
  if (!raw) { toast('⚠️ لا يوجد بيانات'); return; }

  let added = 0, skipped = 0;
  raw.split('\n').forEach(line => {
    line = line.trim();
    if (!line) return;
    const p = line.split(',').map(s => s.trim());
    const name = p[0] || '';
    const amount = +(p[1]) || 0;
    const side = (p[2] || '').toLowerCase();
    const occasion = p[3] || 'زفاف إكرامي وفاطمة';
    const note = p[4] || '';
    if (!name || !amount || !['krami', 'fatima'].includes(side)) { skipped++; return; }
    
    // Merge existing or add new
    const mergeExisting = document.getElementById('excelMergeExisting')?.checked ?? true;
    let existingPerson = null;
    if (mergeExisting) {
      existingPerson = records.find(r => r.name.trim().toLowerCase() === name.toLowerCase() && r.side === side);
    }

    if (existingPerson) {
      if (!existingPerson.received) existingPerson.received = [];
      existingPerson.received.push({
        id: uid(),
        amount: amount,
        occasion: occasion,
        date: new Date().toISOString().slice(0, 10),
        note: note
      });
      if (note) {
        if (!existingPerson.note) {
          existingPerson.note = note;
        } else if (!existingPerson.note.includes(note)) {
          existingPerson.note = `${existingPerson.note} | ${note}`;
        }
      }
    } else {
      records.push({
        id: uid(),
        name,
        side,
        note,
        returns: [],
        received: [{
          id: uid(),
          amount,
          occasion,
          date: new Date().toISOString().slice(0, 10),
          note: ''
        }]
      });
    }
    added++;
  });

  save(); render(); closeImport();
  document.getElementById('impTxt').value = '';
  toast(`✅ استيراد ${added} سجل${skipped ? ` (تجاهل ${skipped})` : ''}`);
}

function loadImageData() {
  if (records.length > 0 && !confirm('⚠️ سيُضاف إلى الموجود. هل تكمل؟')) return;
  INITIAL_DATA.forEach(d => {
    records.push({
      id: uid(),
      name: d.name,
      side: d.side,
      note: d.note || '',
      returns: [],
      received: [{
        id: uid(),
        amount: d.amount,
        occasion: d.occasion || 'زفاف إكرامي وفاطمة',
        date: new Date().toISOString().slice(0, 10),
        note: ''
      }]
    });
  });
  save(); render(); closeImport();
  toast(`✅ تم تحميل ${INITIAL_DATA.length} سجل من الصورة!`);
}

// ── Export CSV ───────────────────────────────────────────────
function exportCSV() {
  if (!records.length) { toast('⚠️ لا يوجد بيانات', 'warn'); return; }
  const BOM = '\uFEFF';
  const hdr = ['#', 'الاسم', 'إجمالي المبلغ المستلم', 'الجانب', 'المناسبات', 'الملاحظة',
    'المردود له', 'حالة الرد', 'تاريخ آخر رد'];
  const rows = records.map((r, i) => {
    const ret = totalReturned(r);
    const rec = totalReceived(r);
    const last = r.returns.length ? r.returns[r.returns.length - 1].date : '';
    const st = returnStatus(r);
    const stLabel = st === 'done' ? 'تم الرد' : st === 'partial' ? 'جزئي' : 'لم يُرد';
    const occasions = (r.received || []).map(g => g.occasion).join(' | ');
    return [
      i + 1,
      `"${r.name}"`, rec,
      r.side === 'krami' ? 'إكرامي' : 'فاطمة',
      `"${occasions}"`, `"${r.note || ''}"`,
      ret, stLabel, last
    ].join(',');
  });
  const csv = BOM + [hdr.join(','), ...rows].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  a.download = 'نقود_الأفراح.csv';
  a.click();
  toast('📊 تم التصدير!');
}

// ── Overlay helpers ──────────────────────────────────────────
function openOv(id) { document.getElementById(id).classList.add('open'); }
function closeOv(id) { document.getElementById(id).classList.remove('open'); }
function ovClick(e, ovId, closeFn) {
  if (e.target.id === ovId) window[closeFn]();
}

// ── Toast ────────────────────────────────────────────────────
let _toastTimer;
function toast(msg) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 3200);
}

// ── Keyboard shortcuts ───────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    ['ovMain', 'ovReturn', 'ovImport'].forEach(closeOv);
  }
  if (e.ctrlKey && e.key === 'n') { e.preventDefault(); openAdd(); }
});

// ── Initial data from the image ──────────────────────────────
const INITIAL_DATA = [
  // ═══ كرامي (groom side) ═══
  { name: 'محمد ذب', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عم جتي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عطتي صباح', amount: 400, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'أم حكيم', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'لمن كمون', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عم أكرامي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عاطي حكيم', amount: 500, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'ماما أوراق', amount: 400, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مصطفي طه', amount: 500, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'محمد حكيم', amount: 500, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'زيد مرات محمد مجدي', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'بند ساعة', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مصطفي عد', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مصطفي أبوعيجي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'حجاج فوق', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'هالة جنتي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عمو ابن تعمي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'سيد ابن تعمي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'خالق محمد', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عم أو تلدة', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'خالد كيتابة', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عم محمود', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'ساسي', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مصطفي محمود', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عم خير أمة', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'خالد فيلي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'خالة ولندة', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عم محمد', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عبد خطاب ذي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'عم ابن خالتي طه', amount: 50, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'أور خالتي', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'خطيب ذي قلشي', amount: 500, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'علي محمود', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'أور بنت خالتي ولندة', amount: 50, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'لبيب', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'أحمد عبالتي', amount: 400, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مرات محمد خضير', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'لدي قاسي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'محمد عبدالمعطي', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'خالق صادق', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'خالد هد', amount: 200, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'ذي بنت خالتي هد', amount: 100, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'محمد ناصر', amount: 400, side: 'krami', occasion: 'زفاف كرامي وفاطمة', note: '' },
  // ═══ فاطمة (bride side) ═══
  { name: 'ربيعة', amount: 100, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'ميادة سوسة', amount: 150, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'بختة بنتي', amount: 200, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مرات أصالح قلتشي', amount: 100, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'سوسة طه', amount: 400, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'تلدة مرات محمد طه', amount: 200, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'تلدة لمن كمون', amount: 100, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مرات عمرو ابن تعمي', amount: 100, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مرات أحمد حكيم', amount: 100, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
  { name: 'مرات محمود ناصر', amount: 200, side: 'fatima', occasion: 'زفاف كرامي وفاطمة', note: '' },
];

// ── Boot ─────────────────────────────────────────────────────
let deferredPrompt;

document.addEventListener('DOMContentLoaded', () => {
  load();
  
  // Register Service Worker for PWA
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js')
      .then(reg => console.log('Service Worker Registered successfully.', reg))
      .catch(err => console.log('Service Worker registration failed.', err));
  }

  // Trigger Supabase Sync on Startup
  syncWithSupabase();

  // Initialize Realtime Sync
  setupRealtime();

  // Initialize Active Workspace
  switchWorkspace(localStorage.getItem('wm_workspace') || 'all');
});

// PWA Install Event Handler
window.addEventListener('beforeinstallprompt', (e) => {
  // Prevent Chrome 67 and earlier from automatically showing the prompt
  e.preventDefault();
  // Stash the event so it can be triggered later.
  deferredPrompt = e;
  // Update UI to show the install button
  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.style.display = 'inline-flex';
  }
});

window.addEventListener('appinstalled', (evt) => {
  console.log('App was successfully installed!');
  const installBtn = document.getElementById('installBtn');
  if (installBtn) {
    installBtn.style.display = 'none';
  }
  toast('🎉 تم تثبيت التطبيق بنجاح!');
});

function installApp() {
  const installBtn = document.getElementById('installBtn');
  if (!deferredPrompt) {
    toast('⚠️ التثبيت غير متاح حالياً أو التطبيق مثبت بالفعل.');
    return;
  }
  // Show the prompt
  deferredPrompt.prompt();
  // Wait for the user to respond to the prompt
  deferredPrompt.userChoice.then((choiceResult) => {
    if (choiceResult.outcome === 'accepted') {
      console.log('User accepted the install prompt');
    } else {
      console.log('User dismissed the install prompt');
    }
    deferredPrompt = null;
    if (installBtn) {
      installBtn.style.display = 'none';
    }
  });
}
