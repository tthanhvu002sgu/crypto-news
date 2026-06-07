const axios = require('axios');
async function run() {
  const url = `https://api.allorigins.win/get?url=${encodeURIComponent('https://fred.stlouisfed.org/graph/fredgraph.csv?id=BAMLH0A0HYM2EY')}`;
  try {
    const res = await axios.get(url, { timeout: 10000 });
    console.log("Success:", res.data.contents.substring(0, 500));
  } catch (e) {
    console.log("Error:", e.message);
  }
}
run();
