// ─────────────────────────────────────────────────────────────
// theta23 — Agent Macro
// Vercel Serverless Function: /api/agent-macro.js
// Finds upcoming Fed/ECB/CPI/NFP dates and updates macro_events table
// Also records outcomes for past events
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RUN_SECRET   = process.env.AGENT_SECRET || 'theta23run2024';

// ── FETCH CURRENT MACRO DATES FROM DB ────────────────────────
async function getCurrentDates() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/macro_events?select=*`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  if (!res.ok) return [];
  return await res.json();
}

// ── FETCH RSS FOR MACRO NEWS ──────────────────────────────────
async function fetchMacroNews() {
  const feeds = [
    'https://feeds.bbci.co.uk/news/business/rss.xml',
    'https://feeds.reuters.com/reuters/businessNews'
  ];
  let headlines = [];
  for (const url of feeds) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'theta23-agent/1.0' },
        signal: AbortSignal.timeout(6000)
      });
      const xml = await res.text();
      const titleRegex = /<title><!\[CDATA\[(.*?)\]\]><\/title>|<title>(.*?)<\/title>/g;
      let match;
      let count = 0;
      while ((match = titleRegex.exec(xml)) !== null && count < 8) {
        const t = (match[1] || match[2] || '').trim();
        if (t && !t.includes('BBC') && !t.includes('Reuters')) {
          headlines.push(t);
          count++;
        }
      }
    } catch(e) { /* skip failed feed */ }
  }
  return headlines.slice(0, 12).join('\n');
}

// ── CLAUDE: FIND UPCOMING DATES & OUTCOMES ───────────────────
async function findMacroDates(currentDates, recentNews) {
  const today = new Date().toISOString().split('T')[0];
  const existingDates = currentDates.map(d =>
    `${d.event_id}: next_date=${d.next_event_date}, last_outcome=${d.last_outcome || 'none'}`
  ).join('\n') || 'No existing dates in DB yet';

  const prompt = `You are a macroeconomic calendar expert for theta23, a financial intelligence platform.

Today is ${today}.

CURRENT DATABASE STATE:
${existingDates}

RECENT FINANCIAL NEWS:
${recentNews}

Your job: Return the next scheduled dates for these 6 macro events, and identify any outcomes from events that recently occurred.

The 6 events to track:
1. fed — FOMC Fed Rate Decision (8x per year, ~every 6-7 weeks)
2. cpi — US CPI Inflation Print (monthly, ~2nd or 3rd week)
3. nfp — US Non-Farm Payrolls (monthly, first Friday)
4. ecb — ECB Rate Decision (8x per year, ~every 6-7 weeks)
5. opec — OPEC+ Meeting (irregular, typically every 2-3 months)
6. china_gdp — China GDP Release (quarterly: Jan, Apr, Jul, Oct)

Respond ONLY with this JSON:
{
  "updates": [
    {
      "event_id": "fed",
      "next_event_date": "YYYY-MM-DD",
      "next_event_label": "Human readable e.g. Mar 19, 2026",
      "frequency": "8x per year (FOMC)",
      "last_outcome": null or "Brief outcome if event just occurred e.g. Fed held rates at 4.25-4.50%, dovish tone",
      "last_outcome_date": null or "YYYY-MM-DD",
      "scenario_triggered": null or "A" or "B" or "C"
    }
  ]
}

Rules:
- Use your knowledge of the FOMC schedule, ECB calendar, and BLS release dates
- If you're not sure of exact date, give the most likely date based on historical patterns
- For last_outcome: only fill if an event occurred within the last 30 days AND you have information about it
- scenario_triggered: A=hawkish/hot, B=inline, C=dovish/cool/cut
- Return all 6 events in the updates array
- Return ONLY the JSON`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1000,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '{"updates":[]}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    console.error('Macro parse error:', text.slice(0, 300));
    return { updates: [] };
  }
}

// ── UPSERT MACRO EVENT TO DB ──────────────────────────────────
async function upsertMacroEvent(update) {
  // Try update first
  const checkRes = await fetch(
    `${SUPABASE_URL}/rest/v1/macro_events?event_id=eq.${update.event_id}`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await checkRes.json();

  const payload = {
    event_id:         update.event_id,
    next_event_date:  update.next_event_date,
    next_event_label: update.next_event_label,
    frequency:        update.frequency,
    updated_at:       new Date().toISOString()
  };

  if (update.last_outcome) {
    payload.last_outcome      = update.last_outcome;
    payload.last_outcome_date = update.last_outcome_date;
    payload.scenario_triggered = update.scenario_triggered;
  }

  if (existing && existing.length > 0) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/macro_events?event_id=eq.${update.event_id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      }
    );
    return res.ok ? 'updated' : 'update_failed';
  } else {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/macro_events`,
      {
        method: 'POST',
        headers: {
          'apikey': SUPABASE_KEY,
          'Authorization': `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal'
        },
        body: JSON.stringify(payload)
      }
    );
    return res.ok ? 'inserted' : 'insert_failed';
  }
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export default async function handler(req, res) {
  const secret = req.query.secret || req.headers['x-agent-secret'];
  if (secret !== RUN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();

  try {
    const [currentDates, recentNews] = await Promise.all([
      getCurrentDates(),
      fetchMacroNews()
    ]);

    const result = await findMacroDates(currentDates, recentNews);

    if (!result.updates || result.updates.length === 0) {
      return res.status(200).json({ success: false, error: 'No updates returned from Claude' });
    }

    const saveResults = [];
    for (const update of result.updates) {
      const action = await upsertMacroEvent(update);
      saveResults.push({ event_id: update.event_id, next_date: update.next_event_date, action });
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return res.status(200).json({
      success: true,
      elapsed: `${elapsed}s`,
      events_updated: saveResults.length,
      results: saveResults
    });

  } catch(e) {
    console.error('Macro agent error:', e);
    return res.status(500).json({ error: e.message });
  }
}
