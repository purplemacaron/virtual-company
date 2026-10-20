import express from 'express';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { WebSocketServer } from 'ws';
import { state, changed, publicState, onEvent, screens, uid, postMessage, leader, flush, cancelTask, decideApproval, safeReportName, reportDir } from './store.js';
import { startEngine, abortAll, stopTask } from './engine.js';
import { listModels } from './llm.js';
import { connectMcp, closeAll, resetBrowser, testSearch, mcpServersObj, writeMcpServers } from './tools.js';

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static('public'));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: '/ws' });
onEvent(msg => { const d = JSON.stringify(msg); wss.clients.forEach(c => c.readyState === 1 && c.send(d)); });
wss.on('connection', ws => {
  ws.send(JSON.stringify({ type: 'state', state: publicState() }));
  for (const [empId, s] of screens) ws.send(JSON.stringify({ type: 'screen', empId, ...s }));
});

const ok = res => res.json({ ok: true });
const EMP_FIELDS = ['name', 'rank', 'role', 'provider', 'model', 'baseUrl', 'persona', 'color', 'tools', 'avatar'];
// 사진은 브라우저에서 128px로 줄인 data URL만 받는다 — 임의 텍스트를 data.json에 박아넣는 통로를 막는다
const AVATAR = /^data:image\/(?:jpeg|png|webp|gif);base64,[A-Za-z0-9+/=]{1,300000}$/;
// 마스킹된 값(••••)은 "변경 없음"으로 취급해 클라이언트에 평문 키를 내려보내지 않는다
const isMasked = v => typeof v === 'string' && v.startsWith('••••');
const pick = o => {
  const out = Object.fromEntries(EMP_FIELDS.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  if (out.baseUrl !== undefined) out.baseUrl = String(out.baseUrl).trim();
  if (out.model !== undefined) out.model = String(out.model).trim();
  if (out.avatar !== undefined) out.avatar = AVATAR.test(String(out.avatar)) ? String(out.avatar) : '';
  return out;
};
// 직원 시트의 팀 체크가 정답이다. 멤버십은 채널에만 저장하고 여기서 맞춘다(전체는 모든 회사 채널).
const syncTeams = (e, teamIds) => {
  if (!Array.isArray(teamIds)) return;
  const ids = new Set(teamIds.map(String));
  for (const c of state.channels) {
    if (c.id === 'general') continue;
    const has = c.members.includes(e.id);
    if (ids.has(c.id) && !has) c.members.push(e.id);
    if (!ids.has(c.id) && has) c.members = c.members.filter(id => id !== e.id);
  }
};
const knownMembers = v => Array.isArray(v) ? state.employees.filter(e => v.includes(e.id)).map(e => e.id) : [];

app.get('/api/state', (req, res) => res.json(publicState()));

app.put('/api/settings', (req, res) => {
  const { keys = {}, clearKeys, search, mcpConfig, userName, companyName, ranks, app: appCfg } = req.body;
  for (const [k, v] of Object.entries(keys))
    if (typeof v === 'string' && v.trim() && !isMasked(v)) state.settings.keys[k] = v.trim();
  // 마스킹이라 평문을 되돌려 줄 수 없어, 지우는 건 명시 요청으로만 받는다
  for (const k of Array.isArray(clearKeys) ? clearKeys : [])
    if (k in state.settings.keys) state.settings.keys[k] = '';
  if (search && typeof search === 'object') {
    const s = state.settings.search;
    if (typeof search.provider === 'string') s.provider = search.provider.trim() || 'auto';
    if (typeof search.googleCx === 'string') s.googleCx = search.googleCx.trim();
    if (typeof search.searxngUrl === 'string') s.searxngUrl = search.searxngUrl.trim();
  }
  if (userName) state.user.name = userName;
  if (companyName) state.company.name = companyName;
  if (Array.isArray(ranks) && ranks.length) state.ranks = ranks;
  if (appCfg && typeof appCfg === 'object') {
    const a = state.settings.app, wasHeadless = a.headless;
    if (Number.isFinite(+appCfg.maxSteps)) a.maxSteps = Math.min(60, Math.max(1, +appCfg.maxSteps));
    if (typeof appCfg.headless === 'boolean') a.headless = appCfg.headless;
    if (typeof appCfg.computerEnabled === 'boolean') a.computerEnabled = appCfg.computerEnabled;
    if (typeof appCfg.startUrl === 'string') a.startUrl = appCfg.startUrl.trim();
    if (a.headless !== wasHeadless) resetBrowser();
  }
  const mcpChanged = typeof mcpConfig === 'string' && mcpConfig !== state.settings.mcpConfig;
  if (typeof mcpConfig === 'string') state.settings.mcpConfig = mcpConfig;
  changed(); ok(res);
  if (mcpChanged) connectMcp();
});
app.post('/api/mcp/reconnect', async (req, res) => { await connectMcp(); ok(res); });

// ---------- MCP 원클릭 연결 ----------
const toArgs = a => Array.isArray(a) ? a.map(String) : String(a || '').trim().split(/\s+/).filter(Boolean);
const toObj = v => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  return JSON.parse(String(v));            // 파싱 실패는 아래 try에서 400으로
};

