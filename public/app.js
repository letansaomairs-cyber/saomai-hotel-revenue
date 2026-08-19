const $=s=>document.querySelector(s), $$=s=>[...document.querySelectorAll(s)];
const fmt=n=>new Intl.NumberFormat('vi-VN',{maximumFractionDigits:0}).format(Number(n||0))+' đ';
const esc=s=>String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Ho_Chi_Minh'}).format(new Date());
const monthNow=()=>today().slice(0,7);
const toast=(m,error=false)=>{const t=$('#toast');t.textContent=m;t.className='toast show'+(error?' error':'');setTimeout(()=>t.className='toast',3000)};
async function api(path,opt={}){const r=await fetch(path,opt);let d;try{d=await r.json()}catch{d={error:await r.text()}}if(!r.ok)throw new Error(d.error||'Có lỗi xảy ra');return d}

function isoToDMY(v){const m=String(v||'').match(/^(\d{4})-(\d{2})-(\d{2})$/);return m?`${m[3]}/${m[2]}/${m[1]}`:''}
function dmyToISO(v){const m=String(v||'').trim().match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{4})$/);if(!m)return '';const d=Number(m[1]),mo=Number(m[2]),y=Number(m[3]);const dt=new Date(Date.UTC(y,mo-1,d));if(dt.getUTCFullYear()!==y||dt.getUTCMonth()!==mo-1||dt.getUTCDate()!==d)return '';return `${String(y).padStart(4,'0')}-${String(mo).padStart(2,'0')}-${String(d).padStart(2,'0')}`}
function fmtDate(v){return isoToDMY(v)||String(v||'-')}
function syncDateProxy(source){if(!source)return;const proxy=source.closest('.date-field')?.querySelector('.date-display');if(proxy)proxy.value=isoToDMY(source.value)}
function setDateValue(source,iso){if(source){source.value=iso||'';syncDateProxy(source)}}
function enhanceDateInputs(){
  $$('input[type="date"]').forEach(source=>{
    if(source.dataset.enhancedDate==='1')return;source.dataset.enhancedDate='1';
    const wrap=document.createElement('span');wrap.className='date-field';source.parentNode.insertBefore(wrap,source);wrap.appendChild(source);source.classList.add('native-date-source');
    const proxy=document.createElement('input');proxy.type='text';proxy.className='date-display';proxy.placeholder='dd/mm/yyyy';proxy.autocomplete='off';
    const cal=document.createElement('button');cal.type='button';cal.className='date-picker-btn';cal.setAttribute('aria-label','Mở lịch');cal.textContent='▣';
    wrap.insertBefore(proxy,source);wrap.appendChild(cal);
    const applyText=()=>{const raw=proxy.value.trim();if(!raw){source.value='';proxy.classList.remove('date-invalid');return true}const iso=dmyToISO(raw);if(!iso){proxy.classList.add('date-invalid');return false}proxy.classList.remove('date-invalid');source.value=iso;return true};
    proxy.addEventListener('blur',()=>{if(!applyText())syncDateProxy(source)});proxy.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();applyText();proxy.blur()}});
    source.addEventListener('change',()=>syncDateProxy(source));
    cal.addEventListener('click',()=>{applyText();try{source.showPicker?source.showPicker():source.click()}catch{source.click()}});
    syncDateProxy(source);
  })
}

