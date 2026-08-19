const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}
function clean(v, max = 500) { return String(v ?? '').trim().slice(0, max); }
function num(v, fallback = 0) { const n = Number(v); return Number.isFinite(n) ? n : fallback; }
function int(v, fallback = 0) { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? n : fallback; }
function nowISO() { return new Date().toISOString(); }
function todayVN() {
  const f = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' });
  return f.format(new Date());
}
function isDate(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || '')); }
function parseDate(s) { const [y,m,d] = s.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); }
function fmtDate(d) { return d.toISOString().slice(0,10); }
function addDays(s, n) { const d = parseDate(s); d.setUTCDate(d.getUTCDate() + n); return fmtDate(d); }
function diffDays(a, b) { return Math.round((parseDate(b) - parseDate(a)) / 86400000); }
function daysInMonth(s) { const d = parseDate(s); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth()+1, 0)).getUTCDate(); }
function daysInYear(s) { const y = parseDate(s).getUTCFullYear(); return ((y % 4 === 0 && y % 100 !== 0) || y % 400 === 0) ? 366 : 365; }
function minDate(a,b) { return a < b ? a : b; }
function maxDate(a,b) { return a > b ? a : b; }
function requirePin(request, env) {
  const expected = String(env.ADMIN_PIN || '1000');
  return String(request.headers.get('x-admin-pin') || '') === expected;
}
function stayCode() {
  const d = new Date();
  const ds = `${d.getUTCFullYear()}${String(d.getUTCMonth()+1).padStart(2,'0')}${String(d.getUTCDate()).padStart(2,'0')}`;
  const r = Math.random().toString(36).slice(2,6).toUpperCase();
  return `SMR-${ds}-${r}`;
}
function dailyGross(stay, revenueDate) {
  const rate = num(stay.contract_rate);
  if (stay.pricing_plan === 'daily') return rate;
  if (stay.pricing_plan === 'yearly') {
    const den = stay.allocation_method === 'fixed_365' ? 365 : daysInYear(revenueDate);
    return den > 0 ? rate / den : 0;
  }
  const den = stay.allocation_method === 'fixed_30' ? 30 : daysInMonth(revenueDate);
  return den > 0 ? rate / den : 0;
}
function splitGross(stay, gross) {
  const breakfast = Math.max(0, int(stay.breakfast_guests) * num(stay.breakfast_rate));
  const breakfastAmount = Math.min(Math.max(0, gross), breakfast);
  return { breakfast: breakfastAmount, netRoom: gross - breakfastAmount };
}

const SERVICE_CATEGORIES = new Set(['pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small','golf_ticket','swim_lesson','gym_month','tennis_day','minibar','laundry','restaurant','extra_bed','others']);
const POOL_CATEGORIES = ['pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small'];
let serviceSchemaReady=false;
async function ensureServiceSchema(env){
  if(serviceSchemaReady) return;
  const cols=(await env.DB.prepare('PRAGMA table_info(services)').all()).results||[];
  const names=new Set(cols.map(c=>c.name));
  if(!names.has('quantity')) await env.DB.prepare('ALTER TABLE services ADD COLUMN quantity REAL NOT NULL DEFAULT 1').run();
  if(!names.has('unit_price')) await env.DB.prepare('ALTER TABLE services ADD COLUMN unit_price REAL NOT NULL DEFAULT 0').run();
  serviceSchemaReady=true;
}

let paymentSchemaReady=false;
async function ensurePaymentSchema(env){
  if(paymentSchemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT, stay_id INTEGER NOT NULL, payment_date TEXT NOT NULL,
    payment_kind TEXT NOT NULL, amount REAL NOT NULL DEFAULT 0, payment_method TEXT NOT NULL,
    note TEXT, created_at TEXT NOT NULL, FOREIGN KEY(stay_id) REFERENCES stays(id) ON DELETE CASCADE
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_payments_stay ON payments(stay_id)').run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_payments_date ON payments(payment_date)').run();
  paymentSchemaReady=true;
}

let segmentSchemaReady=false;
async function ensureSegmentSchema(env){
  if(segmentSchemaReady) return;
  await env.DB.prepare(`CREATE TABLE IF NOT EXISTS stay_segments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stay_id INTEGER NOT NULL,
    start_date TEXT NOT NULL,
    end_date TEXT,
    room_no TEXT NOT NULL,
    room_type TEXT,
    pricing_plan TEXT NOT NULL,
    contract_rate REAL NOT NULL DEFAULT 0,
    allocation_method TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY(stay_id) REFERENCES stays(id) ON DELETE CASCADE
  )`).run();
  await env.DB.prepare('CREATE INDEX IF NOT EXISTS idx_stay_segments_stay ON stay_segments(stay_id,start_date)').run();

  const cols=(await env.DB.prepare('PRAGMA table_info(daily_room_revenue)').all()).results||[];
  const names=new Set(cols.map(c=>c.name));
  if(!names.has('segment_id')) await env.DB.prepare('ALTER TABLE daily_room_revenue ADD COLUMN segment_id INTEGER').run();
  if(!names.has('room_no_snapshot')) await env.DB.prepare('ALTER TABLE daily_room_revenue ADD COLUMN room_no_snapshot TEXT').run();
  if(!names.has('room_type_snapshot')) await env.DB.prepare('ALTER TABLE daily_room_revenue ADD COLUMN room_type_snapshot TEXT').run();
  if(!names.has('contract_rate_snapshot')) await env.DB.prepare('ALTER TABLE daily_room_revenue ADD COLUMN contract_rate_snapshot REAL').run();

  // Backfill one initial segment for legacy stays that have never used room transfer.
  await env.DB.prepare(`INSERT INTO stay_segments(stay_id,start_date,end_date,room_no,room_type,pricing_plan,contract_rate,allocation_method,created_at)
    SELECT s.id,s.check_in_date,NULL,s.room_no,s.room_type,s.pricing_plan,s.contract_rate,s.allocation_method,?
    FROM stays s
    WHERE NOT EXISTS(SELECT 1 FROM stay_segments sg WHERE sg.stay_id=s.id)`).bind(nowISO()).run();

  segmentSchemaReady=true;
}

