import { chromium } from 'playwright';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { state, changed, postMessage, findEmpByName, uid, dmChannel, screens, emit, rankIdx, completeTask, nameOf, addLog, isCancelled, requestApproval } from './store.js';
import { desktopAct } from './desktop.js';
import { SEARCH_ENGINES, SEARCH_ORDER } from './catalog.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const obj = (properties = {}, required = []) => ({ type: 'object', properties, required });
const str = description => ({ type: 'string', description });
const num = description => ({ type: 'number', description });
const bool = description => ({ type: 'boolean', description });

const CORE = [
  { name: 'send_message', description: '사내 메신저로 메시지 전송. to: 직원 이름, "user"(오너), 또는 채널 이름(예: "전체")',
    parameters: obj({ to: str('받는 사람 또는 채널'), text: str('메시지 내용') }, ['to', 'text']) },
  { name: 'assign_task', description: '자기보다 직급이 낮은 직원에게 업무 지시',
    parameters: obj({ assignee: str('직원 이름'), title: str('업무 제목'), description: str('구체적인 업무 내용, 기대 산출물') }, ['assignee', 'title']) },
  { name: 'complete_task', description: '내 업무를 완료하고 결과 보고',
    parameters: obj({ task_id: str('업무 ID'), result: str('구체적인 결과물/보고 내용') }, ['task_id', 'result']) },
  { name: 'request_approval', description: '되돌릴 수 없는 행동을 오너 결재(승인)에 부친다. 실행 전에 호출하고, 승인/반려 응답을 받은 뒤에 행동한다. 예: 결제·송금·파일 삭제·계정 설정 변경·메일 발송·게시글 발행',
    parameters: obj({ title: str('결재 제목 한 줄'), detail: str('무엇을 왜 하려는지, 위험 요소와 대안'), task_id: str('관련 업무 ID') }, ['title', 'detail']) },
  { name: 'list_tasks', description: '회사 전체 업무 목록 조회', parameters: obj() },
];
const ENGINE_IDS = Object.keys(SEARCH_ENGINES);
const ENGINE_DESC = ENGINE_IDS.map(k => `${k}=${SEARCH_ENGINES[k].label}`).join(', ');
const WEB = [
  { name: 'web_search', description: `웹 검색. engine을 생략하면 설정에서 키가 있는 엔진 순서대로 시도합니다 (${ENGINE_DESC})`,
    parameters: obj({ query: str('검색어'), engine: str(`특정 엔진만 쓰기: ${ENGINE_IDS.join(' | ')} (자동=auto)`), max_results: num('결과 수 1~10, 기본 6') }, ['query']) },
  { name: 'fetch_url', description: 'URL의 본문 텍스트 가져오기', parameters: obj({ url: str('URL') }, ['url']) },
  { name: 'search_status', description: '지금 사용 가능한 웹 검색 엔진과 자동 시도 순서 확인', parameters: obj() },
];
const BROWSER = [
  { name: 'browser_navigate', description: '[Playwright] 브라우저로 URL 열기', parameters: obj({ url: str('URL') }, ['url']) },
  { name: 'browser_click', description: '[Playwright] 요소 클릭. selector: CSS 선택자 또는 "text=버튼글자"', parameters: obj({ selector: str('선택자') }, ['selector']) },
  { name: 'browser_fill', description: '[Playwright] 입력창에 텍스트 입력', parameters: obj({ selector: str('선택자'), text: str('입력값'), press_enter: bool('입력 후 Enter') }, ['selector', 'text']) },
  { name: 'browser_press', description: '[Playwright] 키보드 키/단축키. 예: Enter, Escape, Tab, Control+a', parameters: obj({ key: str('키') }, ['key']) },
  { name: 'browser_scroll', description: '[Playwright] 현재 페이지 스크롤 (dy 양수=아래)', parameters: obj({ dy: num('픽셀') }, ['dy']) },
  { name: 'browser_read', description: '[Playwright] 현재 페이지 텍스트와 링크 읽기', parameters: obj() },
  { name: 'browser_screenshot', description: '[Playwright] 현재 페이지 스크린샷만 다시 확인', parameters: obj() },
  { name: 'browser_back', description: '[Playwright] 뒤로 가기', parameters: obj() },
  { name: 'browser_tabs', description: '[Playwright] 탭 관리. action: list / new / select / close',
    parameters: obj({ action: str('list|new|select|close'), index: num('탭 번호(select/close)'), url: str('new일 때 열 URL') }, ['action']) },
];
const COMPUTER = [
  { name: 'computer_info', description: '[컴퓨터 유즈] 화면 크기·커서 위치·열린 창 목록(번호·제목·좌표·크기)을 텍스트로 반환. 이미지를 볼 수 없는 모델도 이 도구로 조작 대상을 찾는다. 마우스를 움직이지 않으므로 다른 직원 작업 중에도 안전', parameters: obj() },
  { name: 'computer_screenshot', description: '[컴퓨터 유즈] 실제 PC 화면 전체 스크린샷. 이후 computer_click 등의 좌표는 이 이미지(1280 폭) 기준', parameters: obj() },
  { name: 'computer_open', description: '[컴퓨터 유즈] URL·프로그램·파일을 OS로 열어서 화면에 띄움. 예: "https://duckduckgo.com", "notepad", "calc"', parameters: obj({ target: str('URL 또는 실행 파일명/경로') }, ['target']) },
  { name: 'computer_focus', description: '[컴퓨터 유즈] computer_info의 창 번호로 해당 창을 앞으로 가져옴', parameters: obj({ index: num('computer_info 목록의 창 번호') }, ['index']) },
  { name: 'computer_click', description: '[컴퓨터 유즈] 실제 마우스로 스크린샷 좌표 클릭', parameters: obj({ x: num('x (스크린샷 기준)'), y: num('y'), button: str('left | right | middle'), double: bool('더블클릭') }, ['x', 'y']) },
  { name: 'computer_click_window', description: '[컴퓨터 유즈] 창 번호+지점으로 클릭 (스크린샷이 없어도 동작). spot: center|title|menu|left|right|top|bottom|close|min|max, dx/dy로 픽셀 보정(우측 상단 버튼군은 근사치)',
    parameters: obj({ index: num('창 번호'), spot: str('지점, 기본 center'), dx: num('x 보정 px'), dy: num('y 보정 px'), button: str('left | right | middle'), double: bool('더블클릭') }, ['index']) },
  { name: 'computer_move', description: '[컴퓨터 유즈] 클릭하지 않고 커서만 이동 (툴팁·호버 확인)', parameters: obj({ x: num('x'), y: num('y') }, ['x', 'y']) },
  { name: 'computer_drag', description: '[컴퓨터 유즈] 드래그', parameters: obj({ x1: num('시작 x'), y1: num('시작 y'), x2: num('끝 x'), y2: num('끝 y') }, ['x1', 'y1', 'x2', 'y2']) },
  { name: 'computer_type', description: '[컴퓨터 유즈] 실제 키보드로 텍스트 입력 (한글 가능, 클립보드 사용 후 복원). 먼저 클릭 등으로 입력창에 포커스해야 한다', parameters: obj({ text: str('텍스트'), press_enter: bool('입력 후 Enter') }, ['text']) },
  { name: 'computer_key', description: '[컴퓨터 유즈] 키/단축키. 예: Enter, Tab, Ctrl+C, Alt+F4, Win+R, Alt+Tab', parameters: obj({ key: str('키') }, ['key']) },
  { name: 'computer_scroll', description: '[컴퓨터 유즈] 스크롤 (dy 양수=아래). x,y를 주면 그 위치에서', parameters: obj({ dy: num('픽셀'), x: num('x'), y: num('y') }) },
  { name: 'computer_wait', description: '[컴퓨터 유즈] 로딩 대기 후 스크린샷', parameters: obj({ seconds: num('초, 최대 10') }) },
];

