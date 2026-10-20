const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const api = (m, u, b) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.json().catch(() => ({})));
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
  b.textContent = S.company.running ? '일시정지' : '업무 시작';
  b.className = S.company.running ? 'stop' : 'primary';
}
$('#runBtn').onclick = async () => {
  await api('PUT', '/api/company', { goal: $('#goal').value });
  await api('POST', S.company.running ? '/api/company/pause' : '/api/company/start');
};
$('#tabs').onclick = e => {
  const t = e.target.dataset.tab; if (!t) return;
  tab = t; document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t)); build();
};

// ---------- 화면 ----------
const shells = {
  office: () => `<div class="office"><div class="floor" id="desks"></div><aside class="card feed"><h3>실시간 활동</h3><div id="feed"></div></aside></div>`,
  tasks: () => `<form class="taskform" id="tf"><input name="title" placeholder="업무 제목" required><input name="description" placeholder="상세 내용 / 기대 산출물"><select name="assigneeId" id="asg"></select><button class="primary">업무 지시</button></form><div class="board" id="board"></div>`,
  chat: () => `<div class="chat"><aside class="chans" id="chans"></aside><section class="room"><div class="chhead" id="chhead"></div><div class="msgs" id="msgs"></div><form class="send" id="send"><input id="msgIn" placeholder="메시지 입력 · @이름 으로 직원 호출" autocomplete="off"><button class="primary">전송</button></form></section></div>`,
  org: () => `<div class="grid2"><div class="card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>직원</h3><button class="primary" id="addEmp">+ 직원 채용</button></div><div id="emps"></div></div>
    <div class="card"><h3>직급 체계</h3><label>높은 직급부터 한 줄에 하나씩</label><textarea id="ranks" rows="9"></textarea><div class="btns"><button class="primary" id="saveRanks">저장</button></div></div></div>`,
  settings: () => {
    const { providers, providerGroups, searchEngines, searchOrder } = S.catalog;
    const keys = S.settings.keys || {}, sc = S.settings.search || {};
    const keyLine = (id, label, hint) => `<label>${esc(label)}</label><div class="kline">
      <input data-key="${id}" placeholder="${esc(keys[id] || hint || '키 입력')}" autocomplete="off">
      <button class="x" data-clearkey="${id}" title="${esc(label)} 키 삭제">지우기</button></div>`;
    const engineNeeds = id => (searchEngines[id].needs || []).map(n => n === 'key' ? '키' : n === 'cx' ? 'cx' : n === 'url' ? 'URL' : n).join('+') || '무료';
    return `<div class="grid2"><div class="card"><h3>전역 기본 API 키</h3>
    <div class="status">직원이 자기 키를 가지고 있으면 그 키를 쓰고, 없으면 아래 키를 씁니다. 로컬 프로바이더는 키 없이도 됩니다.</div>
    ${providerGroups.map(([g, gl]) => {
      const ids = Object.entries(providers).filter(([, p]) => p.group === g).map(([id]) => id);
      return ids.length ? `<label class="grp">${esc(gl)}</label>${ids.map(id => keyLine(id, providers[id].label, providers[id].keyOptional ? '키 불필요 (입력하면 사용)' : '키 입력')).join('')}` : '';
    }).join('')}
    <label>회사 이름</label><input id="cname" value="${esc(S.company.name)}"><label>내 이름</label><input id="uname" value="${esc(S.user.name)}">
    <div class="btns"><button class="primary" id="saveSet">저장</button></div></div>
    <div class="colstack"><div class="card"><h3>웹 검색 엔진</h3>
    <div class="status">자동 모드는 아래에서 사용 가능한 엔진만 ${searchOrder.join(' → ')} 순서로 시도합니다. 직원 업무 중에도 web_search의 engine 인자로 엔진을 고를 수 있습니다.</div>
    <label>기본 엔진</label><select id="searchProvider"><option value="auto"${sc.provider === 'auto' || !sc.provider ? ' selected' : ''}>auto (키가 있는 순서대로 + 실패 시 다음 엔진)</option>
      ${searchOrder.map(id => `<option value="${id}"${sc.provider === id ? ' selected' : ''}>${esc(searchEngines[id].label)} · ${engineNeeds(id)}</option>`).join('')}</select>
    ${searchOrder.filter(id => (searchEngines[id].needs || []).includes('key')).map(id => keyLine(id, searchEngines[id].label + ' 키', '키 입력')).join('')}
    <label>Google Custom Search ID (cx)</label><input id="gxCx" placeholder="0123456789abcdefghij" value="${esc(sc.googleCx || '')}">
    <label>SearXNG 베이스 URL (자체 호스트, 키 불필요)</label><input id="gxSearx" placeholder="http://localhost:8888" value="${esc(sc.searxngUrl || '')}">
    <label>검색 테스트</label><div class="kline"><input id="searchQ" placeholder="테스트할 검색어" autocomplete="off"><button class="primary" id="searchTest">검색</button></div>
    <pre class="out" id="searchOut">키를 넣지 않으면 DuckDuckGo로 시도합니다. 결과를 여기에 보여줍니다.</pre>
    <div class="btns"><button class="primary" id="saveSearch">웹 검색 설정 저장</button></div></div>
    <div class="card"><h3>운영 설정</h3>
    <label>업무당 최대 사고 단계 (1~60)</label><input id="cfgSteps" type="number" min="1" max="60" value="${esc(appCfg().maxSteps ?? 8)}">
    <label>브라우저 시작 URL (비우면 about:blank에서 대기)</label><input id="cfgStart" placeholder="https://duckduckgo.com" value="${esc(appCfg().startUrl || '')}">
    <div class="checks" style="margin-top:14px">
      <label><input type="checkbox" id="cfgHeadless" ${appCfg().headless !== false ? 'checked' : ''}>Playwright 헤드리스</label>
      <label><input type="checkbox" id="cfgComputer" ${appCfg().computerEnabled ? 'checked' : ''}>PC 조작 허용 (마우스·키보드)</label>
    </div>
    <div class="warn">PC 조작 마스터 스위치입니다. 꺼 두면 컴퓨터 유즈 권한을 준 직원에게도 도구가 노출되지 않습니다. 켜면 AI가 이 컴퓨터의 실제 마우스·키보드를 움직입니다.</div>
    <label>회사 이름 · 사원 수 · 직급 단계는 조직 탭에서 조정합니다. 현재 직급 ${S.ranks.length}단계 / 직원 ${S.employees.length}명</label>
    <div class="btns"><button id="clearLogs">활동 로그 지우기</button><button class="primary" id="saveCfg">운영 설정 저장</button></div></div>
    <div class="card"><h3>MCP 서버 연결</h3>
    <label>프리셋</label><select id="mcpPreset"><option value="">직접 입력</option>
      ${S.catalog.mcpPresets.map(p => `<option value="${esc(p.key)}">${esc(p.label)}</option>`).join('')}</select>
    <label>서버 이름 (영문·숫자·._-)</label><input id="mcpName" placeholder="playwright">
    <label>명령어 (비우면 URL 연결)</label><input id="mcpCmd" placeholder="npx">
    <label>인자 (공백 구분)</label><input id="mcpArgs" placeholder="-y @playwright/mcp@latest">
    <label>또는 HTTP/StreamableHTTP URL</label><input id="mcpUrl" placeholder="http://localhost:3001/mcp">
    <label>환경변수 JSON (선택)</label><input id="mcpEnv" placeholder='{"TOKEN":"..."}'>
    <div class="btns"><button class="primary" id="mcpAdd">추가 후 바로 연결</button></div>
    <div id="mcpList"></div>
    <div class="status" id="mcpst"></div>
    <details><summary class="sm">원본 JSON 직접 편집 (Claude Desktop 형식)</summary>
      <textarea id="mcp" rows="10" style="font-family:monospace;font-size:12px">${esc(S.settings.mcpConfig)}</textarea>
      <div class="btns"><button id="recon">재연결</button><button class="primary" id="saveMcp">저장</button></div>
    </details></div></div></div>`;
  },
};

