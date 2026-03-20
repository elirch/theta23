// ─────────────────────────────────────────────────────────────
// theta23 — Agent Commodities
// Vercel Serverless Function: /api/agent-commodities.js
// Links active geo_events to commodities and computes signal scores
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RUN_SECRET   = process.env.AGENT_SECRET || 'theta23run2024';

// ── ALL TRACKED COMMODITIES ───────────────────────────────────
const COMMODITIES = [
  { sym:'USO',  name:'WTI Crude Oil ETF',        cat:'energy'  },
  { sym:'BNO',  name:'Brent Crude Oil ETF',       cat:'energy'  },
  { sym:'UNG',  name:'Natural Gas ETF',           cat:'energy'  },
  { sym:'GLD',  name:'Gold ETF',                  cat:'metals'  },
  { sym:'GDX',  name:'Gold Miners ETF',           cat:'metals'  },
  { sym:'PPLT', name:'Platinum ETF',              cat:'metals'  },
  { sym:'PALL', name:'Palladium ETF',             cat:'metals'  },
  { sym:'BHP',  name:'BHP Group (Iron Ore)',      cat:'mining'  },
  { sym:'VALE', name:'Vale SA (Iron Ore)',         cat:'mining'  },
  { sym:'FCX',  name:'Freeport-McMoRan (Copper)', cat:'mining'  },
  { sym:'ALB',  name:'Albemarle (Lithium)',        cat:'mining'  },
  { sym:'SQM',  name:'SQM (Lithium)',             cat:'mining'  },
  { sym:'WEAT', name:'Wheat ETF',                 cat:'agri'    },
  { sym:'SOYB', name:'Soybeans ETF',              cat:'agri'    },
  { sym:'CORN', name:'Corn ETF',                  cat:'agri'    },
  { sym:'CCJ',  name:'Cameco (Uranium)',           cat:'nuclear' },
  { sym:'NXE',  name:'NexGen Energy (Uranium)',   cat:'nuclear' },
  { sym:'URA',  name:'Uranium ETF',               cat:'nuclear' },
  { sym:'ICLN', name:'Clean Energy ETF',          cat:'clean'   },
  { sym:'NEE',  name:'NextEra Energy',            cat:'clean'   },
];

// ── FETCH ACTIVE GEO EVENTS ───────────────────────────────────
async function getActiveEvents() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/geo_events?status=eq.active&order=signal_score.desc&limit=30`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  return await res.json();
}

// ── CLAUDE: MAP EVENTS TO COMMODITIES ────────────────────────
async function mapEventsToCommodities(events) {
  const eventsText = events.map(e =>
    `ID:${e.id} | "${e.title}" | ${e.region} | ${e.severity} | tags:${(e.tags||[]).join(',')} | tickers:${(e.tickers||[]).join(',')}`
  ).join('\n');

  const commoditiesText = COMMODITIES.map(c =>
    `${c.sym} (${c.name}, category:${c.cat})`
  ).join('\n');

  const prompt = `You are a commodity market analyst for theta23. Map active geopolitical events to the commodities they affect.

ACTIVE GEOPOLITICAL EVENTS:
${eventsText}

COMMODITIES TO ANALYZE:
${commoditiesText}

For each commodity, identify which active events affect it and assign a geo-political signal score.

Respond ONLY with this JSON:
{
  "commodities": [
    {
      "sym": "USO",
      "signal_score": 0-100,
      "signal_label": "ELEVATED" | "MODERATE" | "LOW" | "NEUTRAL",
      "linked_event_ids": [1, 4, 8],
      "hot_driver": "One sentence — the single most important current geopolitical factor for this commodity right now"
    }
  ]
}

Rules:
- signal_score: 0=no geopolitical impact, 100=maximum geopolitical stress
- Include ALL ${COMMODITIES.length} commodities in the response
- linked_event_ids: only include events that have DIRECT material impact on this commodity
- hot_driver: be specific — mention the actual event name and mechanism
- If no active events affect a commodity, set signal_score to 0-15 and linked_event_ids to []
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
  const text = data.content?.[0]?.text || '{"commodities":[]}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    console.error('Commodities parse error:', text.slice(0, 300));
    return { commodities: [] };
  }
}

// ── UPSERT COMMODITY TO DB ────────────────────────────────────
async function upsertCommodity(item, events) {
  // Build linked event titles for display
  const linkedEvents = events
    .filter(e => (item.linked_event_ids || []).includes(e.id))
    .map(e => ({ id: e.id, title: e.title, severity: e.severity }));

  const payload = {
    sym:              item.sym,
    signal_score:     item.signal_score,
    signal_label:     item.signal_label,
    linked_event_ids: item.linked_event_ids || [],
    linked_events:    linkedEvents,
    hot_driver:       item.hot_driver,
    updated_at:       new Date().toISOString()
  };

  // Check if exists
  const check = await fetch(
    `${SUPABASE_URL}/rest/v1/commodities?sym=eq.${item.sym}&select=id`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const existing = await check.json();

  if (existing && existing.length > 0) {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/commodities?sym=eq.${item.sym}`,
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
      `${SUPABASE_URL}/rest/v1/commodities`,
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
    const events = await getActiveEvents();

    if (!events || events.length === 0) {
      return res.status(200).json({ success: false, error: 'No active events found' });
    }

    const result = await mapEventsToCommodities(events);

    if (!result.commodities || result.commodities.length === 0) {
      return res.status(200).json({ success: false, error: 'No commodity mappings returned' });
    }

    const saveResults = [];
    for (const item of result.commodities) {
      const action = await upsertCommodity(item, events);
      saveResults.push({ sym: item.sym, signal: item.signal_score, label: item.signal_label, action });
    }

    const elevated = saveResults.filter(r => r.signal >= 60).length;
    const elapsed  = ((Date.now() - startTime) / 1000).toFixed(1);

    return res.status(200).json({
      success: true,
      elapsed: `${elapsed}s`,
      events_used: events.length,
      commodities_updated: saveResults.length,
      elevated_signals: elevated,
      results: saveResults
    });

  } catch(e) {
    console.error('Commodities agent error:', e);
    return res.status(500).json({ error: e.message });
  }
}