export function mcpServersObj() {
  try { return { ok: true, servers: JSON.parse(state.settings.mcpConfig || '{}').mcpServers || {} }; }
  catch (e) { return { ok: false, error: e.message }; }
}
export function writeMcpServers(servers) {
  state.settings.mcpConfig = JSON.stringify({ mcpServers: servers }, null, 2);
  changed();
}

// ---------- MCP ----------
const mcp = new Map();
const mcpIndex = new Map();
const safeName = s => s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64);

export async function connectMcp() {
  for (const [, s] of mcp) { try { await s.client.close(); } catch {} }
  mcp.clear(); state.mcpStatus = {};
  let cfg;
  try { cfg = JSON.parse(state.settings.mcpConfig || '{}').mcpServers || {}; }
  catch { state.mcpStatus = { 설정: 'JSON 파싱 오류' }; changed(); return; }
  for (const [name, s] of Object.entries(cfg)) {
    if (s?.enabled === false) { state.mcpStatus[name] = '꺼짐'; continue; }
    try {
      const transport = s.url
        ? new StreamableHTTPClientTransport(new URL(s.url), s.headers ? { requestInit: { headers: s.headers } } : undefined)
        : new StdioClientTransport({ command: s.command, args: s.args || [], env: { ...process.env, ...(s.env || {}) } });
      const client = new Client({ name: 'virtual-company', version: '2.0.0' });
      await client.connect(transport);
      const { tools } = await client.listTools();
      mcp.set(name, { client, tools });
      state.mcpStatus[name] = `연결됨 · 도구 ${tools.length}개`;
    } catch (e) { state.mcpStatus[name] = '실패: ' + e.message; }
  }
  changed();
}

