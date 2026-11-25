const express = require('express');
const cors = require('cors');
const cheerio = require('cheerio');
const { OpenAI } = require('openai');
const { createClient } = require('redis');
const net = require('net');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN || '*' }));
app.use(express.json({ limit: '1mb' }));

// Gemini's OpenAI-compatible endpoint — no other logic changes needed
const llm = new OpenAI({
  apiKey: process.env.GEMINI_API_KEY,
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/',
});
const MODEL = 'gemini-2.5-flash'; // free tier; fallback: gemini-2.5-flash-lite

const isPrivate = (host) => {
  if (!host) return true;
  if (host === 'localhost' || host.endsWith('.local')) return true;
  if (net.isIP(host)) return /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.)/.test(host);
  return false;
};

const safeFetch = async (url) => {
  const u = new URL(url);
  if (!/^https?:$/.test(u.protocol) || isPrivate(u.hostname)) throw new Error('URL not allowed');
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 10000);
  const r = await fetch(u, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 TwoThetaBot' } });
  clearTimeout(t);
  if (!r.ok) throw new Error(`Fetch failed: ${r.status}`);
  const text = await r.text();
  return text.slice(0, 1_000_000);
};

app.get('/health', (_, res) => res.json({ ok: true }));

app.post('/api/scrape', async (req, res) => {
  try {
    const html = await safeFetch(req.body.url);
    const $ = cheerio.load(html);
    $('script, style, nav, footer, noscript').remove();
    const text = $('body').text().replace(/\s+/g, ' ').trim().slice(0, 8000);
    if (!text) return res.status(422).json({ error: 'No readable text found (site may be JS-rendered)' });
    res.json({ text });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

(async () => {
  let redis = null;
  try {
    redis = createClient({ url: process.env.REDIS_URL });
    redis.on('error', () => {});
    await redis.connect();
    console.log('Redis connected');
  } catch { console.warn('Redis unavailable — running uncached'); }

  app.post('/api/generate-email', async (req, res) => {
    const { url, text } = req.body || {};
    if (!text || !url) return res.status(400).json({ error: 'url and text required' });

    const key = `email:${url.trim().toLowerCase()}`;
    if (redis) {
      try {
        const hit = await redis.get(key);
        if (hit) return res.set('X-Cache', 'HIT').json(JSON.parse(hit));
      } catch {}
    }

    try {
      const c = await llm.chat.completions.create({
        model: MODEL,
        response_format: { type: 'json_object' },
        temperature: 0.7,
        messages: [
          { role: 'system', content: 'You are an expert SDR. Return ONLY valid JSON: {"facts":[string,string,string],"email":string}. 3 facts about the company, then a 3-sentence cold email. No markdown, no preamble.' },
          { role: 'user', content: text },
        ],
      });

      let data;
      try { data = JSON.parse(c.choices[0].message.content); } catch { throw new Error('Bad JSON from LLM'); }
      if (!Array.isArray(data.facts) || data.facts.length !== 3 || typeof data.email !== 'string')
        throw new Error('Bad shape from LLM');

      if (redis) redis.set(key, JSON.stringify(data), { EX: 86400 }).catch(() => {});
      res.set('X-Cache', 'MISS').json(data);
    } catch (e) {
      console.error('LLM error:', e.message);
      const msg = /rate|quota|429|RESOURCE_EXHAUSTED/i.test(e.message)
        ? 'Free tier rate limit — retry in a moment'
        : 'Generation failed — please retry';
      res.status(502).json({ error: msg });
    }
  });

  app.listen(process.env.PORT || 3000, () => console.log('up'));
})();
