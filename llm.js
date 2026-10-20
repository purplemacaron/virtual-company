import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { PROVIDERS } from './catalog.js';

export { PROVIDERS };

const clients = new Map();
function client(provider, baseURL, key) {
  const id = `${provider}:${baseURL}:${key}`;
  if (!clients.has(id)) clients.set(id, provider === 'anthropic'
    ? new Anthropic({ apiKey: key })
    : new OpenAI({ apiKey: key || 'not-needed', baseURL: baseURL || undefined }));
  return clients.get(id);
}

function clean(schema, drop) {
  if (Array.isArray(schema)) return schema.map(s => clean(s, drop));
  if (schema && typeof schema === 'object')
    return Object.fromEntries(Object.entries(schema).filter(([k]) => !drop.includes(k)).map(([k, v]) => [k, clean(v, drop)]));
  return schema;
}

// SDK 원문 오류(404 status code 등)는 사람이 고칠 단서가 없므로 한국어 안내로 번역한다
function friendly(e, p, model, url) {
  const status = e?.status ?? e?.response?.status;
  const raw = String(e?.message || e).slice(0, 240);
  if (status === 404) return new Error(`${p.label}에서 모델 "${model}"을(를) 찾을 수 없습니다 (HTTP 404 · ${url}). 모델 ID 오타가 가장 흔한 원인입니다 — 직원 편집 창에서 "모델 목록 확인"을 눌러 실제 ID를 고르세요.`);
  if (status === 401 || status === 403) return new Error(`${p.label} 인증 실패 (HTTP ${status}) — 이 직원의 개인 키 또는 설정 탭의 전역 키가 잘못된 것 같습니다. 키를 다시 입력하거나 권한이 있는 키로 교체하세요.`);
  if (status === 429) return new Error(`${p.label} 사용량 초과 (HTTP 429) — 요금제 한도이거나 일시적 속도 제한입니다. 잠시 후 재 시도하거나 더 가벼운 모델로 바꿔 보세요.`);
  if (status >= 500) return new Error(`${p.label} 서버 오류 (HTTP ${status}) — 제공사 문제일 수 있습니다. 잠시 후 다시 시도하거나 다른 제공사를 쓰세요.`);
  if (/fetch failed|Failed to fetch|ECONN|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|TimeoutError|invalid url|hostname/i.test(raw))
    return new Error(`${p.label}에 연결할 수 없습니다 (${url || 'Base URL 없음'}). 네트워크와 Base URL을 확인하세요. 로컬 제공사(Ollama 등)는 서버가 켜져 있어야 합니다.`);
  return new Error(`${p.label} 호출 실패${status ? ` (HTTP ${status})` : ''}: ${raw}`);
}

async function guard(fn, p, model, url) {
  try { return await fn(); } catch (e) { throw friendly(e, p, model, url); }
}

export async function chat({ provider, model, baseUrl, keys, apiKey, system, messages, tools }) {
  const p = PROVIDERS[provider] || PROVIDERS.custom;
  const url = String(baseUrl || p.baseURL || '').trim().replace(/\/+$/, '');
  const key = (apiKey || keys?.[provider] || '').trim();
  if (!key && !p.keyOptional)
    throw new Error(`${p.label} API 키가 없습니다 — 직원 편집에서 개인 키를 넣거나 설정 탭의 전역 기본 키를 입력하세요`);
  if (provider !== 'anthropic' && !url)
    throw new Error(`${p.label}은 Base URL을 직접 입력해야 합니다 — 직원 편집의 Base URL 칸에 엔드포인트를 적어주세요`);
  return guard(() => provider === 'anthropic'
    ? anthropicChat(client(provider, url, key), model, system, messages, tools)
    : openaiChat(client(provider, url, key), provider, model, system, messages, tools), p, model, url || 'https://api.anthropic.com');
}

