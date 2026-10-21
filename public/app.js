const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const mask = k => '••••' + String(k).slice(-4);
let toastT = null;
function toast(msg, kind) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; document.body.appendChild(el); }
  el.textContent = msg;
  el.classList.toggle('err', kind === 'err');
  el.classList.add('on');
  clearTimeout(toastT);
  toastT = setTimeout(() => el.classList.remove('on'), kind === 'err' ? 6000 : 3000);
}
// 실패를 삼키면 "저장이 안 됐다"가 원인도 없이 되풀이된다 → 상태 코드와 오류 메시지를 보여준다
async function api(m, u, b) {
  let r, d = {};
  try {
    r = await fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined });
    d = await r.json().catch(() => ({}));
  } catch { toast('서버에 연결할 수 없습니다. npm start가 실행 중인지 확인하세요.', 'err'); return { error: '연결 실패' }; }
  if (!r.ok) {
    const msg = d.error || `HTTP ${r.status}`;
    toast(`${m} ${u} 실패 · ${msg}`, 'err');
    return { ...d, error: msg };
  }
  return d;
}
let S = null, tab = 'office', chan = 'general';
const screens = {};
const emp = id => S.employees.find(e => e.id === id);
const nm = id => id === 'user' ? S.user.name : id === 'system' ? '시스템' : (emp(id)?.name || '?');
const col = id => id === 'user' ? '#111' : (emp(id)?.color || '#999');
const dm = (a, b) => 'dm:' + [a, b].sort().join(':');
const time = ts => new Date(ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
const dt = ts => new Date(ts).toLocaleString('ko-KR', { hour12: false });
const dnum = ts => { const d = new Date(ts), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}.${p(d.getMonth() + 1)}.${p(d.getDate())}`; };
const MODEL = m => String(m).replace(/^claude-/, 'Claude ').replace(/-\d{8}$/, '').replace(/^gpt-/, 'GPT-').replace(/^gemini-/, 'Gemini ')
  .replace(/-(\d)-(\d)/, ' $1.$2').replace(/-/g, ' ').replace(/\b(opus|sonnet|haiku|flash|pro|mini)\b/g, w => w[0].toUpperCase() + w.slice(1));
const provs = () => S.catalog?.providers || {};
const provLabel = id => provs()[id]?.label || id;
const keyHint = id => provs()[id]?.keyOptional ? '키 불필요 · 필요하면 입력' : '비워 두면 전역 기본 키 사용';
const providerOptions = sel => (S.catalog?.providerGroups || []).map(([g, gl]) => {
  const ids = Object.entries(provs()).filter(([, p]) => p.group === g).map(([id]) => id);
  return ids.length ? `<optgroup label="${esc(gl)}">${ids.map(id => `<option value="${id}"${id === sel ? ' selected' : ''}>${esc(provs()[id].label)}</option>`).join('')}</optgroup>` : '';
}).join('');
const TOOLS = { web: '웹 검색', browser: 'Playwright', computer: '컴퓨터 유즈', mcp: 'MCP' };
const appCfg = () => S.settings.app || {};
const mcpServers = () => Object.keys(S.mcpStatus || {});
const keyBadge = e => e.hasKey ? '<span class="chip">개인 키</span>'
  : e.usingGlobalKey ? '<span class="chip">전역 키</span>' : '<span class="chip warn-chip">키 없음</span>';
const toolChips = e => {
  const t = e.tools || {}, out = [];
  if (t.web) out.push(TOOLS.web);
  if (t.browser) out.push(TOOLS.browser);
  if (t.computer) out.push(appCfg().computerEnabled ? TOOLS.computer : '컴퓨터 유즈(전역 꺼짐)');
  if (t.mcp === 'all') out.push('MCP 전체');
  else if (Array.isArray(t.mcp) && t.mcp.length) out.push('MCP ' + t.mcp.join(', '));
  return out.map(x => `<span class="chip">${esc(x)}</span>`).join('');
};

// ---------- 아이콘 ----------
const ICONS = {
  office: '<path d="M6 21V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v16"/><path d="M3.5 21h17"/><path d="M10 7.5h1M13.5 7.5h1M10 11.5h1M13.5 11.5h1M10 15.5h1M13.5 15.5h1"/>',
  tasks: '<rect x="5" y="5" width="14" height="16" rx="2"/><path d="M9 5V3.5h6V5"/><path d="M8.5 13.2l2.2 2.2 4.4-4.6"/>',
  chat: '<path d="M20 11.8a7.6 7.6 0 0 1-11 6.8L5 19.5l1-3.6A7.6 7.6 0 1 1 20 11.8Z"/>',
  org: '<circle cx="9.2" cy="8" r="3.2"/><path d="M3.6 20c0-3.3 2.5-5.7 5.6-5.7s5.6 2.4 5.6 5.7"/><path d="M16.2 5.3a3.3 3.3 0 0 1 0 5.4M17.8 15c2 .8 3.4 2.8 3.4 5"/>',
  settings: '<circle cx="8.8" cy="8.8" r="3.7"/><path d="M11.5 11.5 20 20"/><path d="M15.3 15.3l1.8-1.8M17.6 17.6l1.7-1.7"/>',
  play: '<path d="M8 5.4v13.2L19 12Z"/>',
  pause: '<path d="M9.4 5.4v13.2M14.6 5.4v13.2"/>',
  send: '<path d="M4 12 20 4.4l-4.4 15.2-3.6-6.3Z"/><path d="M11.8 13.4 20 4.4"/>',
  plus: '<path d="M12 5.4v13.2M5.4 12h13.2"/>',
  save: '<path d="M5.4 6.4a1 1 0 0 1 1-1h8.2l4 4v8.2a1 1 0 0 1-1 1H6.4a1 1 0 0 1-1-1Z"/><path d="M8.6 5.4v3.8h5.4"/><path d="M8.6 13.6h6.8v4.8H8.6Z"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V4.8h5V7"/><path d="M6.6 7l1 12.6h8.8L17.4 7"/><path d="M10.2 10.4v6M13.8 10.4v6"/>',
  close: '<path d="M6.4 6.4 17.6 17.6M17.6 6.4 6.4 17.6"/>',
  pencil: '<path d="M4.4 19.6h3.9L20 7.9a2.1 2.1 0 0 0-3-3L5.3 16.5Z"/><path d="M15.4 6.6 18.5 9.7"/>',
  search: '<circle cx="11" cy="11" r="6"/><path d="M15.4 15.4 20 20"/>',
  plug: '<path d="M9 3.4v5.1M15 3.4v5.1"/><path d="M6.4 8.5h11.2v3a5.6 5.6 0 0 1-11.2 0Z"/><path d="M12 17.1v3.5"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.7-6"/><path d="M20 4.6V10h-5.4"/>',
  camera: '<path d="M3.4 9h3.1l1.8-2.6h7.4L17.5 9h3.1v10.6H3.4Z"/><circle cx="12" cy="14" r="3.4"/>',
  userplus: '<circle cx="10" cy="8" r="3.3"/><path d="M3.8 20c0-3.4 2.8-5.8 6.2-5.8"/><path d="M17.6 13.4v6.2M14.5 16.5h6.2"/>',
  hash: '<path d="M5 9h14M4.4 15h14M9.6 4.4 8 19.6M16 4.4l-1.6 15.2"/>',
  reset: '<path d="M12 3.6v8.4"/><path d="M7.2 6.6a6.8 6.8 0 1 0 9.6 0"/>',
  eye: '<path d="M2.8 12S6.5 6 12 6s9.2 6 9.2 6-3.7 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.6"/>',
  eyeoff: '<path d="M4 4l16 16"/><path d="M9.6 6.4A9.7 9.7 0 0 1 12 6c5.5 0 9.2 6 9.2 6a15.4 15.4 0 0 1-3.4 3.9M6.4 8.7A15.9 15.9 0 0 0 2.8 12s3.7 6 9.2 6c1 0 2-.2 2.9-.5"/>',
  list: '<path d="M8.5 7h11M8.5 12h11M8.5 17h11"/><path d="M4.6 7h.01M4.6 12h.01M4.6 17h.01"/>',
  check: '<path d="M5 12.6l4.4 4.4L19 7.4"/>',
  doc: '<path d="M14 3.6H7.6A1.6 1.6 0 0 0 6 5.2v13.6a1.6 1.6 0 0 0 1.6 1.6h8.8a1.6 1.6 0 0 0 1.6-1.6V8.4Z"/><path d="M14 3.6v4.8h4.8"/><path d="M8.8 13h6.4M8.8 16.4h4.4"/>',
  bell: '<path d="M7.6 10.2a4.4 4.4 0 0 1 8.8 0c0 3.9 1.6 5.4 1.6 5.4H6s1.6-1.5 1.6-5.4Z"/><path d="M10.4 18.6a1.8 1.8 0 0 0 3.2 0"/>',
  box: '<path d="M3.6 7.8 12 4.2l8.4 3.6v8.4L12 19.8l-8.4-3.6Z"/><path d="M3.6 7.8 12 11.4l8.4-3.6"/><path d="M12 11.4v8.4"/>',
  copy: '<rect x="8.6" y="8.6" width="11.4" height="11.4" rx="2"/><path d="M15.8 5.6H6.4a2 2 0 0 0-2 2v9.4"/>',
  clip: '<path d="M20.4 11.5 12 19.9a5.2 5.2 0 0 1-7.4-7.4l8.4-8.4a3.4 3.4 0 0 1 4.9 4.9L9.6 17.3a1.6 1.6 0 0 1-2.3-2.3l7.4-7.4"/>',
  moon: '<path d="M20.4 14.1A8.4 8.4 0 0 1 9.9 3.6a8.7 8.7 0 1 0 10.5 10.5Z"/>',
  contrast: '<circle cx="12" cy="12" r="8.4"/><path d="M12 3.6a8.4 8.4 0 0 1 0 16.8Z" fill="currentColor" stroke="none"/>',
};
const ico = (n, s = 18) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n] || ''}</svg>`;
// 글자 대신 아이콘 버튼. 한국어 이름은 title(툴팁)과 aria-label(스크린리더)로 그대로 남긴다.
const ib = (label, name, cls = '', attrs = '') =>
  `<button type="button" class="ib ${cls}" ${attrs} title="${esc(label)}" aria-label="${esc(label)}">${ico(name)}</button>`;

// ---------- 직원 사진 · 팀 ----------
const teamsOfEmp = id => S.channels.filter(c => c.members?.includes(id));
const teamChannels = () => S.channels.filter(c => c.members?.length);
const teamChips = id => teamsOfEmp(id).map(t => `<span class="chip team">${ico('org', 13)}${esc(t.name)}</span>`).join('');
// 사진이 있으면 사진, 없으면 직원 색 + 이니셜
const av = (id, style = '') => {
  const e = emp(id);
  const name = id === 'user' ? S.user.name : e?.name || '?';
  if (e?.avatar) return `<span class="av hasimg" style="${style}"><img src="${e.avatar}" alt="${esc(name)} 사진"></span>`;
  return `<span class="av" style="background:${id === 'user' ? '#111' : e?.color || '#999'};${style}">${esc(String(name)[0])}</span>`;
};
const AV_PX = 128;
// 정사각으로 가운데 잘라 128px JPEG로 줄인다 — 원본을 data.json에 박으면 백업·전송이 무거워진다
async function shrinkAvatar(file) {
  const bmp = await createImageBitmap(file);
  const side = Math.min(bmp.width, bmp.height);
  const cv = document.createElement('canvas');
  cv.width = cv.height = AV_PX;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, AV_PX, AV_PX);
  ctx.drawImage(bmp, (bmp.width - side) / 2, (bmp.height - side) / 2, side, side, 0, 0, AV_PX, AV_PX);
  bmp.close?.();
  const out = cv.toDataURL('image/jpeg', 0.82);
  if (out.length > 300000) throw new Error('압축해도 너무 큰 이미지입니다');
  return out;
}

