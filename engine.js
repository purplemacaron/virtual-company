import { state, changed, addLog, postMessage, findEmp, nameOf, completeTask } from './store.js';
import { chat } from './llm.js';
import { buildTools, runTool } from './tools.js';
import { releaseDesktop } from './desktop.js';

const ENV_STEPS = process.env.MAX_STEPS ? Number(process.env.MAX_STEPS) : null;
const maxSteps = () => ENV_STEPS || Number(state.settings.app.maxSteps) || 8;
const busy = new Set();
let gen = 0;                                  // 일시정지(비상정지) 시 증가 → 진행 중인 작업 중단

export function startEngine() { setInterval(tick, 1000); }
export function abortAll() { gen++; }

function tick() {
  for (const e of state.employees) {
    if (busy.has(e.id) || Date.now() < (e.cooldownUntil || 0)) continue;
    const job = nextJob(e);
    if (job) run(e, job);
  }
}

function chName(ch) {
  if (!ch) return '시스템';
  if (ch.startsWith('dm:')) return '1:1 대화';
  return '#' + (state.channels.find(c => c.id === ch)?.name || ch);
}

function nextJob(e) {
  if (e.inbox.length) {
    const m = e.inbox.shift(); changed();
    if (m.from === 'system') return { type: 'message', channel: null, prompt: `[시스템 알림]\n${m.text}` };
    const who = m.from === 'user' ? `${state.user.name} (회사 오너)` : `${nameOf(m.from)} (${findEmp(m.from)?.rank || ''})`;
    return { type: 'message', channel: m.channel, prompt: `[메시지] ${chName(m.channel)} / 보낸 사람: ${who}\n${m.text}` };
  }
  if (!state.company.running) return null;
  const t = state.tasks.find(t => t.assigneeId === e.id && t.status === 'todo');
  if (!t) return null;
  t.status = 'doing'; t.startedAt = Date.now(); changed();
  return { type: 'task', taskId: t.id,
    prompt: `[업무 배정] #${t.id} ${t.title}\n지시자: ${nameOf(t.assignerId)}\n내용: ${t.description || '-'}\n\n업무를 수행한 뒤 반드시 complete_task(task_id="${t.id}")로 구체적인 결과를 보고하세요.` };
}

function setStatus(e, status, activity) { e.status = status; e.activity = activity; changed(); }

function systemPrompt(e) {
  const team = [...state.employees]
    .sort((a, b) => state.ranks.indexOf(a.rank) - state.ranks.indexOf(b.rank))
    .map(x => `- ${x.name} | ${x.rank} | ${x.role} | ${x.model}${x.tools?.computer ? ' | PC조작 가능' : ''}${x.id === e.id ? ' (나)' : ''}`).join('\n');
  return `당신은 "${state.company.name}"의 AI 직원 ${e.name}입니다.
직급: ${e.rank} / 직무: ${e.role} / 모델: ${e.model}
성격·지침: ${e.persona || '-'}

회사 목표: ${state.company.goal || '(아직 설정되지 않음)'}
회사 오너: ${state.user.name} (최고 권한자, 지시 최우선)
직급 체계(높은 순): ${state.ranks.join(' > ')}

팀 구성:
${team}

규칙:
- 자기보다 직급이 낮은 직원에게만 assign_task로 업무를 지시할 수 있습니다. 상급자/동급자에게는 send_message로 보고·요청하세요.
- 리더라면 목표를 구체적인 업무로 쪼개 직무와 모델 특성에 맞게 배분하세요. 직접 할 수 있는 일은 직접 하세요.
- 업무가 끝나면 complete_task로 구체적인 결과(조사 내용, 산출물, 출처 링크)를 보고하세요.
- 받은 메시지에 대한 답은 최종 텍스트로 쓰면 해당 대화방에 자동 전송됩니다(그때는 send_message 불필요). 답할 필요가 없으면 "[무응답]"이라고만 쓰세요.
- 단순 인사나 "확인했습니다" 같은 의미 없는 메시지는 보내지 마세요.
${e.tools?.computer && state.settings.app.computerEnabled ? `- 컴퓨터 유즈(computer_*)는 실제 PC를 조작합니다. 첫 단계로 computer_info를 호출해 화면 크기·커서·열린 창 목록(번호·좌표·크기)을 확인하세요. 스크린샷을 볼 수 있으면 computer_screenshot 좌표로 computer_click을, 볼 수 없으면 computer_focus(창 번호)·computer_click_window(창 번호+지점)·computer_key 단축키로 조작하세요. 한 번에 한 동작씩 하고 반드시 결과를 확인합니다. 파일 삭제, 결제, 송금, 계정 설정 변경, 메일 발송 등 되돌릴 수 없는 행동은 오너의 명시적 허락 없이 하지 마세요.` : `- 컴퓨터 유즈는 현재 사용 불가합니다(오너가 PC 조작을 꺼두었거나 권한이 없음). 웹 작업은 web_search/Playwright로 처리하세요.`}
- 브라우저 도구를 쓰기 전 화면이 about:blank면 먼저 browser_navigate로 페이지를 여세요. 새 탭으로 열리는 링크는 자동으로 그 탭을 따라갑니다.
- 웹 정보는 가능하면 web_search/Playwright를 쓰고, 데스크톱 앱이 필요할 때 컴퓨터 유즈를 쓰세요.
- 한국어로 간결하고 전문적으로 답하세요.
현재 시각: ${new Date().toLocaleString('ko-KR')}`;
}

