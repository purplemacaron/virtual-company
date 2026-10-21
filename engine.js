import { state, changed, addLog, postMessage, findEmp, nameOf, completeTask, teamsOf, finishRun, attachmentBlock, leader } from './store.js';
import { chat } from './llm.js';
import { buildTools, runTool } from './tools.js';
import { releaseDesktop } from './desktop.js';

const ENV_STEPS = process.env.MAX_STEPS ? Number(process.env.MAX_STEPS) : null;
// 직원마다 정한 단계가 있으면 그 값, 없으면 회사 기본값. 환경 변수가 항상 이긴다.
const maxSteps = e => {
  const n = ENV_STEPS || Number(e?.maxSteps) || Number(state.settings.app.maxSteps) || 8;
  return Math.min(60, Math.max(1, Math.round(n)));
};
const busy = new Set();
const runs = new Map();                        // empId → 진행 중인 실행 정보(취소·결재 대기 여부)
let gen = 0;                                  // 일시정지(비상정지) 시 증가 → 진행 중인 작업 중단

export function startEngine() { setInterval(tick, 1000); }
// CEO로 취급하는 발신자: 회사 오너 본인, 그리고 오너의 지시를 실어 나르는 대표 직원. 둘 다 모든 작업보다 우선한다.
const fromBoss = m => m.from === 'user' || m.from === leader()?.id;
export function abortAll() { gen++; }
// 오너가 특정 업무를 지우거나 멈추면 그 실행만 그 자리에서 끊는다. 다른 직원의 일은 계속된다.
export function stopTask(taskId) {
  for (const [, r] of runs) if (r.job?.taskId === taskId) r.cancelled = true;
}

function tick() {
  for (const e of state.employees) {
    // CEO(오너) 메시지는 모든 작업보다 우선한다. 일하는 중이면 지금 단계가 끝나는 즉시 일을 놓고 그 메시지를 먼저 다루게 시킨다.
    const r = runs.get(e.id);
    if (r && !r.preempt && r.job?.type === 'task' && e.inbox.some(fromBoss)) r.preempt = true;
    if (busy.has(e.id) || Date.now() < (e.cooldownUntil || 0)) continue;
    const job = nextJob(e);
    if (job) run(e, job);
  }
  checkFinish();
}

// 남은 일이 없는데도 돌아가고 있으면 회사를 멈추고 보고서를 남긴다. 같은 종료 보고를 두 번 쓰지 않는다.
function checkFinish() {
  if (!state.company.running || busy.size) return;
  const open = state.tasks.some(t => ['todo', 'doing', 'blocked'].includes(t.status));
  if (open || state.approvals.some(a => a.status === 'pending')) return;
  // 이미 보고서로 알린 완료 업무는 세지 않는다. 오너가 시작 전에 끝낸 일만 남아 있으면 종료하지 않는다.
  const reported = state.lastRun ? state.lastRun.at : 0;
  if (!state.tasks.some(t => t.status === 'done' && (t.doneAt || 0) > reported)) return;
  finishRun();
}

function chName(ch) {
  if (!ch) return '시스템';
  if (ch.startsWith('dm:')) return '1:1 대화';
  return '#' + (state.channels.find(c => c.id === ch)?.name || ch);
}

function nextJob(e) {
  // 일시정지 중에는 아무것도 달리지 않는다. 오너의 지시·취소·결재 결과는 대기열에 쌓였다가 업무 시작 때 순서대로 처리된다.
  if (!state.company.running) return null;
  if (e.inbox.length) {
    // CEO(오너·대표) 메시지는 먼저 쌓인 다른 답장보다 앞에 나간다.
    const i = Math.max(0, e.inbox.findIndex(fromBoss));
    const m = e.inbox.splice(i, 1)[0]; changed();
    if (m.from === 'system') return { type: 'message', channel: null, prompt: `[시스템 알림]\n${m.text}` };
    const who = m.from === 'user' ? `${state.user.name} (회사 오너)` : `${nameOf(m.from)} (${findEmp(m.from)?.rank || ''})`;
    return { type: 'message', channel: m.channel, prompt: `[메시지] ${chName(m.channel)} / 보낸 사람: ${who}\n${m.text}` };
  }
  const t = state.tasks.find(t => t.assigneeId === e.id && t.status === 'todo');
  if (!t) return null;
  t.status = 'doing'; t.startedAt = Date.now(); delete t.note; changed();
  return { type: 'task', taskId: t.id,
    // 오너가 지시문에서 잘린 첨부 본문을 여기서 다시 읽어 붙인다. data.json은 메타만 들고 있다.
    prompt: `[업무 배정] #${t.id} ${t.title}\n지시자: ${nameOf(t.assignerId)}\n내용: ${t.description || '-'}`
      + attachmentBlock(t.attachments)
      + `\n\n업무를 수행한 뒤 반드시 complete_task(task_id="${t.id}")로 구체적인 결과를 보고하세요.` };
}