function mcpDefs(only) {
  const out = [];
  for (const [srv, { tools }] of mcp) {
    if (Array.isArray(only) && !only.includes(srv)) continue;
    for (const t of tools) {
      const name = safeName(`mcp__${srv}__${t.name}`);
      mcpIndex.set(name, { srv, tool: t.name });
      out.push({ name, description: `[MCP:${srv}] ${t.description || ''}`.slice(0, 1000), parameters: t.inputSchema || obj() });
    }
  }
  return out;
}

async function callMcp(name, args) {
  const ref = mcpIndex.get(name);
  if (!ref || !mcp.get(ref.srv)) throw new Error('MCP 도구를 찾을 수 없습니다');
  const r = await mcp.get(ref.srv).client.callTool({ name: ref.tool, arguments: args });
  const text = (r.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n') || JSON.stringify(r.content || r).slice(0, 8000);
  const img = (r.content || []).find(c => c.type === 'image');
  return { text, image: img?.data, mediaType: img?.mimeType };
}

// tools.mcp: 'all' | 서버 이름 배열 | false(구버전 호환)
export function buildTools(emp) {
  const t = emp.tools || {};
  const app = state.settings.app;
  const grant = t.mcp === true ? 'all' : t.mcp;
  const mcpTools = grant === 'all' ? mcpDefs() : Array.isArray(grant) && grant.length ? mcpDefs(grant) : [];
  return [...CORE, ...(t.web ? WEB : []), ...(t.browser ? BROWSER : []),
    ...(t.computer && app.computerEnabled ? COMPUTER : []), ...mcpTools];
}

// ---------- Playwright 브라우저 ----------
let browserP = null;
const contexts = new Map();
const pages = new Map();
const getBrowser = () => browserP ||= chromium.launch({ headless: state.settings.app.headless !== false });

// 설정에서 헤드리스를 바꾸면 공유 브라우저 자체를 다시 띄워야 한다
export async function resetBrowser() {
  if (!browserP) return;
  const b = await browserP;
  browserP = null; contexts.clear(); pages.clear();
  await b.close().catch(() => {});
}

const isBlank = u => !u || u.startsWith('about:');
const urlLabel = u => isBlank(u) ? '브라우저 대기 · 페이지 미열림' : u;

async function getPage(emp) {
  let p = pages.get(emp.id);
  if (p && p.isClosed()) { pages.delete(emp.id); p = null; }
  if (!p) {
    const ctx = await (await getBrowser()).newContext({ viewport: { width: 1280, height: 800 }, locale: 'ko-KR', userAgent: UA });
    contexts.set(emp.id, ctx);
    // target=_blank 링크·팝업이 새 탭으로 열리면 그 탭을 현재 페이지로 채택한다
    ctx.on('page', np => {
      pages.set(emp.id, np);
      np.once('close', () => { if (pages.get(emp.id) === np) pages.delete(emp.id); });
      np.waitForLoadState('domcontentloaded')
        .then(() => snap(emp, np).catch(() => {}))
        .catch(() => {});
    });
    p = await ctx.newPage();
    pages.set(emp.id, p);
    const start = String(state.settings.app.startUrl || '').trim();
    if (start) await p.goto(normUrl(start), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  }
  return p;
}

async function getContext(emp) { await getPage(emp); return contexts.get(emp.id); }

// about:blank에서 빈 결과를 돌려 모델이 헛되이 루프하는 대신 다음 행동을 안내한다
async function requirePage(emp) {
  const p = await getPage(emp);
  if (isBlank(p.url())) throw new Error('현재 브라우저에 열린 페이지가 없습니다(about:blank). browser_navigate(url)로 먼저 페이지를 여세요.');
  return p;
}

async function snap(emp, page) {
  // 폰트/리소스 로딩이 매듭지어지지 않아 스크린샷이 걸리는 페이지가 있다.
  // 미리보기가 직원 업무를 막지 않도록 짧게 자르고 실패는 무시한다.
  let buf;
  try { buf = await page.screenshot({ type: 'jpeg', quality: 55, timeout: 8000, caret: 'hide' }); }
  catch { return; }
  const s = { img: buf.toString('base64'), url: urlLabel(page.url()) };
  screens.set(emp.id, s);
  emit({ type: 'screen', empId: emp.id, ...s });
}

const pageSummary = async p => `${await p.title()} (${urlLabel(p.url())})`;

const normUrl = u => /^[a-z][a-z0-9+.-]*:\/\//i.test(String(u)) ? u : 'https://' + String(u).replace(/^\/+/, '');
const pageText = p => p.evaluate(() => document.body?.innerText || '');
const pageLinks = p => p.evaluate(() => [...document.querySelectorAll('a[href]')].slice(0, 40)
  .map(a => `${a.innerText.trim().slice(0, 60)} → ${a.href}`).filter(s => !s.startsWith(' →')).join('\n'));

// ---------- 웹 ----------
const htmlToText = h => h.replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, ' ')
  .replace(/<br\s*\/?>|<\/(p|div|li|h\d|tr)>/gi, '\n').replace(/<[^>]+>/g, ' ')
  .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();

const keyFor = id => String(state.settings.keys[id] || '').trim();
const searchCfg = () => state.settings.search || {};

async function httpJson(url, opts = {}) {
  const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
  const text = await r.text();
  let j;
  try { j = JSON.parse(text); } catch { throw new Error(`HTTP ${r.status} · 응답이 JSON이 아님: ${text.slice(0, 160)}`); }
  if (!r.ok) throw new Error(`HTTP ${r.status} · ${j?.error?.message || j?.error?.info || j?.detail?.error || j?.error_message || text.slice(0, 160)}`);
  return j;
}
const qs = (base, params) => {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') u.searchParams.set(k, v);
  return u.href;
};

const ENGINES = {
  tavily: async (q, n) => {
    const j = await httpJson('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${keyFor('tavily')}` },
      body: JSON.stringify({ query: q, max_results: n, include_answer: true }),
    });
    return { summary: j.answer || '', items: (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.content })) };
  },
  serper: async (q, n) => {
    const j = await httpJson('https://google.serper.dev/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-API-KEY': keyFor('serper') },
      body: JSON.stringify({ q, num: n }),
    });
    return { items: (j.organic || []).map(x => ({ title: x.title, url: x.link, snippet: x.snippet })) };
  },
  exa: async (q, n) => {
    const j = await httpJson('https://api.exa.ai/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-api-key': keyFor('exa') },
      body: JSON.stringify({ query: q, numResults: n, type: 'auto', contents: { text: { maxCharacters: 500 } } }),
    });
    return { items: (j.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.text })) };
  },
  brave: async (q, n) => {
    const j = await httpJson(qs('https://api.search.brave.com/res/v1/web/search', { q, count: n }),
      { headers: { 'X-Subscription-Token': keyFor('brave'), Accept: 'application/json' } });
    return { items: (j.web?.results || []).map(x => ({ title: x.title, url: x.url, snippet: x.description })) };
  },
  google: async (q, n) => {
    const j = await httpJson(qs('https://www.googleapis.com/customsearch/v1',
      { key: keyFor('google'), cx: searchCfg().googleCx, q, num: Math.min(n, 10) }));
    return { items: (j.items || []).map(x => ({ title: x.title, url: x.link, snippet: x.snippet })) };
  },
  serpapi: async (q, n) => {
    const j = await httpJson(qs('https://serpapi.com/search.json',
      { engine: 'google', q, num: n, api_key: keyFor('serpapi') }));
    return { items: (j.organic_results || []).map(x => ({ title: x.title, url: x.link, snippet: x.snippet || x.snippet_highlighted_words?.[0] })) };
  },
  searxng: async (q, n) => {
    const base = String(searchCfg().searxngUrl || '').trim().replace(/\/+$/, '');
    const j = await httpJson(qs(`${base}/search`, { q, format: 'json', categories: 'general' }));
    return { items: (j.results || []).slice(0, n).map(x => ({ title: x.title, url: x.url, snippet: x.content })) };
  },
  duckduckgo: async (q, n) => {
    const html = await (await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q),
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) })).text();
    const items = [...html.matchAll(/class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g)].slice(0, n);
    return { items: items.map(([, href, title, snip]) => {
      let url = href; try { url = new URL(href, 'https://duckduckgo.com').searchParams.get('uddg') || href; } catch {}
      return { title: htmlToText(title), url, snippet: htmlToText(snip) };
    }) };
  },
};

