import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PROVIDERS, SEARCH_ENGINES, SEARCH_ORDER, MCP_PRESETS, PROVIDER_GROUPS } from './catalog.js';

export const catalog = { providers: PROVIDERS, providerGroups: PROVIDER_GROUPS, searchEngines: SEARCH_ENGINES, searchOrder: SEARCH_ORDER, mcpPresets: MCP_PRESETS };

const FILE = process.env.DATA_FILE || './data.json';
const OUTDIR = process.env.REPORT_DIR || 'reports';
export const uid = () => randomUUID().replace(/-/g, '').slice(0, 8);
export const screens = new Map();
const listeners = new Set();
export const onEvent = fn => listeners.add(fn);
export const emit = msg => listeners.forEach(fn => fn(msg));

function emp(name, rank, role, provider, model, tools, persona, color) {
  return { id: uid(), name, rank, role, provider, model, baseUrl: '', tools, persona, color, apiKey: '', avatar: '',
    status: 'idle', activity: '대기 중', inbox: [], memory: [] };
}

// 카탈로그에 있는 모든 항목 한 칸씩 — 새 프로바이더/엔진을 추가하면 키 입력창도 같이 늘어난다
const emptyKeys = () => Object.fromEntries([...Object.keys(PROVIDERS), ...Object.keys(SEARCH_ENGINES)].map(k => [k, '']));

function defaults() {
  return {
    company: { name: 'Virtual Company', goal: '', running: false, startedAt: 0 },
    user: { name: '오너' },
    ranks: ['대표', '이사', '팀장', '사원'],
    settings: {
      keys: emptyKeys(),
      search: { provider: 'auto', googleCx: '', searxngUrl: '' },
      mcpConfig: JSON.stringify({ mcpServers: {} }, null, 2),
      app: { maxSteps: 8, headless: true, startUrl: '', computerEnabled: false },
    },
    mcpStatus: {},
    employees: [
      emp('클로이', '대표', 'CEO · 전략 총괄', 'anthropic', 'claude-opus-5-5',
        { web: true, browser: false, computer: false, mcp: 'all' },
        '회사 목표를 분석해 실행 가능한 업무로 쪼개고, 팀원 특성에 맞게 배분한다. 결과를 취합해 오너에게 보고한다.', '#111111'),
      emp('소피아', '이사', '개발 리드 · PC 조작 담당', 'anthropic', 'claude-sonnet-5',
        { web: true, browser: true, computer: true, mcp: 'all' },
        '기술 조사, 프로토타입, 웹 자동화, 실제 PC 조작을 담당한다. 꼼꼼하고 구조적으로 일한다.', '#4f46e5'),
      emp('지피', '팀장', '리서처', 'openai', 'gpt-5',
        { web: true, browser: true, computer: false, mcp: [] },
        '웹 검색과 자료 조사를 담당한다. 출처를 반드시 명시한다.', '#10a37f'),
      emp('제미', '사원', '마케터', 'gemini', 'gemini-2.5-flash',
        { web: true, browser: false, computer: false, mcp: [] },
        '시장, 경쟁사 분석과 카피라이팅을 담당한다.', '#1a73e8'),
      emp('하이쿠', '사원', '어시스턴트', 'anthropic', 'claude-haiku-4-5-20251001',
        { web: true, browser: false, computer: false, mcp: [] },
        '문서 정리, 요약, 간단한 조사 업무를 빠르게 처리한다.', '#d97706'),
    ],
    tasks: [],
    // 오너가 지운 업무의 이력. AI가 같은 일을 되살리는 것을 막는 근거로 쓴다.
    cancelled: [],
    approvals: [],
    lastRun: null,
    channels: [{ id: 'general', name: '전체', members: [] }, { id: 'random', name: '잡담', members: [] }],
    messages: [],
    logs: [],
  };
}

