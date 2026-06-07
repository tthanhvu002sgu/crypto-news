const axios = require('axios');
async function run() {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/HYG?range=1d&interval=1d`;
  try {
    const res = await axios.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0' },
      timeout: 10000 
    });
    console.log("Success:", JSON.stringify(res.data.chart.result[0].meta));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
