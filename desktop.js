// 실제 PC 데스크톱 전체를 조작하는 컴퓨터 유즈
import { screens, emit, findEmp } from './store.js';

const W = 1280;
let L = null;
let img = null;
let owner = null, until = 0;
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

// 스크린샷 좌표 → 실제 화면 좌표 (HiDPI/레티나 보정)
async function pt(x, y) {
  const { screen, Point } = await libs();
  const sw = await screen.width(), sh = await screen.height();
  const px = Math.max(0, Math.min(sw - 1, Math.round(+x * sw / img.w)));
  const py = Math.max(0, Math.min(sh - 1, Math.round(+y * sh / img.h)));
  return new Point(px, py);
}
async function moveTo(x, y) {
  const { mouse, straightTo } = await libs();
  await mouse.move(straightTo(await pt(x, y)));
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

// 한글 등 비ASCII는 클립보드 붙여넣기로 입력
async function typeText(text) {
  const { keyboard, clipboard, Key } = await libs();
  if (/^[\x20-\x7E]*$/.test(text)) return keyboard.type(text);
  await clipboard.setContent(text);
  await press(process.platform === 'darwin' ? Key.LeftSuper : Key.LeftControl, Key.V);
}

export async function desktopAct(emp, name, a) {
  const { mouse, Button, Key, straightTo } = await libs();
  acquire(emp);
  if (!img && name !== 'computer_screenshot') await snap(emp);
  // snap()이 img(좌표계)를 채운 뒤에 안내문을 만들어야, 모델에게 전달되는
  // 좌표 범위와 실제 이미지 크기가 어긋나지 않는다.
  const shot = async text => {
    const image = await snap(emp);
    return { text: `${text}\n(스크린샷 ${img.w}x${img.h}, 좌표는 이 이미지 기준)`, image };
  };

  switch (name) {
    case 'computer_screenshot':
      return shot('현재 화면');
    case 'computer_click': {
      await moveTo(a.x, a.y);
      const btn = a.button === 'right' ? Button.RIGHT : Button.LEFT;
      if (a.double) await mouse.doubleClick(btn); else await mouse.click(btn);
      await sleep(800);
      return shot(`(${a.x}, ${a.y}) ${a.double ? '더블' : ''}클릭`);
    }
    case 'computer_drag': {
      await moveTo(a.x1, a.y1);
      await mouse.drag(straightTo(await pt(a.x2, a.y2)));
      await sleep(500);
      return shot('드래그 완료');
    }
    case 'computer_type': {
      await typeText(String(a.text ?? ''));
      if (a.press_enter) await press(Key.Enter);
      await sleep(500);
      return shot('입력 완료');
    }
    case 'computer_key': {
      await press(...await parseKey(a.key));
      await sleep(700);
      return shot(`${a.key} 입력`);
    }
    case 'computer_scroll': {
      if (a.x != null && a.y != null) await moveTo(a.x, a.y);
      const dy = +a.dy || 500, steps = Math.max(1, Math.round(Math.abs(dy) / 100));
      if (dy > 0) await mouse.scrollDown(steps); else await mouse.scrollUp(steps);
      await sleep(500);
      return shot('스크롤 완료');
    }
    case 'computer_wait':
      await sleep(Math.min(10, +a.seconds || 2) * 1000);
      return shot('대기 완료');
    default:
      throw new Error('알 수 없는 컴퓨터 도구: ' + name);
  }
}