async function segmentForDate(env, stay, date){
  await ensureSegmentSchema(env);
  const seg=await env.DB.prepare(`SELECT * FROM stay_segments
    WHERE stay_id=? AND start_date<=? AND (end_date IS NULL OR end_date>=?)
    ORDER BY start_date DESC,id DESC LIMIT 1`).bind(stay.id,date,date).first();
  return seg || {
    id:null, stay_id:stay.id, start_date:stay.check_in_date, end_date:null,
    room_no:stay.room_no, room_type:stay.room_type, pricing_plan:stay.pricing_plan,
    contract_rate:stay.contract_rate, allocation_method:stay.allocation_method
  };
}

async function log(env, action, entityType, entityId, detail='') {
  try { await env.DB.prepare('INSERT INTO audit_log(action,entity_type,entity_id,detail,created_at) VALUES(?,?,?,?,?)').bind(action,entityType,String(entityId ?? ''),detail,nowISO()).run(); } catch {}
}

async function getStay(env, id) {
  return await env.DB.prepare('SELECT * FROM stays WHERE id=?').bind(id).first();
}

async function financialSummary(env, stay, throughDate=todayVN()){
  await ensurePaymentSchema(env);
  if(stay.status==='active') await ensureLedgerThrough(minDate(throughDate,todayVN()));
  const room=(await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total,
      COALESCE(SUM(breakfast_amount),0) breakfast,
      COALESCE(SUM(net_room_amount),0) net_room
      FROM daily_room_revenue WHERE stay_id=? AND revenue_date<=?`).bind(stay.id,throughDate).first())||{};
  const svc=(await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total
      FROM services WHERE stay_id=? AND service_date<=?`).bind(stay.id,throughDate).first())||{};
  const pay=(await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total
      FROM payments WHERE stay_id=? AND payment_date<=?`).bind(stay.id,throughDate).first())||{};
  const roomTotal=num(room.total), serviceTotal=num(svc.total), paidTotal=num(pay.total);
  return {room_total:roomTotal,room_net:num(room.net_room),breakfast_total:num(room.breakfast),
    service_total:serviceTotal,charge_total:roomTotal+serviceTotal,paid_total:paidTotal,
    balance:(roomTotal+serviceTotal)-paidTotal};
}
async function updatePaymentStatus(env, stayId){
  const stay=await getStay(env,stayId); if(!stay) return;
  const f=await financialSummary(env,stay,todayVN());
  let status='Công nợ';
  if(f.paid_total>0 && f.balance>0) status='Đã thu một phần';
  if(f.paid_total>0 && f.balance<=0) status='Đã thanh toán';
  await env.DB.prepare('UPDATE stays SET payment_method=?,updated_at=? WHERE id=?').bind(status,nowISO(),stayId).run();
}

async function ensureLedgerThrough(env, throughDate) {
  if (!isDate(throughDate)) return;
  await ensureSegmentSchema(env);
  const stays = (await env.DB.prepare(`SELECT * FROM stays WHERE status IN ('active','checked_out') AND check_in_date <= ?`).bind(throughDate).all()).results || [];
  const closedRows = (await env.DB.prepare('SELECT report_date FROM day_closings WHERE report_date <= ?').bind(throughDate).all()).results || [];
  const closed = new Set(closedRows.map(r => r.report_date));
  const ts = nowISO();

  for (const stay of stays) {
    let start = stay.check_in_date;
    let end = throughDate;
    // Ngày checkout không thuộc Room Revenue; khoản thu checkout đi DailyPayment.
    if (stay.actual_check_out_date) end = minDate(end, addDays(stay.actual_check_out_date, -1));
    if (end < start) continue;

    let d = start;
    let guard = 0;
    while (d <= end && guard++ < 2000) {
      if (!closed.has(d)) {
        const seg = await segmentForDate(env, stay, d);
        const gross = dailyGross(seg, d);
        const sp = splitGross(stay, gross);
        await env.DB.prepare(`INSERT OR IGNORE INTO daily_room_revenue
          (stay_id,revenue_date,source_kind,amount,breakfast_amount,net_room_amount,base_daily_rate,pricing_plan,allocation_method,description,locked,created_at,
           segment_id,room_no_snapshot,room_type_snapshot,contract_rate_snapshot)
          VALUES(?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)`)
          .bind(
            stay.id,d,'accrual',gross,sp.breakfast,sp.netRoom,gross,seg.pricing_plan,seg.allocation_method,
            `Phân bổ ${seg.room_type||'hạng phòng'} · phòng ${seg.room_no}`,ts,
            seg.id,seg.room_no,seg.room_type,seg.contract_rate
          ).run();

        // Dòng legacy chưa có snapshot: bổ sung snapshot nếu ngày chưa khóa.
        await env.DB.prepare(`UPDATE daily_room_revenue
          SET segment_id=COALESCE(segment_id,?),room_no_snapshot=COALESCE(room_no_snapshot,?),
              room_type_snapshot=COALESCE(room_type_snapshot,?),contract_rate_snapshot=COALESCE(contract_rate_snapshot,?)
          WHERE stay_id=? AND revenue_date=? AND source_kind='accrual' AND locked=0`)
          .bind(seg.id,seg.room_no,seg.room_type,seg.contract_rate,stay.id,d).run();
      }
      d = addDays(d,1);
    }
  }
}

async function dailySummary(env, date) {
  await ensureLedgerThrough(env, date);
  const room = await env.DB.prepare(`SELECT
      COALESCE(SUM(CASE WHEN source_kind='accrual' THEN net_room_amount ELSE 0 END),0) room_base,
      COALESCE(SUM(CASE WHEN source_kind='adjustment' THEN net_room_amount ELSE 0 END),0) adjustment,
      COALESCE(SUM(breakfast_amount),0) breakfast,
      COALESCE(SUM(net_room_amount),0) room_net,
      COALESCE(SUM(amount),0) room_gross
    FROM daily_room_revenue WHERE revenue_date=?`).bind(date).first();
  await ensureServiceSchema(env);
  const svc = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total,
      COALESCE(SUM(CASE WHEN category IN ('pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small') THEN amount ELSE 0 END),0) pool_total,
      COALESCE(SUM(CASE WHEN category NOT IN ('pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small') THEN amount ELSE 0 END),0) other_total,
      COALESCE(SUM(CASE WHEN category='minibar' THEN amount ELSE 0 END),0) minibar,
      COALESCE(SUM(CASE WHEN category='laundry' THEN amount ELSE 0 END),0) laundry,
      COALESCE(SUM(CASE WHEN category='restaurant' THEN amount ELSE 0 END),0) restaurant,
      COALESCE(SUM(CASE WHEN category='extra_bed' THEN amount ELSE 0 END),0) extra_bed
    FROM services WHERE service_date=?`).bind(date).first();
  const closing = await env.DB.prepare('SELECT * FROM day_closings WHERE report_date=?').bind(date).first();
  const total = num(room?.room_gross) + num(svc?.total);
  return { date, room: room || {}, services: svc || {}, total, closing: closing || null };
}

