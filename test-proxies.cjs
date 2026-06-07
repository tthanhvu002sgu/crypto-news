const axios = require('axios');

async function testProxies() {
  const fredUrl = 'https://api.stlouisfed.org/fred/series/observations?series_id=WALCL&file_type=json&api_key=e41b212dd8c58df436a5b6ce1ab1a129';
  
  try {
    console.log('Testing corsproxy.io for FRED...');
    const res = await axios.get(`https://corsproxy.io/?${encodeURIComponent(fredUrl)}`, { timeout: 10000 });
    console.log('corsproxy.io SUCCESS', !!res.data.observations);
  } catch(e) {
    console.log('corsproxy.io ERROR', e.message);
  }

  try {
    console.log('Testing allorigins for FRED...');
    const res = await axios.get(`https://api.allorigins.win/raw?url=${encodeURIComponent(fredUrl)}`, { timeout: 10000 });
    console.log('allorigins SUCCESS', !!res.data.observations);
  } catch(e) {
    console.log('allorigins ERROR', e.message);
  }
}

testProxies();
