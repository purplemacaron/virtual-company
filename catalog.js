// 서버·프론트가 함께 쓰는 사전 정의. UI가 이 데이터를 그대로 렌더하므로
// 프로바이더/검색엔진을 여기만 추가하면 양쪽에 반영된다.

export const PROVIDERS = {
  anthropic: { label: 'Anthropic Claude', group: 'cloud', native: true, hint: 'claude-opus-5-5 · claude-sonnet-5 · claude-haiku-4-5' },
  openai: { label: 'OpenAI', group: 'cloud', baseURL: 'https://api.openai.com/v1', hint: 'gpt-5 · gpt-5-mini · gpt-4.1' },
  gemini: { label: 'Google Gemini', group: 'cloud', baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/', hint: 'gemini-2.5-pro · gemini-2.5-flash' },
  groq: { label: 'Groq', group: 'cloud', baseURL: 'https://api.groq.com/openai/v1', hint: 'llama-3.3-70b-versatile · openai/gpt-oss-120b' },
  deepseek: { label: 'DeepSeek', group: 'cloud', baseURL: 'https://api.deepseek.com', hint: 'deepseek-chat · deepseek-reasoner' },
  mistral: { label: 'Mistral', group: 'cloud', baseURL: 'https://api.mistral.ai/v1', hint: 'mistral-large-latest · ministral-8b-latest' },
  xai: { label: 'xAI Grok', group: 'cloud', baseURL: 'https://api.x.ai/v1', hint: 'grok-4 · grok-3-mini' },
  together: { label: 'Together AI', group: 'cloud', baseURL: 'https://api.together.xyz/v1', hint: 'meta-llama/Llama-3.3-70B-Instruct-Turbo' },
  fireworks: { label: 'Fireworks', group: 'cloud', baseURL: 'https://api.fireworks.ai/inference/v1', hint: 'accounts/fireworks/models/llama-v3p3-70b-instruct' },
  cerebras: { label: 'Cerebras', group: 'cloud', baseURL: 'https://api.cerebras.ai/v1', hint: 'llama3.3-70b · qwen3-32b' },
  sambanova: { label: 'SambaNova', group: 'cloud', baseURL: 'https://api.sambanova.ai/v1', hint: 'Meta-Llama-3.3-70B-Instruct' },
  nvidia: { label: 'NVIDIA NIM', group: 'cloud', baseURL: 'https://integrate.api.nvidia.com/v1', hint: 'meta/llama-3.3-70b-instruct · nvidia/llama-3.1-nemotron-70b-instruct' },
  github: { label: 'GitHub Models', group: 'cloud', baseURL: 'https://models.github.ai/inference', hint: 'openai/gpt-4.1 · meta/Meta-Llama-3.1-8B-Instruct' },
  perplexity: { label: 'Perplexity', group: 'cloud', baseURL: 'https://api.perplexity.ai', hint: 'sonar-pro · sonar-reasoning-pro' },
  cohere: { label: 'Cohere', group: 'cloud', baseURL: 'https://api.cohere.com/compatibility/v1', hint: 'command-a-03-2025 · command-r-plus-08-2024' },
  moonshot: { label: 'Moonshot Kimi', group: 'cloud', baseURL: 'https://api.moonshot.ai/v1', hint: 'kimi-k2-0905-preview · moonshot-v1-8k' },
  zhipu: { label: 'Zhipu GLM', group: 'cloud', baseURL: 'https://api.z.ai/api/paas/v4', hint: 'glm-4.6 · glm-4-plus' },
  minimax: { label: 'MiniMax', group: 'cloud', baseURL: 'https://api.minimax.io/v1', hint: 'MiniMax-Text-01 · MiniMax-M1' },
  azure: { label: 'Azure OpenAI', group: 'cloud', baseURL: '', keyOptional: true, hint: 'https://{이름}.openai.azure.com/openai/v1 + 배포명' },
  openrouter: { label: 'OpenRouter (통합)', group: 'aggregator', baseURL: 'https://openrouter.ai/api/v1', hint: 'anthropic/claude-sonnet-5 · openai/gpt-5' },
  ollama: { label: 'Ollama (로컬)', group: 'local', baseURL: 'http://localhost:11434/v1', keyOptional: true, hint: 'qwen3:32b · llama3.1:8b · gemma3:12b' },
  lmstudio: { label: 'LM Studio (로컬)', group: 'local', baseURL: 'http://localhost:1234/v1', keyOptional: true, hint: '설치된 모델 이름 그대로' },
  llamacpp: { label: 'llama.cpp 서버 (로컬)', group: 'local', baseURL: 'http://localhost:8080/v1', keyOptional: true, hint: '서버에 로드한 GGUF 이름' },
  vllm: { label: 'vLLM (로컬/서버)', group: 'local', baseURL: 'http://localhost:8000/v1', keyOptional: true, hint: '--served-model-name으로 지정한 이름' },
  custom: { label: '커스텀 (OpenAI 호환)', group: 'local', baseURL: '', keyOptional: true, hint: '직원이 Base URL과 모델명을 직접 입력' },
};

export const PROVIDER_GROUPS = [
  ['cloud', '클라우드'], ['aggregator', '어그리게이터'], ['local', '로컬 · 셀프호스트 · 커스텀'],
];

// 검색 엔진. needs는 그 엔진을 쓰려면 채워야 하는 항목(키 / 추가 설정)을 뜻한다.
export const SEARCH_ENGINES = {
  tavily: { label: 'Tavily', needs: ['key'], keyHint: 'tvly-…' },
  serper: { label: 'Serper (Google)', needs: ['key'], keyHint: 'serper 키' },
  exa: { label: 'Exa', needs: ['key'], keyHint: 'exa-…' },
  brave: { label: 'Brave Search', needs: ['key'] },
  google: { label: 'Google Custom Search', needs: ['key', 'cx'], keyHint: 'API 키' },
  serpapi: { label: 'SerpAPI', needs: ['key'] },
  searxng: { label: 'SearXNG (무료·셀프호스트)', needs: ['url'] },
  duckduckgo: { label: 'DuckDuckGo (키 불필요)', needs: [] },
};
// 자동 모드에서의 시도 순서. 키 없는 DuckDuckGo는 최후의 수단으로 맨 뒤에 둔다.
export const SEARCH_ORDER = Object.keys(SEARCH_ENGINES);

export const MCP_PRESETS = [
  { key: 'playwright', label: 'Playwright MCP (브라우저 조작)', name: 'playwright', command: 'npx', args: '-y @playwright/mcp@latest' },
  { key: 'puppeteer', label: 'Puppeteer MCP', name: 'puppeteer', command: 'npx', args: '-y @modelcontextprotocol/server-puppeteer' },
  { key: 'filesystem', label: 'Filesystem MCP (파일 읽기/쓰기)', name: 'filesystem', command: 'npx', args: '-y @modelcontextprotocol/server-filesystem C:/temp' },
  { key: 'memory', label: 'Memory MCP (지식 그래프 기억)', name: 'memory', command: 'npx', args: '-y @modelcontextprotocol/server-memory' },
  { key: 'sequentialthinking', label: 'Sequential Thinking MCP', name: 'sequentialthinking', command: 'npx', args: '-y @modelcontextprotocol/server-sequential-thinking' },
  { key: 'fetch', label: 'Fetch MCP (웹 문서 가져오기, Python 필요)', name: 'fetch', command: 'uvx', args: 'mcp-server-fetch' },
  { key: 'github', label: 'GitHub MCP (토큰 필요)', name: 'github', command: 'npx', args: '-y @modelcontextprotocol/server-github', env: '{"GITHUB_TOKEN":"put-your-token"}' },
  { key: 'sqlite', label: 'SQLite MCP', name: 'sqlite', command: 'npx', args: '-y @modelcontextprotocol/server-sqlite ./data.db' },
  { key: 'everything', label: 'Everything MCP (데모·연결 테스트용)', name: 'everything', command: 'npx', args: '-y @modelcontextprotocol/server-everything' },
];
