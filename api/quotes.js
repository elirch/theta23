// Vercel Serverless Function — Yahoo Finance proxy
// Deployed automatically by Vercel when placed in /api folder
// Called from the browser as: /api/quotes?symbols=AAPL,EURUSD=X,...

export default async function handler(req, res) {
  // Allow requests from our own domain
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 's-maxage=60'); // cache 60 seconds on Vercel edge

  const { symbols } = req.query;
  if (!symbols) return res.status(400).json({ error: 'symbols required' });

  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${symbols}&fields=regularMarketPrice,regularMarketChangePercent,regularMarketChange`;

  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'application/json',
      }
    });

    if (!response.ok) throw new Error(`Yahoo returned ${response.status}`);

    const data = await response.json();
    const results = data?.quoteResponse?.result || [];

    const quotes = {};
    results.forEach(q => {
      quotes[q.symbol] = {
        price: q.regularMarketPrice,
        pct:   q.regularMarketChangePercent,
        change: q.regularMarketChange
      };
    });

    res.status(200).json(quotes);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}