function load() {
  try {
    const s = JSON.parse(fs.readFileSync(FILE, 'utf8'));
    s.company.running = false;
    const d = defaults();
    s.settings.keys = { ...emptyKeys(), ...(s.settings.keys || {}) };
    s.settings.search = { ...d.settings.search, ...(s.settings.search || {}) };
    s.settings.app = { ...d.settings.app, ...(s.settings.app || {}) };
    s.settings.mcpConfig ||= d.settings.mcpConfig;
    s.employees.forEach(e => {
      e.status = 'idle'; e.activity = '대기 중'; e.inbox ||= []; e.memory ||= []; e.apiKey ||= ''; e.baseUrl ||= ''; e.avatar ||= '';
      // 이전 버전의 mcp true/false를 서버 이름 목록으로 승격
      if (e.tools?.mcp === true) e.tools.mcp = 'all';
      else if (e.tools && !Array.isArray(e.tools.mcp)) e.tools.mcp = [];
    });
    // 멤버가 있는 채널이 곧 팀이다. 기존 채널은 멤버 없는 일반 채널로 남는다.
    s.channels ||= [];
    s.channels.forEach(c => { c.members ||= []; });
    s.cancelled ||= []; s.approvals ||= []; s.lastRun ||= null;
    s.company.startedAt ||= 0;
    // 진행 중이던 업무는 자동으로 다시 달리지 않는다. 멈춤으로 두고 화면에서 명시적으로 재개한다.
    // 결재 서류는 서버가 꺼져도 만료되지 않는다 → 대기 중인 결재에 묶인 업무는 결재 상태를 그대로 유지한다.
    const waiting = new Set(s.approvals.filter(a => a.status === 'pending').map(a => a.id));
    s.tasks.forEach(t => {
      if (t.status === 'doing') { t.status = 'paused'; t.note = '서버가 꺼진 사이 멈췄습니다'; }
      if (t.status === 'blocked' && !waiting.has(t.blockedBy)) { t.status = 'paused'; delete t.blockedBy; }
    });
    return s;
  } catch { return defaults(); }
}

export const state = load();

// 직원 키 우선, 비어 있으면 제공사별 전역 키로 폴백
export const resolveKey = e => e.apiKey || state.settings.keys[e.provider] || '';
export const maskKey = k => k ? '••••' + k.slice(-4) : '';

let pushT = null, saveT = null;
export function changed() {
  if (!pushT) pushT = setTimeout(() => { pushT = null; emit({ type: 'state', state: publicState() }); }, 120);
  if (!saveT) saveT = setTimeout(() => { saveT = null; fs.writeFile(FILE, JSON.stringify(state), e => { if (e) console.error('data.json 저장 실패:', e.message); }); }, 600);
}

// 종료 직전 대기 중인 저장까지 확실히 쓴다. 이 걸림없면 창을 강제로 닫을 때 방금 넣은 API 키가 사라진다.
export function flush() {
  clearTimeout(saveT); saveT = null;
  try { fs.writeFileSync(FILE, JSON.stringify(state)); }
  catch (e) { console.error('data.json 저장 실패:', e.message); }
}

export function publicState() {
  const { settings, ...rest } = state;
  return {
    ...rest,
    catalog,
    employees: state.employees.map(({ memory, inbox, apiKey, ...e }) => ({
      ...e, queue: inbox.length, hasKey: !!apiKey, keyHint: maskKey(apiKey),
      usingGlobalKey: !apiKey && !!settings.keys[e.provider],
    })),
    messages: state.messages.slice(-500),
    logs: state.logs.slice(-300),
    settings: {
      mcpConfig: settings.mcpConfig,
      app: settings.app,
      search: settings.search,
      keys: Object.fromEntries(Object.entries(settings.keys).map(([k, v]) => [k, maskKey(v)])),
    },
  };
}

export const findEmp = id => state.employees.find(e => e.id === id);
export const findEmpByName = n => {
  const name = String(n || '').trim().replace(/^@/, '');
  return state.employees.find(e => e.name === name) || state.employees.find(e => name.includes(e.name));
};
export const nameOf = id => id === 'user' ? state.user.name : id === 'system' ? '시스템' : (findEmp(id)?.name || '?');
export const rankIdx = e => { const i = state.ranks.indexOf(e.rank); return i < 0 ? 99 : i; };
export const leader = () => [...state.employees].sort((a, b) => rankIdx(a) - rankIdx(b))[0];
export const dmChannel = (a, b) => 'dm:' + [a, b].sort().join(':');
// 멤버가 1명 이상인 채널이 팀이다. 직원의 소속은 채널에서 역산한다(중복 저장이 없다).
export const teamChannels = () => state.channels.filter(c => c.members?.length);
export const teamsOf = id => state.channels.filter(c => c.members?.includes(id)).map(c => c.name);

export function addLog(empId, text, kind = 'info') {
  state.logs.push({ id: uid(), ts: Date.now(), empId, text: String(text).slice(0, 600), kind });
  if (state.logs.length > 600) state.logs.splice(0, 100);
  changed();
}