// 로고는 비율을 유지해 280x120 안에 담는다. PNG는 투명 배경을 살린다.
const LOGO_W = 280, LOGO_H = 120;
async function shrinkLogo(file) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(LOGO_W / bmp.width, LOGO_H / bmp.height, 1);
  const cv = document.createElement('canvas');
  cv.width = Math.max(1, Math.round(bmp.width * k));
  cv.height = Math.max(1, Math.round(bmp.height * k));
  cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
  bmp.close?.();
  const png = cv.toDataURL('image/png');
  const out = png.length > 300000 ? (() => {                 // 투명함이 필요 없는 큰 로고는 JPEG로 한 번 더 줄인다
    const c2 = document.createElement('canvas'); c2.width = cv.width; c2.height = cv.height;
    const x = c2.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, c2.width, c2.height); x.drawImage(cv, 0, 0);
    return c2.toDataURL('image/jpeg', 0.85);
  })() : png;
  if (out.length > 300000) throw new Error('압축해도 너무 큰 이미지입니다');
  return out;
}

// 설정 탭의 로고 칸 — 아직 저장하지 않은 logoDraft 를 미리 보여준다.
function paintLogoPrev() {
  const p = $('#logoPrev'); if (!p) return;
  p.innerHTML = logoDraft ? `<img src="${logoDraft}" alt="현재 로고">` : '';
  p.classList.toggle('hasimg', !!logoDraft);
  const del = $('#logoDel'); if (del) del.disabled = !logoDraft;
  const lb = $('#logoPickTxt'); if (lb) lb.textContent = logoDraft ? '로고 교체' : '로고 선택';
}

// ---------- 업무 명령 첨부 ----------
const MAX_ATT = 8 * 1024 * 1024;
const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
const toB64 = f => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = () => res(String(r.result).split(',')[1] || '');
  r.onerror = () => rej(new Error('파일을 읽을 수 없습니다'));
  r.readAsDataURL(f);
});
// 파일은 서버에 한 번 올려 메타정보(id·경로·종류)만 받아 쓴다. 본문은 data.json에 들어가지 않는다.
async function uploadFiles(files) {
  const out = [];
  for (const f of files) {
    if (f.size > MAX_ATT) { toast(`${f.name} · ${kb(f.size)}은 첨부 한계(${kb(MAX_ATT)})를 넘습니다`, 'err'); continue; }
    let b64;
    try { b64 = await toB64(f); } catch { toast(`${f.name}을(를) 읽을 수 없습니다`, 'err'); continue; }
    const rec = await api('POST', '/api/attachments', { name: f.name, mime: f.type, data: b64 });
    if (rec?.id) out.push(rec);                                 // 실패는 api()가 원문과 함께 토스트로 알린다
  }
  return out;
}
const attChip = (a, detach) => `<span class="atchip" title="${esc(a.name)} · ${kb(a.size)} · ${a.kind === 'text' ? '본문을 지시문에 옮겨 담음' : '경로만 전달 · 바이너리 형식'}">
  ${ico('doc', 13)}<a href="/api/attach/${esc(a.id)}" download>${esc(a.name)}</a>
  ${detach ? `<button type="button" class="ib x" ${detach}="${esc(a.id)}" title="첨부 제거" aria-label="${esc(a.name)} 첨부 제거">${ico('close', 13)}</button>` : ''}</span>`;
// 여러 줄 지시를 편하게 쓰도록 입력 칸을 내용에 맞춰 키운다. 너무 길어지면 안에서 스크롤 된다.
function grow(el, max = 300) {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight + 2, max) + 'px';
}
// 업무 카드에 긴 지시를 다 펼치면 판이 망가진다 — 짧으면 그대로, 길면 접어서 전문을 보여준다.
const longText = d => {
  const s = String(d || '');
  if (!s) return '';
  if (s.length <= 200) return `<div class="sm">${esc(s)}</div>`;
  return `<details class="dd"><summary>${esc(s.slice(0, 150).replace(/\s+/g, ' '))}… · 지시 ${s.length.toLocaleString()}자</summary><div class="sm">${esc(s)}</div></details>`;
};

// ---------- WebSocket ----------
function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.type === 'state') { const first = !S; S = d.state; header(); first ? build() : update(); watchAppr(); tabBadge(); }
    if (d.type === 'screen') { screens[d.empId] = d; if (tab === 'office' && S) update(); }
    // 작업 종료·결재 도착 같은 이벤트는 화면이 꺼져 있어도 보여준다
    if (d.type === 'notice') { toast(`${d.title} · ${d.body}`); notify(d.title, d.body); }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}
connect();

function header() {
  const logo = S.company.logo || '';
  const img = $('#brandLogo');
  if (img) {
    img.hidden = !logo;
    if (logo && img.getAttribute('src') !== logo) img.src = logo;   // src 속성에만 대입 → 마크업으로 새어가지 않는다
  }
  $('#brandName').textContent = S.company.name;
  if (document.activeElement !== $('#goal')) { $('#goal').value = S.company.goal; grow($('#goal'), 172); }
  paintRunAtts(); paintThemeBtn();
  const b = $('#runBtn');
  const label = S.company.running ? '일시정지' : '업무 시작';
  b.innerHTML = ico(S.company.running ? 'pause' : 'play', 19);
  b.title = label;
  b.setAttribute('aria-label', label);
  b.className = 'run ' + (S.company.running ? 'stop' : 'primary');
}
// 이번 가동의 지시에 붙은 첨부. 서버가 정답이므로 S.company.attachments 를 그대로 그린다.
function paintRunAtts() {
  const el = $('#goalAtts'); if (!el) return;
  const list = S.company.attachments || [];
  el.hidden = !list.length;
  if (!list.length) { el.innerHTML = ''; return; }
  el.innerHTML = `<span class="alab">${ico('clip', 13)}이 명령의 첨부 ${list.length}개</span>${list.map(x => attChip(x, 'data-rundetach')).join('')}`;
}
// 아직 제출하지 않은 업무 첨부 목록. 탭을 옮기거나 상태가 와도 유지된다.
function paintTfChips() {
  const el = $('#tfChips'); if (!el) return;
  el.innerHTML = taskAtts.map(x => attChip(x, 'data-tfdetach')).join('')
    || '<span class="asize">첨부한 파일은 이 업무 지시문에 본문(텍스트) 또는 경로(그 외 형식)로 실립니다</span>';
}
const themeValue = () => (S?.settings?.theme === 'light' || S?.settings?.theme === 'dark')
  ? S.settings.theme : (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
// 해 모양은 쓰지 않는다 — 낮/밤을 초승달과 대조 원으로 구분한다.
function paintThemeBtn() {
  const dark = themeValue() === 'dark';
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  const b = $('#themeBtn'); if (!b) return;
  b.innerHTML = ico(dark ? 'contrast' : 'moon', 19);
  const label = dark ? '주간 모드로' : '야간 모드로';
  b.title = label; b.setAttribute('aria-label', label);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (!S?.settings?.theme) paintThemeBtn(); });
// 결재 대기 건은 탭 아이콘 위로도 보인다
let badgeSeen = -1;
function tabBadge() {
  const n = S.approvals.filter(a => a.status === 'pending').length;
  if (n === badgeSeen) return;
  badgeSeen = n;
  const b = $('#tabs [data-tab=office]');
  if (b) b.innerHTML = ico('office', 19) + (n ? `<span class="badge">${n}</span>` : '');
}
let runBusy = false;
$('#runBtn').onclick = async () => {
  if (runBusy) return;                          // 연속 클릭이 시작→일시정지를 씹어버리는 것을 막는다
  runBusy = true; $('#runBtn').disabled = true;
  const starting = !S.company.running;
  await api('PUT', '/api/company', { goal: $('#goal').value });
  await api('POST', starting ? '/api/company/start' : '/api/company/pause');
  // 알림은 사용자의 클릭 이후에만 요청할 수 있다 — 업무 시작을 누른 김에 승인을 받는다
  if (starting && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
  const st = await api('GET', '/api/state');     // 서버 상태를 다시 읽어 버튼이 실제 상태와 어긋나지 않게 한다
  if (!st.error) { S = st; header(); update(); tabBadge(); }
  $('#runBtn').disabled = false; runBusy = false;
  toast(starting ? '업무 시작 · 대기 중인 업무부터 다시 달립니다'
    : '일시정지 · 진행 중이던 업무는 "멈춤" 칸으로 이동했습니다\n다시 하려면 업무 카드의 ▶을 누르세요 (보낸 메시지는 재개 후에 처리됩니다)');
};
// 목표는 길게 써도 지워지지 않는다 — Enter는 업무 시작, Shift+Enter는 줄바꿈
$('#goal').addEventListener('input', () => grow($('#goal'), 172));
$('#goal').addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#runBtn').click(); }
});
$('#f_goal').onchange = async ev => {
  const files = [...(ev.target.files || [])]; if (!files.length) return;
  ev.target.value = '';                                     // 같은 파일을 다시 골라도 change 가 다시 걸린다
  const added = await uploadFiles(files);
  if (!added.length) return;
  const list = [...(S.company.attachments || []), ...added];
  await api('PUT', '/api/company', { attachments: list });
  S.company.attachments = list; paintRunAtts();
  toast(`${added.map(a => a.name).join(', ')} 첨부 완료 · 업무 시작 시 대표에게 본문(또는 경로)이 함께 전달됩니다`);
};
$('#themeBtn').onclick = async () => {
  const next = themeValue() === 'dark' ? 'light' : 'dark';
  try { localStorage.setItem('vc.theme', next); } catch { /* 시크릿 모드 등에서는 화면 적용만 유지 */ }
  S.settings.theme = next; paintThemeBtn();                  // WS 왕복을 기다리지 않고 즉시 바꾼다
  await api('PUT', '/api/settings', { theme: next });
};
$('#tabs').onclick = e => {
  const t = e.target.closest('[data-tab]')?.dataset.tab; if (!t) return;
  tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); build();
};
// 탭은 아이콘만 보인다 — 이름은 툴팁과 aria-label로 남는다
$('#tabs').innerHTML = [['office', '오피스'], ['tasks', '업무'], ['chat', '메신저'], ['org', '조직'], ['settings', '설정']]
  .map(([id, label]) => `<button data-tab="${id}"${id === tab ? ' class="on"' : ''} title="${label}" aria-label="${label}">${ico(id, 19)}</button>`).join('');
