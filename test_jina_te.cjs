const axios = require('axios');

async function testTE() {
  const url = 'https://tradingeconomics.com/united-states/inflation-cpi';
  try {
    const res = await axios.get(`https://r.jina.ai/${url}`, {
      headers: { 'Accept': 'text/plain' },
      timeout: 15000
    });
    console.log("Jina TE success! Start of content:", res.data.substring(0, 500));
  } catch(e) {
    console.error("Jina TE error:", e.message);
  }
}
testTE();
