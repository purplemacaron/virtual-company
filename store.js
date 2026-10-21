import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import { PROVIDERS, SEARCH_ENGINES, SEARCH_ORDER, MCP_PRESETS, PROVIDER_GROUPS } from './catalog.js';

export const catalog = { providers: PROVIDERS, providerGroups: PROVIDER_GROUPS, searchEngines: SEARCH_ENGINES, searchOrder: SEARCH_ORDER, mcpPresets: MCP_PRESETS };

const FILE = process.env.DATA_FILE || './data.json';
const TMP = FILE + '.tmp';
const BAK = FILE + '.bak';
const OUTDIR = process.env.REPORT_DIR || 'reports';
const UPLOADS = process.env.UPLOAD_DIR || 'uploads';
export const uid = () => randomUUID().replace(/-/g, '').slice(0, 8);
const pad = n => String(n).padStart(2, '0');
const stamp = ts => { const d = new Date(ts);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`; };
export const safeReportName = n => /^report-\d{14}\.md$/.test(String(n)) ? String(n) : null;
export const reportDir = () => OUTDIR;
export const uploadDir = () => UPLOADS;
export const kb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';

// ---------- 오너의 업무 명령 첨부 ----------
// 본체는 data.json에 박지 않고 uploads/ 에 파일로만 둔다. state에는 메타정보만 들어간다.
// file 칸은 구분자(경로)를 절대 허용하지 않는다 — 저장된 이름으로 읽을 때 임의 경로로 빠져나갈 구멍을 없앤다.
const ATT_FILE = /^[\w.\-() 가-힣]{1,150}$/;
const ATT_MAX = 8 * 1024 * 1024;               // 첨부 한 장 최대 8MB
const ATT_TEXT_MAX = 512 * 1024;               // 이보다 큰 "텍스트"는 본문 대신 경로만 전달한다
const ATT_INLINE = 20000;                      // 지시문에 박아 넣는 본문 최대 글자 수
const TEXT_EXT = /\.(md|markdown|txt|csv|tsv|json|jsonl|ya?ml|xml|html?|js|jsx|mjs|ts|tsx|py|java|kt|c|h|cpp|cs|go|rs|rb|php|swift|sh|bash|bat|ps1|sql|ini|conf|toml|log|svg|srt|vtt|tex|r)$/i;
export const isTextAttachment = (mime, name) =>
  /^(text\/|application\/(json|xml|x-yaml|x-yaml|javascript|toml|csv))/i.test(String(mime || ''))
  || TEXT_EXT.test(String(name || ''));
const safeFileName = n => {
  const base = path.basename(String(n || 'file')).replace(/[^\w.\-() 가-힣]/g, '_').slice(0, 100);
  return base.replace(/^\.+/, '') || 'file';
};
// 브라우저가 올려준 첨부를 디스크에 쓰고, state에 들어갈 메타정보만 돌려준다.
export function saveAttachment({ name, mime, buf }) {
  if (!buf?.length) throw new Error('파일이 비어 있습니다');
  if (buf.length > ATT_MAX) throw new Error(`${kb(buf.length)}은 첨부 한계(${kb(ATT_MAX)})를 넘습니다`);
  fs.mkdirSync(UPLOADS, { recursive: true });
  const id = uid();
  const original = safeFileName(name);
  const file = `${id}-${original}`;
  if (!ATT_FILE.test(file)) throw new Error('파일 이름에 사용할 수 없는 문자가 있습니다');
  fs.writeFileSync(path.join(UPLOADS, file), buf);
  return { id, name: String(name || file).slice(0, 160), mime: String(mime || '').slice(0, 100),
    size: buf.length, kind: isTextAttachment(mime, original) && buf.length <= ATT_TEXT_MAX ? 'text' : 'binary',
    file, at: Date.now() };
}
// 브라우저에서 넘어온 첨부 목록을 우리가 만든 것만 남은 형태로 좁힌다 (경로·종류 검증 지점).
export const attList = v => Array.isArray(v) ? v.filter(a => a && a.id && ATT_FILE.test(String(a.file || ''))).map(a => ({
  id: String(a.id).replace(/[^\w-]/g, '').slice(0, 16), file: String(a.file).slice(0, 150),
  name: String(a.name || a.file).slice(0, 160), mime: String(a.mime || '').slice(0, 100),
  size: Number(a.size) || 0, kind: a.kind === 'text' ? 'text' : 'binary', at: Number(a.at) || Date.now(),
})).slice(0, 20) : [];
export const findAttachment = id => [state.company.attachments || [], ...(state.tasks || []).map(t => t.attachments || [])]
  .flat().find(a => a.id === String(id));
// 지시문 뒤에 붙일 첨부 블록. 텍스트는 본문을 옮겨 담고, 그 외 형식은 경로만 안내한다.
export function attachmentBlock(list) {
  const atts = list || [];
  if (!atts.length) return '';
  const body = atts.map((a, i) => {
    if (!ATT_FILE.test(String(a.file || ''))) return `${i + 1}. ${a.name} · (안전상 사용할 수 없는 파일명 — 다시 첨부해 주세요)`;
    const abs = path.resolve(UPLOADS, a.file);
    const head = `${i + 1}. ${a.name} · ${kb(a.size)} · 로컬 경로: ${abs}`;
    if (a.kind !== 'text') return `${head}\n   (이 형식은 서버가 본문을 읽지 않습니다. computer_open이나 browser_navigate(file://경로)로 열거나 파일을 읽을 수 있는 도구로 열어 보세요)`;
    let txt;
    try { txt = fs.readFileSync(abs, 'utf8'); } catch { return `${head}\n   (저장된 파일을 찾을 수 없습니다. 오너가 지시 전에 삭제했을 수 있습니다)`; }
    const cut = txt.length > ATT_INLINE;
    return `${head}\n${'─'.repeat(20)} 본문 시작 (${a.name}) ${'─'.repeat(20)}\n${txt.slice(0, ATT_INLINE)}${cut ? `\n…(본문 ${txt.length.toLocaleString()}자 중 ${ATT_INLINE.toLocaleString()}자만 실렸습니다 · 전체는 위 경로에 있습니다)` : ''}\n${'─'.repeat(20)} 본문 끝 ${'─'.repeat(20)}`;
  });
  return `\n\n[오너가 이 지시와 함께 첨부한 파일 ${atts.length}개 — 내용이 사실 데이터로 취급하고 그대로 사용하세요]\n${body.join('\n\n')}`;
}
// 더 이상 아무 지시도 참조하지 않는 첨부 파일을 지운다. 방금 올려 아직 제출 전인 파일은 건드리지 않는다.
export function pruneUploads(keep = 600000) {
  let names;
  try { names = fs.readdirSync(UPLOADS); } catch { return; }
  const live = new Set([state.company.attachments || [], ...state.tasks.map(t => t.attachments || [])].flat().map(a => a.file));
  const now = Date.now();
  for (const n of names) {
    if (live.has(n)) continue;
    try {
      const st = fs.statSync(path.join(UPLOADS, n));
      if (!st.isFile() || now - st.mtimeMs < keep) continue;
      fs.rmSync(path.join(UPLOADS, n));
    } catch { /* 한 개 실패가 나머지를 막지 못하게 */ }
  }
}