async function monthSummary(env, ym) {
  const [y,m] = ym.split('-').map(Number);
  const start = `${y}-${String(m).padStart(2,'0')}-01`;
  const end = fmtDate(new Date(Date.UTC(y,m,0)));
  await ensureLedgerThrough(env, minDate(end, todayVN()));
  const r = await env.DB.prepare(`SELECT COALESCE(SUM(net_room_amount),0) room_net,
      COALESCE(SUM(breakfast_amount),0) breakfast,
      COALESCE(SUM(CASE WHEN source_kind='adjustment' THEN net_room_amount ELSE 0 END),0) adjustment,
      COALESCE(SUM(amount),0) room_gross
    FROM daily_room_revenue WHERE revenue_date BETWEEN ? AND ?`).bind(start,end).first();
  await ensureServiceSchema(env);
  const s = await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) service_total,
      COALESCE(SUM(CASE WHEN category IN ('pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small') THEN amount ELSE 0 END),0) pool_total,
      COALESCE(SUM(CASE WHEN category NOT IN ('pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small') THEN amount ELSE 0 END),0) other_total
    FROM services WHERE service_date BETWEEN ? AND ?`).bind(start,end).first();
  const total = num(r?.room_gross)+num(s?.service_total);
  return { start,end, room:r||{}, services:s||{}, total };
}

async function apiDashboard(request, env, url) {
  const date = isDate(url.searchParams.get('date')) ? url.searchParams.get('date') : todayVN();
  const ym = date.slice(0,7);
  const daily = await dailySummary(env,date);
  const month = await monthSummary(env,ym);
  const active = (await env.DB.prepare(`SELECT * FROM stays WHERE status='active' ORDER BY check_in_date DESC, id DESC LIMIT 100`).all()).results || [];
  const checkoutToday = (await env.DB.prepare(`SELECT COUNT(*) c FROM stays WHERE actual_check_out_date=? AND status='checked_out'`).bind(date).first())?.c || 0;
  const points=[];
  for(let i=6;i>=0;i--) { const d=addDays(date,-i); const ds=await dailySummary(env,d); points.push({date:d, room:num(ds.room.room_gross), service:num(ds.services.total), total:num(ds.total)}); }
  return json({ ok:true, date, daily, month, active_stays:active, active_count:active.length, checkout_today:checkoutToday, points });
}

async function apiStays(request, env, url) {
  if (request.method === 'GET') {
    await ensurePaymentSchema(env);
    await ensureLedgerThrough(todayVN());
    const status = clean(url.searchParams.get('status'),20);
    const q = clean(url.searchParams.get('q'),80);
    let sql=`SELECT s.*,
      COALESCE((SELECT SUM(r.amount) FROM daily_room_revenue r WHERE r.stay_id=s.id),0) room_total,
      COALESCE((SELECT SUM(v.amount) FROM services v WHERE v.stay_id=s.id),0) service_total,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.stay_id=s.id),0) paid_total
      FROM stays s WHERE 1=1`; const binds=[];
    if(status){ sql+=' AND s.status=?'; binds.push(status); }
    if(q){ sql+=' AND (s.guest_name LIKE ? OR s.room_no LIKE ? OR s.company_name LIKE ? OR s.code LIKE ?)'; const x=`%${q}%`; binds.push(x,x,x,x); }
    sql+=' ORDER BY CASE s.status WHEN \'active\' THEN 0 ELSE 1 END, s.check_in_date DESC, s.id DESC LIMIT 300';
    const rs=await env.DB.prepare(sql).bind(...binds).all();
    const rows=(rs.results||[]).map(r=>({...r,charge_total:num(r.room_total)+num(r.service_total),balance:num(r.room_total)+num(r.service_total)-num(r.paid_total)}));
    return json({ok:true, rows});
  }
  if (request.method === 'POST') {
    const b=await request.json();
    const guest=clean(b.guest_name,120), room=clean(b.room_no,30), ci=clean(b.check_in_date,10);
    if(!guest||!room||!isDate(ci)) return json({error:'Thiếu tên khách, số phòng hoặc ngày check-in.'},400);
    const plan=['daily','monthly','yearly'].includes(b.pricing_plan)?b.pricing_plan:'monthly';
    const alloc=['actual_month_days','fixed_30','fixed_365'].includes(b.allocation_method)?b.allocation_method:'actual_month_days';
    const ts=nowISO(), code=stayCode();
    const rs=await env.DB.prepare(`INSERT INTO stays(code,guest_name,company_name,room_no,room_type,check_in_date,expected_check_out_date,pricing_plan,contract_rate,allocation_method,fallback_daily_rate,breakfast_guests,breakfast_rate,payment_method,note,status,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'active',?,?)`)
      .bind(code,guest,clean(b.company_name,160),room,clean(b.room_type,80),ci,isDate(b.expected_check_out_date)?b.expected_check_out_date:null,plan,num(b.contract_rate),alloc,num(b.fallback_daily_rate),int(b.breakfast_guests),num(b.breakfast_rate,100000),clean(b.payment_method,60),clean(b.note,800),ts,ts).run();
    const id=rs.meta?.last_row_id;
    await ensureSegmentSchema(env);
    await env.DB.prepare(`INSERT INTO stay_segments(stay_id,start_date,end_date,room_no,room_type,pricing_plan,contract_rate,allocation_method,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)`)
      .bind(id,ci,null,room,clean(b.room_type,80),plan,num(b.contract_rate),alloc,ts).run();
    await ensurePaymentSchema(env);
    const initialAmount=num(b.initial_payment_amount);
    if(initialAmount>0){
      const kind=['deposit','payment'].includes(b.initial_payment_kind)?b.initial_payment_kind:'deposit';
      const method=['cash','transfer','card'].includes(b.initial_payment_method)?b.initial_payment_method:'cash';
      const pdate=isDate(b.initial_payment_date)?b.initial_payment_date:ci;
      await env.DB.prepare('INSERT INTO payments(stay_id,payment_date,payment_kind,amount,payment_method,note,created_at) VALUES(?,?,?,?,?,?,?)')
        .bind(id,pdate,kind,initialAmount,method,clean(b.initial_payment_note,300),nowISO()).run();
      await updatePaymentStatus(env,id);
    }
    await log(env,'create','stay',id,code);
    return json({ok:true,id,code});
  }
  return json({error:'Method not allowed'},405);
}

async function apiStayDetail(request, env, id) {
  const stay=await getStay(env,id); if(!stay) return json({error:'Không tìm thấy lưu trú.'},404);
  if(request.method==='GET') {
    await ensureSegmentSchema(env);
    const ledger=(await env.DB.prepare('SELECT * FROM daily_room_revenue WHERE stay_id=? ORDER BY revenue_date, id').bind(id).all()).results||[];
    const services=(await env.DB.prepare('SELECT * FROM services WHERE stay_id=? ORDER BY service_date,id').bind(id).all()).results||[];
    const segments=(await env.DB.prepare('SELECT * FROM stay_segments WHERE stay_id=? ORDER BY start_date,id').bind(id).all()).results||[];
    await ensurePaymentSchema(env);
    const payments=(await env.DB.prepare('SELECT * FROM payments WHERE stay_id=? ORDER BY payment_date,id').bind(id).all()).results||[];
    const financial=await financialSummary(env,stay,stay.actual_check_out_date||todayVN());
    return json({ok:true,stay,ledger,services,payments,segments,financial});
  }
  if(request.method==='PATCH') {
    const b=await request.json(); const ts=nowISO();
    await env.DB.prepare(`UPDATE stays SET guest_name=?,company_name=?,room_no=?,room_type=?,expected_check_out_date=?,pricing_plan=?,contract_rate=?,allocation_method=?,fallback_daily_rate=?,breakfast_guests=?,breakfast_rate=?,payment_method=?,note=?,updated_at=? WHERE id=?`)
      .bind(clean(b.guest_name||stay.guest_name,120),clean(b.company_name??stay.company_name,160),clean(b.room_no||stay.room_no,30),clean(b.room_type??stay.room_type,80),isDate(b.expected_check_out_date)?b.expected_check_out_date:null,['daily','monthly','yearly'].includes(b.pricing_plan)?b.pricing_plan:stay.pricing_plan,num(b.contract_rate,stay.contract_rate),['actual_month_days','fixed_30','fixed_365'].includes(b.allocation_method)?b.allocation_method:stay.allocation_method,num(b.fallback_daily_rate,stay.fallback_daily_rate),int(b.breakfast_guests,stay.breakfast_guests),num(b.breakfast_rate,stay.breakfast_rate),clean(b.payment_method??stay.payment_method,60),clean(b.note??stay.note,800),ts,id).run();
    await log(env,'update','stay',id,'Cập nhật thông tin lưu trú');
    return json({ok:true});
  }
  if(request.method==='DELETE') {
    if(!requirePin(request,env)) return json({error:'Sai PIN quản lý.'},401);
    const closed = await env.DB.prepare(`SELECT dc.report_date FROM daily_room_revenue r JOIN day_closings dc ON dc.report_date=r.revenue_date WHERE r.stay_id=? LIMIT 1`).bind(id).first();
    if(closed) return json({error:`Không thể xóa: lưu trú đã có doanh thu trong ngày ${closed.report_date} đã chốt.`},409);
    const svcClosed = await env.DB.prepare(`SELECT dc.report_date FROM services sv JOIN day_closings dc ON dc.report_date=sv.service_date WHERE sv.stay_id=? LIMIT 1`).bind(id).first();
    if(svcClosed) return json({error:`Không thể xóa: lưu trú có dịch vụ trong ngày ${svcClosed.report_date} đã chốt.`},409);
    await log(env,'delete','stay',id,JSON.stringify({code:stay.code,guest_name:stay.guest_name,room_no:stay.room_no}));
    await env.DB.prepare('DELETE FROM services WHERE stay_id=?').bind(id).run();
    await ensurePaymentSchema(env);
    await env.DB.prepare('DELETE FROM payments WHERE stay_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM daily_room_revenue WHERE stay_id=?').bind(id).run();
    await ensureSegmentSchema(env);
    await env.DB.prepare('DELETE FROM stay_segments WHERE stay_id=?').bind(id).run();
    await env.DB.prepare('DELETE FROM stays WHERE id=?').bind(id).run();
    return json({ok:true});
  }
  return json({error:'Method not allowed'},405);
}


async function apiTransferRoom(request, env, id) {
  if(request.method!=='POST') return json({error:'Method not allowed'},405);
  const stay=await getStay(env,id);
  if(!stay) return json({error:'Không tìm thấy lưu trú.'},404);
  if(stay.status!=='active') return json({error:'Chỉ chuyển phòng cho khách đang ở.'},409);

  const b=await request.json();
  const transferDate=clean(b.transfer_date,10);
  const newRoom=clean(b.new_room_no,30);
  const newType=clean(b.new_room_type,80);
  const newRate=num(b.new_contract_rate);

  if(!isDate(transferDate) || transferDate < stay.check_in_date || transferDate > todayVN())
    return json({error:'Ngày chuyển phòng không hợp lệ.'},400);
  if(!newRoom || !newType || newRate<=0)
    return json({error:'Cần nhập phòng mới, hạng phòng mới và giá hợp đồng mới.'},400);

  const closed=await env.DB.prepare('SELECT 1 x FROM day_closings WHERE report_date=?').bind(transferDate).first();
  if(closed) return json({error:'Ngày chuyển phòng đã chốt báo cáo. Không thể thay đổi hạng phòng của ngày đã chốt.'},409);

  await ensureSegmentSchema(env);

  const current=await segmentForDate(env,stay,transferDate);
  if(current && current.start_date===transferDate){
    return json({error:'Ngày này đã bắt đầu một chặng phòng. Hãy kiểm tra lịch sử chuyển phòng.'},409);
  }

  // Giữ nguyên toàn bộ số ngày lưu trú. Chỉ đóng chặng phòng cũ và mở chặng mới.
  await env.DB.prepare(`UPDATE stay_segments SET end_date=? WHERE stay_id=? AND start_date<? AND (end_date IS NULL OR end_date>=?)`)
    .bind(addDays(transferDate,-1),id,transferDate,transferDate).run();

  const rs=await env.DB.prepare(`INSERT INTO stay_segments
    (stay_id,start_date,end_date,room_no,room_type,pricing_plan,contract_rate,allocation_method,created_at)
    VALUES(?,?,?,?,?,?,?,?,?)`)
    .bind(id,transferDate,null,newRoom,newType,stay.pricing_plan,newRate,stay.allocation_method,nowISO()).run();

  // Snapshot các ngày trước chuyển phòng theo thông tin cũ nếu còn thiếu.
  await env.DB.prepare(`UPDATE daily_room_revenue
    SET room_no_snapshot=COALESCE(room_no_snapshot,?),room_type_snapshot=COALESCE(room_type_snapshot,?),
        contract_rate_snapshot=COALESCE(contract_rate_snapshot,?)
    WHERE stay_id=? AND revenue_date<? AND source_kind='accrual'`)
    .bind(stay.room_no,stay.room_type,stay.contract_rate,id,transferDate).run();

  // Ngày chuyển phòng trở đi phải tính theo hạng/giá mới; chỉ xóa dòng chưa khóa.
  await env.DB.prepare(`DELETE FROM daily_room_revenue
    WHERE stay_id=? AND revenue_date>=? AND source_kind='accrual' AND locked=0`).bind(id,transferDate).run();

  await env.DB.prepare(`UPDATE stays SET room_no=?,room_type=?,contract_rate=?,updated_at=? WHERE id=?`)
    .bind(newRoom,newType,newRate,nowISO(),id).run();

  await log(env,'room_transfer','stay',id,JSON.stringify({
    transfer_date:transferDate,
    from_room:stay.room_no,from_type:stay.room_type,from_rate:stay.contract_rate,
    to_room:newRoom,to_type:newType,to_rate:newRate,
    pricing_plan:stay.pricing_plan,allocation_method:stay.allocation_method
  }));

  await ensureLedgerThrough(env,todayVN());
  return json({ok:true,segment_id:rs.meta?.last_row_id,transfer_date:transferDate,new_room_no:newRoom,new_room_type:newType,new_contract_rate:newRate});
}


async function apiStayPayments(request, env, id) {
  const stay=await getStay(env,id);
  if(!stay) return json({error:'Không tìm thấy lưu trú.'},404);
  await ensurePaymentSchema(env);
  if(request.method==='GET'){
    const payments=(await env.DB.prepare('SELECT * FROM payments WHERE stay_id=? ORDER BY payment_date,id').bind(id).all()).results||[];
    const financial=await financialSummary(env,stay,stay.actual_check_out_date||todayVN());
    return json({ok:true,stay,payments,financial});
  }
  if(request.method==='POST'){
    if(stay.status!=='active') return json({error:'Khách đã checkout. Lễ tân không ghi nhận thêm khoản thu sau checkout.'},409);
    const b=await request.json();
    const date=clean(b.payment_date,10), amount=num(b.amount);
    const kind=['deposit','payment'].includes(b.payment_kind)?b.payment_kind:'payment';
    const method=['cash','transfer','card'].includes(b.payment_method)?b.payment_method:'cash';
    if(!isDate(date)||date<stay.check_in_date||date>todayVN()) return json({error:'Ngày thu tiền không hợp lệ.'},400);
    if(amount<=0) return json({error:'Số tiền thu phải lớn hơn 0.'},400);
    const rs=await env.DB.prepare(`INSERT INTO payments(stay_id,payment_date,payment_kind,amount,payment_method,note,created_at)
      VALUES(?,?,?,?,?,?,?)`).bind(id,date,kind,amount,method,clean(b.note,300),nowISO()).run();
    await updatePaymentStatus(env,id);
    await log(env,'payment','stay',id,JSON.stringify({payment_id:rs.meta?.last_row_id,date,kind,amount,method}));
    const fresh=await getStay(env,id);
    const financial=await financialSummary(env,fresh,todayVN());
    return json({ok:true,payment:{id:rs.meta?.last_row_id,payment_date:date,payment_kind:kind,amount,payment_method:method,note:clean(b.note,300)},financial});
  }
  return json({error:'Method not allowed'},405);
}
async function apiCheckoutPreview(request, env, id, url) {
  const stay=await getStay(env,id);
  if(!stay) return json({error:'Không tìm thấy lưu trú.'},404);
  if(stay.status!=='active') return json({error:'Khách đã checkout.'},409);
  const checkout=clean(url.searchParams.get('date'),10);
  const mode=clean(url.searchParams.get('mode'),30)||'contract';
  const fallback=num(url.searchParams.get('fallback_daily_rate'),stay.fallback_daily_rate);
  const custom=num(url.searchParams.get('custom_total'));
  if(!isDate(checkout)||checkout<stay.check_in_date||checkout>todayVN()) return json({error:'Ngày checkout không hợp lệ.'},400);
  await ensureLedgerThrough(addDays(checkout,-1));
  const recognizedRow=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total FROM daily_room_revenue
      WHERE stay_id=? AND revenue_date<? AND source_kind='accrual'`).bind(id,checkout).first();
  const recognized=num(recognizedRow?.total), nights=Math.max(0,diffDays(stay.check_in_date,checkout));
  let roomTarget=recognized;
  if(mode==='fallback_daily') roomTarget=nights*fallback;
  if(mode==='custom_total') roomTarget=custom;
  const adjustment=roomTarget-recognized;
  const svc=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total FROM services WHERE stay_id=? AND service_date<=?`).bind(id,checkout).first();
  const pay=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE stay_id=? AND payment_date<=?`).bind(id,checkout).first();
  const serviceTotal=num(svc?.total), paidTotal=num(pay?.total), grandTotal=roomTarget+serviceTotal;
  return json({ok:true,nights,recognized_room:recognized,room_target:roomTarget,adjustment,service_total:serviceTotal,grand_total:grandTotal,paid_total:paidTotal,remaining:grandTotal-paidTotal});
}
async function apiCheckout(request, env, id) {
  if(request.method!=='POST') return json({error:'Method not allowed'},405);
  const stay=await getStay(env,id); if(!stay) return json({error:'Không tìm thấy lưu trú.'},404);
  if(stay.status==='checked_out') return json({error:'Khách đã checkout.'},400);
  const b=await request.json(); const checkout=clean(b.actual_check_out_date,10);
  if(!isDate(checkout)||checkout<=stay.check_in_date) return json({error:'Ngày checkout không hợp lệ.'},400);
  if(checkout>todayVN()) return json({error:'Không thể checkout ở ngày tương lai.'},400);
  const mode=['contract','fallback_daily','custom_total'].includes(b.settlement_mode)?b.settlement_mode:'contract';
  await ensureLedgerThrough(env,addDays(checkout,-1));
  // Nếu trước đây đã sinh accrual đúng ngày checkout thì loại bỏ để tránh trùng DailyPayment.
  await env.DB.prepare(`DELETE FROM daily_room_revenue WHERE stay_id=? AND revenue_date=? AND source_kind='accrual' AND locked=0`).bind(id,checkout).run();
  const recognizedRow=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) gross, COALESCE(SUM(breakfast_amount),0) breakfast FROM daily_room_revenue WHERE stay_id=? AND revenue_date<?`).bind(id,checkout).first();
  const recognized=num(recognizedRow?.gross);
  const nights=Math.max(0,diffDays(stay.check_in_date,checkout));
  let target=recognized;
  if(mode==='fallback_daily') target=nights*num(b.fallback_daily_rate ?? stay.fallback_daily_rate);
  if(mode==='custom_total') target=num(b.custom_total);
  const adjustment=target-recognized;
  if(Math.abs(adjustment)>0.0001) {
    const closed=await env.DB.prepare('SELECT 1 x FROM day_closings WHERE report_date=?').bind(checkout).first();
    if(closed) return json({error:'Ngày checkout đã chốt báo cáo. Hãy checkout vào ngày đang mở hoặc mở quy trình điều chỉnh sau chốt.'},409);
    await env.DB.prepare(`INSERT INTO daily_room_revenue(stay_id,revenue_date,source_kind,amount,breakfast_amount,net_room_amount,base_daily_rate,pricing_plan,allocation_method,description,locked,created_at)
      VALUES(?,?,?,?,0,?,?,?,?,?,0,?)
      ON CONFLICT(stay_id,revenue_date,source_kind) DO UPDATE SET amount=excluded.amount,net_room_amount=excluded.net_room_amount,description=excluded.description`)
      .bind(id,checkout,'adjustment',adjustment,adjustment,0,stay.pricing_plan,stay.allocation_method,`Điều chỉnh checkout: ${mode}; ${nights} đêm; tổng quyết toán ${target.toFixed(0)}`,nowISO()).run();
  }
  await ensurePaymentSchema(env);
  const serviceRow=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total FROM services WHERE stay_id=? AND service_date<=?`).bind(id,checkout).first();
  const paidBeforeRow=await env.DB.prepare(`SELECT COALESCE(SUM(amount),0) total FROM payments WHERE stay_id=? AND payment_date<=?`).bind(id,checkout).first();
  const serviceTotal=num(serviceRow?.total), paidBefore=num(paidBeforeRow?.total);
  const grandTotal=target+serviceTotal, remainingBefore=grandTotal-paidBefore;
  const dpAmount=num(b.dailypayment_amount); let paymentId=null, dpMethod=null;
  if(dpAmount>0){
    dpMethod=['cash','transfer','card'].includes(b.dailypayment_method)?b.dailypayment_method:'cash';
    const prs=await env.DB.prepare('INSERT INTO payments(stay_id,payment_date,payment_kind,amount,payment_method,note,created_at) VALUES(?,?,?,?,?,?,?)')
      .bind(id,checkout,'dailypayment',dpAmount,dpMethod,clean(b.dailypayment_note,300),nowISO()).run();
    paymentId=prs.meta?.last_row_id;
  }
  await env.DB.prepare(`UPDATE stays SET actual_check_out_date=?,status='checked_out',payment_method=?,updated_at=? WHERE id=?`)
    .bind(checkout,(remainingBefore-dpAmount)<=0?'Đã thanh toán':'Còn công nợ khi checkout',nowISO(),id).run();
  await log(env,'checkout','stay',id,JSON.stringify({checkout,mode,nights,recognized,target,adjustment,serviceTotal,paidBefore,dpAmount}));
  return json({ok:true,nights,recognized,target,adjustment,service_total:serviceTotal,grand_total:grandTotal,paid_before:paidBefore,dailypayment:dpAmount,balance:grandTotal-paidBefore-dpAmount,payment_id:paymentId,payment_method:dpMethod});
}

