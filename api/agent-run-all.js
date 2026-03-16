// ─────────────────────────────────────────────────────────────
// theta23 — Agent Orchestrator
// Vercel Serverless Function: /api/agent-run-all.js
// The single cron entry point — runs all agents in order
// Cron: 0 8 * * * (every day at 08:00 UTC)
// ─────────────────────────────────────────────────────────────

const RUN_SECRET = process.env.AGENT_SECRET || 'theta23run2024';
const BASE_URL   = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : 'https://www.theta23.com';

async function runAgent(name, path, log) {
  const start = Date.now();
  try {
    const res  = await fetch(`${BASE_URL}${path}?secret=${RUN_SECRET}`);
    const data = await res.json();
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    log.push({ agent: name, success: data.success !== false, elapsed: `${elapsed}s`, result: data });
    return data;
  } catch(e) {
    log.push({ agent: name, success: false, error: e.message });
    return null;
  }
}

export default async function handler(req, res) {
  const secret = req.query.secret || req.headers['x-agent-secret'];
  if (secret !== RUN_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const log     = [];
  const today   = new Date();
  const isMonday = today.getUTCDay() === 1; // 0=Sun, 1=Mon

  // ── 1. SCAN (every day) ───────────────────────────────────
  await runAgent('scanner', '/api/agent-scan', log);

  // ── 2. ARCHIVE (Mondays only) ─────────────────────────────
  if (isMonday) {
    await runAgent('archive', '/api/agent-archive', log);
  }

  // ── 3. REPORT (Mondays only, after archive) ───────────────
  if (isMonday) {
    await runAgent('report', '/api/agent-report', log);
  }

  // ── 4. MACRO (Mondays only) ───────────────────────────────────
  if (isMonday) {
    await runAgent('macro', '/api/agent-macro', log);
  }

  // ── 5. COMMODITIES (add when ready) ───────────────────────
  // await runAgent('commodities', '/api/agent-commodities', log);

  return res.status(200).json({
    success: true,
    date: today.toISOString().split('T')[0],
    is_monday: isMonday,
    agents_run: log.length,
    log
  });
}
