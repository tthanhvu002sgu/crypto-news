import fs from 'fs';

function searchFlows() {
  const content = fs.readFileSync('scratch/nuxt_state.js', 'utf8');
  try {
    const getNuxt = new Function(`return ${content};`);
    const state = getNuxt();
    const dataObj = state.data[0];
    
    // Let's print keys of dataObj to see if there's any flow/history data
    console.log('Main data keys:', Object.keys(dataObj));
    
    // Check if there are keys related to etf history or flows
    const keys = Object.keys(dataObj);
    for (const key of keys) {
      if (key.toLowerCase().includes('flow') || key.toLowerCase().includes('hist') || key.toLowerCase().includes('chart')) {
        console.log(`Found matching key: ${key}`);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
  }
}

searchFlows();