const titles={dashboard:['Dashboard','Tổng quan doanh thu khách sạn'],stays:['Khách đang ở','Quản lý lưu trú và quyết toán'], 'new-stay':['Tạo lưu trú','Khách ngày, tháng hoặc năm'], 'daily-report':['Doanh thu theo ngày','Báo cáo ngày và khóa số liệu'],services:['Dịch vụ phát sinh','Vé bơi, golf, tennis, minibar, laundry...'],'month-report':['Báo cáo tháng','Lũy kế doanh thu theo tháng']};
function go(view){$$('.view').forEach(x=>x.classList.remove('active'));$(`#view-${view}`).classList.add('active');$$('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.view===view));$('#page-title').textContent=titles[view][0];$('#page-subtitle').textContent=titles[view][1]; if(view==='dashboard')loadDashboard(); if(view==='stays')loadStays(); if(view==='services')loadServices(); if(view==='daily-report')loadDaily(); if(view==='month-report')loadMonth();}
$$('.nav-item').forEach(b=>b.onclick=()=>go(b.dataset.view));$$('[data-go]').forEach(b=>b.onclick=()=>go(b.dataset.go));

$('#global-date').value=today();$('#report-date').value=today();$('#month-input').value=monthNow();$('#service-form [name=service_date]').value=today();$('#stay-form [name=check_in_date]').value=today();$('#stay-form [name=initial_payment_date]').value=today();enhanceDateInputs();$('#refresh-btn').onclick=()=>{const active=$('.nav-item.active')?.dataset.view||'dashboard';go(active)};

function planName(p){return p==='monthly'?'Tháng':p==='yearly'?'Năm':'Ngày'}
const SERVICE_LABELS={pool_vbn:'Vé bơi ngày - VBN',pool_vbl:'Vé bơi ngày - VBL',pool_vbt_large:'Vé bơi ngày - VBT lớn',pool_vbt_small:'Vé bơi ngày - VBT nhỏ',golf_ticket:'Vé Golf',swim_lesson:'Vé học bơi',gym_month:'Vé Gym tháng',tennis_day:'Tennis ngày',minibar:'Minibar',laundry:'Laundry',restaurant:'Restaurant',extra_bed:'Extra Bed',others:'Khác'};
const serviceLabel=k=>SERVICE_LABELS[k]||k||'-';
async function loadDashboard(){try{const d=await api('/api/dashboard?date='+$('#global-date').value);$('#kpi-room').textContent=fmt(d.daily.room.room_gross);$('#kpi-net-room').textContent=fmt(d.daily.room.room_net);$('#kpi-breakfast').textContent=fmt(d.daily.room.breakfast);$('#kpi-service').textContent=fmt(d.daily.services.total);$('#kpi-total').textContent=fmt(d.daily.total);$('#kpi-adjustment').textContent='Điều chỉnh: '+fmt(d.daily.room.adjustment);$('#month-room').textContent=fmt(d.month.room.room_gross);$('#month-service').textContent=fmt(d.month.services.service_total);$('#month-total').textContent=fmt(d.month.total);$('#dash-stays').innerHTML=(d.active_stays||[]).slice(0,8).map(r=>`<tr><td><b>${esc(r.room_no)}</b></td><td>${esc(r.guest_name)}<br><small>${esc(r.company_name)}</small></td><td>${planName(r.pricing_plan)}</td><td>${fmtDate(r.check_in_date)}</td><td>${fmtDate(r.expected_check_out_date)}</td><td>${fmt(r.contract_rate)}</td><td>${fmt(r.fallback_daily_rate)}</td></tr>`).join('')||'<tr><td colspan=7>Chưa có khách đang ở.</td></tr>';renderBars(d.points||[])}catch(e){toast(e.message,true)}}
function renderBars(points){const max=Math.max(1,...points.map(p=>p.total));$('#mini-chart').innerHTML=points.map(p=>`<div class="bar-group"><div class="bar room" title="Phòng ${fmt(p.room)}" style="height:${Math.max(2,p.room/max*210)}px"></div><div class="bar service" title="Dịch vụ ${fmt(p.service)}" style="height:${Math.max(2,p.service/max*210)}px"></div><span class="bar-label">${p.date.slice(5)}</span></div>`).join('')}

$('#stay-form').onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;const b=Object.fromEntries(new FormData(form));try{const d=await api('/api/stays',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});toast('Đã tạo lưu trú '+d.code);form.reset();setDateValue(form.querySelector('[name=check_in_date]'),today());setDateValue(form.querySelector('[name=initial_payment_date]'),today());form.querySelector('[name=breakfast_guests]').value=0;form.querySelector('[name=breakfast_rate]').value=100000;go('stays')}catch(err){toast(err.message,true)}};
$('#stay-form').addEventListener('reset',()=>setTimeout(()=>{$$('#stay-form input[type="date"]').forEach(syncDateProxy)},0));
$('#stay-refresh').onclick=loadStays;$('#stay-status').onchange=loadStays;let searchTimer;$('#stay-search').oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(loadStays,300)};
async function loadStays(){try{const q=encodeURIComponent($('#stay-search').value||''),st=encodeURIComponent($('#stay-status').value||'');const d=await api(`/api/stays?status=${st}&q=${q}`);$('#stays-body').innerHTML=(d.rows||[]).map(r=>`<tr><td><b>${esc(r.code)}</b><br><small>ID ${r.id}</small></td><td><b>${esc(r.room_no)}</b><br><small>${esc(r.room_type)}</small></td><td>${esc(r.guest_name)}<br><small>${esc(r.company_name)}</small></td><td>${planName(r.pricing_plan)}<br><b>${fmt(r.contract_rate)}</b></td><td>${fmtDate(r.check_in_date)}</td><td>${fmtDate(r.expected_check_out_date)}</td><td><span class="badge ${r.status}">${r.status==='active'?'Đang ở':'Đã checkout'}</span></td><td><div class="action-stack">${r.status==='active'?`<button class="btn gold transfer-btn" data-id="${r.id}" data-room="${esc(r.room_no)}" data-room-type="${esc(r.room_type)}" data-rate="${r.contract_rate}" data-guest="${esc(r.guest_name)}" data-plan="${r.pricing_plan}">Chuyển phòng</button><button class="btn primary checkout-btn" data-id="${r.id}" data-room="${esc(r.room_no)}" data-guest="${esc(r.guest_name)}" data-fallback="${r.fallback_daily_rate}">Checkout</button>`:''}<button class="btn danger delete-stay-btn" data-id="${r.id}" data-code="${esc(r.code)}" data-room="${esc(r.room_no)}" data-guest="${esc(r.guest_name)}">Xóa</button></div></td></tr>`).join('')||'<tr><td colspan=8>Không có dữ liệu.</td></tr>';$$('.transfer-btn').forEach(b=>b.onclick=()=>openTransfer(b));$$('.checkout-btn').forEach(b=>b.onclick=()=>openCheckout(b));$$('.delete-stay-btn').forEach(b=>b.onclick=()=>deleteStay(b))}catch(e){toast(e.message,true)}}
function openTransfer(b){
  const f=$('#transfer-form');
  f.stay_id.value=b.dataset.id;
  setDateValue(f.transfer_date,today());
  f.new_room_no.value='';
  f.new_room_type.value='';
  f.new_contract_rate.value=b.dataset.rate||0;
  $('#transfer-guest').textContent=`${b.dataset.guest} · hiện tại ${b.dataset.room} · ${b.dataset.roomType||'-'}`;
  $('#transfer-plan-note').textContent=b.dataset.plan==='monthly'
    ? 'Khách tháng: số ngày ở được nối liên tục. Chặng phòng mới tính theo giá tháng của hạng phòng mới; không đổi sang giá ngày chỉ vì chuyển phòng.'
    : 'Chuyển phòng không tạo booking mới và không reset số ngày lưu trú.';
  $('#transfer-dialog').showModal();
}
$('#transfer-submit').onclick=async e=>{
  e.preventDefault();
  const f=$('#transfer-form'),b=Object.fromEntries(new FormData(f));
  try{
    await api(`/api/stays/${b.stay_id}/transfer-room`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});
    $('#transfer-dialog').close();
    toast('Đã chuyển phòng và giữ liên tục kỳ lưu trú.');
    loadStays(); loadDaily(); loadDashboard();
  }catch(err){toast(err.message,true)}
};

