// 실제 PC 데스크톱 전체를 조작하는 컴퓨터 유즈
import { execFile } from 'child_process';
import { promisify } from 'util';
import { screens, emit, findEmp } from './store.js';

const runFile = promisify(execFile);
const W = 1280;
let L = null;
let img = null;                 // 스크린샷 좌표계 {w,h}
let owner = null, until = 0;
let winCache = [];              // computer_info가 매긴 창 번호 → nut-js Window
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 필요할 때만 로드 → 라이브러리 문제가 있어도 서버 자체는 실행됨
async function libs() {
  if (L) return L;
  try {
    const nut = await import('@nut-tree-fork/nut-js');
    const shot = (await import('screenshot-desktop')).default;
    const sharp = (await import('sharp')).default;
    nut.mouse.config.mouseSpeed = 2000;
    nut.keyboard.config.autoDelayMs = 8;
    L = { ...nut, shot, sharp };
    return L;
  } catch (e) {
    throw new Error('컴퓨터 유즈 라이브러리 로드 실패 (npm install 확인): ' + e.message);
  }
}

// 마우스·키보드는 하나 → 한 번에 한 직원만 사용 (90초 미사용 시 자동 해제)
function acquire(emp) {
  const now = Date.now();
  if (owner && owner !== emp.id && now < until)
    throw new Error(`${findEmp(owner)?.name || '다른 직원'}님이 컴퓨터를 사용 중입니다. 다른 일을 먼저 하거나 잠시 후 다시 시도하세요.`);
  owner = emp.id; until = now + 90000;
}
export function releaseDesktop(id) { if (owner === id) owner = null; }

async function snap(emp) {
  const { shot, sharp } = await libs();
  const raw = await shot({ format: 'png' });
  const meta = await sharp(raw).metadata();
  const h = Math.round(W * meta.height / meta.width);
  const b64 = (await sharp(raw).resize(W, h).jpeg({ quality: 60 }).toBuffer()).toString('base64');
  img = { w: W, h };
  const s = { img: b64, url: '데스크톱' };
  screens.set(emp.id, s);
  emit({ type: 'screen', empId: emp.id, ...s });
  return b64;
}

async function realSize() {
  const { screen } = await libs();
  return { w: await screen.width(), h: await screen.height() };
}

// 스크린샷 좌표 → 실제 화면 픽셀 (HiDPI/레티나 보정)
async function toPx(x, y) {
  if (!img) throw new Error('먼저 computer_screenshot을 호출하세요. 좌표는 그 스크린샷(1280 폭) 기준입니다.');
  const { w, h } = await realSize();
  const px = Math.max(0, Math.min(w - 1, Math.round(+x * w / img.w)));
  const py = Math.max(0, Math.min(h - 1, Math.round(+y * h / img.h)));
  return { px, py };
}
async function moveTo(x, y) {
  const { mouse, straightTo, Point } = await libs();
  const { px, py } = await toPx(x, y);
  await mouse.move(straightTo(new Point(px, py)));
}
async function moveToReal(px, py) {
  const { mouse, straightTo, Point } = await libs();
  const { w, h } = await realSize();
  await mouse.move(straightTo(new Point(Math.max(0, Math.min(w - 1, Math.round(px))), Math.max(0, Math.min(h - 1, Math.round(py))))));
}

const ALIAS = {
  ctrl: 'LeftControl', control: 'LeftControl', shift: 'LeftShift', alt: 'LeftAlt', option: 'LeftAlt',
  cmd: 'LeftSuper', command: 'LeftSuper', meta: 'LeftSuper', win: 'LeftSuper', super: 'LeftSuper', windows: 'LeftSuper',
  enter: 'Enter', return: 'Enter', esc: 'Escape', escape: 'Escape', tab: 'Tab', backspace: 'Backspace',
  delete: 'Delete', del: 'Delete', space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  arrowup: 'Up', arrowdown: 'Down', arrowleft: 'Left', arrowright: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
};
async function parseKey(s) {
  const { Key } = await libs();
  return String(s).split('+').map(p => {
    const k = p.trim(), low = k.toLowerCase();
    const name = ALIAS[low] || (/^[a-z]$/i.test(k) ? k.toUpperCase()
      : /^\d$/.test(k) ? 'Num' + k : /^f\d{1,2}$/i.test(k) ? k.toUpperCase() : k);
    if (Key[name] === undefined) throw new Error('알 수 없는 키: ' + k);
    return Key[name];
  });
}

async function press(...keys) {
  const { keyboard } = await libs();
  await keyboard.pressKey(...keys);
  await keyboard.releaseKey(...[...keys].reverse());
}

