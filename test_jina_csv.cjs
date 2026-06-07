const axios = require('axios');
async function run() {
  const url = `https://r.jina.ai/https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2EY`;
  try {
    const res = await axios.get(url, { headers: { 'Accept': 'text/plain' }, timeout: 10000 });
    console.log("Success:", res.data.substring(0, 500));
  } catch (e) {
    console.log("Error:", e.response ? e.response.status : e.message);
  }
}
run();
