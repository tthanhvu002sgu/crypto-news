const axios = require('axios');

async function testJinaYahoo() {
  const url = `https://r.jina.ai/https://query1.finance.yahoo.com/v8/finance/chart/HYG?range=1d&interval=1d`;
  try {
    const res = await axios.get(url, { 
      headers: { 'Accept': 'text/plain' },
      timeout: 15000 
    });
    console.log("Jina response length:", res.data.length);
    console.log("Jina response sample:", res.data.substring(0, 500));
  } catch (e) {
    console.log("Jina error:", e.message);
  }
}

testJinaYahoo();
