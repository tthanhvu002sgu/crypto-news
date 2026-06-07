const axios = require('axios');
async function run() {
  const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=HYG`;
  try {
    const res = await axios.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000 
    });
    console.log("Success:", JSON.stringify(res.data.quoteResponse.result[0]));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