// 엔진을 쓰려면 무엇을 채워야 하는지 — 자동 순서와 상태 표시가 이 판정에 의존한다
const needMissing = (want, id) => want === 'key' ? !keyFor(id)
  : want === 'cx' ? !searchCfg().googleCx : want === 'url' ? !searchCfg().searxngUrl : false;
const needLabel = (want, id) => want === 'key' ? `${SEARCH_ENGINES[id].label} API 키`
  : want === 'cx' ? 'Google CSE 검색엔진 ID(cx)' : `${SEARCH_ENGINES[id].label} URL`;
const needsOf = id => SEARCH_ENGINES[id]?.needs || [];
const ready = id => !needsOf(id).some(want => needMissing(want, id));
const missingOf = id => needsOf(id).filter(want => needMissing(want, id)).map(want => needLabel(want, id));

const autoOrder = () => SEARCH_ORDER.filter(ready);

async function webSearch(query, engine, maxResults) {
  const n = Math.min(10, Math.max(1, Number(maxResults) || 6));
  const pick = String(engine || searchCfg().provider || 'auto').trim();
  const order = pick !== 'auto' && ENGINES[pick] ? [pick] : autoOrder();
  if (!order.length) throw new Error('사용 가능한 웹 검색 엔진이 없습니다 — 설정 탭의 웹 검색에서 엔진 키를 입력하거나, 키 불필요한 DuckDuckGo를 자동 순서에 둡니다.');
  const errs = [];
  for (const id of order) {
    if (!ENGINES[id]) { errs.push(`${id}: 알 수 없는 엔진`); continue; }
    if (!ready(id)) { errs.push(`${id}: ${missingOf(id).join(', ')} 필요`); continue; }
    try {
      const { summary, items = [] } = await ENGINES[id](query, n);
      const list = items.filter(x => x.url || x.title);
      if (!list.length) { errs.push(`${id}: 결과 없음`); continue; }
      return `${summary ? `요약: ${summary}\n\n` : ''}${list.map((x, i) => `${i + 1}. ${htmlToText(String(x.title || '')).slice(0, 200) || '(제목 없음)'}\n${x.url}\n${htmlToText(String(x.snippet || '')).slice(0, 500)}`).join('\n\n')}\n\n[검색 엔진: ${id}]`;
    } catch (e) { errs.push(`${id}: ${String(e.message || e).slice(0, 200)}`); }
  }
  throw new Error('웹 검색 실패 — ' + errs.join(' / '));
}

