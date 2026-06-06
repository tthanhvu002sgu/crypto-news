import fs from 'fs';

// Read the complete HTML output of bitbo (we can fetch it directly here)
async function run() {
  try {
    const res = await fetch('https://bitbo.io/etf/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const html = await res.text();
    fs.writeFileSync('C:\\Users\\Vu\\Documents\\news\\scratch\\full_bitbo.html', html);
    
    console.log('HTML Saved, parsing...');
    
    // Look for __NUXT__ state
    const nuxtMatch = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);<\/script>/);
    if (nuxtMatch) {
      console.log('Found __NUXT__ state!');
      const stateContent = nuxtMatch[1];
      fs.writeFileSync('C:\\Users\\Vu\\Documents\\news\\scratch\\nuxt_state.js', stateContent);
      console.log('Saved Nuxt state to scratch/nuxt_state.js');
    } else {
      console.log('__NUXT__ state not found.');
    }

    // Let's do a simple regex search for holdings of BlackRock, Grayscale, Fidelity
    const terms = ['IBIT', 'GBTC', 'FBTC', 'BlackRock', 'Grayscale', 'Fidelity'];
    for (const term of terms) {
      const idx = html.indexOf(term);
      if (idx !== -1) {
        console.log(`Found "${term}" at index ${idx}. Context:`, html.slice(idx - 100, idx + 200));
      } else {
        console.log(`"${term}" NOT found.`);
      }
    }

  } catch (err) {
    console.error('Error:', err);
  }
}

run();