async function apiServices(request, env, url) {
  await ensureServiceSchema(env);
  if(request.method==='GET') {
    const date=clean(url.searchParams.get('date'),10); const stayId=int(url.searchParams.get('stay_id'));
    let sql='SELECT s.*, st.guest_name FROM services s LEFT JOIN stays st ON st.id=s.stay_id WHERE 1=1'; const binds=[];
    if(isDate(date)){sql+=' AND s.service_date=?';binds.push(date);} if(stayId){sql+=' AND s.stay_id=?';binds.push(stayId);} sql+=' ORDER BY s.service_date DESC,s.id DESC LIMIT 500';
    const rs=await env.DB.prepare(sql).bind(...binds).all(); return json({ok:true,rows:rs.results||[]});
  }
  if(request.method==='POST') {
    const b=await request.json(); const date=clean(b.service_date,10), cat=clean(b.category,40);
    const qty=Math.max(0,num(b.quantity,1)), unit=Math.max(0,num(b.unit_price));
    const amount=Math.max(0,num(b.amount,qty*unit));
    if(!isDate(date)||!SERVICE_CATEGORIES.has(cat)||qty<=0||unit<0||amount<=0) return json({error:'Dữ liệu vé/dịch vụ không hợp lệ.'},400);
    const stayId=int(b.stay_id)||null; let room=clean(b.room_no,30);
    if(stayId){
      const st=await getStay(env,stayId);
      if(st){
        const seg=await segmentForDate(env,st,date);
        room=seg.room_no;
      }
    }
    const rs=await env.DB.prepare('INSERT INTO services(stay_id,service_date,room_no,category,quantity,unit_price,amount,note,payment_method,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(stayId,date,room,cat,qty,unit,amount,clean(b.note,500),clean(b.payment_method,60),nowISO()).run();
    await log(env,'create','service',rs.meta?.last_row_id,JSON.stringify({cat,qty,unit,amount})); return json({ok:true,id:rs.meta?.last_row_id});
  }
  return json({error:'Method not allowed'},405);
}

async function apiDailyReport(request, env, url) {
  const date=isDate(url.searchParams.get('date'))?url.searchParams.get('date'):todayVN();
  const roomType=clean(url.searchParams.get('room_type'),80);
  let rows;
  await ensureSegmentSchema(env);
  if(roomType){
    rows=(await env.DB.prepare(`SELECT r.*,s.code,s.guest_name,s.company_name,
      COALESCE(r.room_no_snapshot,s.room_no) room_no,
      COALESCE(r.room_type_snapshot,s.room_type) room_type,
      s.check_in_date,s.expected_check_out_date,s.actual_check_out_date,s.breakfast_guests,s.payment_method
      FROM daily_room_revenue r JOIN stays s ON s.id=r.stay_id
      WHERE r.revenue_date=? AND LOWER(TRIM(COALESCE(r.room_type_snapshot,s.room_type)))=LOWER(TRIM(?))
      ORDER BY COALESCE(r.room_no_snapshot,s.room_no),r.source_kind`).bind(date,roomType).all()).results||[];
  } else {
    rows=(await env.DB.prepare(`SELECT r.*,s.code,s.guest_name,s.company_name,
      COALESCE(r.room_no_snapshot,s.room_no) room_no,
      COALESCE(r.room_type_snapshot,s.room_type) room_type,
      s.check_in_date,s.expected_check_out_date,s.actual_check_out_date,s.breakfast_guests,s.payment_method
      FROM daily_room_revenue r JOIN stays s ON s.id=r.stay_id WHERE r.revenue_date=?
      ORDER BY COALESCE(r.room_no_snapshot,s.room_no),r.source_kind`).bind(date).all()).results||[];
  }
  const baseSummary=await dailySummary(env,date);
  const roomGross=rows.reduce((a,r)=>a+num(r.amount),0), breakfast=rows.reduce((a,r)=>a+num(r.breakfast_amount),0), roomNet=rows.reduce((a,r)=>a+num(r.net_room_amount),0), adjustment=rows.filter(r=>r.source_kind==='adjustment').reduce((a,r)=>a+num(r.net_room_amount),0);
  const summary=roomType?{...baseSummary,room:{...baseSummary.room,room_gross:roomGross,breakfast,room_net:roomNet,adjustment},total:roomGross+num(baseSummary.services.total)}:baseSummary;
  const services=(await env.DB.prepare(`SELECT sv.*,st.guest_name,st.company_name FROM services sv LEFT JOIN stays st ON st.id=sv.stay_id WHERE sv.service_date=? ORDER BY sv.room_no,sv.id`).bind(date).all()).results||[];
  return json({ok:true,summary,rows,services});
}

async function apiCloseDay(request, env) {
  if(request.method!=='POST') return json({error:'Method not allowed'},405);
  if(!requirePin(request,env)) return json({error:'Sai PIN quản lý.'},401);
  const b=await request.json(); const date=clean(b.report_date,10); if(!isDate(date)) return json({error:'Ngày không hợp lệ.'},400);
  const existing=await env.DB.prepare('SELECT * FROM day_closings WHERE report_date=?').bind(date).first(); if(existing) return json({error:'Ngày này đã chốt.'},409);
  const s=await dailySummary(env,date);
  await env.DB.prepare(`INSERT INTO day_closings(report_date,room_revenue,adjustment,service_revenue,total_revenue,closed_by,closed_at,note) VALUES(?,?,?,?,?,?,?,?)`)
    .bind(date,num(s.room.room_base),num(s.room.adjustment),num(s.services.total)+num(s.room.breakfast),num(s.total),clean(b.closed_by,80),nowISO(),clean(b.note,500)).run();
  await env.DB.prepare('UPDATE daily_room_revenue SET locked=1 WHERE revenue_date=?').bind(date).run();
  await log(env,'close_day','report',date,`Total ${s.total}`); return json({ok:true,summary:s});
}

async function apiMonthReport(request, env, url) {
  const ym=/^\d{4}-\d{2}$/.test(url.searchParams.get('month')||'')?url.searchParams.get('month'):todayVN().slice(0,7);
  const summary=await monthSummary(env,ym);
  const daily=(await env.DB.prepare(`WITH d AS (
      SELECT revenue_date date, SUM(amount) room_gross, SUM(net_room_amount) room_net, SUM(breakfast_amount) breakfast,
      SUM(CASE WHEN source_kind='adjustment' THEN net_room_amount ELSE 0 END) adjustment
      FROM daily_room_revenue WHERE revenue_date BETWEEN ? AND ? GROUP BY revenue_date),
    s AS (SELECT service_date date,SUM(amount) service_total,
      SUM(CASE WHEN category IN ('pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small') THEN amount ELSE 0 END) pool_total,
      SUM(CASE WHEN category NOT IN ('pool_vbn','pool_vbl','pool_vbt_large','pool_vbt_small') THEN amount ELSE 0 END) other_service_total
      FROM services WHERE service_date BETWEEN ? AND ? GROUP BY service_date)
    SELECT COALESCE(d.date,s.date) date,COALESCE(d.room_gross,0) room_gross,COALESCE(d.room_net,0) room_net,COALESCE(d.breakfast,0) breakfast,COALESCE(d.adjustment,0) adjustment,COALESCE(s.service_total,0) service_total,COALESCE(s.pool_total,0) pool_total,COALESCE(s.other_service_total,0) other_service_total
    FROM d LEFT JOIN s ON s.date=d.date
    UNION ALL
    SELECT s.date,0,0,0,0,s.service_total,s.pool_total,s.other_service_total FROM s LEFT JOIN d ON d.date=s.date WHERE d.date IS NULL
    ORDER BY date`).bind(summary.start,summary.end,summary.start,summary.end).all()).results||[];
  return json({ok:true,month:ym,summary,daily});
}

async function apiExportDaily(env, url) {
  const date=isDate(url.searchParams.get('date'))?url.searchParams.get('date'):todayVN();
  const roomType=clean(url.searchParams.get('room_type'),80);
  await ensureSegmentSchema(env);
  let sql=`SELECT COALESCE(r.room_no_snapshot,s.room_no) room_no,
    COALESCE(r.room_type_snapshot,s.room_type) room_type,
    s.guest_name,s.company_name,s.check_in_date,s.actual_check_out_date,
    r.source_kind,r.amount,r.breakfast_amount,r.net_room_amount,r.description
    FROM daily_room_revenue r JOIN stays s ON s.id=r.stay_id WHERE r.revenue_date=?`;
  const binds=[date];
  if(roomType){sql+=' AND LOWER(TRIM(COALESCE(r.room_type_snapshot,s.room_type)))=LOWER(TRIM(?))';binds.push(roomType);}
  sql+=' ORDER BY COALESCE(r.room_no_snapshot,s.room_no),r.source_kind';
  const rows=(await env.DB.prepare(sql).bind(...binds).all()).results||[];
  const esc=v=>`"${String(v??'').replaceAll('"','""')}"`;
  const lines=[['Phòng','Loại phòng','Khách','Công ty','Check-in','Checkout','Loại dòng','Tổng phân bổ','Điểm tâm','DTKS','Ghi chú'].map(esc).join(',')];
  for(const r of rows) lines.push([r.room_no,r.room_type,r.guest_name,r.company_name,r.check_in_date,r.actual_check_out_date,r.source_kind,r.amount,r.breakfast_amount,r.net_room_amount,r.description].map(esc).join(','));
  return new Response('\uFEFF'+lines.join('\r\n'),{headers:{'content-type':'text/csv; charset=utf-8','content-disposition':`attachment; filename="bao-cao-doanh-thu-${date}.csv"`}});
}

async function route(request, env) {
  const url=new URL(request.url); const p=url.pathname;
  if(p==='/api/dashboard') return apiDashboard(request,env,url);
  if(p==='/api/stays') return apiStays(request,env,url);
  let m=p.match(/^\/api\/stays\/(\d+)\/payments$/); if(m) return apiStayPayments(request,env,int(m[1]));
  m=p.match(/^\/api\/stays\/(\d+)\/checkout-preview$/); if(m) return apiCheckoutPreview(request,env,int(m[1]),url);
  m=p.match(/^\/api\/stays\/(\d+)\/transfer-room$/); if(m) return apiTransferRoom(request,env,int(m[1]));
  m=p.match(/^\/api\/stays\/(\d+)\/checkout$/); if(m) return apiCheckout(request,env,int(m[1]));
  m=p.match(/^\/api\/stays\/(\d+)$/); if(m) return apiStayDetail(request,env,int(m[1]));
  if(p==='/api/services') return apiServices(request,env,url);
  if(p==='/api/reports/daily') return apiDailyReport(request,env,url);
  if(p==='/api/reports/month') return apiMonthReport(request,env,url);
  if(p==='/api/reports/close-day') return apiCloseDay(request,env);
  if(p==='/api/reports/daily.csv') return apiExportDaily(env,url);
  if(p==='/api/health') return json({ok:true,date:todayVN()});
  return env.ASSETS.fetch(request);
}

export default {
  async fetch(request, env) {
    try { return await route(request,env); }
    catch(e){ console.error(e); return json({error:e?.message||String(e)},500); }
  }
};
