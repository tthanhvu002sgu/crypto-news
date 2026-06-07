const axios = require('axios');

async function testJinaJson() {
  const url = `https://r.jina.ai/https://query1.finance.yahoo.com/v8/finance/chart/HYG?range=1d&interval=1d`;
  try {
    const res = await axios.get(url, { 
      headers: { 
        'Accept': 'application/json',
        'X-Return-Format': 'json'
      },
      timeout: 15000 
    });
    console.log("Jina JSON keys:", Object.keys(res.data));
    console.log("Jina JSON data keys:", Object.keys(res.data.data));
    console.log("Jina content sample:", res.data.data.content.substring(0, 500));
  } catch (e) {
    console.log("Jina JSON error:", e.message);
  }
}

testJinaJson();
