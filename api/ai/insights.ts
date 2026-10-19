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

  const { plans, friends, topCats } = req.body || {};
  const ai = new Anthropic({ apiKey });

  try {
    const msg = await ai.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 800,
      messages: [{
        role: 'user',
        content: `You are a NYC social calendar assistant. Generate exactly 5 fall 2026 recommendations for a New Yorker. Always return 5 recs regardless of data quantity — if data is sparse, generate general NYC fall suggestions. User data: plans="${plans || 'none yet'}". Categories: "${topCats || 'none'}". Friends: "${friends || 'none'}". Return ONLY raw JSON, no commentary, no preamble: {"recs":[{"icon":"emoji","title":"short title under 40 chars","why":"1-2 sentences personal to their data or general NYC if sparse","cat":"upstate|fair|halloween|friendsgiving|other","suggestDate":"2026-MM-DD or null","planName":"short plan name"}]}`,
      }],
    });
    const raw = msg.content[0].type === 'text' ? msg.content[0].text : '{}';
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? '{}');
    return res.json(parsed);
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
