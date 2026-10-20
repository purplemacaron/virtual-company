import express from 'express';
import http from 'http';
import { WebSocketServer } from 'ws';
import { state, changed, publicState, onEvent, screens, uid, postMessage, leader } from './store.js';
import { startEngine, abortAll } from './engine.js';
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
const EMP_FIELDS = ['name', 'rank', 'role', 'provider', 'model', 'baseUrl', 'persona', 'color', 'tools'];
// 마스킹된 값(••••)은 "변경 없음"으로 취급해 클라이언트에 평문 키를 내려보내지 않는다
const isMasked = v => typeof v === 'string' && v.startsWith('••••');
const pick = o => {
  const out = Object.fromEntries(EMP_FIELDS.filter(k => o[k] !== undefined).map(k => [k, o[k]]));
  if (out.baseUrl !== undefined) out.baseUrl = String(out.baseUrl).trim();
  if (out.model !== undefined) out.model = String(out.model).trim();
  return out;
};

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

app.put('/api/company', (req, res) => {
  if (typeof req.body.goal === 'string') state.company.goal = req.body.goal;
  if (req.body.name) state.company.name = req.body.name;
  changed(); ok(res);
});
app.post('/api/company/start', (req, res) => {
  state.company.running = true;
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
  state.employees.forEach(e => { e.inbox = e.inbox.filter(m => m.from === 'user'); });
  changed(); ok(res);
});

app.post('/api/employees', (req, res) => {
  const e = { id: uid(), status: 'idle', activity: '대기 중', inbox: [], memory: [], apiKey: '',
    tools: { web: true, browser: false, computer: false, mcp: [] }, color: '#4f46e5', ...pick(req.body) };
  if (typeof req.body.apiKey === 'string' && !isMasked(req.body.apiKey)) e.apiKey = req.body.apiKey.trim();
  state.employees.push(e); changed(); res.json(publicState().employees.find(x => x.id === e.id));
});
app.put('/api/employees/:id', (req, res) => {
  const e = state.employees.find(x => x.id === req.params.id);
  if (!e) return res.status(404).end();
  Object.assign(e, pick(req.body));
  if (typeof req.body.apiKey === 'string' && !isMasked(req.body.apiKey)) e.apiKey = req.body.apiKey.trim();
  changed(); ok(res);
});
app.delete('/api/employees/:id', (req, res) => {
  state.employees = state.employees.filter(x => x.id !== req.params.id); changed(); ok(res);
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
  if (t && req.body.status) t.status = req.body.status;
  changed(); ok(res);
});
app.delete('/api/tasks/:id', (req, res) => { state.tasks = state.tasks.filter(x => x.id !== req.params.id); changed(); ok(res); });

app.post('/api/messages', (req, res) => {
  const { channel, text } = req.body;
  if (!channel || !text?.trim()) return res.status(400).end();
  res.json(postMessage(channel, 'user', text.trim()));
});
app.post('/api/channels', (req, res) => {
  const name = String(req.body.name || '').trim();
  if (!name) return res.status(400).end();
  const c = { id: uid(), name }; state.channels.push(c); changed(); res.json(c);
});
app.put('/api/channels/:id', (req, res) => {
  const c = state.channels.find(x => x.id === req.params.id);
  const name = String(req.body.name || '').trim();
  if (!c || !name) return res.status(400).json({ error: '채널 또는 이름이 올바르지 않습니다' });
  c.name = name; changed(); ok(res);
});
app.delete('/api/channels/:id', (req, res) => {
  state.channels = state.channels.filter(x => x.id !== req.params.id);
  state.messages = state.messages.filter(m => m.channel !== req.params.id);
  if (req.params.id === 'general') state.channels.unshift({ id: 'general', name: '전체' });
  changed(); ok(res);
});
app.delete('/api/logs', (req, res) => { state.logs = []; changed(); ok(res); });

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Virtual Company → http://localhost:${PORT}`));
startEngine();
connectMcp();
process.on('SIGINT', async () => { await closeAll(); process.exit(0); });