function describe({ name, args = {} }) {
  const m = {
    web_search: `웹 검색 · "${args.query}"`,
    search_status: '사용 가능한 검색 엔진 확인',
    fetch_url: `웹페이지 읽는 중 · ${args.url}`,
    browser_navigate: `브라우저 · ${args.url}`,
    browser_click: `브라우저 클릭 · ${args.selector}`,
    browser_fill: `브라우저 입력 · ${args.selector}`,
    browser_press: `브라우저 키 입력 · ${args.key}`,
    browser_scroll: '브라우저 스크롤',
    browser_read: '브라우저 페이지 읽는 중',
    browser_screenshot: '브라우저 화면 갱신',
    browser_back: '브라우저 뒤로 가기',
    browser_tabs: `브라우저 탭 · ${args.action || 'list'}`,
    computer_info: 'PC 화면·열린 창 목록 확인 중',
    computer_screenshot: 'PC 화면 확인 중',
    computer_open: `PC에서 열기 · ${args.target}`,
    computer_focus: `창 앞으로 가져오기 · [${args.index}]`,
    computer_click_window: `창 클릭 · [${args.index}] ${args.spot || 'center'}`,
    computer_move: `커서 이동 · (${args.x}, ${args.y})`,
    computer_click: `마우스 클릭 · (${args.x}, ${args.y})`,
    computer_drag: '마우스 드래그',
    computer_type: `타이핑 · "${String(args.text || '').slice(0, 30)}"`,
    computer_key: `키 입력 · ${args.key}`,
    computer_scroll: '화면 스크롤',
    computer_wait: '화면 로딩 대기',
    send_message: `메시지 작성 → ${args.to}`,
    assign_task: `업무 지시 → ${args.assignee}`,
    complete_task: `업무 완료 보고 · #${args.task_id}`,
    list_tasks: '업무 목록 확인',
  }[name];
  if (m) return m;
  if (name.startsWith('mcp__')) return `MCP · ${name.slice(5).replace('__', ' › ')}`;
  return name;
}

// 이미지 토큰 절약: 마지막 스크린샷만 유지, 끊긴 tool_call 보정
function prepare(mem) {
  let lastImg = -1;
  mem.forEach((m, i) => { if (m.role === 'tool' && m.results.some(r => r.image)) lastImg = i; });
  const out = [];
  mem.forEach((m, i) => {
    out.push(m.role === 'tool' ? { role: 'tool', results: m.results.map(r => i === lastImg ? r : { ...r, image: undefined }) } : m);
    if (m.role === 'assistant' && m.toolCalls?.length && mem[i + 1]?.role !== 'tool')
      out.push({ role: 'tool', results: m.toolCalls.map(tc => ({ id: tc.id, name: tc.name, text: '(중단됨)' })) });
  });
  return out;
}

