import type { VercelRequest, VercelResponse } from '@vercel/node';
import Anthropic from '@anthropic-ai/sdk';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(503).json({ error: 'ANTHROPIC_API_KEY not set' });

  const { dayName, monthName, dayNum, friends = [] } = req.body || {};
  const ctx = friends.length ? ` You often hang out with ${(friends as string[]).slice(0, 3).join(', ')}.` : '';
  const ai = new Anthropic({ apiKey });

  try {
    const msg = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 512,
      messages: [{
        role: 'user',
        content: `Suggest 3 specific things to do in or near New York City for ${dayName}, ${monthName} ${dayNum}, 2026.${ctx} Focus on fall activities: upstate day trips, county fairs, Halloween events, friendsgiving prep, or unique NYC fall experiences. Use real venues or locations. Respond ONLY with valid JSON: {"suggestions":[{"title":"...","description":"1-2 sentences","category":"upstate|fair|halloween|friendsgiving|other"}]}`,
      }],
    });
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    return res.json(parsed);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
