const axios = require('axios');
async function run() {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2EY`;
  try {
    const res = await axios.get(url, { 
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36' },
      timeout: 10000 
    });
    console.log("Success:", res.data.substring(0, 100));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