// 직원 간 메시지 무한 핑퐁 방지 (같은 방향 3분에 4회까지)
const a2a = new Map();
function allowA2A(from, to) {
  const k = from + '>' + to, now = Date.now();
  const arr = (a2a.get(k) || []).filter(t => now - t < 180000);
  if (arr.length >= 4) return false;
  arr.push(now); a2a.set(k, arr); return true;
}

export function postMessage(channel, from, text) {
  const m = { id: uid(), channel, from, text: String(text), ts: Date.now() };
  state.messages.push(m);
  if (state.messages.length > 1500) state.messages.splice(0, 300);

  const targets = new Set();
  if (channel.startsWith('dm:')) channel.slice(3).split(':').forEach(id => targets.add(id));
  else {
    state.employees.forEach(e => { if (m.text.includes('@' + e.name)) targets.add(e.id); });
    if (from === 'user' && !targets.size && leader()) targets.add(leader().id);
  }
  for (const id of targets) {
    const e = findEmp(id);
    if (!e || id === from) continue;
    if (from !== 'user' && !allowA2A(from, id)) continue;
    e.inbox.push({ channel, from, text: m.text });
  }
  changed();
  return m;
}

export function completeTask(t, emp, result) {
  t.status = 'done'; t.result = String(result || ''); t.doneAt = Date.now(); delete t.error; delete t.blockedBy;
  addLog(emp.id, `업무 완료 · #${t.id} ${t.title}`, 'done');
  if (t.assignerId === 'user') {
    postMessage(dmChannel('user', emp.id), emp.id, `업무 #${t.id} 「${t.title}」 완료 보고드립니다.\n\n${t.result}`);
  } else {
    const boss = findEmp(t.assignerId);
    if (boss && boss.id !== emp.id) boss.inbox.push({ from: 'system', channel: null,
      text: `[완료 보고] ${emp.name}(${emp.rank})님이 업무 #${t.id} 「${t.title}」를 완료했습니다.\n결과:\n${t.result.slice(0, 4000)}\n\n필요하면 후속 업무를 지시하고, 목표가 달성되었으면 send_message(to="user")로 오너에게 최종 보고하세요.` });
  }
  changed();
}

// ---------- 오너가 지운 업무 ----------
// 제목을 규칙화해 저장한다. AI가 표기만 바꿔 같은 업무를 다시 만들면 여전히 취소된 업무로 판정된다.
const normTitle = t => String(t || '').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '').slice(0, 80);
export const isCancelled = title => state.cancelled.some(c => c.key === normTitle(title));

export function cancelTask(t) {
  state.tasks = state.tasks.filter(x => x.id !== t.id);
  state.cancelled.push({ id: t.id, key: normTitle(t.title), title: String(t.title).slice(0, 120), ts: Date.now() });
  if (state.cancelled.length > 60) state.cancelled.splice(0, 30);
  // 담당자·지시자 모두에게 알린다. 한쪽만 알면 다른 쪽이 같은 일을 다시 지시한다.
  for (const id of new Set([t.assigneeId, t.assignerId])) {
    const e = findEmp(id);
    if (!e) continue;
    e.inbox = e.inbox.filter(m => !m.text?.includes(`#${t.id}`));
    e.inbox.push({ from: 'user', channel: null,
      text: `[업무 취소] #${t.id} 「${t.title}」를 오너가 삭제했습니다. 이 작업을 중단하고 같은 내용으로 다시 지시하거나 수행하지 마세요.` });
  }
  addLog('user', `업무 취소 · #${t.id} ${t.title}`, 'error');
  changed();
}

// ---------- 결재 서류 ----------
export function requestApproval(emp, { title, detail, taskId }) {
  const a = { id: uid().slice(0, 5), empId: emp.id, title: String(title || '').slice(0, 120),
    detail: String(detail || '').slice(0, 4000), taskId: taskId || null, status: 'pending', createdAt: Date.now() };
  state.approvals.push(a);
  if (state.approvals.length > 60) state.approvals = state.approvals.slice(-40);
  addLog(emp.id, `결재 상신 · ${a.title}`, 'info');
  postMessage(dmChannel('user', emp.id), emp.id,
    `[결재 요청] ${a.title}\n${a.detail}\n\n오피스 오른쪽 결재함에서 승인하거나 반려하세요. 승인 전에는 이 행동을 하지 않습니다.`);
  changed();
  return a;
}

