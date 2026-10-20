import fs from 'fs';
import { randomUUID } from 'crypto';
import { PROVIDERS, SEARCH_ENGINES, SEARCH_ORDER, MCP_PRESETS, PROVIDER_GROUPS } from './catalog.js';

export const catalog = { providers: PROVIDERS, providerGroups: PROVIDER_GROUPS, searchEngines: SEARCH_ENGINES, searchOrder: SEARCH_ORDER, mcpPresets: MCP_PRESETS };

const FILE = process.env.DATA_FILE || './data.json';
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
    company: { name: 'Virtual Company', goal: '', running: false },
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
    s.tasks.forEach(t => { if (t.status === 'doing') t.status = 'todo'; });
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
  t.status = 'done'; t.result = String(result || ''); t.doneAt = Date.now(); delete t.error;
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