async function saveServers(mutate, res) {
  let draft;
  try { draft = mutate(mcpServersObj()); }
  catch (e) { return res.status(400).json({ error: '입력 형식 오류: ' + e.message }); }
  if (draft?.error) return res.status(draft.status || 400).json({ error: draft.error });
  writeMcpServers(draft);
  await connectMcp();
  res.json({ ok: true, status: state.mcpStatus });
}

app.post('/api/mcp/servers', (req, res) => saveServers(({ ok, servers, error }) => {
  if (!ok) return { error: '저장된 MCP JSON이 해석되지 않습니다: ' + error };
  const { name, command, url, args, env, headers } = req.body || {};
  const key = String(name || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,48}$/.test(key)) return { error: '서버 이름은 1~48자의 영문·숫자·._-만 쓸 수 있습니다' };
  if (servers[key]) return { error: `${key}는 이미 등록된 서버입니다. 다른 이름으로 만들거나 먼저 삭제하세요.` };
  const cmd = String(command || '').trim(), href = String(url || '').trim();
  if (!cmd && !href) return { error: '명령어(stdio) 또는 URL(http) 중 하나를 채워주세요' };
  const extra = { env: toObj(env), headers: toObj(headers) };
  if (extra.env.GITHUB_TOKEN === '') delete extra.env.GITHUB_TOKEN;
  servers[key] = {
    ...(cmd ? { command: cmd.split(/\s+/)[0], args: [...cmd.split(/\s+/).slice(1), ...toArgs(args)] } : { url: href }),
    ...Object.fromEntries(Object.entries(extra).filter(([, v]) => Object.keys(v).length).map(([k, v]) => [k, v])),
    enabled: true,
  };
  return servers;
}, res));

app.delete('/api/mcp/servers/:name', (req, res) => saveServers(({ ok, servers, error }) => {
  if (!ok) return { error: '저장된 MCP JSON이 해석되지 않습니다: ' + error };
  if (!servers[req.params.name]) return { error: `${req.params.name} 서버가 없습니다` };
  delete servers[req.params.name];
  state.employees.forEach(e => {
    if (Array.isArray(e.tools?.mcp)) e.tools.mcp = e.tools.mcp.filter(x => x !== req.params.name);
  });
  return servers;
}, res));

app.put('/api/mcp/servers/:name', (req, res) => saveServers(({ ok, servers, error }) => {
  if (!ok) return { error: '저장된 MCP JSON이 해석되지 않습니다: ' + error };
  const s = servers[req.params.name];
  if (!s) return { error: `${req.params.name} 서버가 없습니다` };
  if (typeof req.body?.enabled === 'boolean') s.enabled = req.body.enabled;
  return servers;
}, res));

// 서버 하나를 전 직원 권한에 즉시 반영
app.post('/api/mcp/grant', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: '서버 이름이 필요합니다' });
  state.employees.forEach(e => {
    e.tools = e.tools || {};
    if (e.tools.mcp === 'all') return;
    const arr = Array.isArray(e.tools.mcp) ? e.tools.mcp : [];
    if (!arr.includes(name)) arr.push(name);
    e.tools.mcp = arr;
  });
  changed(); ok(res);
});