export function decideApproval(id, approved, note = '') {
  const a = state.approvals.find(x => x.id === id);
  if (!a || a.status !== 'pending') return null;
  a.status = approved ? 'approved' : 'rejected';
  a.note = String(note || '').slice(0, 1000);
  a.decidedAt = Date.now();
  const e = findEmp(a.empId);
  if (e) e.inbox.push({ from: 'user', channel: null, text: approved
    ? `[결재 승인] 「${a.title}」${a.note ? ` · 오너 메모: ${a.note}` : ''}\n${a.taskId ? `업무 #${a.taskId}를 계속 수행하세요.` : '이어서 진행하세요.'}`
    : `[결재 반려] 「${a.title}」${a.note ? ` · 사유: ${a.note}` : ''}\n이 행동은 수행하지 마세요. 안전한 대안으로 진행하거나 오너에게 무엇을 막혔는지 보고하세요.` });
  const t = state.tasks.find(x => x.id === a.taskId);
  // 결재 때문에 서 있던 업무만 할 일로 되돌린다. 오너가 직접 멈춰 세운 업무는 그대로 둔다.
  if (t && (t.status === 'blocked' || (t.status === 'paused' && (t.blockedBy === a.id || String(t.error || '').startsWith('결재'))))) {
    t.status = 'todo'; delete t.error; delete t.blockedBy;
  }
  addLog('user', `결재 ${approved ? '승인' : '반려'} · ${a.title}`, approved ? 'done' : 'error');
  changed();
  return a;
}

// ---------- 작업 종료 보고서 ----------
const pad = n => String(n).padStart(2, '0');
const stamp = ts => { const d = new Date(ts);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
export const safeReportName = n => /^report-\d{14}\.md$/.test(String(n)) ? String(n) : null;
export const reportDir = () => OUTDIR;

export function writeReport() {
  const at = Date.now();
  const done = state.tasks.filter(t => t.status === 'done');
  const lines = [
    `# ${state.company.name} · 작업 종료 보고서`,
    `생성 시각: ${new Date(at).toLocaleString('ko-KR')}`,
    `회사 목표: ${state.company.goal || '(미설정)'}`,
    '',
    `## 완료된 업무 (${done.length}건)`,
  ];
  if (!done.length) lines.push('(없음)');
  done.forEach((t, i) => {
    lines.push(`\n### ${i + 1}. ${t.title}`,
      `- 담당: ${nameOf(t.assigneeId)} / 지시: ${nameOf(t.assignerId)}`,
      `- 내용: ${t.description || '-'}`,
      `- 완료 시각: ${new Date(t.doneAt || at).toLocaleString('ko-KR')}`,
      `- 결과:\n\n${String(t.result || '(결과 없음)').split('\n').map(l => '  ' + l).join('\n')}`);
  });
  const stuck = state.tasks.filter(t => ['paused', 'failed'].includes(t.status));
  lines.push(`\n## 멈춤·실패 (${stuck.length}건)`);
  if (!stuck.length) lines.push('(없음)');
  stuck.forEach(t => lines.push(`- ${t.title} [${t.status}] · 담당 ${nameOf(t.assigneeId)} · ${t.error || t.note || '사유 없음'}`));
  const gone = state.cancelled.slice(-10);
  if (gone.length) { lines.push('\n## 오너가 취소한 업무'); gone.forEach(c => lines.push(`- ${c.title}`)); }
  const apps = state.approvals.slice(-10);
  if (apps.length) {
    lines.push('\n## 결재');
    apps.forEach(a => lines.push(`- ${a.title} · ${nameOf(a.empId)} · ${{ pending: '대기', approved: '승인', rejected: '반려', expired: '만료' }[a.status] || a.status}${a.note ? ` · 메모: ${a.note}` : ''}`));
  }
  const text = lines.join('\n');
  fs.mkdirSync(OUTDIR, { recursive: true });
  const name = `report-${stamp(at)}.md`;
  fs.writeFileSync(path.join(OUTDIR, name), text, 'utf8');
  return { name, at, path: path.join(OUTDIR, name), done: done.length, stuck: stuck.length };
}

export function finishRun() {
  const r = writeReport();
  state.company.running = false;
  state.company.finishedAt = r.at;
  state.lastRun = { at: r.at, file: r.name, done: r.done, stuck: r.stuck, goal: state.company.goal };
  addLog('system', `작업 종료 · 완료 ${r.done}건 · 멈춤/실패 ${r.stuck}건 · 보고서 ${r.name}`, 'done');
  emit({ type: 'notice', title: '작업 종료', body: `업무가 모두 끝났습니다 (완료 ${r.done}건). 보고서: ${r.name}` });
  changed();
  return r;
}
