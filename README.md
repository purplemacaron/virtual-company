# Virtual Company

직원은 AI이고, 사장은 당신입니다. 이 컴퓨터에서 도는 로컬 서버 하나 위에 AI 직원 5명을 앉히고, 메신저로 업무를 지시하면 서로 보고·위임·협업하며 파일을 만들고 브라우저를 조작합니다.

> **실행 전에 읽어주세요.** 컴퓨터 유즈를 켜면 AI가 이 PC의 마우스와 키보드를 실제로 움직입니다. 가상 머신이나 버려둘 계정에서 돌리는 것을 권합니다. 첫 실행이라면 `MAX_STEPS=8`처럼 단계 수를 짧게 잡으세요.

## 실행

```bash
git clone https://github.com/purplemacaron/virtual-company.git
cd virtual-company
npm install     # 의존성 + Playwright Chromium 설치
npm start       # http://localhost:3000
```

Node 18 이상. 별도 데이터베이스나 빌드 과정이 없습니다.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `3000` | 웹 서버 포트 |
| `DATA_FILE` | `./data.json` | 조직·업무·대화·키 저장 경로 |
| `MAX_STEPS` | `25` | 한 업무당 도구 호출 상한 (비상 정지용) |

## 화면

| 탭 | 보여 주는 것 |
|---|---|
| 오피스 | 직원 책상과 실시간 작업 화면. 마우스 커서 움직임까지 보입니다 |
| 업무 | 업무 대기열 · 담당 · 단계 로그 · 완료 결과 |
| 메신저 | 오너 지시와 직원 간 대화. `@이름`으로 특정 직원에게 보냅니다 |
| 조직 | 직급 트리, 직원 추가/편집, 도구 권한 |
| 설정 | API 키 · 웹 검색 엔진 · MCP 서버 · 안전 스위치 |

기본 직원: 클로이(대표) · 소피아(이사) · 지피(팀장) · 제이미(팀장) · 하이쿠(사원). 직급은 대표–이사–팀장–사원 4단계이며, 자기보다 낮은 직급에게만 업무를 지시할 수 있습니다. 직급표 자체도 편집할 수 있어 위임 구조가 그대로 권한이 됩니다.

## 운영 자유도

- **모델 · 25개 프로바이더.** Anthropic, OpenAI, Gemini, Groq, DeepSeek, Mistral, xAI, Together, Fireworks, Cerebras, SambaNova, NVIDIA NIM, GitHub Models, Perplexity, Cohere, Kimi, GLM, MiniMax, Azure, OpenRouter, 그리고 로컬(Ollama · LM Studio · llama.cpp · vLLM · OpenAI 호환 커스텀). 직원마다 다른 제공사와 모델, **개인 API 키**를 붙일 수 있고, 개인 키가 없으면 그 제공사의 전역 키로 폴백합니다. 로컬은 키 없이 Base URL만으로도 동작합니다.
- **웹 검색 · 8개 엔진.** tavily · serper · exa · brave · google(cse) · serpapi · searxng · duckduckgo. 자동 모드는 키가 채워진 엔진만 정해진 순서로 시도하고 실패하면 다음으로 넘어갑니다. 설정 탭에서 직접 질의를 넣어 결과를 테스트할 수 있습니다.
- **MCP · 프리셋 9개.** playwright, puppeteer, filesystem, memory, sequential-thinking, fetch, github, sqlite, everything. 프리셋을 고르면 명령어가 채워지고, "추가 후 바로 연결"이 등록과 접속을 한 번에 끝냅니다. stdio와 StreamableHTTP(헤더 인증) 모두 지원, 서버별 켜기/끄기, 어느 직원이 쓸 수 있는지 별도 지정합니다.
- **도구 권한 · 4개 그룹.** `core`(send_message · assign_task · complete_task · list_tasks), `web`(web_search · search_status · fetch_url), `browser`(navigate · click · fill · press · scroll · read · tabs · screenshot), `computer`(screenshot · click · drag · type · key · scroll · wait). 직원 개별로 켜고 끕니다.

## 데이터와 키 보안

- 모든 상태는 `data.json` 한 파일에 저장하며, **git에 커밋하지 않습니다**(`.gitignore` 처리됨). 파일이 없으면 기본 조직으로 새로 만듭니다.
- API 키는 브라우저와 WebSocket으로 내려가지 않습니다. 화면에는 앞 네 글자만 마스킹된 형태(`••••1234`)로만 전달됩니다.
- 마스킹된 값이 다시 제출되면 "변경 없음"으로 취급합니다. 키를 지우려면 입력창의 삭제 토글(`clearKeys`)을 명시적으로 켜야 합니다.

## 구조

```
server.js    Express + WebSocket, REST API, MCP 연결/권한 엔드포인트
engine.js    직원별 사고 루프 · 도구 호출 · 위임 · 완료 보고
store.js     데이터 모델, JSON 저장, 키 마스킹, 카탈로그 노출
llm.js       프로바이더별 클라이언트 생성과 tool call 규범화
tools.js     웹 검색 8엔진, MCP 접속과 도구 이름 변환, 파일/브라우저 도구
desktop.js   nut-js + screenshot-desktop 기반 실제 마우스·키보드 조작
catalog.js   프로바이더·검색엔진·MCP 프리셋 정의 (UI와 서버가 같은 소스 사용)
public/      앱 화면 (index.html · app.js · style.css)
site/        랜딩 페이지 (Vercel 배포용 정적 파일)
```

## 랜딩 페이지

`site/` 폴더가 배포 대상입니다. 프레임워크 없이 HTML/CSS/JS 정적 파일만 쓰므로 Vercel에서 **Root Directory를 `site`로 지정**하면 됩니다.

- `styles.css` 최상단의 CSS 변수가 팔레트와 글꼴을 한 곳에서 관리합니다.
- `site.js`의 직원별 로그 문장은 `engine.js`·`tools.js`가 실제로 화면에 찍는 문자열과 같습니다.
- 움직임은 스크롤로 보이는 구간에서만 돌고, `prefers-reduced-motion`에서는 정지 상태로 렌더링됩니다.