app.post('/api/search/test', async (req, res) => {
  const query = String(req.body?.query || '').trim();
  if (!query) return res.status(400).json({ error: '검색어를 입력하세요' });
  try { res.json({ result: await testSearch(query, req.body?.engine) }); }
  catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

// 제공사별 실제 모델 ID 목록 — 오타 404를 고르는 가장 빠른 길
app.post('/api/models', async (req, res) => {
  const provider = String(req.body?.provider || 'custom');
  const baseUrl = String(req.body?.baseUrl || '').trim();
  const typed = String(req.body?.apiKey || '');
  // 평문 키를 되돌려 줄 수 없으니 마스킹 값은 "저장된 키 그대로"로 해석한다
  const saved = state.employees.find(x => x.id === req.body?.empId)?.apiKey || '';
  const apiKey = typed && !isMasked(typed) ? typed.trim() : saved;
  try { res.json({ models: await listModels({ provider, baseUrl, keys: state.settings.keys, apiKey }) }); }
  catch (e) { res.status(502).json({ error: String(e.message || e) }); }
});

app.put('/api/company', (req, res) => {
  if (typeof req.body.goal === 'string') state.company.goal = req.body.goal;
  if (req.body.name) state.company.name = req.body.name;
  changed(); ok(res);
});
app.post('/api/company/start', (req, res) => {
  state.company.running = true;
  state.company.startedAt = Date.now();          // 이번 가동 구분자 — 종료 보고서를 한 번만 쓴다
  // 결재 때문에 멈춰 있던 업무는 가동과 함께 다시 결재 대기 상태로 올린다.
  state.tasks.forEach(t => {
    if (t.status === 'paused' && t.error === '결재 대기 중 일시정지' && state.approvals.some(a => a.id === t.blockedBy && a.status === 'pending')) {
      t.status = 'blocked'; delete t.error;
    }
  });
  const L = leader();
  const open = state.tasks.some(t => t.status !== 'done');
  if (L && state.company.goal && !open && !L.inbox.length) {
    L.inbox.push({ from: 'system', channel: null,
      text: `회사가 가동되었습니다. 회사 목표: "${state.company.goal}"\n대표로서 목표 달성 계획을 세우고, 팀원의 직무·모델 특성을 고려해 assign_task로 업무를 배분하세요. 계획은 send_message로 "전체" 채널에 공유하세요.` });
  }
  changed(); ok(res);
});
app.post('/api/company/pause', (req, res) => {
  state.company.running = false;
  abortAll();                                   // 진행 중인 작업(컴퓨터 조작 포함) 즉시 중단
  // 진행 중이던 업무는 할 일로 되돌리지 않고 멈춤으로 세운다. 다시 켜도 같은 작업이 저절로 재실행되지 않는다.
  // 결재 대기 중인 업무도 멈춤으로 세운다. 승인하면 할 일로 돌아와 다음 가동부터 이어진다.
  state.tasks.forEach(t => {
    if (t.status === 'doing') { t.status = 'paused'; t.error = '일시정지됨'; }
    else if (t.status === 'blocked') { t.status = 'paused'; t.error = '결재 대기 중 일시정지'; }
  });
  // 오너가 보낸 메시지(지시·취소·결재 결과)는 대기열에 남겨 다음 가동 때 읽고, 직원 간 잡담은 버린다.
  state.employees.forEach(e => { e.inbox = e.inbox.filter(m => m.from === 'user'); });
  changed(); ok(res);
});

app.post('/api/employees', (req, res) => {
  const e = { id: uid(), status: 'idle', activity: '대기 중', inbox: [], memory: [], apiKey: '', avatar: '',
    tools: { web: true, browser: false, computer: false, mcp: [] }, color: '#4f46e5', ...pick(req.body) };
  if (typeof req.body.apiKey === 'string' && !isMasked(req.body.apiKey)) e.apiKey = req.body.apiKey.trim();
  state.employees.push(e);
  syncTeams(e, req.body.teams);
  changed(); res.json(publicState().employees.find(x => x.id === e.id));
});
app.put('/api/employees/:id', (req, res) => {
  const e = state.employees.find(x => x.id === req.params.id);
  if (!e) return res.status(404).end();
  Object.assign(e, pick(req.body));
  if (typeof req.body.apiKey === 'string' && !isMasked(req.body.apiKey)) e.apiKey = req.body.apiKey.trim();
  syncTeams(e, req.body.teams);
  changed(); ok(res);
});
app.delete('/api/employees/:id', (req, res) => {
  state.employees = state.employees.filter(x => x.id !== req.params.id);
  state.channels.forEach(c => { c.members = (c.members || []).filter(id => id !== req.params.id); });
  changed(); ok(res);
});
app.post('/api/employees/:id/reset', (req, res) => {
  const e = state.employees.find(x => x.id === req.params.id);
  if (e) { e.memory = []; e.inbox = []; changed(); }
  ok(res);
});

app.post('/api/tasks', (req, res) => {
  const { title, description = '', assigneeId } = req.body;
  if (!title || !assigneeId) return res.status(400).json({ error: '제목과 담당자가 필요합니다' });
  const t = { id: uid().slice(0, 5), title, description, assigneeId, assignerId: 'user', status: 'todo', createdAt: Date.now() };
  state.tasks.push(t); changed(); res.json(t);
});
app.put('/api/tasks/:id', (req, res) => {
  const t = state.tasks.find(x => x.id === req.params.id);
  // 오너가 화면에서 바꿀 수 있는 상태만 받는다. doing/blocked은 엔진이 관리한다.
  const next = ['todo', 'paused', 'done'].includes(req.body.status) ? req.body.status : null;
  if (t && next) {
    if (t.status === 'doing' && next !== 'doing') stopTask(t.id);   // 재개/멈춤 시 밀리는 실행을 끊는다
    t.status = next;
    if (next === 'todo') { delete t.error; delete t.note; delete t.blockedBy; }
    if (next === 'paused') t.error = '오너가 멈춤';
    if (next === 'done') { t.doneAt = Date.now(); t.result = t.result || '오너가 직접 완료 처리했습니다'; }
  }
  changed(); ok(res);
});
app.delete('/api/tasks/:id', (req, res) => {
  const t = state.tasks.find(x => x.id === req.params.id);
  if (t) { stopTask(t.id); cancelTask(t); }      // 진행 중이면 그 자리에서 끊고, 취소 사실을 직원에게 알린다
  ok(res);
});

// ---------- 결재 ----------
app.post('/api/approvals/:id', (req, res) => {
  const a = decideApproval(req.params.id, !!req.body?.approved, String(req.body?.note || ''));
  if (!a) return res.status(409).json({ error: '이미 처리됐거나 없는 결재 서류입니다' });
  res.json({ status: a.status });
});

// ---------- 작업 종료 보고서 ----------
app.get('/api/report/:name', (req, res) => {
  const name = safeReportName(req.params.name);
  if (!name) return res.status(400).json({ error: '보고서 이름 형식이 올바르지 않습니다' });
  const f = path.join(reportDir(), name);
  if (!fs.existsSync(f)) return res.status(404).json({ error: '보고서 파일이 없습니다. 서버가 재시작되면 사라질 수 있습니다' });
  res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${name}"; filename*=UTF-8''${encodeURIComponent(`작업보고-${name.slice(7, 15)}.md`)}`);
  fs.createReadStream(f).pipe(res);
});

app.post('/api/messages', (req, res) => {
  const { channel, text } = req.body;
  if (!channel || !text?.trim()) return res.status(400).end();
  res.json(postMessage(channel, 'user', text.trim()));
});
app.post('/api/channels', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).end();
  const c = { id: uid(), name, members: knownMembers(req.body.members) };
  state.channels.push(c); changed(); res.json(c);
});
app.put('/api/channels/:id', (req, res) => {
  const c = state.channels.find(x => x.id === req.params.id);
  const name = String(req.body.name || '').trim();
  if (!c || !name) return res.status(400).json({ error: '채널 또는 이름이 올바르지 않습니다' });
  c.name = name;
  // "전체"는 전원 고정 — 멤버를 걸면 팀 채널이 아니게 된다
  if (Array.isArray(req.body.members) && c.id !== 'general') c.members = knownMembers(req.body.members);
  changed(); ok(res);
});
app.delete('/api/channels/:id', (req, res) => {
  state.channels = state.channels.filter(x => x.id !== req.params.id);
  state.messages = state.messages.filter(m => m.channel !== req.params.id);
  if (req.params.id === 'general') state.channels.unshift({ id: 'general', name: '전체', members: [] });
  changed(); ok(res);
});
app.delete('/api/logs', (req, res) => { state.logs = []; changed(); ok(res); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Virtual Company → http://localhost:${PORT}`));
startEngine();
connectMcp();
// 종료 전 대기 중인 저장을 반드시 반영한다 (안 그러면 방금 저장한 키/설정이 유실)
async function shutdown() { flush(); await closeAll(); process.exit(0); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('exit', flush);