const updaters = {
  office() {
    $('#desks').innerHTML = S.employees.map(e => {
      const sc = screens[e.id];
      return `<div class="desk s-${e.status}" data-id="${e.id}"><div class="bubble">${esc(e.activity)}</div>
        <div class="monitor">${sc ? `<img src="data:image/jpeg;base64,${sc.img}"><span class="tag">${esc(sc.url)}</span>` : '<div class="code"><i></i><i></i><i></i></div>'}</div><div class="stand"></div>
        <div class="person"><div class="head" style="background:${e.color}">${esc(e.name[0])}</div><div class="body"></div></div><div class="table"></div>
        <div class="meta"><span class="dot"></span><b>${esc(e.name)}</b><span class="rank">${esc(e.rank)}</span><div class="role">${esc(e.role)}</div>
        <span class="chip model">${esc(provLabel(e.provider))} · ${esc(MODEL(e.model))}</span>${keyBadge(e)}${e.queue ? `<span class="chip">대기 ${e.queue}</span>` : ''}
        ${toolChips(e)}</div></div>`;
    }).join('');
    $('#feed').innerHTML = S.logs.slice(-100).reverse().map(l => `<div class="log ${l.kind}"><span class="t">${time(l.ts)}</span><span class="who" style="color:${col(l.empId)}">${esc(nm(l.empId))}</span>${esc(l.text)}</div>`).join('') || '<div class="status">아직 활동이 없습니다</div>';
  },
  tasks() {
    const a = $('#asg'), v = a.value;
    a.innerHTML = S.employees.map(e => `<option value="${e.id}">${esc(e.name)} (${esc(e.rank)})</option>`).join(''); if (v) a.value = v;
    const cols = { todo: '할 일', doing: '진행 중', done: '완료' };
    $('#board').innerHTML = Object.entries(cols).map(([k, t]) => `<div class="col"><h3>${t} · ${S.tasks.filter(x => x.status === k).length}</h3>
      ${S.tasks.filter(x => x.status === k).reverse().map(x => `<div class="task"><button class="x" data-del="${x.id}">×</button><div class="ti">#${x.id} ${esc(x.title)}</div>
      <div class="sm">${esc(nm(x.assignerId))} → ${esc(nm(x.assigneeId))}</div>${x.description ? `<div class="sm">${esc(x.description)}</div>` : ''}
      ${x.error ? `<div class="sm" style="color:#d33">${esc(x.error)}</div>` : ''}${x.result ? `<details><summary>결과 보기</summary>${esc(x.result)}</details>` : ''}</div>`).join('')}</div>`).join('');
  },
  chat() {
    const observed = [...new Set(S.messages.map(m => m.channel).filter(c => c.startsWith('dm:') && !c.split(':').includes('user')))];
    const c = (id, label, av) => `<div class="c ${chan === id ? 'on' : ''}" data-ch="${id}">${av || '#'} ${esc(label)}</div>`;
    $('#chans').innerHTML = `<h3>채널</h3>${S.channels.map(x => c(x.id, x.name)).join('')}<div class="c" id="newCh" style="color:#8a8a8a">+ 채널 추가</div>
      <h3>1:1 대화</h3>${S.employees.map(e => c(dm('user', e.id), `${e.name} · ${e.rank}`, `<span class="av" style="background:${e.color}">${esc(e.name[0])}</span>`)).join('')}
      ${observed.length ? `<h3>직원 간 대화</h3>${observed.map(id => c(id, id.slice(3).split(':').map(nm).join(' ↔ '), '↔')).join('')}` : ''}`;
    const ch = S.channels.find(x => x.id === chan);
    $('#chhead').innerHTML = ch
      ? `# ${esc(ch.name)}${ch.id !== 'general' ? `<span style="float:right"><button class="x" data-chrename="${ch.id}">이름 변경</button><button class="x" data-chdel="${ch.id}">삭제</button></span>` : ''}`
      : esc(chan.slice(3).split(':').map(nm).join(' ↔ '));
    const box = $('#msgs'), atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 80;
    box.innerHTML = S.messages.filter(m => m.channel === chan).map(m => `<div class="msg"><span class="av" style="background:${col(m.from)}">${esc(nm(m.from)[0])}</span>
      <div><div class="n">${esc(nm(m.from))}<span>${esc(emp(m.from)?.rank || '')} ${time(m.ts)}</span></div><div class="tx">${esc(m.text)}</div></div></div>`).join('') || '<div class="status">메시지가 없습니다</div>';
    if (atBottom) box.scrollTop = box.scrollHeight;
    $('#send').style.display = chan.startsWith('dm:') && !chan.split(':').includes('user') ? 'none' : '';
  },
  org() {
    $('#emps').innerHTML = S.employees.map(e => `<div class="row"><span class="av" style="background:${e.color};width:34px;height:34px">${esc(e.name[0])}</span>
      <div class="grow"><b>${esc(e.name)}</b> <span class="rank">${esc(e.rank)}</span><div class="role">${esc(e.role)} · ${esc(provLabel(e.provider))} · ${esc(MODEL(e.model))}</div>
      <div>${keyBadge(e)}${toolChips(e)}</div></div>
      <button data-edit="${e.id}">편집</button></div>`).join('');
    if (document.activeElement !== $('#ranks')) $('#ranks').value = S.ranks.join('\n');
  },
  settings() {
    $('#mcpst').textContent = Object.entries(S.mcpStatus || {}).map(([k, v]) => `${k}: ${v}`).join('\n') || '연결된 MCP 서버 없음';
    // 저장 응답은 WS 상태로 되아오므로, 폼이 그 전 값을 붙들고 있으면 안 된다.
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
      <button class="x" data-mcpgrant="${esc(n)}">전 직원 허용</button>
      <button class="x danger" data-mcpdel="${esc(n)}">삭제</button></div>`).join('')
      : '<div class="status">등록된 MCP 서버가 없습니다. 위의 프리셋을 고르고 추가하세요.</div>';
  },
};

function build() { $('#view').innerHTML = shells[tab](); update(); }
function update() { updaters[tab]?.(); }

// ---------- 이벤트 ----------
document.addEventListener('click', async e => {
  if (!$('#modal').classList.contains('hidden')) return;
  const t = e.target.closest('[data-id],[data-ch],[data-del],[data-edit],[data-chrename],[data-chdel],[data-clearkey],[data-mcpdel],[data-mcpgrant],#newCh,#addEmp,#saveRanks,#saveSet,#saveCfg,#saveSearch,#searchTest,#mcpAdd,#clearLogs,#saveMcp,#recon');
  if (!t) return;
  if (t.dataset.id && tab === 'office') { chan = dm('user', t.dataset.id); $('#tabs [data-tab=chat]').click(); }
  else if (t.dataset.ch) { chan = t.dataset.ch; update(); }
  else if (t.dataset.del) { if (confirm('업무를 삭제할까요?')) api('DELETE', '/api/tasks/' + t.dataset.del); }
  else if (t.dataset.edit) editEmp(emp(t.dataset.edit));
  else if (t.dataset.chrename) {
    const c = S.channels.find(x => x.id === t.dataset.chrename);
    const n = prompt('채널 이름', c?.name); if (n) api('PUT', '/api/channels/' + c.id, { name: n.trim() });
  }
  else if (t.dataset.chdel) { if (confirm('채널과 이 채널의 대화를 삭제할까요?')) { api('DELETE', '/api/channels/' + t.dataset.chdel); chan = 'general'; } }
  else if (t.id === 'addEmp') editEmp(null);
  else if (t.id === 'newCh') { const n = prompt('채널 이름'); if (n) api('POST', '/api/channels', { name: n }); }
  else if (t.id === 'saveRanks') api('PUT', '/api/settings', { ranks: $('#ranks').value.split('\n').map(s => s.trim()).filter(Boolean) });
  else if (t.id === 'saveCfg') {
    await api('PUT', '/api/settings', { app: {
      maxSteps: +$('#cfgSteps').value || 8, startUrl: $('#cfgStart').value.trim(),
      headless: $('#cfgHeadless').checked, computerEnabled: $('#cfgComputer').checked,
    } });
    alert('운영 설정이 저장되었습니다. 헤드리스 브라우저 설정은 다음 브라우저 사용부터 반영됩니다.'); build();
  }
  else if (t.id === 'clearLogs') api('DELETE', '/api/logs');
  else if (t.id === 'saveSet') {
    const keys = {}; document.querySelectorAll('[data-key]').forEach(i => { if (i.value) keys[i.dataset.key] = i.value; i.value = ''; });
    await api('PUT', '/api/settings', { keys, companyName: $('#cname').value, userName: $('#uname').value }); alert('저장되었습니다'); build();
  }
  else if (t.dataset.clearkey) {
    if (confirm(`${provLabel(t.dataset.clearkey) || t.dataset.clearkey}에 저장된 키를 삭제할까요?`)) {
      await api('PUT', '/api/settings', { clearKeys: [t.dataset.clearkey] }); build();
    }
  }
  else if (t.id === 'saveSearch') {
    const keys = {}; document.querySelectorAll('[data-key]').forEach(i => { if (i.value) keys[i.dataset.key] = i.value; i.value = ''; });
    await api('PUT', '/api/settings', { keys, search: {
      provider: $('#searchProvider').value, googleCx: $('#gxCx').value.trim(), searxngUrl: $('#gxSearx').value.trim(),
    } });
    alert('웹 검색 설정이 저장되었습니다'); build();
  }
  else if (t.id === 'searchTest') {
    const out = $('#searchOut'), q = $('#searchQ').value.trim();
    if (!q) return alert('검색어를 입력하세요');
    out.textContent = '검색 중…';
    const r = await api('POST', '/api/search/test', { query: q, engine: $('#searchProvider').value });
    out.textContent = r.error ? '실패: ' + r.error : r.result;
  }
  else if (t.id === 'mcpAdd') {
    const r = await api('POST', '/api/mcp/servers', {
      name: $('#mcpName').value.trim(), command: $('#mcpCmd').value.trim(),
      args: $('#mcpArgs').value.trim(), url: $('#mcpUrl').value.trim(), env: $('#mcpEnv').value.trim(),
    });
    if (r.error) alert('추가 실패: ' + r.error);
    else alert('MCP 서버가 등록되고 연결되었습니다');
    build();
  }
  else if (t.dataset.mcpdel) {
    if (!confirm(`${t.dataset.mcpdel} 서버 연결을 끊고 설정에서 삭제할까요?`)) return;
    const r = await api('DELETE', '/api/mcp/servers/' + encodeURIComponent(t.dataset.mcpdel));
    if (r.error) alert('삭제 실패: ' + r.error);
    build();
  }
  else if (t.dataset.mcpgrant) {
    await api('POST', '/api/mcp/grant', { name: t.dataset.mcpgrant });
    alert(`${t.dataset.mcpgrant} 서버를 모든 직원의 허용 목록에 추가했습니다`);
  }
  else if (t.id === 'saveMcp') { try { JSON.parse($('#mcp').value); api('PUT', '/api/settings', { mcpConfig: $('#mcp').value }); } catch { alert('JSON 형식이 올바르지 않습니다'); } }
  else if (t.id === 'recon') api('POST', '/api/mcp/reconnect');
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
function editEmp(e) {
  const x = e || { name: '', rank: S.ranks[S.ranks.length - 1], role: '', provider: 'anthropic', model: 'claude-sonnet-5', persona: '', color: '#4f46e5', tools: { web: true } };
  const t = x.tools || {};
  const mcpOn = t.mcp === 'all' || (Array.isArray(t.mcp) && t.mcp.length > 0);
  const srvs = mcpServers();
  const allSel = t.mcp === 'all' || (Array.isArray(t.mcp) && srvs.length > 0 && srvs.every(s => t.mcp.includes(s)));
  $('#sheet').innerHTML = `<h3>${e ? '직원 편집 · ' + esc(x.name) : '직원 채용'}</h3>
    <label>이름</label><input id="f_name" value="${esc(x.name)}">
    <label>직급</label><select id="f_rank">${S.ranks.map(r => `<option ${r === x.rank ? 'selected' : ''}>${esc(r)}</option>`).join('')}</select>
    <label>직무</label><input id="f_role" value="${esc(x.role)}">
    <label>AI 제공사</label><select id="f_provider">${providerOptions(x.provider)}</select>
    <label>모델 ID</label><input id="f_model" value="${esc(x.model)}" placeholder="${esc(provs()[x.provider]?.hint || '모델 이름')}" autocomplete="off">
    <div class="status" id="f_modelHint">${esc(provs()[x.provider]?.hint || '')}</div>
    <label>Base URL (비우면 제공사 기본값 · 로컬/커스텀은 직접 입력)</label>
    <input id="f_baseUrl" value="${esc(x.baseUrl || '')}" placeholder="${esc(provs()[x.provider]?.baseURL || 'http://localhost:11434/v1')}" autocomplete="off">
    <label id="f_keyLabel">이 직원의 개인 API 키 (${provLabel(x.provider)})</label>
    <input id="f_apiKey" type="password" autocomplete="new-password" placeholder="${esc(x.keyHint || keyHint(x.provider))}">
    <div class="status">${e ? (x.hasKey ? `개인 키 설정됨 · ${esc(x.keyHint)}` : '전역 기본 키를 사용하고 있습니다') : '채용 후에도 언제든 바꿀 수 있습니다'}${e && x.hasKey ? ' · <label style="display:inline"><input type="checkbox" id="f_clearKey"> 개인 키 삭제</label>' : ''}</div>
    <label>색상</label><input id="f_color" type="color" value="${x.color}" style="height:40px;padding:4px">
    <label>성격 · 업무 지침</label><textarea id="f_persona">${esc(x.persona)}</textarea>
    <label>사용 가능한 도구</label><div class="checks">${Object.entries(TOOLS).map(([k, l]) => `<label><input type="checkbox" data-tool="${k}" ${(k === 'mcp' ? mcpOn : !!t[k]) ? 'checked' : ''}>${l}</label>`).join('')}</div>
    ${srvs.length ? `<label>허용할 MCP 서버${mcpOn ? '' : ' · MCP를 켜야 선택할 수 있습니다'}</label><div class="checks" id="mcpServers"><label><input type="checkbox" id="mcpAll" ${allSel ? 'checked' : ''}>전체 (뒤에 추가되는 서버 포함)</label>
      ${srvs.map(s => `<label><input type="checkbox" data-mcp="${esc(s)}" ${t.mcp === 'all' || Array.isArray(t.mcp) && t.mcp.includes(s) ? 'checked' : ''}>${esc(s)}</label>`).join('')}</div>`
      : '<div class="status">연결된 MCP 서버가 없습니다. 설정 탭의 MCP 서버에서 추가하세요.</div>'}
    <div class="warn">컴퓨터 유즈는 설정 탭의 "PC 조작 허용"이 켜져 있을 때만 실제로 노출됩니다. 켜지면 AI가 이 PC의 실제 마우스·키보드를 조작합니다.</div>
    <div class="btns">${e ? '<button class="danger" id="m_del">해고</button><button id="m_reset">기억 초기화</button>' : ''}<button id="m_close">취소</button><button class="primary" id="m_save">저장</button></div>`;
  $('#modal').classList.remove('hidden');
  const close = () => $('#modal').classList.add('hidden');
  $('#m_close').onclick = close;
  // 제공사를 고르면 그 제공사의 모델 예시·기본 Base URL·키 안내가 따라온다
  $('#f_provider').onchange = ev => {
    const p = provs()[ev.target.value] || {};
    $('#f_modelHint').textContent = p.hint || '';
    $('#f_model').placeholder = p.hint || '모델 이름';
    $('#f_baseUrl').placeholder = p.baseURL || 'http://localhost:11434/v1';
    $('#f_keyLabel').textContent = `이 직원의 개인 API 키 (${p.label || ev.target.value})`;
    $('#f_apiKey').placeholder = keyHint(ev.target.value);
  };
  $('#m_save').onclick = async () => {
    const body = { tools: {} };
    ['name', 'rank', 'role', 'provider', 'model', 'baseUrl', 'color', 'persona'].forEach(k => body[k] = $('#f_' + k).value.trim());
    document.querySelectorAll('[data-tool]').forEach(c => body.tools[c.dataset.tool] = c.checked);
    const grant = !body.tools.mcp ? [] : (!$('#mcpAll') || $('#mcpAll').checked) ? 'all'
      : [...document.querySelectorAll('[data-mcp]')].filter(c => c.checked).map(c => c.dataset.mcp);
    body.tools.mcp = grant;
    if (!body.name || !body.model) return alert('이름과 모델은 필수입니다');
    const keyBox = $('#f_apiKey'), clearBox = $('#f_clearKey');
    if (clearBox?.checked) body.apiKey = '';
    else if (keyBox.value.trim()) body.apiKey = keyBox.value.trim();
    await api(e ? 'PUT' : 'POST', '/api/employees' + (e ? '/' + e.id : ''), body); close();
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
    $('#m_reset').onclick = async () => { await api('POST', '/api/employees/' + e.id + '/reset'); alert('기억을 초기화했습니다'); };
  }
}
$('#modal').onclick = e => { if (e.target.id === 'modal') $('#modal').classList.add('hidden'); };
