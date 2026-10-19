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

  const { success, total, topFriends, breakdown } = req.body || {};
  const prompt = `Write a warm, fun 2-paragraph recap of my fall 2026 social season. Stats: ${success} success days, ${total} total plans. Top friends: ${topFriends || 'none logged'}. Activity mix: ${breakdown || 'varied'}. Make it personal and celebratory.`;
  const ai = new Anthropic({ apiKey });

  const stream = new ReadableStream({
    async start(ctrl) {
      const enc = new TextEncoder();
      try {
        const s = ai.messages.stream({ model: 'claude-sonnet-5', max_tokens: 600, messages: [{ role: 'user', content: prompt }] });
        for await (const chunk of s) {
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            ctrl.enqueue(enc.encode(chunk.delta.text));
          }
        }
      } catch (e) { ctrl.enqueue(enc.encode(`Error: ${e}`)); }
      ctrl.close();
    },
  });

  res.setHeader('Content-Type', 'text/plain; charset=utf-8');
  const reader = stream.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    res.write(value);
  }
  res.end();
}
