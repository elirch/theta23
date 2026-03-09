// ─────────────────────────────────────────────────────────────
// theta23 — Agent Reports
// Vercel Serverless Function: /api/agent-report.js
// Trigger: GET https://theta23.com/api/agent-report?secret=theta23run2024
// Generates a Weekly Intelligence Brief from active geo_events
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RUN_SECRET   = process.env.AGENT_SECRET || 'theta23run2024';

// ── FETCH ACTIVE EVENTS ───────────────────────────────────────
async function getActiveEvents() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/geo_events?status=eq.active&order=signal_score.desc&limit=10`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

// ── FETCH RECENT QUEUE (approved this week) ───────────────────
async function getRecentApproved() {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/agent_queue?status=eq.approved&created_at=gte.${weekAgo}&select=proposed_data,qa_score`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

// ── CLAUDE AGENT: WRITE REPORT ────────────────────────────────
async function generateReport(events, newThisWeek) {
  const eventsText = events.map((e, i) =>
    `${i+1}. ${e.title} [${e.region}] [${e.severity.toUpperCase()}] Signal:${e.signal_score}/100
   Summary: ${e.summary}
   Affected assets: ${(e.tickers||[]).join(', ')}
   Context: ${(e.context||'').slice(0, 200)}`
  ).join('\n\n');

  const newText = newThisWeek.length > 0
    ? `\nNEW EVENTS ADDED THIS WEEK:\n${newThisWeek.map(n => `- ${n.proposed_data?.title}`).join('\n')}`
    : '';

  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const weekOf = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const prompt = `You are a senior geopolitical financial analyst writing for theta23, an intelligence platform for sophisticated investors and finance professionals.

Today is ${today}.

ACTIVE GEOPOLITICAL EVENTS (sorted by signal strength):
${eventsText}
${newText}

Write a concise Weekly Intelligence Brief in the following EXACT JSON format:

{
  "title": "Weekly Intelligence Brief — [Month Day, Year]",
  "subtitle": "One punchy sentence summarizing the week's dominant theme",
  "week_of": "${weekOf}",
  "top_story": {
    "headline": "The single most important development this week (max 10 words)",
    "body": "3-4 sentences. What happened, why it matters financially, what to watch. Be specific about assets and historical precedents.",
    "key_assets": ["TICKER1", "TICKER2", "TICKER3"]
  },
  "three_things": [
    {
      "title": "Short title",
      "body": "2-3 sentences on a notable geopolitical development and its market implications.",
      "assets": ["TICKER1"]
    },
    {
      "title": "Short title", 
      "body": "2-3 sentences.",
      "assets": ["TICKER1"]
    },
    {
      "title": "Short title",
      "body": "2-3 sentences.",
      "assets": ["TICKER1"]
    }
  ],
  "chart_of_the_week": {
    "title": "One asset or spread worth watching",
    "body": "2-3 sentences on why this specific asset/spread is at an inflection point.",
    "ticker": "TICKER"
  },
  "risk_radar": [
    {"event": "Short event description", "probability": "low/medium/high", "impact": "low/medium/high"},
    {"event": "Short event description", "probability": "low/medium/high", "impact": "low/medium/high"},
    {"event": "Short event description", "probability": "low/medium/high", "impact": "low/medium/high"}
  ],
  "closing_note": "One sentence. A forward-looking observation or contrarian view."
}

Rules:
- Tickers must be real US-listed ETFs or stocks
- Be specific, not vague — cite actual price levels, spreads, or historical analogues when relevant
- Write for a Bloomberg terminal user, not a general audience
- Return ONLY the JSON, no other text`;

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
  const text = data.content?.[0]?.text || '{}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    console.error('Report parse error:', text.slice(0, 200));
    return null;
  }
}

// ── SAVE REPORT TO SUPABASE ───────────────────────────────────
async function saveReport(report, keyEvents, keyAssets) {
  const weekOf = new Date().toISOString().split('T')[0];

  // Check if report already exists for this week
  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/reports?week_of=eq.${weekOf}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await check.json();

  const payload = {
    title:      report.title,
    week_of:    weekOf,
    body:       JSON.stringify(report),
    key_events: keyEvents,
    key_assets: keyAssets,
    status:     'draft'
  };

  if (existing.length > 0) {
    // Update existing draft
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
  } else {
    // Insert new
    const res = await fetch(`${SUPABASE_URL}/rest/v1/reports`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(payload)
    });
    return res.ok;
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
    // 1. Fetch data
    const [events, newThisWeek] = await Promise.all([
      getActiveEvents(),
      getRecentApproved()
    ]);

    if (!events || events.length === 0) {
      return res.status(200).json({ success: false, error: 'No active events found' });
    }

    // 2. Generate report
    const report = await generateReport(events, newThisWeek);
    if (!report) {
      return res.status(200).json({ success: false, error: 'Report generation failed' });
    }

    // 3. Extract key assets
    const allAssets = [
      ...(report.top_story?.key_assets || []),
      ...(report.three_things || []).flatMap(t => t.assets || []),
      report.chart_of_the_week?.ticker
    ].filter(Boolean);
    const uniqueAssets = [...new Set(allAssets)];
    const keyEvents = events.slice(0, 3).map(e => e.title);

    // 4. Save to Supabase
    const saved = await saveReport(report, keyEvents, uniqueAssets);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    return res.status(200).json({
      success: true,
      elapsed: `${elapsed}s`,
      events_used: events.length,
      new_this_week: newThisWeek.length,
      report_title: report.title,
      saved,
      status: 'draft — awaiting approval'
    });

  } catch(e) {
    console.error('Report agent error:', e);
    return res.status(500).json({ error: e.message });
  }
}
