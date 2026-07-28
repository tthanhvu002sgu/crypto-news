/**
 * OpenRouter API Service
 * Supports dynamic fetching of free models with unique provider filtering
 * and streaming text generation via OpenRouter API.
 */

// Fallback list of curated top free models in case of network issues fetching OpenRouter API
export const FALLBACK_FREE_MODELS = [
  { id: 'deepseek/deepseek-r1:free', name: 'DeepSeek R1 (Free)', provider: 'DeepSeek' },
  { id: 'meta-llama/llama-3.3-70b-instruct:free', name: 'Llama 3.3 70B (Free)', provider: 'Meta Llama' },
  { id: 'qwen/qwen-2.5-72b-instruct:free', name: 'Qwen 2.5 72B (Free)', provider: 'Qwen' },
  { id: 'google/gemini-2.0-flash-exp:free', name: 'Gemini 2.0 Flash (Free)', provider: 'Google' },
  { id: 'mistralai/mistral-small-24b-instruct-2501:free', name: 'Mistral Small 24B (Free)', provider: 'Mistral AI' },
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct:free', name: 'Nemotron 70B (Free)', provider: 'NVIDIA' },
  { id: 'microsoft/phi-3-medium-128k-instruct:free', name: 'Phi-3 Medium 128k (Free)', provider: 'Microsoft' },
  { id: 'gryphe/mythomax-l2-13b:free', name: 'MythoMax 13B (Free)', provider: 'Gryphe' },
  { id: 'sophosympatheia/rogue-rose-103b-v0.2:free', name: 'Rogue Rose 103B (Free)', provider: 'Sophos' },
  { id: 'openchat/openchat-7b:free', name: 'OpenChat 7B (Free)', provider: 'OpenChat' },
];

/**
 * Fetch top 10 free models from OpenRouter ensuring NO DUPLICATE PROVIDERS.
 */
export async function fetchTop10FreeUniqueProviderModels() {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/models');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const allModels = json.data || [];

    // Filter free models
    const freeModels = allModels.filter((m) => {
      const isFreeId = m.id.endsWith(':free');
      const isZeroPrice =
        m.pricing &&
        parseFloat(m.pricing.prompt || '0') === 0 &&
        parseFloat(m.pricing.completion || '0') === 0;
      return isFreeId || isZeroPrice;
    });

    if (!freeModels.length) return FALLBACK_FREE_MODELS;

    // Deduplicate by provider (extracted from prefix before '/')
    const providerMap = new Map();

    // Priority ordering keywords to sort models by strength
    const priorityKeywords = ['r1', '70b', '72b', 'flash', '2501', '3.3', 'large', 'medium'];

    // Sort free models by context_length and priority keywords
    freeModels.sort((a, b) => {
      const aName = a.id.toLowerCase();
      const bName = b.id.toLowerCase();
      const aPrio = priorityKeywords.findIndex((k) => aName.includes(k));
      const bPrio = priorityKeywords.findIndex((k) => bName.includes(k));

      const aScore = (aPrio !== -1 ? 10 - aPrio : 0) + (a.context_length ? Math.min(a.context_length / 10000, 5) : 0);
      const bScore = (bPrio !== -1 ? 10 - bPrio : 0) + (b.context_length ? Math.min(b.context_length / 10000, 5) : 0);
      return bScore - aScore;
    });

    for (const m of freeModels) {
      const providerSlug = m.id.split('/')[0] || 'other';
      if (!providerMap.has(providerSlug)) {
        // Humanize provider name
        let providerName = providerSlug.charAt(0).toUpperCase() + providerSlug.slice(1);
        if (providerSlug === 'meta-llama') providerName = 'Meta Llama';
        else if (providerSlug === 'deepseek') providerName = 'DeepSeek';
        else if (providerSlug === 'google') providerName = 'Google';
        else if (providerSlug === 'nvidia') providerName = 'NVIDIA';
        else if (providerSlug === 'mistralai') providerName = 'Mistral AI';
        else if (providerSlug === 'qwen') providerName = 'Qwen';
        else if (providerSlug === 'microsoft') providerName = 'Microsoft';

        const displayName = m.name ? `${m.name} (${providerName})` : m.id;
        providerMap.set(providerSlug, {
          id: m.id,
          name: displayName,
          provider: providerName,
          contextLength: m.context_length,
        });
      }
      if (providerMap.size >= 10) break;
    }

    const uniqueTop10 = Array.from(providerMap.values());
    return uniqueTop10.length > 0 ? uniqueTop10 : FALLBACK_FREE_MODELS;
  } catch (err) {
    console.warn('[OpenRouter] Failed to fetch live models, using fallback list:', err);
    return FALLBACK_FREE_MODELS;
  }
}

/**
 * Stream OpenRouter completion response
 */
export async function streamOpenRouterCompletion({
  apiKey,
  model,
  systemPrompt,
  userPrompt,
  generationConfig = {},
  onChunk,
}) {
  const url = 'https://openrouter.ai/api/v1/chat/completions';
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey.trim()}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': window.location.href || 'http://localhost',
      'X-Title': 'Crypto News Dashboard',
    },
    body: JSON.stringify({
      model: model || 'deepseek/deepseek-r1:free',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: generationConfig.temperature ?? 0.2,
      top_p: generationConfig.topP ?? 0.85,
      max_tokens: generationConfig.maxOutputTokens ?? 4000,
      stream: true,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(errorText || `OpenRouter API HTTP ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let fullText = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split(/\r?\n|\r/);
    buffer = lines.pop() || '';

    for (const line of lines) {
      const cleaned = line.trim();
      if (!cleaned || cleaned.startsWith(':')) continue;
      if (cleaned.startsWith('data: ')) {
        const dataStr = cleaned.slice(6).trim();
        if (dataStr === '[DONE]') break;

        try {
          const parsed = JSON.parse(dataStr);
          const delta = parsed.choices?.[0]?.delta?.content || '';
          if (delta) {
            fullText += delta;
            onChunk(fullText);
          }
        } catch {
          // ignore parse errors for partial chunks
        }
      }
    }
  }

  return fullText;
}
