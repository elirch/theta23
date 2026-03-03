// ─────────────────────────────────────────────────────────────
// theta23 — Agent Scanner
// Vercel Serverless Function: /api/agent-scan.js
// Trigger: GET https://theta23.com/api/agent-scan?secret=theta23run
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RUN_SECRET   = process.env.AGENT_SECRET || 'theta23run';

// ── RSS SOURCES ───────────────────────────────────────────────
const RSS_FEEDS = [
  { name:'Reuters World',   url:'https://feeds.reuters.com/reuters/worldNews' },
  { name:'Reuters Business',url:'https://feeds.reuters.com/reuters/businessNews' },
  { name:'BBC World',       url:'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { name:'Al Jazeera',      url:'https://www.aljazeera.com/xml/rss/all.xml' },
];

// ── FETCH RSS ─────────────────────────────────────────────────
async function fetchRSS(url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'theta23-agent/1.0' },
      signal: AbortSignal.timeout(8000)
    });
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const title       = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                           item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const description = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) ||
                           item.match(/<description>(.*?)<\/description>/))?.[1] || '';
      const link        = item.match(/<link>(.*?)<\/link>/)?.[1] || '';
      const pubDate     = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || '';
      if (title) items.push({ title, description: description.replace(/<[^>]+>/g,'').slice(0,300), link, pubDate });
    }
    return items.slice(0, 8); // top 8 per feed
  } catch(e) {
    console.error(`RSS fetch failed for ${url}:`, e.message);
    return [];
  }
}

// ── GET EXISTING EVENTS FROM SUPABASE ─────────────────────────
async function getExistingEvents() {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/geo_events?status=eq.active&select=title,region`, {
    headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` }
  });
  return await res.json();
}

// ── CLAUDE AGENT: SCAN ────────────────────────────────────────
async function agentScan(headlines, existingEvents) {
  const existingTitles = existingEvents.map(e => e.title).join('\n');

  const prompt = `You are a geopolitical financial intelligence analyst for theta23, a platform that maps geopolitical events to financial asset movements.

EXISTING EVENTS (already tracked — do not duplicate):
${existingTitles}

NEW HEADLINES FROM TODAY:
${headlines.map((h,i) => `${i+1}. [${h.source}] ${h.title} — ${h.description}`).join('\n')}

Your task: Identify 1-3 NEW geopolitical events from these headlines that:
1. Are NOT already covered in existing events
2. Have clear implications for financial assets (commodities, equities, currencies, bonds)
3. Are significant enough to track (not minor daily fluctuations)

For each event found, respond ONLY with valid JSON array:
[
  {
    "title": "Short clear title (max 8 words)",
    "region": "Geographic region (e.g. Middle East, East Asia, Western Europe)",
    "severity": "critical|high|medium|low",
    "lat": 0.0,
    "lng": 0.0,
    "summary": "2-3 sentence factual summary of what is happening",
    "tags": ["Tag1", "Tag2", "Tag3"],
    "tickers": ["SYM1", "SYM2", "SYM3"],
    "ticker_groups": {"Group Name": ["SYM1", "SYM2"]},
    "signal_score": 65,
    "context": "Historical context: what has happened in similar past events, what assets moved and by how much",
    "source_url": "url of the source article"
  }
]

If no significant new events found, return: []

Rules:
- tickers must be real US-listed ETFs or stocks (e.g. USO, GLD, LMT, SPY, EWG, FXI, CCJ)
- signal_score 0-100 based on historical pattern strength
- lat/lng must be accurate coordinates for the event location
- Be conservative — only flag genuinely market-moving geopolitical events
- Return ONLY the JSON array, no other text`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 2000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '[]';

  try {
    const clean = text.replace(/```json|```/g, '').trim();
    return JSON.parse(clean);
  } catch(e) {
    console.error('Parse error:', text);
    return [];
  }
}

// ── CLAUDE AGENT: QA ──────────────────────────────────────────
async function agentQA(event) {
  const prompt = `You are a QA agent for theta23, a geopolitical financial intelligence platform.

Review this proposed event and score its quality:

${JSON.stringify(event, null, 2)}

Score it 0-100 based on:
- Accuracy of ticker symbols (are they real and relevant?)
- Quality of signal_score (is it realistic?)
- Accuracy of coordinates
- Quality of context (is it historically grounded?)
- Severity appropriateness

Respond ONLY with JSON:
{
  "qa_score": 75,
  "qa_notes": "Brief notes on quality. Flag any issues with tickers, coordinates, or severity."
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '{"qa_score":50,"qa_notes":"QA failed"}';
  try {
    return JSON.parse(text.replace(/```json|```/g,'').trim());
  } catch(e) {
    return { qa_score: 50, qa_notes: 'QA parse error' };
  }
}

// ── SAVE TO SUPABASE QUEUE ────────────────────────────────────
async function saveToQueue(event, qa) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/agent_queue`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      agent_name:    'scanner-v1',
      event_type:    'geo',
      source_url:    event.source_url || null,
      proposed_data: event,
      qa_score:      qa.qa_score,
      qa_notes:      qa.qa_notes,
      status:        qa.qa_score >= 65 ? 'pending' : 'rejected'
    })
  });
  return res.ok;
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export default async function handler(req, res) {
  // Security check
  const secret = req.query.secret || req.headers['x-agent-secret'];
  if (secret !== RUN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  const log = [];

  try {
    // 1. Fetch headlines from all RSS feeds
    log.push('Fetching RSS feeds...');
    const allHeadlines = [];
    for (const feed of RSS_FEEDS) {
      const items = await fetchRSS(feed.url);
      items.forEach(item => allHeadlines.push({ ...item, source: feed.name }));
    }
    log.push(`Fetched ${allHeadlines.length} headlines`);

    // 2. Get existing events to avoid duplicates
    const existing = await getExistingEvents();
    log.push(`Found ${existing.length} existing events`);

    // 3. Agent Scan — find new events
    log.push('Running Agent Scan...');
    const newEvents = await agentScan(allHeadlines, existing);
    log.push(`Agent found ${newEvents.length} new events`);

    // 4. QA each event and save
    const results = [];
    for (const event of newEvents) {
      log.push(`QA checking: ${event.title}`);
      const qa = await agentQA(event);
      log.push(`QA score: ${qa.qa_score} — ${qa.qa_notes}`);
      const saved = await saveToQueue(event, qa);
      results.push({ title: event.title, qa_score: qa.qa_score, saved, status: qa.qa_score >= 65 ? 'pending' : 'rejected' });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return res.status(200).json({
      success: true,
      elapsed: `${elapsed}s`,
      headlines_fetched: allHeadlines.length,
      events_found: newEvents.length,
      results,
      log
    });

  } catch(e) {
    console.error('Agent error:', e);
    return res.status(500).json({ error: e.message, log });
  }
}