// 아이콘 SVG는 정적 마크업에 넣을 수 없어 여기서 채운다
document.querySelectorAll('.pickclip').forEach(el => el.insertAdjacentHTML('afterbegin', ico('clip', 19)));
paintThemeBtn();                                 // 서버 상태를 기다리지 않고 첫 화면부터 테마를 맞춘다
grow($('#goal'), 172);

// ---------- 화면 ----------
let logoDraft = '', logoSaved = null;               // 설정 탭에서 아직 저장하지 않은 로고 미리보기 / 서버에 있다고 아는 값
let taskAtts = [], attBusy = false;                 // 아직 제출하지 않은 업무 첨부 / 업로드 진행 중
let tfDraft = { title: '', description: '' };       // 탭을 옮겨도 지시 문구가 사라지지 않게 잠시 든다
const shells = {
  office: () => `<div class="office"><div class="floor" id="desks"></div><aside class="offside">
    <div id="banner"></div>
    <div class="card apprbox" id="apprBox"></div>
    <div class="card resbox" id="resBox"></div>
    <div class="card feed"><h3>실시간 활동</h3><div id="feed"></div></aside></aside></div>`,
  tasks: () => `<form class="taskform" id="tf">
    <input name="title" placeholder="업무 제목 (한 줄)" required maxlength="300" value="${esc(tfDraft.title)}">
    <textarea name="description" id="tfDesc" rows="1" placeholder="상세 지시 · 길게 써도 됩니다 · Shift+Enter 줄바꿈, Enter 업무 지시">${esc(tfDraft.description)}</textarea>
    <div class="tfrow">
      <label class="pick sm">${ico('clip', 15)}<span>파일 첨부</span><input type="file" id="f_tf" multiple hidden></label>
      <span class="atchips" id="tfChips"></span>
      <select name="assigneeId" id="asg"></select>
      <button class="ib primary" type="submit" title="업무 지시" aria-label="업무 지시">${ico('plus')}</button>
    </div></form><div class="board" id="board"></div>`,
  chat: () => `<div class="chat"><aside class="chans" id="chans"></aside><section class="room"><div class="chhead" id="chhead"></div><div class="msgs" id="msgs"></div><form class="send" id="send"><input id="msgIn" placeholder="메시지 입력 · @이름 으로 직원 호출" autocomplete="off"><button class="ib primary" type="submit" title="전송" aria-label="전송">${ico('send')}</button></form></section></div>`,
  org: () => `<div class="grid2"><div class="colstack">
    <div class="card"><div class="cardhead"><h3>직원</h3>${ib('직원 채용', 'userplus', 'primary', 'id="addEmp"')}</div><div id="emps"></div></div>
    <div class="card"><div class="cardhead"><h3>팀</h3>${ib('팀 만들기', 'plus', 'primary', 'id="addTeam"')}</div>
      <div class="status">팀을 만들면 멤버만 쓰는 대화방이 생기고, 업무 목록·AI 지시문에 팀이 표시됩니다.</div><div id="teams"></div></div></div>
    <div class="card"><h3>직급 체계</h3><label>높은 직급부터 한 줄에 하나씩</label><textarea id="ranks" rows="9"></textarea><div class="btns">${ib('직급 체계 저장', 'save', 'primary', 'id="saveRanks"')}</div></div></div>`,
  settings: () => {
    const { providers, providerGroups, searchEngines, searchOrder } = S.catalog;
    const keys = S.settings.keys || {}, sc = S.settings.search || {};
    const keyLine = (id, label, hint) => `<label>${esc(label)}</label><div class="kline">
      <input data-key="${id}" placeholder="${esc(keys[id] || hint || '키 입력')}" autocomplete="off">
      ${ib(`${label} 키 지우기`, 'close', 'x', `data-clearkey="${esc(id)}"`)}</div>`;
    const engineNeeds = id => (searchEngines[id].needs || []).map(n => n === 'key' ? '키' : n === 'cx' ? 'cx' : n === 'url' ? 'URL' : n).join('+') || '무료';
    return `<div class="grid2"><div class="card"><h3>전역 기본 API 키</h3>
    <div class="status">직원이 자기 키를 가지고 있으면 그 키를 쓰고, 없으면 아래 키를 씁니다. 로컬 프로바이더는 키 없이도 됩니다.</div>
    ${providerGroups.map(([g, gl]) => {
      const ids = Object.entries(providers).filter(([, p]) => p.group === g).map(([id]) => id);
      return ids.length ? `<label class="grp">${esc(gl)}</label>${ids.map(id => keyLine(id, providers[id].label, providers[id].keyOptional ? '키 불필요 (입력하면 사용)' : '키 입력')).join('')}` : '';
    }).join('')}
    <label>회사 이름</label><input id="cname" value="${esc(S.company.name)}"><label>내 이름</label><input id="uname" value="${esc(S.user.name)}">
    <label>회사 로고 (좌측 상단 회사 이름 앞에 표시)</label>
    <div class="avrow"><span class="logoprev" id="logoPrev"></span>
      <label class="pick">${ico('camera')}<span id="logoPickTxt">로고 선택</span><input type="file" id="f_logo" accept="image/png,image/jpeg,image/webp,image/gif" hidden></label>
      ${ib('로고 제거', 'trash', 'danger', 'id="logoDel"')}</div>
    <div class="status">PNG는 투명 배경을 살립니다. ${LOGO_W}x${LOGO_H} 안에 맞게 줄여서만 저장하므로 data.json이 불어날지 않습니다.</div>
    <div class="btns">${ib('전역 설정 저장', 'save', 'primary', 'id="saveSet"')}</div></div>
    <div class="colstack"><div class="card"><h3>웹 검색 엔진</h3>
    <div class="status">자동 모드는 아래에서 사용 가능한 엔진만 ${searchOrder.join(' → ')} 순서로 시도합니다. 직원 업무 중에도 web_search의 engine 인자로 엔진을 고를 수 있습니다.</div>
    <label>기본 엔진</label><select id="searchProvider"><option value="auto"${sc.provider === 'auto' || !sc.provider ? ' selected' : ''}>auto (키가 있는 순서대로 + 실패 시 다음 엔진)</option>
      ${searchOrder.map(id => `<option value="${id}"${sc.provider === id ? ' selected' : ''}>${esc(searchEngines[id].label)} · ${engineNeeds(id)}</option>`).join('')}</select>
    ${searchOrder.filter(id => (searchEngines[id].needs || []).includes('key')).map(id => keyLine(id, searchEngines[id].label + ' 키', '키 입력')).join('')}
    <label>Google Custom Search ID (cx)</label><input id="gxCx" placeholder="0123456789abcdefghij" value="${esc(sc.googleCx || '')}">
    <label>SearXNG 베이스 URL (자체 호스트, 키 불필요)</label><input id="gxSearx" placeholder="http://localhost:8888" value="${esc(sc.searxngUrl || '')}">
    <label>검색 테스트</label><div class="kline"><input id="searchQ" placeholder="테스트할 검색어" autocomplete="off">${ib('검색', 'search', 'primary', 'id="searchTest"')}</div>
    <pre class="out" id="searchOut">키를 넣지 않으면 DuckDuckGo로 시도합니다. 결과를 여기에 보여줍니다.</pre>
    <div class="btns">${ib('웹 검색 설정 저장', 'save', 'primary', 'id="saveSearch"')}</div></div>
    <div class="card"><h3>운영 설정</h3>
    <label>업무당 최대 사고 단계 (1~60)</label><input id="cfgSteps" type="number" min="1" max="60" value="${esc(appCfg().maxSteps ?? 8)}">
    <label>브라우저 시작 URL (비우면 about:blank에서 대기)</label><input id="cfgStart" placeholder="https://duckduckgo.com" value="${esc(appCfg().startUrl || '')}">
    <div class="checks" style="margin-top:14px">
      <label><input type="checkbox" id="cfgHeadless" ${appCfg().headless !== false ? 'checked' : ''}>Playwright 헤드리스</label>
      <label><input type="checkbox" id="cfgComputer" ${appCfg().computerEnabled ? 'checked' : ''}>PC 조작 허용 (마우스·키보드)</label>
    </div>
    <div class="warn">PC 조작 마스터 스위치입니다. 꺼 두면 컴퓨터 유즈 권한을 준 직원에게도 도구가 노출되지 않습니다. 켜면 AI가 이 컴퓨터의 실제 마우스·키보드를 움직입니다.</div>
    <label>회사 이름 · 사원 수 · 직급 단계는 조직 탭에서 조정합니다. 현재 직급 ${S.ranks.length}단계 / 직원 ${S.employees.length}명</label>
    <div class="btns">${ib('활동 로그 지우기', 'trash', 'danger', 'id="clearLogs"')}${ib('운영 설정 저장', 'save', 'primary', 'id="saveCfg"')}</div></div>
    <div class="card"><h3>MCP 서버 연결</h3>
    <label>프리셋</label><select id="mcpPreset"><option value="">직접 입력</option>
      ${S.catalog.mcpPresets.map(p => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('')}</select>
    <label>서버 이름 (영문·숫자·._-)</label><input id="mcpName" placeholder="playwright">
    <label>명령어 (비우면 URL 연결)</label><input id="mcpCmd" placeholder="npx">
    <label>인자 (공백 구분)</label><input id="mcpArgs" placeholder="-y @playwright/mcp@latest">
    <label>또는 HTTP/StreamableHTTP URL</label><input id="mcpUrl" placeholder="http://localhost:3001/mcp">
    <label>환경변수 JSON (선택)</label><input id="mcpEnv" placeholder='{"TOKEN":"..."}'>
    <div class="btns">${ib('추가 후 바로 연결', 'plug', 'primary', 'id="mcpAdd"')}</div>
    <div id="mcpList"></div>
    <div class="status" id="mcpst"></div>
    <details><summary class="sm">원본 JSON 직접 편집 (Claude Desktop 형식)</summary>
      <textarea id="mcp" rows="10" style="font-family:monospace;font-size:12px">${esc(S.settings.mcpConfig)}</textarea>
      <div class="btns">${ib('MCP 재연결', 'refresh', '', 'id="recon"')}${ib('MCP 설정 저장', 'save', 'primary', 'id="saveMcp"')}</div>
    </details></div></div></div>`;
  },
};

