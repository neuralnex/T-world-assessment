import { config } from '../config.js';

const promptVersion = 'summary-v1';

function mockSummary(text, tone, length) {
  const sentences = text.match(/[^.!?]+[.!?]*/g) || [text];
  const maxSentences = length === 'short' ? 2 : length === 'long' ? 6 : 4;
  const excerpt = sentences.slice(0, maxSentences).join(' ').trim();
  return `${tone === 'professional' ? 'Summary: ' : ''}${excerpt}`.trim();
}

export async function summarizeContent({ body, tone, length }) {
  if (!config.openRouterKey) {
    return { output: mockSummary(body, tone, length), provider: 'mock', model: 'local-extractive', promptVersion };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.aiTimeoutMs);
  try {
    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.openRouterKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': config.openRouterSiteUrl,
        'X-Title': config.openRouterAppName,
      },
      body: JSON.stringify({
        model: config.openRouterModel,
        temperature: 0.3,
        max_tokens: length === 'short' ? 180 : length === 'long' ? 650 : 350,
        messages: [
          { role: 'system', content: `Summarize the supplied content. Use a ${tone} tone and a ${length} length. Return only the summary.` },
          { role: 'user', content: body },
        ],
      }),
      signal: controller.signal,
    });
    if (!response.ok) {
      const providerMessage = response.status === 429 ? 'The AI provider is busy. Try again shortly.' : `The AI provider returned status ${response.status}.`;
      const error = new Error(providerMessage);
      error.status = response.status === 429 ? 429 : 502;
      throw error;
    }
    const payload = await response.json();
    const output = payload.choices?.[0]?.message?.content?.trim();
    if (!output) throw Object.assign(new Error('The AI provider returned an empty summary.'), { status: 502 });
    return { output, provider: 'openrouter', model: payload.model || config.openRouterModel, promptVersion };
  } catch (error) {
    if (error.name === 'AbortError') throw Object.assign(new Error('The AI request timed out. Try again.'), { status: 504 });
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export function fallbackExcerpt(body) {
  const firstSentence = body.match(/[^.!?]+[.!?]*/)?.[0]?.trim();
  return firstSentence || body.slice(0, 180).trim();
}
