async function testJina() {
  console.log('Testing Jina Reader for ETF flows...');
  try {
    const url = 'https://r.jina.ai/https://farside.co.uk/btc/';
    console.log('Fetching Farside via Jina:', url);
    const res = await fetch(url);
    console.log('Farside Status:', res.status);
    const text = await res.text();
    console.log('Farside text length:', text.length);
    // Write a slice to check if the tables are parsed
    console.log('Sample Farside text:', text.slice(0, 1000));
  } catch (err) {
    console.error('Farside Jina Error:', err.message);
  }

  try {
    const url = 'https://r.jina.ai/https://bitbo.io/etf/';
    console.log('Fetching Bitbo via Jina:', url);
    const res = await fetch(url);
    console.log('Bitbo Status:', res.status);
    const text = await res.text();
    console.log('Bitbo text length:', text.length);
    console.log('Sample Bitbo text:', text.slice(0, 1000));
  } catch (err) {
    console.error('Bitbo Jina Error:', err.message);
  }
}

testJina();