function trim(e) {
  const MAX = 40;
  if (e.memory.length > MAX) {
    let cut = e.memory.length - MAX;
    while (cut < e.memory.length && e.memory[cut].role !== 'user') cut++;
    e.memory = e.memory.slice(cut);
  }
  const lastTool = e.memory.map(m => m.role).lastIndexOf('tool');
  e.memory.forEach((m, i) => { if (m.role === 'tool' && i !== lastTool) m.results.forEach(r => { delete r.image; }); });
}

async function run(e, job) {
  busy.add(e.id);
  const myGen = gen;
  let aborted = false;
  setStatus(e, 'thinking', job.type === 'task' ? '업무 검토 중' : '메시지 읽는 중');
  try {
    const defs = buildTools(e);
    e.memory.push({ role: 'user', content: job.prompt });
    let finalText = '';
    for (let step = 0; step < maxSteps(); step++) {
      if (myGen !== gen) { aborted = true; break; }
      setStatus(e, 'thinking', '생각 중…');
      const res = await chat({ provider: e.provider, model: e.model, baseUrl: e.baseUrl, keys: state.settings.keys,
        apiKey: e.apiKey, system: systemPrompt(e), messages: prepare(e.memory), tools: defs });
      e.memory.push({ role: 'assistant', text: res.text || '', toolCalls: res.toolCalls });
      if (res.text) { finalText = res.text; addLog(e.id, res.text, 'thought'); }
      if (!res.toolCalls.length) break;

      const results = [];
      for (const tc of res.toolCalls) {
        if (myGen !== gen) { aborted = true; results.push({ id: tc.id, name: tc.name, text: '(오너가 작업을 중지시킴)' }); continue; }
        const label = describe(tc);
        setStatus(e, 'working', label);
        addLog(e.id, label, 'tool');
        let out;
        try {
          if (!defs.find(d => d.name === tc.name)) throw new Error('이 직원에게 허용되지 않은 도구입니다');
          out = await runTool(tc.name, tc.args || {}, { emp: e, job });
        } catch (err) { out = { text: '오류: ' + err.message }; addLog(e.id, `도구 오류 · ${err.message}`, 'error'); }
        if (typeof out === 'string') out = { text: out };
        results.push({ id: tc.id, name: tc.name, text: String(out.text || '').slice(0, 12000), image: out.image, mediaType: out.mediaType });
      }
      e.memory.push({ role: 'tool', results });
      if (aborted) break;
    }

    if (aborted) {
      addLog(e.id, '일시정지로 작업 중단', 'error');
      if (job.type === 'task') {
        const t = state.tasks.find(x => x.id === job.taskId);
        if (t && t.status === 'doing') t.status = 'todo';
      }
      return;
    }
    if (job.type === 'message' && job.channel && finalText && !/^\[?무응답\]?$/.test(finalText.trim()))
      postMessage(job.channel, e.id, finalText);
    if (job.type === 'task') {
      const t = state.tasks.find(x => x.id === job.taskId);
      if (t && t.status === 'doing') completeTask(t, e, finalText || '(결과 없음)');
    }
  } catch (err) {
    addLog(e.id, 'AI 호출 오류: ' + err.message, 'error');
    e.cooldownUntil = Date.now() + 30000;
    if (job.type === 'task') {
      const t = state.tasks.find(x => x.id === job.taskId);
      if (t && t.status === 'doing') { t.status = 'todo'; t.error = err.message; }
    }
    if (job.type === 'message' && job.channel) postMessage(job.channel, e.id, `[오류] ${err.message}`);
  } finally {
    releaseDesktop(e.id);
    trim(e);
    busy.delete(e.id);
    setStatus(e, 'idle', '대기 중');
  }
}
