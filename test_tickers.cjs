const axios = require('axios');

async function testTicker(ticker) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=1d&interval=1d`;
  try {
    const res = await axios.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 10000 
    });
    const meta = res.data?.chart?.result?.[0]?.meta;
    console.log(`Success [${ticker}]: price = ${meta?.regularMarketPrice}, prevClose = ${meta?.chartPreviousClose}`);
  } catch (e) {
    console.log(`Error [${ticker}]:`, e.message);
  }
}

async function run() {
  const tickers = ['DX-Y.NYB', '^TNX', '^GSPC', '^NDX', '^VIX'];
  for (const t of tickers) {
    await testTicker(t);
  }
}

run();