// ---------- 회사 서류 양식 ----------
// 결재 서류와 결과물은 같은 회사의 종이 한 종류다 — 생김새를 하나의 양식으로 통일한다.
function docForm(o) {
  return `<div class="doc${o.stamp ? ' stamped ' + (o.stampKind || '') : ''}">
    <div class="dhead"><b>${esc(o.org)}</b><span>${esc(o.kind)} · ${esc(o.no)}</span></div>
    <div class="dform">
      <div class="dcell"><span>기안</span><b>${esc(o.from)}</b></div>
      <div class="dcell"><span>수신</span><b>${esc(o.to)}</b></div>
      <div class="dcell"><span>상신일</span><b>${esc(o.when)}</b></div>
      <div class="dcell"><span>상태</span><b>${esc(o.state)}</b></div>
      ${o.ref ? `<div class="dcell wide"><span>관련 업무</span><b>${esc(o.ref)}</b></div>` : ''}
    </div>
    <h4 class="dti">${esc(o.title)}</h4>
    <div class="dbody">${esc(o.body)}</div>
    ${o.note ? `<div class="dnote"><span>오너 메모</span><p>${esc(o.note)}</p></div>` : ''}
    <div class="dseal">
      <div class="sl"><span>기안자</span><b>${esc(o.fromShort)}</b></div>
      <div class="sl last"><span>결재자</span><b>${esc(o.toShort)}</b>${o.stamp ? `<i class="stamp">${esc(o.stamp)}</i>` : '<i class="nosig">인감 미날인</i>'}</div>
    </div>
  </div>`;
}

// ---------- 작업 종료 배너 · 결재함 ----------
// 일이 모두 끝났을 때 아래 창에 "작업 종료"와 보고서 파일을 남긴다. 숨기면 그 종료 건은 다시 안 보인다.
function renderBanner() {
  const el = $('#banner'); if (!el) return;
  const r = S.lastRun;
  if (!r || localStorage.getItem('vc.ban.' + r.at) === '1') { el.className = ''; el.innerHTML = ''; return; }
  el.className = 'banner';
  el.innerHTML = `<div class="bt">${ico('check', 20)}<b>작업 종료</b><span>${time(r.at)} · 완료 ${r.done}건${r.stuck ? ` · 멈춤/실패 ${r.stuck}건` : ''}</span></div>
    <div class="bs">${esc(r.goal || '목표 미설정')}</div>
    <div class="brow"><a class="dl" href="/api/report/${esc(r.file)}" download title="작업 종료 보고서 다운로드">${ico('doc', 15)}보고서 저장</a>
    ${ib('이 종료 안내 숨기기', 'close', 'x', 'id="banHide"')}</div>`;
}
function renderAppr() {
  const el = $('#apprBox'); if (!el) return;
  const pend = S.approvals.filter(a => a.status === 'pending');
  const past = S.approvals.filter(a => a.status !== 'pending').slice(-4).reverse();
  const st = { approved: '승인', rejected: '반려', expired: '만료' };
  el.innerHTML = `<h3>${ico('doc', 14)}결재함${pend.length ? `<span class="badge">${pend.length}</span>` : ''}</h3>
    ${pend.map(a => `<div class="appr" data-apprs="${a.id}" tabindex="0" role="button" title="결재 서류 열기">
      <div class="dno">결재 ${esc(a.id.toUpperCase())} · ${dnum(a.createdAt)} ${time(a.createdAt)}</div>
      <div class="ti">${esc(a.title)}</div>
      <div class="who">${av(a.empId, 'width:22px;height:22px')}<span>${esc(nm(a.empId))} · ${a.taskId ? '#' + esc(a.taskId) : '업무 없음'}</span></div>
      <div class="det">${esc(a.detail)}</div>
      <div class="btns">${ib('반려', 'close', 'x danger', `data-no="${a.id}"`)}${ib('결재 서류에 서명', 'pencil', '', `data-apprs="${a.id}"`)}${ib('승인', 'check', 'primary', `data-yes="${a.id}"`)}</div></div>`).join('')
      || '<div class="status">올라온 결재가 없습니다. 직원이 되돌릴 수 없는 행동을 하려 하면 여기에 서류가 뜹니다.</div>'}
    ${past.length ? `<div class="hist">${past.map(a => `<button type="button" class="chip ${a.status}" data-apprs="${a.id}" title="${st[a.status] || a.status} · ${esc(a.title)} · 서류 다시 보기">${st[a.status] || a.status} · ${esc(a.title)}</button>`).join('')}</div>` : ''}`;
}

// ---------- 결과물 상자 ----------
// 끝난 업무의 결과를 한 곳에 쌓아 둔다. 카드를 누르면 회사 양식(서류)으로 열어 본다.
function renderRes() {
  const el = $('#resBox'); if (!el) return;
  const list = S.tasks.filter(t => t.status === 'done').reverse();
  el.innerHTML = `<h3>${ico('box', 14)}결과물${list.length ? `<span class="badge grey">${list.length}</span>` : ''}</h3>
    ${list.map(t => `<div class="res" data-res="${t.id}" tabindex="0" role="button" title="결과물 열기 · ${esc(t.title)}">
      <div class="dno">결과 ${esc(t.id.toUpperCase())} · ${t.doneAt ? dnum(t.doneAt) + ' ' + time(t.doneAt) : '완료'}</div>
      <div class="ti">${esc(t.title)}</div>
      <div class="who">${av(t.assigneeId, 'width:20px;height:20px')}<span>${esc(nm(t.assigneeId))}${t.description ? ` · ${esc(t.description.slice(0, 40))}` : ''}</span></div>
      <div class="prev">${esc(String(t.result || '(결과 텍스트 없음)').slice(0, 90))}</div></div>`).join('')
      || '<div class="status">아직 담긴 결과물이 없습니다. 업무가 끝나면 결과 보고서가 이 상자 안에 쌓입니다.</div>'}
    ${S.lastRun ? `<div class="resfoot">${ico('doc', 14)}<a href="/api/report/${esc(S.lastRun.file)}" download title="작업 종료 보고서 다운로드">최종 보고서 ${esc(S.lastRun.file)}</a></div>` : ''}`;
}
function showResult(id) {
  const t = S.tasks.find(x => x.id === id);
  if (!t) { toast('업무 기록이 없습니다', 'err'); return; }
  const sheet = $('#sheet');
  sheet.classList.add('wide');
  sheet.innerHTML = `<h3>결과물 · 업무 #${esc(t.id)}</h3>
    ${docForm({
      org: S.company.name, kind: '결과 보고', no: t.id.toUpperCase(),
      from: `${nm(t.assigneeId)} (${emp(t.assigneeId)?.rank || '직원'})`, to: `${S.user.name} (오너)`,
      when: t.doneAt ? dt(t.doneAt) : '완료 시각 없음', state: '완료',
      ref: `${t.title}${t.description ? ` · ${t.description}` : ''}`,
      title: t.title, body: t.result || '(결과 텍스트가 없습니다. 직원이 결과를 남기지 않고 완료만 처리했습니다.)',
      fromShort: nm(t.assigneeId), toShort: S.user.name, stamp: '확인', stampKind: 'done',
    })}
    <div class="btns"><button type="button" class="lbl" id="r_copy" title="결과 텍스트 복사">${ico('copy', 15)}결과 복사</button>
      <button type="button" class="primary lbl" id="r_close" title="닫기">${ico('close', 15)}닫기</button></div>`;
  $('#modal').classList.remove('hidden');
  $('#r_copy').onclick = async () => {
    try { await navigator.clipboard.writeText(t.result || ''); toast('결과를 복사했습니다'); }
    catch { toast('복사 권한이 없어 결과를 아래처럼 직접 골라 주세요', 'err'); }
  };
  $('#r_close').onclick = () => $('#modal').classList.add('hidden');
}
function notify(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try { new Notification(title, { body }); } catch { /* 브라우저가 알림을 막으면 화면 토스트만 남는다 */ }
}
// 결재가 올라온 순간을 다른 탭에서도 놓치지 않는다
let pendSeen = 0, apprInit = false;
function watchAppr() {
  const pend = S.approvals.filter(a => a.status === 'pending');
  if (!apprInit) { apprInit = true; pendSeen = pend.length; return; }
  if (pend.length > pendSeen) {
    const a = pend[pend.length - 1];
    toast(`결재 서류 도착 · ${a.title}\n${a.detail.slice(0, 120)}`);
    notify('결재 서류가 도착했습니다', `${nm(a.empId)}님: ${a.title}`);
  }
  pendSeen = pend.length;
}