async function deleteStay(b){if(!confirm(`Xóa lưu trú ${b.dataset.code} - ${b.dataset.guest} - phòng ${b.dataset.room}?\n\nChỉ dùng cho dữ liệu nhập nháp/sai. Dữ liệu ngày đã chốt sẽ không cho xóa.`))return;const pin=prompt('Nhập PIN quản lý để xóa:');if(pin===null)return;try{await api(`/api/stays/${b.dataset.id}`,{method:'DELETE',headers:{'x-admin-pin':pin}});toast('Đã xóa lưu trú nhập nháp.');loadStays();loadDashboard()}catch(e){toast(e.message,true)}}
function openCheckout(b){const f=$('#checkout-form');f.stay_id.value=b.dataset.id;setDateValue(f.actual_check_out_date,today());f.fallback_daily_rate.value=b.dataset.fallback||0;$('#checkout-guest').textContent=`${b.dataset.guest} · Phòng ${b.dataset.room}`;$('#checkout-dialog').showModal();toggleSettlement()}
function toggleSettlement(){const m=$('#settlement-mode').value;$('#fallback-wrap').classList.toggle('hidden',m!=='fallback_daily');$('#custom-wrap').classList.toggle('hidden',m!=='custom_total')}
$('#settlement-mode').onchange=toggleSettlement;
$('#checkout-submit').onclick=async e=>{e.preventDefault();const f=$('#checkout-form'),b=Object.fromEntries(new FormData(f));const id=b.stay_id;try{const d=await api(`/api/stays/${id}/checkout`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});$('#checkout-dialog').close();toast(`Checkout xong. Adjustment: ${fmt(d.adjustment)}`);loadStays()}catch(err){toast(err.message,true)}};

const serviceForm=$('#service-form');
function calcServiceAmount(){const q=Number(serviceForm.quantity.value||0),p=Number(serviceForm.unit_price.value||0);serviceForm.amount.value=Math.round(q*p)}
serviceForm.quantity.oninput=calcServiceAmount;serviceForm.unit_price.oninput=calcServiceAmount;calcServiceAmount();
serviceForm.onsubmit=async e=>{e.preventDefault();const form=e.currentTarget;calcServiceAmount();const b=Object.fromEntries(new FormData(form));try{await api('/api/services',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b)});toast('Đã ghi nhận vé/dịch vụ');form.reset();setDateValue(form.querySelector('[name=service_date]'),today());form.querySelector('[name=quantity]').value=1;calcServiceAmount();loadServices()}catch(err){toast(err.message,true)}};
async function loadServices(){try{const date=$('#global-date').value||today();const d=await api('/api/services?date='+date);$('#service-list').innerHTML=(d.rows||[]).map(r=>`<tr><td>${esc(r.room_no||'-')}<br><small>${esc(r.guest_name||'')}</small></td><td>${esc(serviceLabel(r.category))}</td><td>${Number(r.quantity||1)}</td><td>${fmt(r.unit_price||r.amount)}</td><td><b>${fmt(r.amount)}</b></td><td>${esc(r.payment_method||'-')}</td><td>${esc(r.note)}</td></tr>`).join('')||'<tr><td colspan=7>Chưa có vé/dịch vụ.</td></tr>'}catch(e){toast(e.message,true)}}