// ---------- 오너가 비우는 기록 ----------
// 종류별로 지우는 대상이 다르고 되돌릴 수 없다. 버튼에 개수를 띄우려면 화면 상태에_counts_가 함께 가야 한다.
export function wipeCounts() {
  return {
    memory: state.employees.reduce((n, e) => n + (e.memory?.length || 0), 0),
    queue: state.employees.reduce((n, e) => n + (e.inbox?.length || 0), 0),
    done: state.tasks.filter(t => t.status === 'done').length,
    open: state.tasks.filter(t => t.status !== 'done').length,
    messages: state.messages.length,
    cancelled: state.cancelled.length,
    logs: state.logs.length,
    uploads: [state.company.attachments || [], ...state.tasks.map(t => t.attachments || [])].flat().length,
  };
}
export const wipes = {
  // 직원이 자기 기억을 잃으면 진행 중인 업무의 맥락도 사라진다. 키·사진·직급·팀·도구 권한은 건드리지 않는다.
  memory: () => {
    const n = wipeCounts();
    state.employees.forEach(e => { e.memory = []; e.inbox = []; e.activity = '대기 중'; delete e.thought; delete e.cooldownUntil; });
    return `직원 ${state.employees.length}명의 대화 기억 ${n.memory}줄 · 대기 메시지 ${n.queue}건`;
  },
  // 완료 업무만 뽑는다. 멈춤·실패·대기 중인 일은 그대로 남고, 써 놓은 보고서 .md는 지우지 않는다.
  tasks: () => {
    const n = wipeCounts();
    state.tasks = state.tasks.filter(t => t.status !== 'done');
    // 기본 유예를 지킨다. 아직 지시하지 않고 올려만 둔 파일이 이 정리로 함께 사라지면 안 된다.
    pruneUploads();
    return `완료된 업무 ${n.done}건과 그 첨부 원본`;
  },
  messages: () => {
    const n = wipeCounts().messages;
    state.messages = [];
    return `대화 기록 ${n}건`;
  },
  // 톤스톤을 해제하면 오너가 지웠던 일을 같은 제목으로 다시 지시할 수 있다.
  cancelled: () => {
    const n = wipeCounts().cancelled;
    state.cancelled = [];
    return `취소 목록 ${n}건 · 같은 제목의 업무를 다시 지시할 수 있습니다`;
  },
  logs: () => {
    const n = wipeCounts().logs;
    state.logs = [];
    return `활동 로그 ${n}건`;
  },
};
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
    company: { name: 'Virtual Company', goal: '', running: false, startedAt: 0, logo: '', attachments: [] },
    user: { name: '오너' },
    ranks: ['대표', '이사', '팀장', '사원'],
    settings: {
      keys: emptyKeys(),
      theme: '',                                             // '' = 시스템 설정을 따른다
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

// mcp 권한: 구버전 true는 'all'로, 서버 이름 하나만 적힌 문자열은 목록으로 승격한다.
// 이미 'all'이거나 배열인 값은 그대로 둬야 한다 — !Array.isArray로 묶으면 'all'이 부팅마다 []로 초기화되었다.
const normMcp = v => v === true || v === 'all' ? 'all'
  : Array.isArray(v) ? v.filter(x => typeof x === 'string' && x)
    : !v || v === false ? [] : [String(v)];

// 저장된 상태를 지금 코드 모양으로 맞춘다. 없으면 비워 두지 않고 기본값으로 채운다.
function normalize(s) {
  const d = defaults();
  s.company = { ...d.company, ...(s.company || {}), running: false, startedAt: s.company?.startedAt || 0 };
  s.company.attachments = attList(s.company.attachments);   // 첨부 메타는 항상 우리 형식으로 좁힌다
  s.user ||= d.user;
  s.ranks ||= d.ranks;
  s.settings ||= {};
  s.settings.keys = { ...emptyKeys(), ...(s.settings.keys || {}) };
  s.settings.theme = ['light', 'dark'].includes(s.settings.theme) ? s.settings.theme : '';
  s.settings.search = { ...d.settings.search, ...(s.settings.search || {}) };
  s.settings.app = { ...d.settings.app, ...(s.settings.app || {}) };
  s.settings.mcpConfig ||= d.settings.mcpConfig;
  s.employees ||= d.employees;
  s.employees.forEach(e => {
    e.status = 'idle'; e.activity = '대기 중'; e.inbox ||= []; e.memory ||= []; e.apiKey ||= ''; e.baseUrl ||= ''; e.avatar ||= '';
    e.color ||= '#4f46e5';        // 색이 비면 <input type=color> 가 "undefined" 를 받아 경고를 남긴다
    e.tools ||= {}; e.tools.web = !!e.tools.web; e.tools.browser = !!e.tools.browser; e.tools.computer = !!e.tools.computer;
    e.tools.mcp = normMcp(e.tools.mcp);
  });
  // 멤버가 있는 채널이 곧 팀이다. 기존 채널은 멤버 없는 일반 채널로 남는다.
  s.channels ||= [];
  s.channels.forEach(c => { c.members ||= []; });
  s.tasks ||= []; s.messages ||= []; s.logs ||= []; s.mcpStatus ||= {};
  s.cancelled ||= []; s.approvals ||= []; s.lastRun ||= null;
  // 진행 중이던 업무는 자동으로 다시 달리지 않는다. 멈춤으로 두고 화면에서 명시적으로 재개한다.
  // 결재 서류는 서버가 꺼져도 만료되지 않는다 → 대기 중인 결재에 묶인 업무는 결재 상태를 그대로 유지한다.
  const waiting = new Set(s.approvals.filter(a => a.status === 'pending').map(a => a.id));
  s.tasks.forEach(t => {
    t.attachments = attList(t.attachments);
    if (t.status === 'doing') { t.status = 'paused'; t.note = '서버가 꺼진 사이 멈췄습니다'; }
    if (t.status === 'blocked' && !waiting.has(t.blockedBy)) { t.status = 'paused'; delete t.blockedBy; }
  });
  return s;
}

const readJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

// 읽기 실패를 조용히 기본값 대체로 넘기지 않는다. 손상 본은 반드시 다른 이름으로 남긴 뒤 복구 순서를 따른다.
function load() {
  if (!fs.existsSync(FILE)) return normalize(defaults());
  const cur = readJson(FILE);
  if (cur) return normalize(cur);
  const kept = `${FILE.replace(/\.json$/, '')}.corrupt-${stamp(Date.now())}.json`;
  try { fs.copyFileSync(FILE, kept); } catch { }
  const bak = readJson(BAK);
  if (bak) {
    console.error(`data.json이 손상되어 직전 본(.bak)으로 복구했습니다 · 손상 본은 ${kept} 에 보존`);
    return normalize(bak);
  }
  console.error(`data.json을 해석할 수 없어 새 회사로 시작합니다 · 손상 본은 ${kept} 에 그대로 있습니다 (되돌리려면 이 파일을 data.json으로 복사)`);
  return normalize(defaults());
}

export const state = load();
pruneUploads();                                 // 전에 쓰다 만 첨부는 부팅 때 한 번 정리한다

// 직원 키 우선, 비어 있으면 제공사별 전역 키로 폴백
export const resolveKey = e => e.apiKey || state.settings.keys[e.provider] || '';
export const maskKey = k => k ? '••••' + k.slice(-4) : '';

let pushT = null, saveT = null;
// 임시 파일에 끝까지 쓴 뒤 rename으로 갈아끼운다. 쓰는 도중 프로세스가 죽어도 data.json은 직전 온전한 본으로 남는다.
// 교체 전에 직전 본을 .bak으로 옮겨 두므로, 파일이 망가지면 직전 상태까지 되돌릴 수 있다.
function save() {
  const payload = JSON.stringify(state);
  try {
    fs.writeFileSync(TMP, payload);
    if (fs.existsSync(FILE)) fs.copyFileSync(FILE, BAK);
    try { fs.renameSync(TMP, FILE); }
    catch { fs.writeFileSync(FILE, payload); }   // rename이 파일 잠식에 막히면 내용만 교체한다 (TMP는 복구용으로 남김)
  } catch (e) { console.error('data.json 저장 실패:', e.message); }
}
export function changed() {
  if (!pushT) pushT = setTimeout(() => { pushT = null; emit({ type: 'state', state: publicState() }); }, 120);
  if (!saveT) saveT = setTimeout(() => { saveT = null; save(); }, 600);
}

// 키·MCP 권한·로고처럼 잃으면 아픈 변화는 600ms를 기다리지 않고 즉시 쓴다.
// 저장 직후 창을 닫으면(강제 종료) 아직 파일에 닿기 전이라 값이 초기화되어 보였다.
export function saveNow() { clearTimeout(saveT); saveT = null; save(); }

// 종료 직전 대기 중인 저장까지 확실히 쓴다.
export const flush = saveNow;

export function publicState() {
  const { settings, ...rest } = state;
  return {
    ...rest,
    counts: wipeCounts(),
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
      theme: settings.theme,
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
export function writeReport() {
  const at = Date.now();
  const done = state.tasks.filter(t => t.status === 'done');
  const lines = [
    `# ${state.company.name} · 작업 종료 보고서`,
    `생성 시각: ${new Date(at).toLocaleString('ko-KR')}`,
    `회사 목표: ${state.company.goal || '(미설정)'}`,
    ...(state.company.attachments?.length ? [`가동 지시 첨부: ${state.company.attachments.map(a => a.name).join(', ')}`] : []),
    '',
    `## 완료된 업무 (${done.length}건)`,
  ];
  if (!done.length) lines.push('(없음)');
  done.forEach((t, i) => {
    lines.push(`\n### ${i + 1}. ${t.title}`,
      `- 담당: ${nameOf(t.assigneeId)} / 지시: ${nameOf(t.assignerId)}`,
      `- 내용: ${t.description || '-'}`,
      ...(t.attachments?.length ? [`- 첨부: ${t.attachments.map(a => `${a.name} (${kb(a.size)})`).join(', ')}`] : []),
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