function searchStatus() {
  const order = autoOrder();
  return [
    `설정된 모드: ${searchCfg().provider || 'auto'}`,
    `자동 시도 순서: ${order.join(' → ') || '(없음)'}`,
    ...SEARCH_ORDER.map(id => `- ${id} (${SEARCH_ENGINES[id].label}): ${ready(id) ? '사용 가능' : '미설정 · ' + missingOf(id).join(', ')}`),
  ].join('\n');
}

async function fetchUrl(url) {
  const r = await fetch(normUrl(url), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
  return htmlToText(await r.text()).slice(0, 10000);
}

// 설정 탭의 "검색 테스트" 버튼이 같은 코드를 돌린다
export const testSearch = (query, engine) => webSearch(query, engine, 6);

// ---------- 실행 ----------
export async function runTool(name, a, { emp, ctx }) {
  if (name.startsWith('computer_')) return desktopAct(emp, name, a);
  if (name.startsWith('mcp__')) return callMcp(name, a);

  switch (name) {
    case 'send_message': {
      const to = String(a.to || '').trim().replace(/^[@#]/, '');
      let ch;
      if (['user', '오너', '사용자', state.user.name].includes(to)) ch = dmChannel('user', emp.id);
      else {
        const t = findEmpByName(to);
        if (t) ch = dmChannel(emp.id, t.id);
        else { const c = state.channels.find(c => c.name === to || c.id === to); if (!c) return `"${to}"을(를) 찾을 수 없습니다`; ch = c.id; }
      }
      postMessage(ch, emp.id, a.text);
      return '전송 완료';
    }
    case 'assign_task': {
      const t = findEmpByName(a.assignee);
      if (!t) return `"${a.assignee}" 직원이 없습니다`;
      // 오너가 지운 일은 다시 만들지 못하게 막는다 — 안 그러면 같은 작업이 무한히 재지시된다
      if (isCancelled(a.title)) return `거부됨: "${a.title}"은(는) 오너가 삭제한 업무입니다. 같은 내용으로 다시 지시하지 마세요.`;
      if (t.id !== emp.id && rankIdx(t) <= rankIdx(emp)) return `${t.name}(${t.rank})님은 직급이 같거나 높아 업무를 지시할 수 없습니다. send_message로 요청하세요.`;
      const task = { id: uid().slice(0, 5), title: a.title, description: a.description || '', assigneeId: t.id, assignerId: emp.id, status: 'todo', createdAt: Date.now() };
      state.tasks.push(task); changed();
      addLog(emp.id, `업무 지시 → ${t.name} · ${a.title}`, 'tool');
      return `업무 #${task.id} 생성 → ${t.name}`;
    }
    case 'complete_task': {
      const id = String(a.task_id).replace('#', '');
      const t = state.tasks.find(x => x.id === id);
      if (!t) return state.cancelled.some(c => c.id === id)
        ? '이 업무는 오너가 취소했습니다. 다시 수행하지 마세요.'
        : '해당 업무가 없습니다';
      if (t.assigneeId !== emp.id) return '본인 업무만 완료할 수 있습니다';
      completeTask(t, emp, a.result);
      return '완료 처리되었습니다';
    }
    case 'request_approval': {
      const ap = requestApproval(emp, { title: a.title, detail: a.detail, taskId: String(a.task_id || '').replace('#', '') || null });
      if (ctx) { ctx.hold = true; ctx.approvalId = ap.id; }
      return `결재 #${ap.id} 상신 완료 · "${ap.title}"\n오너의 승인/반려를 기다립니다. 이번 응답을 여기서 마무리하고, 승인 전에는 해당 행동을 실행하지 마세요.`;
    }
    case 'list_tasks':
      return (state.tasks.slice(-40).map(t => `#${t.id} [${t.status}] ${t.title} — 담당 ${nameOf(t.assigneeId)}, 지시 ${nameOf(t.assignerId)}`).join('\n') || '업무 없음')
        + (state.cancelled.length ? `\n\n[오너가 취소한 업무 — 재지시·재수행 금지]\n${state.cancelled.slice(-10).map(c => `- ${c.title}`).join('\n')}` : '');
    case 'web_search': return webSearch(a.query, a.engine, a.max_results);
    case 'search_status': return searchStatus();
    case 'fetch_url': return fetchUrl(a.url);
    case 'browser_navigate': {
      const p = await getPage(emp);
      const target = normUrl(a.url);
      const resp = await p.goto(target, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await p.waitForTimeout(800);
      const cur = pages.get(emp.id) || p;          // 리디렉트가 새 탭에서 마무리될 수 있다
      await snap(emp, cur);
      if (isBlank(cur.url()))
        throw new Error(`${target} 열었으나 최종 페이지가 about:blank입니다(차단/리디렉트 실패). 다른 출처를 시도하거나 fetch_url을 쓰세요.`);
      const code = resp ? resp.status() : 0;
      const redir = cur.url() !== p.url() ? `\n(새 탭으로 전환됨 → ${cur.url()})` : '';
      return `페이지: ${await pageSummary(cur)} · HTTP ${code}${redir}\n\n${(await pageText(cur)).slice(0, 4000)}`;
    }
    case 'browser_click': {
      const p = await requirePage(emp);
      await p.locator(a.selector).first().click({ timeout: 10000 });
      await p.waitForTimeout(1000);
      const cur = pages.get(emp.id) || p;           // 팝업/새 탭이 채택됐을 수 있다
      await snap(emp, cur);
      return `클릭 완료. 현재: ${await pageSummary(cur)}`;
    }
    case 'browser_fill': {
      const p = await requirePage(emp);
      const loc = p.locator(a.selector).first();
      await loc.fill(String(a.text), { timeout: 10000 });
      if (a.press_enter) await loc.press('Enter');
      await p.waitForTimeout(1000); await snap(emp, p);
      return `입력 완료. 현재: ${await pageSummary(p)}`;
    }
    case 'browser_press': {
      const p = await requirePage(emp);
      await p.keyboard.press(String(a.key));
      await p.waitForTimeout(800); await snap(emp, p);
      return `${a.key} 입력. 현재: ${await pageSummary(p)}`;
    }
    case 'browser_scroll': {
      const p = await requirePage(emp);
      await p.mouse.wheel(0, +a.dy || 500);
      await p.waitForTimeout(600); await snap(emp, p);
      return `스크롤 완료. 현재: ${await pageSummary(p)}\n\n${(await pageText(p)).slice(0, 3000)}`;
    }
    case 'browser_read': {
      const p = await requirePage(emp); await snap(emp, p);
      return `${await pageSummary(p)}\n\n${(await pageText(p)).slice(0, 10000)}\n\n[링크]\n${await pageLinks(p)}`;
    }
    case 'browser_screenshot': {
      const p = await requirePage(emp); await snap(emp, p);
      return `스크린샷 갱신. 현재: ${await pageSummary(p)}`;
    }
    case 'browser_back': {
      const p = await requirePage(emp);
      if (!p.url().includes('#') && await p.evaluate(() => history.length <= 1).catch(() => true))
        return '이력상 뒤로 갈 페이지가 없습니다. browser_navigate로 이동하세요.';
      await p.goBack().catch(() => {}); await snap(emp, p);
      return `현재: ${await pageSummary(p)}`;
    }
    case 'browser_tabs': {
      const ctx = await getContext(emp);
      const act = String(a.action || 'list');
      const list = ctx.pages();
      if (act === 'new') {
        const np = await ctx.newPage();
        if (a.url) await np.goto(normUrl(a.url), { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await np.waitForTimeout(500); await snap(emp, np);
        return `새 탭 열림 → ${await pageSummary(np)}`;
      }
      if (act === 'select' || act === 'close') {
        const i = Number(a.index);
        const t = list[i];
        if (!t) return `탭 ${i}이(가) 없습니다. 열려 있는 탭 ${list.length}개`;
        if (act === 'close') {
          await t.close().catch(() => {});
          const rest = ctx.pages();
          if (rest.length) { const np = rest[Math.max(0, Math.min(i, rest.length - 1))]; pages.set(emp.id, np); await snap(emp, np); }
          return `탭 ${i} 닫힘. 남은 탭 ${ctx.pages().length}개`;
        }
        pages.set(emp.id, t); await t.bringToFront().catch(() => {}); await snap(emp, t);
        return `탭 ${i} 선택 → ${await pageSummary(t)}`;
      }
      const cur = pages.get(emp.id);
      const lines = await Promise.all(list.map(async (t, i) => `${i === list.indexOf(cur) ? '*' : ' '} [${i}] ${await pageSummary(t)}`));
      return lines.join('\n') || '열린 탭 없음';
    }
    default:
      throw new Error('알 수 없는 도구: ' + name);
  }
}

export async function closeAll() {
  for (const [, s] of mcp) { try { await s.client.close(); } catch {} }
  if (browserP) (await browserP).close().catch(() => {});
}