const updaters = {
  office() {
    $('#desks').innerHTML = S.employees.map(e => {
      const sc = screens[e.id];
      return `<div class="desk s-${e.status}" data-id="${e.id}"><div class="bubble">${esc(e.activity)}</div>
        <div class="monitor">${sc ? `<img src="data:image/jpeg;base64,${sc.img}"><span class="tag">${esc(sc.url)}</span>` : '<div class="code"><i></i><i></i><i></i></div>'}</div><div class="stand"></div>
        <div class="person">${e.avatar ? `<div class="head hasimg"><img src="${e.avatar}" alt="${esc(e.name)} 사진"></div>` : `<div class="head" style="background:${e.color}">${esc(e.name[0])}</div>`}<div class="body"></div></div><div class="table"></div>
        <div class="meta"><span class="dot"></span><b>${esc(e.name)}</b><span class="rank">${esc(e.rank)}</span><div class="role">${esc(e.role)}</div>
        <span class="chip model">${esc(provLabel(e.provider))} · ${esc(MODEL(e.model))}</span>${keyBadge(e)}${e.queue ? `<span class="chip">대기 ${e.queue}</span>` : ''}${teamChips(e.id)}
        ${toolChips(e)}</div></div>`;
    }).join('');
    $('#feed').innerHTML = S.logs.slice(-100).reverse().map(l => `<div class="log ${l.kind}"><span class="t">${time(l.ts)}</span><span class="who" style="color:${col(l.empId)}">${esc(nm(l.empId))}</span>${esc(l.text)}</div>`).join('') || '<div class="status">아직 활동이 없습니다</div>';
    renderBanner(); renderAppr(); renderRes();
  },
  tasks() {
    const a = $('#asg'), v = a.value;
    paintTfChips();
    const ti = $('#tf [name="title"]'), d = $('#tfDesc'), fin = $('#f_tf');
    if (ti) ti.oninput = () => { tfDraft.title = ti.value; };
    if (d) {
      d.oninput = () => { tfDraft.description = d.value; grow(d, 320); };
      d.onkeydown = e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); $('#tf').requestSubmit(); } };
      grow(d, 320);
    }
    if (fin) fin.onchange = async ev => {
      const files = [...(ev.target.files || [])]; if (!files.length) return;
      ev.target.value = '';                                   // 같은 파일을 다시 골라도 change 가 다시 걸린다
      attBusy = true;
      const added = await uploadFiles(files);
      attBusy = false;
      if (!added.length) return;
      taskAtts = [...taskAtts, ...added]; paintTfChips();
      const t = added.filter(x => x.kind === 'text').length;
      toast(`${added.map(x => x.name).join(', ')} 첨부 준비 완료 · ${t}개는 본문, ${added.length - t}개는 경로가 지시문에 실립니다`);
    };
    // 팀별로 묶어 보여준다 — 같은 팀원에게 맡기는 판단을 화면에서 할 수 있게
    const opt = e => `<option value="${e.id}">${esc(e.name)} (${esc(e.rank)})</option>`;
    const claimed = new Set();
    const groups = teamChannels().map(c => {
      const ms = S.employees.filter(e => c.members.includes(e.id));
      ms.forEach(m => claimed.add(m.id));
      return ms.length ? `<optgroup label="${esc(c.name)}">${ms.map(opt).join('')}</optgroup>` : '';
    }).join('');
    const rest = S.employees.filter(e => !claimed.has(e.id));
    a.innerHTML = (groups ? groups + (rest.length ? `<optgroup label="미소속">${rest.map(opt).join('')}</optgroup>` : '')
      : S.employees.map(opt).join('')) || '<option value="">직원 없음</option>';
    if (v) a.value = v;
    // 멈춤/실패는 별도 칸에 둔다 — 업무 시작을 다시 켜도 이 카드들은 버튼 전까지 다시 달리지 않는다.
    const card = x => `<div class="task">${ib('업무 삭제', 'trash', 'x del', `data-del="${x.id}"`)}
      ${x.status !== 'done' ? ib('오너가 완료 처리', 'check', 'x ok', `data-done="${x.id}"`) : ''}
      ${['todo', 'doing'].includes(x.status) ? ib('이 업무만 멈춤', 'pause', 'x stop', `data-pause="${x.id}"`) : ''}
      ${['paused', 'failed', 'blocked'].includes(x.status) ? ib('다시 할 일로 옮겨 시작', 'play', 'x go', `data-resume="${x.id}"`) : ''}
      <div class="ti">#${x.id} ${esc(x.title)}</div>
      <div class="sm">${esc(nm(x.assignerId))} → ${esc(nm(x.assigneeId))}</div>${longText(x.description)}
      ${x.attachments?.length ? `<div class="atchips">${x.attachments.map(p => attChip(p, '')).join('')}</div>` : ''}
      ${x.error ? `<div class="sm err">${esc(x.error)}</div>` : ''}
      ${x.status === 'blocked' ? '<div class="sm">결재 대기 중 · 오피스의 결재함에서 서명하면 이어갑니다</div>' : ''}
      ${x.result ? `<details><summary>결과 보기</summary>${esc(x.result)}</details>` : ''}</div>`;
    const cols = [
      ['할 일', x => x.status === 'todo'],
      ['진행 중', x => x.status === 'doing'],
      ['결재 대기', x => x.status === 'blocked'],
      ['멈춤 · 실패', x => ['paused', 'failed'].includes(x.status)],
      ['완료', x => x.status === 'done'],
    ];
    $('#board').innerHTML = cols.map(([t, f]) => {
      const list = S.tasks.filter(f).reverse();
      return `<div class="col"><h3>${t} · ${list.length}</h3>${list.map(card).join('') || '<div class="status">없음</div>'}</div>`;
    }).join('');
  },
  chat() {
    const observed = [...new Set(S.messages.map(m => m.channel).filter(c => c.startsWith('dm:') && !c.split(':').includes('user')))];
    const row = (id, label, badge, sub = '') => `<div class="c ${chan === id ? 'on' : ''}" data-ch="${id}">${badge || ico('hash', 15)}<span class="cname">${esc(label)}</span>${sub}</div>`;
    $('#chans').innerHTML = `<h3>채널 · 팀</h3>${S.channels.map(x => {
      const ms = (x.members || []).filter(id => emp(id));
      return ms.length ? row(x.id, x.name, ico('org', 15), `<span class="csub">${ms.length}명</span>`)
        : row(x.id, x.name, x.id === 'general' ? ico('org', 15) : ico('hash', 15));
    }).join('')}${ib('팀·채널 만들기', 'plus', 'add', 'id="newCh"')}
      <h3>1:1 대화</h3>${S.employees.map(e => row(dm('user', e.id), `${e.name} · ${e.rank}`, av(e.id, 'width:20px;height:20px'))).join('')}
      ${observed.length ? `<h3>직원 간 대화</h3>${observed.map(id => row(id, id.slice(3).split(':').map(nm).join(' ↔ '), ico('chat', 15))).join('')}` : ''}`;
    const ch = S.channels.find(x => x.id === chan);
    const ms = (ch?.members || []).filter(id => emp(id));
    $('#chhead').innerHTML = ch
      ? `${ch.id === 'general' || ms.length ? ico('org', 16) : '#'}<b>${esc(ch.name)}</b>
        ${ms.length ? `<span class="membars">${ms.map(id => av(id, 'width:20px;height:20px')).join('')}<span class="csub">${esc(ms.map(id => nm(id)).join(' · '))}</span></span>` : ''}
        ${ch.id !== 'general' ? `<span class="chact">${ib('팀 이름·멤버 편집', 'pencil', '', `data-chedit="${ch.id}"`)}${ib('이 채널 삭제', 'trash', 'danger', `data-chdel="${ch.id}"`)}</span>` : ''}`
      : esc(chan.slice(3).split(':').map(nm).join(' ↔ '));
    const box = $('#msgs'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = S.messages.filter(m => m.channel === chan).map(m => `<div class="msg">${av(m.from)}
      <div><div class="n">${esc(nm(m.from))}<span>${esc(emp(m.from)?.rank || '')} ${time(m.ts)}</span></div><div class="tx">${esc(m.text)}</div></div></div>`).join('') || '<div class="status">메시지가 없습니다</div>';
    if (atBottom) box.scrollTop = box.scrollHeight;
    $('#send').style.display = chan.startsWith('dm:') && !chan.split(':').includes('user') ? 'none' : '';
  },
  org() {
    $('#emps').innerHTML = S.employees.map(e => `<div class="row">${av(e.id, 'width:34px;height:34px')}
      <div class="grow"><b>${esc(e.name)}</b> <span class="rank">${esc(e.rank)}</span><div class="role">${esc(e.role)} · ${esc(provLabel(e.provider))} · ${esc(MODEL(e.model))}</div>
      <div>${keyBadge(e)}${teamChips(e.id)}${toolChips(e)}</div></div>
      ${ib(`${e.name}님 편집`, 'pencil', '', `data-edit="${e.id}"`)}</div>`).join('')
      || '<div class="status">직원이 없습니다. 위의 버튼으로 채용하세요.</div>';
    const teams = teamChannels();
    $('#teams').innerHTML = teams.map(c => {
      const ms = c.members.map(emp).filter(Boolean);
      return `<div class="row"><div class="tbadge">${ico('org', 15)}</div>
        <div class="grow"><b>${esc(c.name)}</b><div class="role">${ms.length ? ms.map(e => esc(e.name)).join(' · ') : '멤버 없음'}</div>
        <div class="avrow sm">${ms.map(e => av(e.id, 'width:22px;height:22px')).join('') || '<span class="status">아직 없음</span>'}</div></div>
        ${ib(`${c.name} 팀 편집`, 'pencil', '', `data-team="${c.id}"`)}${ib(`${c.name} 팀 삭제`, 'trash', 'danger', `data-teamdel="${c.id}"`)}</div>`;
    }).join('') || '<div class="status">팀이 없습니다. 팀을 만들면 그 팀만 쓰는 대화방이 생깁니다.</div>';
    if (document.activeElement !== $('#ranks')) $('#ranks').value = S.ranks.join('\n');
  },
  settings() {
    $('#mcpst').textContent = Object.entries(S.mcpStatus || {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '연결된 MCP 서버 없음';
    // 저장 응답은 WS 상태로 되돌아오므로, 폼이 그 전 값을 붙들고 있으면 안 된다.
    // 단 사용자가 아직 입력 중인 항목은 덮어쓰지 않는다.
    const a = S.settings.app || {};
    const fill = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.value = v; };
    const tick = (sel, v) => { const el = $(sel); if (el && document.activeElement !== el) el.checked = !!v; };
    fill('#cfgSteps', a.maxSteps ?? 8); fill('#cfgStart', a.startUrl || '');
    tick('#cfgHeadless', a.headless !== false); tick('#cfgComputer', a.computerEnabled);
    let servers = {};
    try { servers = JSON.parse(S.settings.mcpConfig || '{}').mcpServers || {}; } catch { /* 원본이 깨진 경우 목록만 비운다 */ }
    const names = [...new Set([...Object.keys(servers), ...Object.keys(S.mcpStatus || {})])];
    $('#mcpList').innerHTML = names.length ? names.map(n => `<div class="mrow">
      <label><input type="checkbox" data-mcpeng="${esc(n)}" ${servers[n]?.enabled === false ? '' : 'checked'}> ${esc(n)}</label>
      <span class="sm">${esc(S.mcpStatus?.[n] || '미연결 · 재연결 필요')}</span>
      ${ib(`${n} 서버를 전 직원에 허용`, 'userplus', 'x', `data-mcpgrant="${esc(n)}"`)}
      ${ib(`${n} 서버 삭제`, 'trash', 'x danger', `data-mcpdel="${esc(n)}"`)}</div>`).join('')
      : '<div class="status">등록된 MCP 서버가 없습니다. 위의 프리셋을 고르고 추가하세요.</div>';
    // 서버의 로고가 우리가 알던 값과 달라졌으면(방금 저장했거나 다른 창에서 바꿨거나) 미리보기를 맞춘다.
    // 아직 저장하지 않은 선택은 logoDraft 에만 있으니 이 재동기가 지우지 않는다.
    const saved = S.company.logo || '';
    if (logoSaved !== saved) { logoSaved = saved; logoDraft = saved; }
    paintLogoPrev();
    $('#f_logo').onchange = async ev => {
      const file = ev.target.files?.[0]; if (!file) return;
      try { logoDraft = await shrinkLogo(file); }
      catch (err) { toast(`${file.name}을(를) 로고로 바꿀 수 없습니다: ${err.message}`, 'err'); return; }
      ev.target.value = '';                          // 같은 파일을 다시 골라도 change 가 다시 걸린다
      paintLogoPrev();
      toast(`${file.name} 로고 준비 완료 · "전역 설정 저장"을 누르면 좌측 상단에 붙습니다`);
    };
  },
};

function build() { $('#view').innerHTML = shells[tab](); update(); }
function update() { updaters[tab]?.(); }

// ---------- 이벤트 ----------
document.addEventListener('click', async e => {
  if (!$('#modal').classList.contains('hidden')) return;
  const t = e.target.closest('[data-id],[data-ch],[data-del],[data-done],[data-pause],[data-resume],[data-yes],[data-no],[data-apprs],[data-res],[data-edit],[data-chedit],[data-chdel],[data-team],[data-teamdel],[data-clearkey],[data-mcpdel],[data-mcpgrant],[data-rundetach],[data-tfdetach],#newCh,#addEmp,#addTeam,#saveRanks,#saveSet,#saveCfg,#saveSearch,#searchTest,#mcpAdd,#clearLogs,#saveMcp,#recon,#banHide,#logoDel');
  if (!t) return;
  if (t.dataset.id && tab === 'office') { chan = dm('user', t.dataset.id); $('#tabs [data-tab=chat]').click(); }
  else if (t.dataset.ch) { chan = t.dataset.ch; update(); }
  else if (t.dataset.res) showResult(t.dataset.res);
  else if (t.dataset.del) { if (confirm('업무를 삭제할까요? 삭제한 일은 다시 지시되지 않습니다.')) api('DELETE', '/api/tasks/' + t.dataset.del); }
  else if (t.dataset.done) { await api('PUT', '/api/tasks/' + t.dataset.done, { status: 'done' }); toast('완료 처리했습니다 · 남은 업무가 없으면 작업 종료 보고서가 올라옵니다'); }
  else if (t.dataset.pause) { await api('PUT', '/api/tasks/' + t.dataset.pause, { status: 'paused' }); toast('이 업무를 멈췄습니다 · 멈춤·실패 칸에서 ▶로 다시 시작할 수 있어요'); }
  else if (t.dataset.resume) await api('PUT', '/api/tasks/' + t.dataset.resume, { status: 'todo' });
  else if (t.dataset.yes || t.dataset.no) sign(t.dataset.yes || t.dataset.no, t.dataset.yes ? true : false, '');
  else if (t.dataset.apprs) showApproval(t.dataset.apprs);
  else if (t.id === 'banHide') { if (S.lastRun) localStorage.setItem('vc.ban.' + S.lastRun.at, '1'); renderBanner(); }
  else if (t.dataset.edit) editEmp(emp(t.dataset.edit));
  else if (t.dataset.team || t.dataset.chedit) editTeam(S.channels.find(x => x.id === (t.dataset.team || t.dataset.chedit)));
  else if (t.dataset.teamdel) {
    const c = S.channels.find(x => x.id === t.dataset.teamdel);
    if (c && confirm(`${c.name} 팀과 이 팀의 대화를 삭제할까요?`)) { if (chan === c.id) chan = 'general'; api('DELETE', '/api/channels/' + c.id); }
  }
  else if (t.dataset.chdel) {
    const c = S.channels.find(x => x.id === t.dataset.chdel);
    if (c && confirm(`"${c.name}" 채널과 이 채널의 대화를 삭제할까요?`)) { chan = 'general'; api('DELETE', '/api/channels/' + c.id); }
  }
  else if (t.id === 'addEmp') editEmp(null);
  else if (t.id === 'addTeam' || t.id === 'newCh') editTeam(null);
  else if (t.id === 'saveRanks') api('PUT', '/api/settings', { ranks: $('#ranks').value.split('\n').map(s => s.trim()).filter(Boolean) });
  else if (t.id === 'saveCfg') {
    const pcOn = $('#cfgComputer').checked;
    await api('PUT', '/api/settings', { app: {
      maxSteps: +$('#cfgSteps').value || 8, startUrl: $('#cfgStart').value.trim(),
      headless: $('#cfgHeadless').checked, computerEnabled: pcOn,
    } });
    toast(`운영 설정 저장 완료 · PC 조작 ${pcOn ? '허용' : '차단'}\n헤드리스 브라우저 설정은 다음 브라우저 사용부터 반영됩니다.`); build();
  }
  else if (t.id === 'clearLogs') api('DELETE', '/api/logs');
  else if (t.id === 'logoDel') { logoDraft = ''; paintLogoPrev(); toast('로고를 지웠습니다 · 아래 "전역 설정 저장"을 눌러야 실제로 사라집니다'); }
  // 이번 가동의 첨부 = 서버 목록이 정답. 빼면 즉시 저장해 다른 창과 어긋나지 않게 한다.
  else if (t.dataset.rundetach) {
    const list = (S.company.attachments || []).filter(x => x.id !== t.dataset.rundetach);
    await api('PUT', '/api/company', { attachments: list });
    S.company.attachments = list; paintRunAtts(); toast('첨부를 뺐습니다 · 이미 직원에게 전달된 지시는 되돌리지 않습니다');
  }
  else if (t.dataset.tfdetach) { taskAtts = taskAtts.filter(x => x.id !== t.dataset.tfdetach); paintTfChips(); }
  else if (t.id === 'saveSet') {
    const keys = {}; document.querySelectorAll('[data-key]').forEach(i => { if (i.value) { keys[i.dataset.key] = i.value; i.value = ''; } });
    const n = Object.keys(keys).length;
    await api('PUT', '/api/settings', { keys, companyName: $('#cname').value, userName: $('#uname').value, logo: logoDraft });
    toast(n ? `전역 설정 저장 완료 · 키 ${n}개 갱신 (뒷부분 ${Object.values(keys).map(mask).join(' / ')}\n아래 칸에 •••• 표시로 남습니다)`
      : `회사 이름·내 이름·로고 저장 완료 · 새로 입력된 키는 없습니다`);
    build();
  }
  else if (t.dataset.clearkey) {
    const label = provLabel(t.dataset.clearkey) || t.dataset.clearkey;
    if (confirm(`${label}에 저장된 키를 삭제할까요?`)) {
      await api('PUT', '/api/settings', { clearKeys: [t.dataset.clearkey] });
      toast(`${label} 전역 키를 삭제했습니다`); build();
    }
  }
  else if (t.id === 'saveSearch') {
    const keys = {}; document.querySelectorAll('[data-key]').forEach(i => { if (i.value) { keys[i.dataset.key] = i.value; i.value = ''; } });
    await api('PUT', '/api/settings', { keys, search: {
      provider: $('#searchProvider').value, googleCx: $('#gxCx').value.trim(), searxngUrl: $('#gxSearx').value.trim(),
    } });
    toast(`웹 검색 설정 저장 완료 · 기본 엔진 ${$('#searchProvider').value}`); build();
  }
  else if (t.id === 'searchTest') {
    const out = $('#searchOut'), q = $('#searchQ').value.trim();
    if (!q) { toast('검색어를 입력하세요', 'err'); return; }
    out.textContent = '검색 중…';
    const r = await api('POST', '/api/search/test', { query: q, engine: $('#searchProvider').value });
    out.textContent = r.error ? '실패: ' + r.error : r.result;
  }
  else if (t.id === 'mcpAdd') {
    const name = $('#mcpName').value.trim();
    const r = await api('POST', '/api/mcp/servers', {
      name, command: $('#mcpCmd').value.trim(),
      args: $('#mcpArgs').value.trim(), url: $('#mcpUrl').value.trim(), env: $('#mcpEnv').value.trim(),
    });
    if (!r.error) toast(`${name} 서버 등록 완료 · ${S.mcpStatus?.[name] || '연결 시도 중'}`);
    build();
  }
  else if (t.dataset.mcpdel) {
    if (!confirm(`${t.dataset.mcpdel} 서버 연결을 끊고 설정에서 삭제할까요?`)) return;
    const r = await api('DELETE', '/api/mcp/servers/' + encodeURIComponent(t.dataset.mcpdel));
    if (!r.error) toast(`${t.dataset.mcpdel} 서버를 삭제했습니다`);
    build();
  }
  else if (t.dataset.mcpgrant) {
    const r = await api('POST', '/api/mcp/grant', { name: t.dataset.mcpgrant });
    if (!r.error) toast(`${t.dataset.mcpgrant} 서버를 모든 직원의 허용 목록에 추가했습니다`);
  }
  else if (t.id === 'saveMcp') {
    try { JSON.parse($('#mcp').value); } catch { toast('JSON 형식이 올바르지 않습니다', 'err'); return; }
    await api('PUT', '/api/settings', { mcpConfig: $('#mcp').value });
    toast('MCP 설정 저장 완료 · 재연결을 시도합니다');
  }
  else if (t.id === 'recon') { await api('POST', '/api/mcp/reconnect'); toast('MCP 재연결을 시도했습니다'); }
});

// 결재·결과물 카드는 role="button" 이므로 마우스 없이 Enter/Space 로도 열린다
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  if (!$('#modal').classList.contains('hidden')) return;
  const t = e.target.closest?.('[data-apprs],[data-res]');
  if (!t) return;
  e.preventDefault();
  t.dataset.apprs ? showApproval(t.dataset.apprs) : showResult(t.dataset.res);
});

