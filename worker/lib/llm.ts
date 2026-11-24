import type { Env, ExperimentRow, HookType } from '../types';

export interface GeneratedDraft {
  hook_type: HookType;
  parts: string[];
}

const VALID_HOOKS = new Set<HookType>([
  'pain_point',
  'hot_take',
  'question',
  'mini_story',
  'build_in_public',
]);

export function parseLlmDrafts(rawText: string, fallbackHookType: HookType): GeneratedDraft[] {
  const stripped = rawText
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  const parsed = JSON.parse(stripped) as {
    drafts?: Array<{ hook_type?: string; parts?: unknown }>;
  };

  if (!parsed || !Array.isArray(parsed.drafts)) {
    throw new Error('LLM response missing drafts array');
  }

  const results: GeneratedDraft[] = [];
  for (const item of parsed.drafts) {
    if (!Array.isArray(item.parts)) continue;
    const parts = item.parts
      .filter((p): p is string => typeof p === 'string')
      .map((p) => p.trim().slice(0, 500))
      .filter((p) => p.length > 0)
      .slice(0, 5);

    if (parts.length === 0) continue;
    const hook = VALID_HOOKS.has(item.hook_type as HookType)
      ? (item.hook_type as HookType)
      : fallbackHookType;

    results.push({ hook_type: hook, parts });
  }

  if (results.length === 0) {
    throw new Error('LLM returned zero usable drafts');
  }
  return results;
}

const HOOK_GUIDANCE: Record<HookType, string> = {
  pain_point: 'Mulai dari keluhan nyata yang spesifik & relatable, tanpa basa-basi.',
  hot_take: 'Opini tegas yang agak kontradiktif tapi masuk akal untuk memancing diskusi.',
  question: 'Pertanyaan pendek & tajam di awal agar orang tergerak membalas pengalaman mereka.',
  mini_story: 'Cerita singkat 2-4 kalimat dari observasi nyata di lapangan + 1 insight.',
  build_in_public: 'Update jujur proses eksperimen/membangun tool, fokus ke masalah yang dicoba diselesaikan.',
};

export async function generateHookDrafts(
  env: Env,
  input: {
    experiment: ExperimentRow;
    hookType: HookType;
    count: number;
    isChain: boolean;
  }
): Promise<GeneratedDraft[]> {
  if (!env.LLM_API_KEY) {
    throw new Error('LLM_API_KEY is not configured');
  }

  const baseUrl = (env.LLM_BASE_URL || 'https://api.openai.com/v1').replace(/\/$/, '');
  const model = env.LLM_MODEL || 'gpt-4o-mini';
  const count = Math.max(1, Math.min(8, input.count));

  const systemPrompt = [
    'Kamu adalah penulis konten Threads berbahasa Indonesia yang natural, tajam, dan tidak terdengar seperti bot.',
    'Tujuan postingan adalah riset pasar: memancing komentar jujur dan melihat apakah audiens benar-benar merasakan masalah ini.',
    'ATURAN KETAT:',
    '- DILARANG pakai pembuka klise seperti "Di era digital saat ini", "Tahukah kamu", "Sebagai seorang...", atau "Berikut adalah 5 tips".',
    '- Hindari emoji berlebihan (maks 0-1 emoji jika benar-benar perlu), jangan pakai hashtag sama sekali.',
    '- Setiap bagian (part) maksimal 440 karakter.',
    '- Jawab HANYA dengan JSON valid berbentuk: {"drafts":[{"hook_type":"...","parts":["..."]}]}',
  ].join('\n');

  const userPrompt = [
    `Topik eksperimen: ${input.experiment.name}`,
    `Sudut masalah: ${input.experiment.problem_angle}`,
    `Target audiens: ${input.experiment.target_audience}`,
    `Gaya bahasa: ${input.experiment.tone}`,
    `Tipe hook: ${input.hookType} (${HOOK_GUIDANCE[input.hookType]})`,
    `Format: ${input.isChain ? 'Thread berantai 2 sampai 3 bagian per draft (part 1 adalah hook kuat, part berikutnya lanjutan + pertanyaan pemicu)' : 'Single post (1 bagian saja per draft)'}`,
    `Buat tepat ${count} variasi draft yang berbeda sudutnya.`,
  ].join('\n');

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    signal: AbortSignal.timeout(25_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${env.LLM_API_KEY}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.85,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`LLM API error (${res.status}): ${errText.slice(0, 180)}`);
  }

  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error('LLM API returned empty message content');
  }

  return parseLlmDrafts(content, input.hookType);
}
