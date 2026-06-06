async function searchLinks() {
  console.log('Fetching Tradingster home page to find Bitcoin link...');
  try {
    const res = await fetch('https://r.jina.ai/https://tradingster.com/', {
      headers: { 'Accept': 'text/plain' }
    });
    const text = await res.text();
    console.log('Page loaded. Length:', text.length);
    
    // Find all links containing "bitcoin" or "cme"
    const lines = text.split('\n');
    const matches = lines.filter(line => line.toLowerCase().includes('bitcoin') || line.toLowerCase().includes('btc'));
    console.log('Matches:', matches.slice(0, 20));
  } catch (err) {
    console.error('Error:', err.message);
  }
}

searchLinks();
