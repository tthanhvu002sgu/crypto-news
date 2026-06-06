import fs from 'fs';

function testParse() {
  const html = fs.readFileSync('scratch/full_bitbo.html', 'utf8');
  
  // Find __NUXT__ assignment
  // Match window.__NUXT__ = (function(...) { ... })(...);
  const match = html.match(/window\.__NUXT__\s*=\s*([\s\S]*?);?\s*<\/script>/);
  if (!match) {
    console.error('Could not find window.__NUXT__ in HTML');
    return;
  }
  
  const nuxtExpr = match[1];
  try {
    // We can wrap it in an IIFE or Function block returning the expression
    const getNuxt = new Function(`return ${nuxtExpr};`);
    const state = getNuxt();
    console.log('Successfully evaluated Nuxt state!');
    
    // Check state layout and data structure
    console.log('Layout:', state.layout);
    console.log('Data is array:', Array.isArray(state.data));
    if (state.data && state.data[0]) {
      const dataObj = state.data[0];
      console.log('Funds keys:', Object.keys(dataObj.funds || {}));
      console.log('IBIT holdings:', dataObj.funds?.IBIT);
      console.log('GBTC holdings:', dataObj.funds?.GBTC);
      console.log('FBTC holdings:', dataObj.funds?.FBTC);
      console.log('ARKB holdings:', dataObj.funds?.ARKB);
      console.log('BITB holdings:', dataObj.funds?.BITB);
    }
  } catch (err) {
    console.error('Error evaluating Nuxt state:', err.message);
  }
}

testParse();