// 프리셋을 고르면 폼이 채워지고, 서버 활성 토글은 즉시 재연결로 이어진다
document.addEventListener('change', async e => {
  const t = e.target;
  if (t.id === 'mcpPreset') {
    const p = (S.catalog.mcpPresets || []).find(x => x.key === t.value);
    if (p) { $('#mcpName').value = p.name; $('#mcpCmd').value = p.command; $('#mcpArgs').value = p.args; $('#mcpUrl').value = ''; $('#mcpEnv').value = p.env || ''; }
  }
  if (t.dataset.mcpeng) {
    const r = await api('PUT', '/api/mcp/servers/' + encodeURIComponent(t.dataset.mcpeng), { enabled: t.checked });
    if (r.error) alert('변경 실패: ' + r.error);
    build();
  }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  if (e.target.id === 'tf') {
    if (attBusy) { toast('첨부 업로드가 끝나지 않았습니다 · 잠시 뒤 다시 지시하세요', 'err'); return; }
    const f = e.target, d = Object.fromEntries(new FormData(f));
    const r = await api('POST', '/api/tasks', { ...d, attachments: taskAtts });
    if (!r?.id) return;                                       // 실패한 지시는 입력 내용을 지우지 않는다
    if (String(d.description || '').length >= 60000) toast('지시가 6만 자를 넘어 잘렸습니다 · 파일로 첨부하면 전체가 전달됩니다', 'err');
    f.reset(); tfDraft = { title: '', description: '' }; taskAtts = []; paintTfChips();
    grow($('#tfDesc'), 320);
    toast(`업무 지시 · #${r.id} ${r.title}${r.attachments?.length ? ` · 첨부 ${r.attachments.length}개` : ''}`);
  }
  if (e.target.id === 'send') { const i = $('#msgIn'); if (!i.value.trim()) return; const text = i.value; i.value = ''; await api('POST', '/api/messages', { channel: chan, text }); }
});

