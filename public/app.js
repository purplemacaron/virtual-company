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
  settings: '<circle cx="12" cy="12" r="3.1"/><path d="M12 2.9v2.6M12 18.5v2.6M4.6 7.7l2.2 1.3M17.2 15l2.2 1.3M4.6 16.3l2.2-1.3M17.2 9l2.2-1.3"/>',
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

// ---------- WebSocket ----------
function connect() {
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws');
  ws.onmessage = ev => {
    const d = JSON.parse(ev.data);
    if (d.type === 'state') { const first = !S; S = d.state; header(); first ? build() : update(); }
    if (d.type === 'screen') { screens[d.empId] = d; if (tab === 'office' && S) update(); }
  };
  ws.onclose = () => setTimeout(connect, 1500);
}
connect();

function header() {
  $('#brandName').textContent = S.company.name;
  if (document.activeElement !== $('#goal')) $('#goal').value = S.company.goal;
  const b = $('#runBtn');
  const label = S.company.running ? '일시정지' : '업무 시작';
  b.innerHTML = ico(S.company.running ? 'pause' : 'play', 19);
  b.title = label;
  b.setAttribute('aria-label', label);
  b.className = 'run ' + (S.company.running ? 'stop' : 'primary');
}
$('#runBtn').onclick = async () => {
  await api('PUT', '/api/company', { goal: $('#goal').value });
  await api('POST', S.company.running ? '/api/company/pause' : '/api/company/start');
};
$('#tabs').onclick = e => {
  const t = e.target.closest('[data-tab]')?.dataset.tab; if (!t) return;
  tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); build();
};
// 탭은 아이콘만 보인다 — 이름은 툴팁과 aria-label로 남는다
$('#tabs').innerHTML = [['office', '오피스'], ['tasks', '업무'], ['chat', '메신저'], ['org', '조직'], ['settings', '설정']]
  .map(([id, label]) => `<button data-tab="${id}"${id === tab ? ' class="on"' : ''} title="${label}" aria-label="${label}">${ico(id, 19)}</button>`).join('');

// ---------- 화면 ----------
const shells = {
  office: () => `<div class="office"><div class="floor" id="desks"></div><aside class="card feed"><h3>실시간 활동</h3><div id="feed"></div></aside></div>`,
  tasks: () => `<form class="taskform" id="tf"><input name="title" placeholder="업무 제목" required><input name="description" placeholder="상세 내용 / 기대 산출물"><select name="assigneeId" id="asg"></select><button class="ib primary" type="submit" title="업무 지시" aria-label="업무 지시">${ico('plus')}</button></form><div class="board" id="board"></div>`,
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
  },
  tasks() {
    const a = $('#asg'), v = a.value;
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
    const cols = { todo: '할 일', doing: '진행 중', done: '완료' };
    $('#board').innerHTML = Object.entries(cols).map(([k, t]) => `<div class="col"><h3>${t} · ${S.tasks.filter(x => x.status === k).length}</h3>
      ${S.tasks.filter(x => x.status === k).reverse().map(x => `<div class="task">${ib('업무 삭제', 'trash', 'x del', `data-del="${x.id}"`)}<div class="ti">#${x.id} ${esc(x.title)}</div>
      <div class="sm">${esc(nm(x.assignerId))} → ${esc(nm(x.assigneeId))}</div>${x.description ? `<div class="sm">${esc(x.description)}</div>` : ''}
      ${x.error ? `<div class="sm" style="color:#d33">${esc(x.error)}</div>` : ''}${x.result ? `<details><summary>결과 보기</summary>${esc(x.result)}</details>` : ''}</div>`).join('')}</div>`).join('');
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
  },
};

function build() { $('#view').innerHTML = shells[tab](); update(); }
function update() { updaters[tab]?.(); }

// ---------- 이벤트 ----------
document.addEventListener('click', async e => {
  if (!$('#modal').classList.contains('hidden')) return;
  const t = e.target.closest('[data-id],[data-ch],[data-del],[data-edit],[data-chedit],[data-chdel],[data-team],[data-teamdel],[data-clearkey],[data-mcpdel],[data-mcpgrant],#newCh,#addEmp,#addTeam,#saveRanks,#saveSet,#saveCfg,#saveSearch,#searchTest,#mcpAdd,#clearLogs,#saveMcp,#recon');
  if (!t) return;
  if (t.dataset.id && tab === 'office') { chan = dm('user', t.dataset.id); $('#tabs [data-tab=chat]').click(); }
  else if (t.dataset.ch) { chan = t.dataset.ch; update(); }
  else if (t.dataset.del) { if (confirm('업무를 삭제할까요?')) api('DELETE', '/api/tasks/' + t.dataset.del); }
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
  else if (t.id === 'saveSet') {
    const keys = {}; document.querySelectorAll('[data-key]').forEach(i => { if (i.value) { keys[i.dataset.key] = i.value; i.value = ''; } });
    const n = Object.keys(keys).length;
    await api('PUT', '/api/settings', { keys, companyName: $('#cname').value, userName: $('#uname').value });
    toast(n ? `전역 설정 저장 완료 · 키 ${n}개 갱신 (뒷부분 ${Object.values(keys).map(mask).join(' / ')}\n아래 칸에 •••• 표시로 남습니다)`
      : '회사 이름·내 이름 저장 완료 · 새로 입력된 키는 없습니다');
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
  if (e.target.id === 'tf') { await api('POST', '/api/tasks', Object.fromEntries(new FormData(e.target))); e.target.reset(); }
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
    const grant = !body.tools.mcp ? [] : (!$('#mcpAll') || $('#mcpAll').checked) ? 'all'
      : [...document.querySelectorAll('[data-mcp]')].filter(c => c.checked).map(c => c.dataset.mcp);
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