// 한글 등 비ASCII는 클립보드 붙여넣기로 입력 — 다 쓴 뒤 이전 텍스트를 되돌려 놓는다
async function typeText(text) {
  const { keyboard, clipboard, Key } = await libs();
  if (/^[\x20-\x7E]*$/.test(text)) return keyboard.type(text);
  let prev = '';
  try { const c = await clipboard.getContent(); if (typeof c === 'string') prev = c; } catch { /* 내용 확인 실패는 복원 생략 */ }
  await clipboard.setContent(text);
  await press(process.platform === 'darwin' ? Key.LeftSuper : Key.LeftControl, Key.V);
  if (prev) setTimeout(() => clipboard.setContent(prev).catch(() => {}), 1200);
}

// ---------- 창(윈도우) ----------
// libnut가 한글 제목을 UTF-8 변환에서 깨뜨리므로 제목은 참고용, 번호와 좌표로 창을 고른다.
const cleanTitle = t => String(t || '').replace(/\uFFFD+/g, '?').replace(/\s+/g, ' ').trim();
const rectOf = r => ({
  left: +(r.left ?? r.x ?? 0), top: +(r.top ?? r.y ?? 0), width: +r.width || 0, height: +r.height || 0,
});
const NOISE = /^(Program Manager|GDI\+ Window|Shell Handwriting Canvas|Windows Input Experience|Taskbar|(?:Silent|Hidden))/i;
async function listWindows() {
  const { getWindows } = await libs();
  const out = [];
  for (const w of await getWindows()) {
    try {
      const r = rectOf(await w.region);
      if (r.width < 160 || r.height < 100) continue;      // 투명·보조 창 제외
      const title = cleanTitle(await w.title);
      if (!title || NOISE.test(title)) continue;
      out.push({ n: out.length, win: w, title, ...r });
      if (out.length >= 24) break;
    } catch { /* 사라지는 창 */ }
  }
  winCache = out;
  return out;
}
function pickWindow(index) {
  const w = winCache.find(x => x.n === Math.round(+index)) || winCache[+index];
  if (!w) throw new Error(`창 번호 ${index}이(가) 없습니다. computer_info로 목록을 다시 확인하세요.`);
  return w;
}
const SPOT = {
  center: r => [r.left + r.width / 2, r.top + r.height / 2],
  title: r => [r.left + r.width / 2, r.top + 14],
  menu: r => [r.left + 24, r.top + 40],
  left: r => [r.left + Math.min(60, r.width / 6), r.top + r.height / 2],
  right: r => [r.left + r.width - Math.min(60, r.width / 6), r.top + r.height / 2],
  top: r => [r.left + r.width / 2, r.top + Math.min(60, r.height / 6)],
  bottom: r => [r.left + r.width / 2, r.top + r.height - Math.min(60, r.height / 6)],
  close: r => [r.left + r.width - 24, r.top + 14],
  min: r => [r.left + r.width - 100, r.top + 14],
  max: r => [r.left + r.width - 62, r.top + 14],
};

