async function testProxy() {
  console.log('Testing AllOrigins CORS proxy for Bitbo...');
  try {
    const targetUrl = encodeURIComponent('https://bitbo.io/etf/');
    const proxyUrl = `https://api.allorigins.win/get?url=${targetUrl}`;
    
    console.log('Fetching:', proxyUrl);
    const res = await fetch(proxyUrl);
    console.log('Status:', res.status);
    const json = await res.json();
    console.log('JSON keys:', Object.keys(json));
    const contents = json.contents;
    console.log('Contents length:', contents ? contents.length : 0);
    
    if (contents) {
      const nuxtMatch = contents.match(/window\.__NUXT__\s*=\s*([\s\S]*?);<\/script>/);
      console.log('Nuxt Match Found:', !!nuxtMatch);
    }
  } catch (err) {
    console.error('Proxy Fetch Error:', err.message);
  }
}

testProxy();