// ---------- 직원 편집 ----------
const teamBoxes = x => {
  const list = S.channels.filter(c => c.id !== 'general');
  if (!list.length) return '<label>소속 팀</label><div class="status">아직 팀이 없습니다. 조직 탭에서 팀을 만드세요.</div>';
  return `<label>소속 팀</label><div class="checks">${list.map(c => `<label><input type="checkbox" data-teamcb="${c.id}" ${c.members?.includes(x.id) ? 'checked' : ''}>${esc(c.name)}</label>`).join('')}</div>`;
};
function editEmp(e) {
  const x = e || { name: '', rank: S.ranks[S.ranks.length - 1], role: '', provider: 'anthropic', model: 'claude-sonnet-5', persona: '', color: '#4f46e5', tools: { web: true } };
  const t = x.tools || {};
  let avatar = x.avatar || '';
  const mcpOn = t.mcp === 'all' || (Array.isArray(t.mcp) && t.mcp.length > 0);
  const srvs = mcpServers();
  const allSel = t.mcp === 'all' || (Array.isArray(t.mcp) && srvs.length > 0 && srvs.every(s => t.mcp.includes(s)));
  $('#sheet').classList.remove('wide');
  $('#sheet').innerHTML = `<h3>${e ? '직원 편집 · ' + esc(x.name) : '직원 채용'}</h3>
    <label>이름</label><input id="f_name" value="${esc(x.name)}">
    <label>직급</label><select id="f_rank">${S.ranks.map(r => `<option ${r === x.rank ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
    <label>직무</label><input id="f_role" value="${esc(x.role)}">
    ${teamBoxes(x)}
    <label>AI 제공사</label><select id="f_provider">${providerOptions(x.provider)}</select>
    <label>모델 ID</label>
    <div class="kline"><input id="f_model" value="${esc(x.model)}" placeholder="${esc(provs()[x.provider]?.hint || '모델 이름')}" autocomplete="off">${ib('모델 목록 확인', 'list', 'x', 'id="f_modelList"')}</div>
    <select id="f_modelPick" hidden></select>
    <div class="status" id="f_modelHint">${esc(provs()[x.provider]?.hint || '')}</div>
    <label>Base URL (비우면 제공사 기본값 · 로컬/커스텀은 직접 입력)</label>
    <input id="f_baseUrl" value="${esc(x.baseUrl || '')}" placeholder="${esc(provs()[x.provider]?.baseURL || 'http://localhost:11434/v1')}" autocomplete="off">
    <label id="f_keyLabel">이 직원의 개인 API 키 (${provLabel(x.provider)})</label>
    <div class="kline"><input id="f_apiKey" type="password" autocomplete="new-password" placeholder="${esc(x.keyHint || keyHint(x.provider))}">${ib('키 표시', 'eye', 'x', 'id="f_keyEye"')}</div>
    <div class="status" id="f_keyStatus"></div>
    ${e && x.hasKey ? '<label style="display:flex;align-items:center;gap:7px;margin-top:6px;font-size:12px"><input type="checkbox" id="f_clearKey" style="width:auto"> 개인 키 삭제하고 전역 기본 키로 돌리기</label>' : ''}
    <label>사진</label>
    <div class="avrow">
      <span class="av big" id="f_avPrev"></span>
      <label class="pick">${ico('camera')}${esc(avatar ? '사진 교체' : '사진 선택')}<input type="file" id="f_avatar" accept="image/*" hidden></label>
      ${ib('사진 제거', 'trash', 'danger', 'id="f_avatarDel"')}
    </div>
    <div class="status">정사각으로 가운데를 잘라 ${AV_PX}px 사진으로 저장합니다. 사진이 없으면 아래 색상과 이니셜을 씁니다.</div>
    <label>색상</label><input id="f_color" type="color" value="${x.color}" style="height:40px;padding:4px">
    <label>성격 · 업무 지침</label><textarea id="f_persona">${esc(x.persona)}</textarea>
    <label>사용 가능한 도구</label><div class="checks">${Object.entries(TOOLS).map(([k, l]) => `<label><input type="checkbox" data-tool="${k}" ${(k === 'mcp' ? mcpOn : !!t[k]) ? 'checked' : ''}>${l}</label>`).join('')}</div>
    ${srvs.length ? `<label>허용할 MCP 서버${mcpOn ? '' : ' · MCP를 켜야 선택할 수 있습니다'}</label><div class="checks" id="mcpServers"><label><input type="checkbox" id="mcpAll" ${allSel ? 'checked' : ''}>전체 (뒤에 추가되는 서버 포함)</label>
      ${srvs.map(s => `<label><input type="checkbox" data-mcp="${esc(s)}" ${t.mcp === 'all' || Array.isArray(t.mcp) && t.mcp.includes(s) ? 'checked' : ''}>${esc(s)}</label>`).join('')}</div>`
      : '<div class="status">연결된 MCP 서버가 없습니다. 설정 탭의 MCP 서버에서 추가하세요.</div>'}
    <div class="warn">컴퓨터 유즈는 설정 탭의 "PC 조작 허용"이 켜져 있을 때만 실제로 노출됩니다. 켜지면 AI가 이 PC의 실제 마우스·키보드를 조작합니다.</div>
    <div class="btns">${e ? `<button type="button" class="danger lbl" id="m_del" title="${esc(x.name)}님 해고">${ico('trash', 15)}해고</button>${ib('기억 · 대기 메시지 초기화', 'reset', '', 'id="m_reset"')}` : ''}${ib('취소', 'close', '', 'id="m_close"')}${ib('저장', 'save', 'primary', 'id="m_save"')}</div>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  const paintAvatar = () => {
    const p = $('#f_avPrev');
    p.innerHTML = avatar ? `<img src="${avatar}" alt="사진 미리보기">` : esc((($('#f_name').value || x.name || '?').trim() || '?')[0]);
    p.style.background = avatar ? '' : (x.color || '#4f46e5');
    p.classList.toggle('hasimg', !!avatar);
    $('#f_avatarDel').disabled = !avatar;
    $('#f_avatarDel').title = avatar ? '사진 제거' : '사진 없음';
    $('#sheet .pick').innerHTML = `${ico('camera')}${avatar ? '사진 교체' : '사진 선택'}<input type="file" id="f_avatar" accept="image/*" hidden>`;
    wireAvatar();
  };
  function wireAvatar() {
    $('#f_avatar').onchange = async ev => {
      const file = ev.target.files?.[0];
      if (!file) return;
      try { avatar = await shrinkAvatar(file); } catch (err) { toast(`${file.name}을(를) 사진으로 바꿀 수 없습니다: ${err.message}`, 'err'); return; }
      paintAvatar();
      toast(`${x.name || $('#f_name').value} 사진 준비 완료 · 저장하면 반영됩니다`);
    };
  }
  $('#f_avatarDel').onclick = () => { avatar = ''; paintAvatar(); };
  $('#f_name').oninput = () => { if (!avatar) paintAvatar(); };
  paintAvatar();
  $('#m_close').onclick = close;
  // 제공사를 고르면 그 제공사의 모델 예시·기본 Base URL·키 안내가 따라온다
  const keyBox = $('#f_apiKey'), clearBox = $('#f_clearKey'), keyStatus = $('#f_keyStatus');
  const baseKeyStatus = e
    ? (x.hasKey ? `개인 키 설정됨 · ${x.keyHint} · 이 직원은 이 키를 우선 사용합니다`
      : x.usingGlobalKey ? '개인 키 없음 · 설정 탭의 전역 기본 키를 사용합니다'
      : '키 없음 · 이대로 두면 업무 시작 시 키 오류가 납니다')
    : '키를 비우면 설정 탭의 전역 기본 키를 사용합니다 · 채용 후에도 언제든 바꿀 수 있습니다';
  const syncKey = () => {
    if (clearBox?.checked) keyStatus.textContent = '저장하면 이 직원의 개인 키가 삭제되고 전역 기본 키로 돌아갑니다';
    else if (keyBox.value.trim()) keyStatus.textContent = `새 키 입력됨 · 뒷부분 ${mask(keyBox.value.trim())} · 저장 후 이 직원부터 사용됩니다`;
    else keyStatus.textContent = baseKeyStatus;
  };
  keyBox.oninput = syncKey;
  if (clearBox) clearBox.onchange = syncKey;
  syncKey();
  const eyeBtn = $('#f_keyEye');
  eyeBtn.onclick = () => {
    const show = keyBox.type === 'password';
    keyBox.type = show ? 'text' : 'password';
    eyeBtn.innerHTML = ico(show ? 'eyeoff' : 'eye');
    eyeBtn.title = show ? '키 가리기' : '키 표시';
    eyeBtn.setAttribute('aria-label', eyeBtn.title);
  };
  $('#f_provider').onchange = ev => {
    const p = provs()[ev.target.value] || {};
    $('#f_modelHint').textContent = p.hint || '';
    $('#f_model').placeholder = p.hint || '모델 이름';
    $('#f_baseUrl').placeholder = p.baseURL || 'http://localhost:11434/v1';
    $('#f_keyLabel').textContent = `이 직원의 개인 API 키 (${p.label || ev.target.value})`;
    keyBox.placeholder = keyHint(ev.target.value);
    const pick = $('#f_modelPick'); pick.hidden = true; pick.innerHTML = '';   // 다른 제공사의 목록이 남으면 안 된다
  };
  // 제공사에 실제로 등록된 모델 ID를 가져온다 — 오타가 만드는 404를 눈으로 고르게
  $('#f_modelList').onclick = async () => {
    const btn = $('#f_modelList'), hint = $('#f_modelHint'), pick = $('#f_modelPick');
    btn.disabled = true; btn.innerHTML = ico('refresh'); btn.title = '모델 목록 조회 중…';
    const r = await api('POST', '/api/models', {
      provider: $('#f_provider').value, baseUrl: $('#f_baseUrl').value.trim(),
      apiKey: keyBox.value.trim(), empId: e?.id,
    });
    btn.disabled = false; btn.innerHTML = ico('list'); btn.title = '모델 목록 확인';
    pick.hidden = true; pick.innerHTML = '';
    if (r.error) { hint.textContent = '모델 목록을 가져오지 못했습니다: ' + r.error; return; }
    const ids = r.models || [], cur = $('#f_model').value.trim();
    if (!ids.length) { hint.textContent = '이 엔드포인트는 모델 목록을 제공하지 않습니다. 모델 ID를 직접 입력하세요.'; return; }
    pick.innerHTML = `<option value="">목록에서 고르기 (${ids.length}개) · 현재 입력: ${esc(cur || '없음')}</option>`
      + ids.map(id => `<option${id === cur ? ' selected' : ''}>${esc(id)}</option>`).join('');
    pick.hidden = false;
    hint.textContent = ids.includes(cur)
      ? `${provLabel($('#f_provider').value)}에 이 모델이 있습니다 (${ids.length}개 중)`
      : `현재 입력한 "${cur}"은(는) 제공사 목록에 없습니다. 아래에서 골라 교체하세요 (${ids.length}개)`;
  };
  $('#f_modelPick').onchange = ev => { if (ev.target.value) $('#f_model').value = ev.target.value; };

  const save = async () => {
    const body = { tools: {} };
    ['name', 'rank', 'role', 'provider', 'model', 'baseUrl', 'color', 'persona'].forEach(k => body[k] = $('#f_' + k).value.trim());
    document.querySelectorAll('[data-tool]').forEach(c => body.tools[c.dataset.tool] = c.checked);
    body.avatar = avatar;
    body.teams = [...document.querySelectorAll('[data-teamcb]')].filter(c => c.checked).map(c => c.dataset.teamcb);
    // 서버 목록이 비어 있으면 체크박스가 렌더되지 않는다. 그때 'all'을 새로 만들면
    // 목록으로 좁혀 둔 권한이 서버를 지울 때마다 전체 허용으로 넓어진다 — 지금 값을 보존한다.
    const all = $('#mcpAll');
    const grant = !body.tools.mcp ? [] : all ? (all.checked ? 'all'
      : [...document.querySelectorAll('[data-mcp]')].filter(c => c.checked).map(c => c.dataset.mcp))
      : (t.mcp === undefined ? 'all' : t.mcp);
    body.tools.mcp = grant;
    if (!body.name || !body.model) { toast('이름과 모델 ID는 반드시 채워야 합니다', 'err'); return; }
    if (clearBox?.checked) body.apiKey = '';
    else if (keyBox.value.trim()) body.apiKey = keyBox.value.trim();
    const r = await api(e ? 'PUT' : 'POST', '/api/employees' + (e ? '/' + e.id : ''), body);
    if (r.error) return;                        // 실패 원인은 api()가 이미 토스트로 보여준다
    const keyLine = body.apiKey === '' ? '개인 키 삭제 완료 · 전역 기본 키 사용'
      : body.apiKey ? `개인 키 저장 완료 · 뒷부분 ${mask(body.apiKey)}`
      : x.hasKey ? `개인 키 그대로 유지 · ${x.keyHint}`
      : x.usingGlobalKey ? '전역 기본 키 사용 중' : '키 없음 · 전역 키를 넣거나 개인 키를 저장하세요';
    toast(`${body.name}님 ${e ? '정보 저장 완료' : '채용 완료'} · 서버에 반영되었습니다\n${keyLine}\n${body.avatar ? '사진 저장됨 · ' : '사진 없음 · '}소속 팀 ${body.teams.length ? body.teams.map(id => S.channels.find(c => c.id === id)?.name).join(', ') : '없음'}`);
    close();
  };
  $('#m_save').onclick = save;
  $('#sheet').onkeydown = ev => {                   // Enter = 저장
    if (ev.key !== 'Enter' || ev.target.matches('textarea,select,button')) return;
    ev.preventDefault(); save();
  };
  // 서버 목록은 MCP 마스터 아래에만 의미가 있다. 꺼진 상태에서 고른 선택이
  // 저장 때 조용히 사라지는 대신, 고르면 마스터가 같이 켜지게 한다.
  const mcpMaster = $('#sheet [data-tool=mcp]'), mcpWrap = $('#mcpServers');
  const syncMcp = () => {
    mcpWrap?.classList.toggle('off', !mcpMaster.checked);
    // 전체가 켜져 있으면 개별 선택이 무시되므로 직접 건드릴 수 없게 한다.
    const all = $('#mcpAll')?.checked;
    mcpWrap?.querySelectorAll('[data-mcp]').forEach(c => c.toggleAttribute('disabled', !!all));
  };
  mcpMaster.addEventListener('change', syncMcp);
  mcpWrap?.addEventListener('change', ev => {
    if (ev.target.matches('[data-mcp]') && ev.target.checked) mcpMaster.checked = true;
    syncMcp();
  });
  syncMcp();
  if (e) {
    $('#m_del').onclick = async () => { if (confirm(`${e.name}님을 해고할까요?`)) { await api('DELETE', '/api/employees/' + e.id); close(); } };
    $('#m_reset').onclick = async () => { const r = await api('POST', '/api/employees/' + e.id + '/reset'); if (!r.error) toast(`${e.name}님의 기억과 대기 중인 메시지를 초기화했습니다`); };
  }
}
$('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };

// ---------- 팀 · 채널 편집 ----------
function editTeam(c) {
  const x = c || { name: '', members: [] };
  $('#sheet').classList.remove('wide');
  $('#sheet').innerHTML = `<h3>${c ? '팀 편집 · ' + esc(x.name) : '팀 만들기'}</h3>
    <label>팀 이름</label><input id="t_name" value="${esc(x.name)}" placeholder="예: 리서치팀">
    <label>멤버</label>
    ${S.employees.length ? `<div class="checks">${S.employees.map(e => `<label><input type="checkbox" data-member="${e.id}" ${x.members?.includes(e.id) ? 'checked' : ''}>${esc(e.name)} (${esc(e.rank)})</label>`).join('')}</div>`
      : '<div class="status">직원이 없어 멤버를 지정할 수 없습니다. 먼저 직원을 채용하세요.</div>'}
    <div class="status">멤버를 1명 이상 두면 그 팀만 쓰는 대화방이 됩니다. 비우면 모두 보는 일반 채널로 남고, "전체"는 항상 전원 공개입니다.</div>
    <div class="btns">${c ? ib('팀 삭제', 'trash', 'danger', 'id="t_del"') : ''}${ib('취소', 'close', '', 'id="t_close"')}${ib('저장', 'save', 'primary', 'id="t_save"')}</div>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#t_close').onclick = close;
  const save = async () => {
    const name = $('#t_name').value.trim();
    if (!name) { toast('팀 이름을 입력하세요', 'err'); return; }
    const members = [...document.querySelectorAll('[data-member]')].filter(i => i.checked).map(i => i.dataset.member);
    const r = await api(c ? 'PUT' : 'POST', '/api/channels' + (c ? '/' + c.id : ''), { name, members });
    if (r.error) return;
    if (!c) chan = r.id;
    toast(`"${name}" ${c ? '팀 정보 저장 완료' : '팀 생성 완료'} · 멤버 ${members.length}명${members.length ? '' : ' (일반 채널로 저장됨)'}`);
    close();
  };
  $('#t_save').onclick = save;
  $('#sheet').onkeydown = ev => {
    if (ev.key !== 'Enter' || ev.target.matches('textarea,select,button')) return;
    ev.preventDefault(); save();
  };
  if (c) $('#t_del').onclick = async () => {
    if (!confirm(`${c.name} 팀과 이 팀의 대화를 삭제할까요?`)) return;
    if (chan === c.id) chan = 'general';
    await api('DELETE', '/api/channels/' + c.id);
    close();
  };
}

// ---------- 결재 서류 ----------
async function sign(id, approved, note) {
  const a = S.approvals.find(x => x.id === id);
  const r = await api('POST', '/api/approvals/' + id, { approved, note });
  if (r.error) return;
  toast(`${a ? a.title : '결재'} ${approved ? '승인' : '반려'}됨 · 담당 직원이 결재 결과를 받아 이어갑니다`);
  $('#modal').classList.add('hidden');
}
function showApproval(id) {
  const a = S.approvals.find(x => x.id === id);
  if (!a) { toast('이미 처리된 결재입니다', 'err'); return; }
  const t = S.tasks.find(x => x.id === a.taskId);
  const open = a.status === 'pending';
  const st = { approved: '결재', rejected: '반려', expired: '만료' }[a.status] || '대기';
  $('#sheet').classList.add('wide');
  $('#sheet').innerHTML = `<h3>결재 서류 · ${open ? '서명 대기' : st + ' 완료'}</h3>
    ${docForm({
      org: S.company.name, kind: '품의', no: a.id.toUpperCase(),
      from: `${nm(a.empId)} (${emp(a.empId)?.rank || '직원'})`, to: `${S.user.name} (오너)`,
      when: dt(a.createdAt), state: open ? '결재 대기' : `${st}${a.decidedAt ? ' · ' + time(a.decidedAt) : ''}`,
      ref: t ? `#${t.id} ${t.title}` : '없음',
      title: a.title, body: a.detail, note: a.note,
      fromShort: nm(a.empId), toShort: S.user.name,
      stamp: open ? '' : st, stampKind: a.status,
    })}
    ${open ? '<label>오너 메모 · 조건 (승인/반려 결과에 함께 기록됩니다)</label><textarea id="a_note" rows="3" placeholder="예: 금액 다시 확인 후 집행 / 이번 주에는 보류"></textarea>' : ''}
    <div class="status">${open ? '승인하면 담당 직원이 그대로 진행하고, 반려하면 그 행동은 하지 않고 대안으로 보고합니다.'
      : '이미 서명이 끝난 서류입니다. 결재함 아래의 기록을 누르면 언제든 다시 열어 볼 수 있습니다.'}</div>
    <div class="btns">${open ? `<button type="button" class="danger lbl" id="a_no" title="반려">${ico('close', 15)}반려</button>
      <button type="button" class="primary lbl" id="a_yes" title="승인">${ico('check', 15)}승인</button>` : ''}
      ${ib('닫기', 'close', '', 'id="a_close"')}</div>`;
  $('#modal').classList.remove('hidden');
  const note = () => $('#a_note')?.value.trim() || '';
  // 이미 서명된 서류를 기록에서 다시 열 때는 서명 버튼이 렌더되지 않는다 — null 에 붙지 않게 한다.
  $('#a_yes')?.addEventListener('click', () => sign(a.id, true, note()));
  $('#a_no')?.addEventListener('click', () => sign(a.id, false, note()));
  $('#a_close').onclick = () => $('#modal').classList.add('hidden');
  $('#sheet').onkeydown = ev => {
    if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && open) { ev.preventDefault(); $('#a_yes').click(); }
  };
}