$('#load-daily').onclick=loadDaily;$('#export-daily').onclick=()=>{location.href='/api/reports/daily.csv?date='+$('#report-date').value+'&room_type='+encodeURIComponent($('#report-room-type').value||'')};
async function loadDaily(){try{const rt=$('#report-room-type').value||'';const d=await api('/api/reports/daily?date='+$('#report-date').value+'&room_type='+encodeURIComponent(rt));const s=d.summary;$('#r-net').textContent=fmt(s.room.room_net);$('#r-breakfast').textContent=fmt(s.room.breakfast);$('#r-adj').textContent=fmt(s.room.adjustment);$('#r-pool').textContent=fmt(s.services.pool_total);$('#r-svc').textContent=fmt(s.services.other_total);$('#r-total').textContent=fmt(s.total);const c=$('#closing-badge');if(s.closing){c.classList.remove('hidden');c.textContent=`✓ Đã chốt lúc ${s.closing.closed_at} · ${s.closing.closed_by||'Quản lý'} · Tổng ${fmt(s.closing.total_revenue)}`}else c.classList.add('hidden');$('#daily-body').innerHTML=(d.rows||[]).map(r=>`<tr><td><b>${esc(r.room_no)}</b></td><td>${esc(r.guest_name)}<br><small>${esc(r.company_name)}</small></td><td>${esc(r.room_type)}</td><td><span class="badge ${r.source_kind}">${r.source_kind==='adjustment'?'Adjustment':'Doanh thu ngày'}</span></td><td>${fmt(r.amount)}</td><td>${fmt(r.breakfast_amount)}</td><td><b>${fmt(r.net_room_amount)}</b></td><td>${esc(r.description)}</td></tr>`).join('')||'<tr><td colspan=8>Không có doanh thu phòng ngày này.</td></tr>';$('#daily-services-body').innerHTML=(d.services||[]).map(r=>`<tr><td>${esc(r.room_no||'-')}</td><td>${esc(r.guest_name||'-')}</td><td>${esc(serviceLabel(r.category))}</td><td>${Number(r.quantity||1)}</td><td>${fmt(r.unit_price||r.amount)}</td><td><b>${fmt(r.amount)}</b></td><td>${esc(r.payment_method||'-')}</td><td>${esc(r.note||'')}</td></tr>`).join('')||'<tr><td colspan=8>Không có vé/dịch vụ trong ngày.</td></tr>'}catch(e){toast(e.message,true)}}
$('#close-day-btn').onclick=async()=>{if(!confirm('Chốt ngày này? Sau khi chốt, doanh thu phòng ngày đó sẽ bị khóa.'))return;const b={report_date:$('#report-date').value,closed_by:$('#closed-by').value};try{await api('/api/reports/close-day',{method:'POST',headers:{'content-type':'application/json','x-admin-pin':$('#close-pin').value},body:JSON.stringify(b)});toast('Đã chốt báo cáo ngày');loadDaily()}catch(e){toast(e.message,true)}};

$('#load-month').onclick=loadMonth;async function loadMonth(){try{const d=await api('/api/reports/month?month='+$('#month-input').value);$('#m-room').textContent=fmt(d.summary.room.room_gross);$('#m-net').textContent=fmt(d.summary.room.room_net);$('#m-breakfast').textContent=fmt(d.summary.room.breakfast);$('#m-pool').textContent=fmt(d.summary.services.pool_total);$('#m-svc').textContent=fmt(d.summary.services.other_total);$('#m-total').textContent=fmt(d.summary.total);$('#month-body').innerHTML=(d.daily||[]).map(r=>`<tr><td>${fmtDate(r.date)}</td><td>${fmt(r.room_gross)}</td><td>${fmt(r.room_net)}</td><td>${fmt(r.breakfast)}</td><td>${fmt(r.adjustment)}</td><td>${fmt(r.pool_total)}</td><td>${fmt(r.other_service_total)}</td><td><b>${fmt(Number(r.room_gross)+Number(r.service_total))}</b></td></tr>`).join('')||'<tr><td colspan=8>Chưa có dữ liệu.</td></tr>'}catch(e){toast(e.message,true)}}

loadDashboard();