// 제공사 /models를 직접 조회 — 모델 ID 오타(404)를 사용자가 눈으로 고를 수 있게
export async function listModels({ provider, baseUrl, keys, apiKey }) {
  const p = PROVIDERS[provider] || PROVIDERS.custom;
  const url = String(baseUrl || p.baseURL || '').trim().replace(/\/+$/, '');
  const key = (apiKey || keys?.[provider] || '').trim();
  if (provider === 'anthropic') {
    const r = await fetch(`${url || 'https://api.anthropic.com'}/v1/models`, {
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', Accept: 'application/json' },
      signal: AbortSignal.timeout(20000),
    });
    const body = await r.text();
    if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 180)}`);
    return [...new Set((JSON.parse(body).data || []).map(m => m?.id).filter(Boolean))].sort();
  }
  if (!url) throw new Error(`${p.label}은 Base URL을 입력해야 목록을 가져올 수 있습니다`);
  if (!key && !p.keyOptional) throw new Error(`${p.label} 키를 입력한 뒤에 모델을 조회할 수 있습니다`);
  const headers = { Accept: 'application/json' };
  if (key) headers.Authorization = `Bearer ${key}`;
  const r = await fetch(`${url}/models`, { headers, signal: AbortSignal.timeout(20000) });
  const body = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status}: ${body.slice(0, 180)}`);
  let data;
  try { data = JSON.parse(body); } catch { throw new Error(`${url}/models 응답이 JSON이 아닙니다. Base URL이 OpenAI 호환 엔드포인트(/v1)인지 확인하세요.`); }
  const arr = data?.data || data?.models || [];
  const ids = arr.map(m => (typeof m === 'string' ? m : m?.id || m?.name || m?.model)).filter(x => typeof x === 'string' && x);
  return [...new Set(ids)].sort();
}

async function anthropicChat(c, model, system, messages, tools) {
  const msgs = [];
  const push = (role, blocks) => {
    const last = msgs[msgs.length - 1];
    if (last && last.role === role) last.content.push(...blocks); else msgs.push({ role, content: [...blocks] });
  };
  for (const m of messages) {
    if (m.role === 'user') push('user', [{ type: 'text', text: m.content }]);
    else if (m.role === 'assistant') {
      const b = [];
      if (m.text) b.push({ type: 'text', text: m.text });
      for (const tc of m.toolCalls || []) b.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.args || {} });
      if (b.length) push('assistant', b);
    } else if (m.role === 'tool') {
      push('user', m.results.map(r => ({
        type: 'tool_result', tool_use_id: r.id,
        content: r.image
          ? [{ type: 'text', text: r.text || 'screenshot' }, { type: 'image', source: { type: 'base64', media_type: r.mediaType || 'image/jpeg', data: r.image } }]
          : (r.text || '(빈 결과)'),
      })));
    }
  }
  const body = { model, max_tokens: 8192, system, messages: msgs };
  if (tools.length) body.tools = tools.map(t => ({ name: t.name, description: t.description, input_schema: clean(t.parameters, ['$schema']) }));
  const res = await c.messages.create(body);
  return {
    text: res.content.filter(b => b.type === 'text').map(b => b.text).join('\n').trim(),
    toolCalls: res.content.filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, args: b.input })),
  };
}

async function openaiChat(c, provider, model, system, messages, tools) {
  const msgs = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'user') msgs.push({ role: 'user', content: m.content });
    else if (m.role === 'assistant') {
      const o = { role: 'assistant', content: m.text || '' };
      if (m.toolCalls?.length) o.tool_calls = m.toolCalls.map(tc => ({ id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } }));
      msgs.push(o);
    } else if (m.role === 'tool') {
      const imgs = [];
      for (const r of m.results) {
        msgs.push({ role: 'tool', tool_call_id: r.id, content: r.text || '(빈 결과)' });
        if (r.image) imgs.push(`data:${r.mediaType || 'image/jpeg'};base64,${r.image}`);
      }
      if (imgs.length) msgs.push({ role: 'user', content: [{ type: 'text', text: '[도구가 반환한 스크린샷]' }, ...imgs.map(url => ({ type: 'image_url', image_url: { url } }))] });
    }
  }
  const drop = provider === 'gemini' ? ['$schema', 'additionalProperties'] : ['$schema'];
  const body = { model, messages: msgs };
  if (tools.length) body.tools = tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: clean(t.parameters, drop) } }));
  const res = await c.chat.completions.create(body);
  const msg = res.choices[0].message;
  return {
    text: (msg.content || '').trim(),
    toolCalls: (msg.tool_calls || []).map(tc => ({
      id: tc.id || 'call_' + Math.random().toString(36).slice(2, 10),
      name: tc.function.name,
      args: (() => { try { return JSON.parse(tc.function.arguments || '{}'); } catch { return {}; } })(),
    })),
  };
}
