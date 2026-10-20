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

export async function chat({ provider, model, baseUrl, keys, apiKey, system, messages, tools }) {
  const p = PROVIDERS[provider] || PROVIDERS.custom;
  const url = String(baseUrl || p.baseURL || '').trim();
  const key = (apiKey || keys?.[provider] || '').trim();
  if (!key && !p.keyOptional)
    throw new Error(`${p.label} API 키가 없습니다 — 직원 편집에서 개인 키를 넣거나 설정 탭의 전역 기본 키를 입력하세요`);
  if (provider !== 'anthropic' && !url)
    throw new Error(`${p.label}은 Base URL을 직접 입력해야 합니다 — 직원 편집의 Base URL 칸에 엔드포인트를 적어주세요`);
  return provider === 'anthropic'
    ? anthropicChat(client(provider, url, key), model, system, messages, tools)
    : openaiChat(client(provider, url, key), provider, model, system, messages, tools);
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