function setStatus(e, status, activity) { e.status = status; e.activity = activity; changed(); }

function systemPrompt(e) {
  const myTeams = teamsOf(e.id);
  const team = [...state.employees]
    .sort((a, b) => state.ranks.indexOf(a.rank) - state.ranks.indexOf(b.rank))
    .map(x => `- ${x.name} | ${x.rank} | ${x.role} | 팀: ${teamsOf(x.id).join(', ') || '없음'} | ${x.model}${x.tools?.computer ? ' | PC조작 가능' : ''}${x.id === e.id ? ' (나)' : ''}`).join('\n');
  return `당신은 "${state.company.name}"의 AI 직원 ${e.name}입니다.
직급: ${e.rank} / 직무: ${e.role} / 모델: ${e.model}
성격·지침: ${e.persona || '-'}

회사 목표: ${state.company.goal || '(아직 설정되지 않음)'}
회사 오너: ${state.user.name} (최고 권한자, 지시 최우선)
직급 체계(높은 순): ${state.ranks.join(' > ')}
${myTeams.length ? `내 소속 팀: ${myTeams.join(', ')} (각 팀에 전용 대화방이 있습니다)` : '내 소속 팀: 없음'}

팀 구성:
${team}

규칙:
- 자기보다 직급이 낮은 직원에게만 assign_task로 업무를 지시할 수 있습니다. 상급자/동급자에게는 send_message로 보고·요청하세요.
- 업무가 같은 팀원으로 해결되는지 먼저 살피세요. 같은 팀이 없거나 전문 영역이 다를 때만 다른 팀에게 요청하고, 요청은 해당 팀 채널에서 하세요.
- 리더라면 목표를 구체적인 업무로 쪼개 직무와 모델 특성에 맞게 배분하세요. 직접 할 수 있는 일은 직접 하세요.
- 업무가 끝나면 complete_task로 구체적인 결과(조사 내용, 산출물, 출처 링크)를 보고하세요.
- 오너가 "[업무 취소]"로 알린 일은 즉시 중단하세요. 같은 제목·같은 내용으로 다시 지시하거나 수행하지 않습니다.
- CEO(오너와 대표)의 메시지는 진행 중인 업무보다 우선합니다. 그런 메시지가 도착하면 하던 업무를 잠시 대기열로 되돌리고 그 메시지부터 처리한 뒤 업무를 이어하세요.
- 결제·송금·파일 삭제·계정 설정 변경·메일 발송·게시글 발행처럼 되돌릴 수 없는 행동은 실행하기 전에 request_approval로 결재 서류를 상신하고, 승인 응답을 받은 뒤에 실행하세요. 상신 후에는 이번 응답을 거기서 마무리합니다.
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
    request_approval: `결재 서류 상신 · "${args.title}"`,
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
  const ctx = { job, cancelled: false, hold: false };
  runs.set(e.id, ctx);
  const myGen = gen;
  const stopped = () => myGen !== gen || ctx.cancelled;
  setStatus(e, 'thinking', job.type === 'task' ? '업무 검토 중' : '메시지 읽는 중');
  // 멈춤·실패로 내리기: 오너가 명시적으로 재개하기 전까지 같은 일은 다시 달리지 않는다.
  const park = (t, status, why) => {
    if (!t) return;
    t.status = status; t.error = why; delete t.blockedBy;
    addLog(e.id, `업무 ${status === 'failed' ? '실패' : '중단'} · #${t.id} ${t.title} · ${why}`, 'error');
  };
  // 업무는 시작 전에 잡아둔다. LLM 호출이 즉시 실패해도 'doing'에 못 박혀 남는 일이 없도록.
  const task = job.type === 'task' ? state.tasks.find(x => x.id === job.taskId) : null;
  try {
    const defs = buildTools(e);
    e.memory.push({ role: 'user', content: job.prompt });
    let finalText = '';
    const steps = maxSteps(e);
    for (let step = 0; step < steps; step++) {
      if (stopped()) break;
      if (ctx.preempt) break;                       // CEO 메시지 때문에 이번 일을 여기서 접는다
      setStatus(e, 'thinking', `생각 중 ${step + 1}/${steps}`);
      const res = await chat({ provider: e.provider, model: e.model, baseUrl: e.baseUrl, keys: state.settings.keys,
        apiKey: e.apiKey, system: systemPrompt(e), messages: prepare(e.memory), tools: defs });
      e.memory.push({ role: 'assistant', text: res.text || '', toolCalls: res.toolCalls });
      if (res.text) { finalText = res.text; e.thought = res.text.slice(0, 600); e.thoughtAt = Date.now(); addLog(e.id, res.text, 'thought'); }
      if (!res.toolCalls.length) break;

      const results = [];
      for (const tc of res.toolCalls) {
        if (stopped()) { results.push({ id: tc.id, name: tc.name, text: '(오너가 작업을 중지시킴)' }); continue; }
        const label = describe(tc);
        setStatus(e, 'working', label);
        addLog(e.id, label, 'tool');
        let out;
        try {
          if (!defs.find(d => d.name === tc.name)) throw new Error('이 직원에게 허용되지 않은 도구입니다');
          out = await runTool(tc.name, tc.args || {}, { emp: e, job, ctx });
        } catch (err) { out = { text: '오류: ' + err.message }; addLog(e.id, `도구 오류 · ${err.message}`, 'error'); }
        if (typeof out === 'string') out = { text: out };
        results.push({ id: tc.id, name: tc.name, text: String(out.text || '').slice(0, 12000), image: out.image, mediaType: out.mediaType });
      }
      e.memory.push({ role: 'tool', results });
      if (ctx.hold) { setStatus(e, 'idle', '결재 대기 중'); addLog(e.id, '결재 서류 승인 대기 · 작업 정지', 'info'); break; }
      if (stopped()) break;
    }

    if (stopped()) {
      addLog(e.id, ctx.cancelled ? '오너 취소로 작업 중단' : '일시정지로 작업 중단', 'error');
      // 삭제된 업무는 취소 목록에 남고, 멈춘 업무는 되살리지 않는다.
      if (task && state.cancelled.some(c => c.id === task.id)) return;
      if (task) park(task, 'paused', ctx.cancelled ? '오너가 업무를 취소했습니다' : '일시정지됨');
      return;
    }
    // CEO 메시지를 먼저 처리하라고 세운 것이다. 업무는 멈춤(에러)이 아니라 바로 다음 순번으로 되돌려 둔다.
    if (ctx.preempt) {
      if (task && task.status === 'doing') {
        task.status = 'todo'; delete task.startedAt; delete task.note;
        addLog(e.id, `CEO 메시지 우선 · #${task.id} ${task.title}를 대기열로 되돌리고 메시지를 먼저 처리합니다`, 'info');
      }
      return;
    }
    if (ctx.hold) {                               // 결재 대기: 오너 서명 전까지 이 업무는 멈춰 있다
      if (task && task.status === 'doing') { task.status = 'blocked'; task.blockedBy = ctx.approvalId || null; changed(); }
      return;
    }
    if (job.type === 'message' && job.channel && finalText && !/^\[?무응답\]?$/.test(finalText.trim()))
      postMessage(job.channel, e.id, finalText);
    if (task && task.status === 'doing') completeTask(task, e, finalText || '(결과 없음)');
  } catch (err) {
    addLog(e.id, 'AI 호출 오류: ' + err.message, 'error');
    e.cooldownUntil = Date.now() + 30000;
    if (task && task.status === 'doing') park(task, 'failed', err.message);
    if (job.type === 'message' && job.channel) postMessage(job.channel, e.id, `[오류] ${err.message}`);
  } finally {
    runs.delete(e.id);
    releaseDesktop(e.id);
    trim(e);
    busy.delete(e.id);
    setStatus(e, 'idle', '대기 중');
  }
}
