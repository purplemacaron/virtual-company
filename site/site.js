// 오피스 목업의 모니터에 앱이 실제로 찍는 활동 로그 문구를 흘려보낸다.
// 화면 밖에서는 멈추고, reduced-motion에서는 마지막 상태로 고정한다.
(() => {
  const LOGS = {
    '클로이': [
      ['think', '회사 목표 검토 중'],
      ['think', '업무 분배 계획 수립'],
      ['work', '업무 지시 → 소피아 · 프로토타입'],
      ['work', '업무 지시 → 지피 · 경쟁사 조사'],
      ['work', '메시지 작성 → 전체'],
      ['think', '완료 보고 취합 중'],
      ['work', '메시지 작성 → user'],
    ],
    '소피아': [
      ['work', '웹 검색 · "playwright mcp"'],
      ['work', '브라우저 · github.com'],
      ['work', '브라우저 클릭 · text=Install'],
      ['work', 'PC 화면 확인 중'],
      ['work', '마우스 클릭 · (480, 320)'],
      ['work', '타이핑 · "npm start"'],
      ['work', 'MCP · playwright › browser_read'],
    ],
    '지피': [
      ['work', '웹 검색 · "경쟁사 가격 정책"'],
      ['work', '웹페이지 읽는 중 · docs.example'],
      ['work', '브라우저 스크롤'],
      ['work', '메시지 작성 → 클로이'],
      ['think', '출처 정리 중'],
    ],
    '하이쿠': [
      ['think', '메시지 읽는 중'],
      ['work', '문서 요약 작성'],
      ['work', '업무 완료 보고 · #7c3f1'],
      ['work', '메시지 작성 → 소피아'],
    ],
  };
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desks = [...document.querySelectorAll('.desk')].map(desk => ({
    desk,
    screen: desk.querySelector('.screen'),
    bubble: desk.querySelector('[data-bubble]'),
    lines: LOGS[desk.querySelector('[data-screen]')?.dataset.screen] || [],
    i: 0,
    timer: 0,
  })).filter(d => d.screen && d.lines.length);

  const push = d => {
    const [kind, text] = d.lines[d.i % d.lines.length];
    d.i++;
    const ln = document.createElement('div');
    ln.className = 'ln';
    const caret = document.createElement('i');
    caret.textContent = kind === 'think' ? '…' : '›';
    ln.append(caret, document.createTextNode(' ' + text));
    d.screen.append(ln);
    requestAnimationFrame(() => ln.classList.add('on'));
    while (d.screen.children.length > 5) d.screen.firstChild.remove();
    d.desk.classList.toggle('is-thinking', kind === 'think');
    d.desk.classList.toggle('is-working', kind === 'work');
    if (d.bubble) d.bubble.textContent = text;
  };

  const start = d => { if (!d.timer && d.visible) d.timer = setInterval(() => push(d), 1500 + Math.random() * 1400); };
  const stop = d => { clearInterval(d.timer); d.timer = 0; };

  for (const d of desks) { for (let n = 0; n < 3; n++) push(d); d.visible = true; }

  if (reduce) { desks.forEach(stop); return; }

  const io = new IntersectionObserver(es => es.forEach(e => {
    const d = desks.find(x => x.desk === e.target);
    if (!d) return;
    d.visible = e.isIntersecting;
    d.visible ? start(d) : stop(d);
  }), { threshold: .2 });
  desks.forEach(d => io.observe(d.desk));
  document.addEventListener('visibilitychange', () =>
    document.hidden ? desks.forEach(stop) : desks.forEach(start));
})();
