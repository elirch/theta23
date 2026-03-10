// ─────────────────────────────────────────────────────────────
// theta23 — Agent Archival
// Vercel Serverless Function: /api/agent-archive.js
// Trigger: GET https://theta23.com/api/agent-archive?secret=theta23run2024
// Checks each active event against current news and decides:
// ongoing / resolved / escalated
// ─────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const RUN_SECRET   = process.env.AGENT_SECRET || 'theta23run2024';

// ── FETCH ACTIVE EVENTS ───────────────────────────────────────
async function getActiveEvents() {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/geo_events?status=eq.active&order=created_at.asc`,
    { headers: { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}` } }
  );
  const data = await res.json();
  return data;
}

// ── FETCH RECENT NEWS FOR AN EVENT ───────────────────────────
async function fetchNewsForEvent(title, region) {
  const query = encodeURIComponent(`${title} ${region}`);
  // Use BBC RSS as a broad news check
  try {
    const res = await fetch('https://feeds.bbci.co.uk/news/world/rss.xml', {
      headers: { 'User-Agent': 'theta23-agent/1.0' },
      signal: AbortSignal.timeout(6000)
    });
    const xml = await res.text();
    const items = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;
    while ((match = itemRegex.exec(xml)) !== null) {
      const item = match[1];
      const t = (item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) || item.match(/<title>(.*?)<\/title>/))?.[1] || '';
      const d = (item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/) || item.match(/<description>(.*?)<\/description>/))?.[1] || '';
      if (t) items.push(`${t} — ${d.replace(/<[^>]+>/g,'').slice(0,150)}`);
    }
    return items.slice(0, 15).join('\n');
  } catch(e) {
    return 'No recent news available';
  }
}

// ── CLAUDE AGENT: ASSESS EVENT STATUS ────────────────────────
async function assessEvent(event, recentNews) {
  const prompt = `You are a geopolitical analyst for theta23. Assess whether this tracked event is still ongoing, has been resolved, or has significantly escalated.

EVENT:
Title: ${event.title}
Region: ${event.region}
Severity: ${event.severity}
Summary: ${event.summary}
Signal Score: ${event.signal_score}/100
Added: ${event.created_at ? new Date(event.created_at).toDateString() : 'Unknown'}

RECENT WORLD NEWS HEADLINES:
${recentNews}

Assess this event and respond ONLY with JSON:
{
  "status": "ongoing" | "resolved" | "escalated",
  "confidence": 0-100,
  "reasoning": "One sentence explaining your decision",
  "resolution_note": "If resolved: brief description of how it ended. If ongoing/escalated: null"
}

Rules:
- "resolved" only if there is strong evidence the crisis has ended (ceasefire held, deal signed, crisis passed)
- "escalated" if the situation has materially worsened beyond the original summary
- "ongoing" if still active or unclear
- Be conservative — default to "ongoing" if uncertain
- Consider that some events (Russia-Ukraine, Iran Nuclear) are structural and will be ongoing for years
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
      max_tokens: 300,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  const text = data.content?.[0]?.text || '{"status":"ongoing","confidence":50,"reasoning":"Assessment failed"}';
  try {
    return JSON.parse(text.replace(/```json|```/g, '').trim());
  } catch(e) {
    return { status: 'ongoing', confidence: 50, reasoning: 'Parse error — keeping active' };
  }
}

// ── ARCHIVE EVENT ─────────────────────────────────────────────
async function archiveEvent(id, resolutionNote) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/geo_events?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({
      status: 'archived',
      context: resolutionNote ? `[RESOLVED] ${resolutionNote}` : '[ARCHIVED]'
    })
  });
  return res.ok;
}

// ── UPDATE EVENT SEVERITY ─────────────────────────────────────
async function escalateEvent(id, currentSeverity) {
  const escalationMap = { low: 'medium', medium: 'high', high: 'critical', critical: 'critical' };
  const newSeverity = escalationMap[currentSeverity] || 'high';
  const res = await fetch(`${SUPABASE_URL}/rest/v1/geo_events?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    body: JSON.stringify({ severity: newSeverity })
  });
  return res.ok;
}

// ── MAIN HANDLER ──────────────────────────────────────────────
export default async function handler(req, res) {
  const secret = req.query.secret || req.headers['x-agent-secret'];
  if (secret !== RUN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const startTime = Date.now();
  const results = [];

  try {
    const events = await getActiveEvents();

    if (!events || events.length === 0) {
      return res.status(200).json({ success: true, message: 'No active events to assess' });
    }

    // Only assess events older than 7 days (new events are obviously still relevant)
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const eventsToCheck = events.filter(e => {
      if (!e.created_at) return true;
      return new Date(e.created_at) < weekAgo;
    });

    // Fetch news once (shared context)
    const sharedNews = await fetchNewsForEvent('geopolitical', 'world');

    // Assess each event (with rate limiting — 1 per second)
    for (const event of eventsToCheck) {
      const assessment = await assessEvent(event, sharedNews);

      const result = {
        id: event.id,
        title: event.title,
        status: assessment.status,
        confidence: assessment.confidence,
        reasoning: assessment.reasoning,
        action: 'none'
      };

      if (assessment.status === 'resolved' && assessment.confidence >= 75) {
        await archiveEvent(event.id, assessment.resolution_note);
        result.action = 'archived';
      } else if (assessment.status === 'escalated' && assessment.confidence >= 70) {
        await escalateEvent(event.id, event.severity);
        result.action = `escalated to ${event.severity}+`;
      }

      results.push(result);

      // Small delay to avoid rate limits
      await new Promise(r => setTimeout(r, 500));
    }

    const archived   = results.filter(r => r.action === 'archived').length;
    const escalated  = results.filter(r => r.action.startsWith('escalated')).length;
    const ongoing    = results.filter(r => r.action === 'none').length;
    const elapsed    = ((Date.now() - startTime) / 1000).toFixed(1);

    return res.status(200).json({
      success: true,
      elapsed: `${elapsed}s`,
      events_checked: eventsToCheck.length,
      skipped_new: events.length - eventsToCheck.length,
      archived,
      escalated,
      ongoing,
      results
    });

  } catch(e) {
    console.error('Archive agent error:', e);
    return res.status(500).json({ error: e.message });
  }
}