// ---------- 애플리케이션·URL·파일 열기 ----------
// 셸 문자열에 얹지 않고 -EncodedCommand로 넘겨 명령어 삽입을 막는다.
// Start-Process에는 -LiteralPath가 없으므로 -FilePath를 쓴다. 오류는 PowerShell이
// 한국어( cp949 )로 뱉어 인코딩을 UTF-8로 고정하고 VCOK/VCERR 표지로 판정한다.
async function openWith(target) {
  const q = `'${String(target).replace(/'/g, "''")}'`;
  const script = `[Console]::OutputEncoding=[Text.Encoding]::UTF8; $ErrorActionPreference='Stop'; `
    + `try { Start-Process -FilePath ${q}; 'VCOK' } catch { 'VCERR ' + $_.Exception.Message }`;
  const b64 = Buffer.from(script, 'utf16le').toString('base64');
  let out = '';
  try { out = (await runFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', b64], { timeout: 15000, windowsHide: true })).stdout; }
  catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
  if (!out.includes('VCOK'))
    throw new Error(`"${target}" 열기 실패: ${((out.match(/VCERR([\s\S]*)/) || [, '알 수 없는 오류'])[1]).trim().slice(0, 220)}`);
}

// ---------- 안내문 ----------
// 모델이 스크린샷을 못 보는 경우에도 조작할 수 있도록 모든 결과에 텍스트 정보를 붙인다.
async function ground(action) {
  const { mouse, getActiveWindow } = await libs();
  const rs = await realSize();
  const p = await mouse.getPosition().catch(() => null);
  const act = await getActiveWindow().catch(() => null);
  const at = act ? cleanTitle(await act.title.catch(() => '')) : '';
  const ar = act ? rectOf(await act.region.catch(() => ({}))) : null;
  const coord = img ? `스크린샷 ${img.w}x${img.h} (실제 픽셀 = 좌표 × ${(rs.w / img.w).toFixed(1)})` : '스크린샷 미촬영';
  return `${action}
[PC ${rs.w}x${rs.h} · ${coord} · 커서 ${p ? `${p.x}, ${p.y}` : '(확인 불가)'} · 포커스 창 "${at || '없음'}"${ar ? ` (${ar.left}, ${ar.top} ${ar.width}x${ar.height})` : ''}]`;
}

async function shotWith(emp, action) {
  const image = await snap(emp);
  return { text: await ground(action), image };
}

export async function desktopAct(emp, name, a) {
  const { mouse, Button, Key, straightTo, Point } = await libs();
  const readonly = name === 'computer_info';
  if (!readonly) acquire(emp);
  if (!img && !readonly) await snap(emp);

  switch (name) {
    case 'computer_screenshot':
      return shotWith(emp, '현재 화면');
    case 'computer_info': {
      const wins = await listWindows();
      const rs = await realSize();
      const { mouse, getActiveWindow } = await libs();
      const p = await mouse.getPosition().catch(() => null);
      const act = await getActiveWindow().catch(() => null);
      const at = act ? cleanTitle(await act.title.catch(() => '')) : '';
      const list = wins.map(w => `[${w.n}] "${w.title}" (${w.left}, ${w.top} ${w.width}x${w.height})`).join('\n');
      return { text: `화면 ${rs.w}x${rs.h} · 커서 ${p ? `${p.x}, ${p.y}` : '(알 수 없음)'} · 포커스 창 "${at || '없음'}"
사용 가능한 창 ${wins.length}개 (제목의 ?는 한글 제목이 깨진 것 — 번호로 고르세요)
${list || '조건에 맞는 창이 없습니다'}
번호로 computer_focus(앞으로 가져오기)·computer_click_window(창 안 클릭)를 쓸 수 있습니다. 이미지를 볼 수 없는 모델도 이 좌표만으로 조작 가능합니다.` };
    }
    case 'computer_open': {
      const target = String(a.target || '').trim();
      if (!target) throw new Error('열 대상(URL·프로그램명·파일 경로)이 없습니다');
      await openWith(target);
      await sleep(1500);
      return shotWith(emp, `"${target}" 열기 시도`);
    }
    case 'computer_focus': {
      const w = pickWindow(a.index);
      await w.win.focus();
      await sleep(600);
      return shotWith(emp, `[${a.index}] "${w.title}" 창을 앞으로 가져옴`);
    }
    case 'computer_click_window': {
      const w = pickWindow(a.index);
      const spot = String(a.spot || 'center');
      if (!SPOT[spot]) throw new Error(`알 수 없는 지점: ${spot} (center|title|menu|left|right|top|bottom|close|min|max)`);
      const [rx, ry] = SPOT[spot]({ left: w.left, top: w.top, width: w.width, height: w.height });
      const px = rx + (+a.dx || 0), py = ry + (+a.dy || 0);
      await moveToReal(px, py);
      const btn = a.button === 'right' ? Button.RIGHT : a.button === 'middle' ? Button.MIDDLE : Button.LEFT;
      if (a.double) await mouse.doubleClick(btn); else await mouse.click(btn);
      await sleep(800);
      return shotWith(emp, `[${a.index}] "${w.title}" ${spot} 클릭 (실제 픽셀 ${Math.round(px)}, ${Math.round(py)})`);
    }
    case 'computer_move': {
      await moveTo(a.x, a.y);
      await sleep(300);
      return shotWith(emp, `(${a.x}, ${a.y})으로 커서 이동`);
    }
    case 'computer_click': {
      await moveTo(a.x, a.y);
      const btn = a.button === 'right' ? Button.RIGHT : a.button === 'middle' ? Button.MIDDLE : Button.LEFT;
      if (a.double) await mouse.doubleClick(btn); else await mouse.click(btn);
      await sleep(800);
      return shotWith(emp, `(${a.x}, ${a.y}) ${a.double ? '더블' : ''}클릭`);
    }
    case 'computer_drag': {
      await moveTo(a.x1, a.y1);
      const p2 = await toPx(a.x2, a.y2);
      await mouse.drag(straightTo(new Point(p2.px, p2.py)));
      await sleep(500);
      return shotWith(emp, '드래그 완료');
    }
    case 'computer_type': {
      await typeText(String(a.text ?? ''));
      if (a.press_enter) await press(Key.Enter);
      await sleep(500);
      return shotWith(emp, '입력 완료');
    }
    case 'computer_key': {
      await press(...await parseKey(a.key));
      await sleep(700);
      return shotWith(emp, `${a.key} 입력`);
    }
    case 'computer_scroll': {
      if (a.x != null && a.y != null) await moveTo(a.x, a.y);
      const dy = +a.dy || 500, steps = Math.max(1, Math.round(Math.abs(dy) / 100));
      if (dy > 0) await mouse.scrollDown(steps); else await mouse.scrollUp(steps);
      await sleep(500);
      return shotWith(emp, '스크롤 완료');
    }
    case 'computer_wait':
      await sleep(Math.min(10, +a.seconds || 2) * 1000);
      return shotWith(emp, '대기 완료');
    default:
      throw new Error('알 수 없는 컴퓨터 도구: ' + name);
  }
}
