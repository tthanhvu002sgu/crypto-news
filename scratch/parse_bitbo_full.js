import fs from 'fs';

function run() {
  const html = fs.readFileSync('C:\\Users\\Vu\\Documents\\news\\scratch\\full_bitbo.html', 'utf8');
  console.log('Searching for tables and elements in Bitbo HTML...');

  // 1. Let's find all <table> tags
  const tableMatches = html.match(/<table[\s\S]*?>/gi);
  console.log('Number of <table> tags:', tableMatches ? tableMatches.length : 0);

  // 2. Search for the word "flow" or "inflow" or "outflow" case-insensitive
  const flowIndex = html.toLowerCase().indexOf('flow');
  if (flowIndex !== -1) {
    console.log('Found "flow" word context:', html.slice(flowIndex - 50, flowIndex + 250));
  } else {
    console.log('"flow" word NOT found.');
  }

  // 3. Search for some dates like "May" or "June" or "05/" or "06/"
  // Let's print out text that looks like a table row with negative numbers (flows are often like -250M or +300M)
  const numberMatches = html.match(/-?\d+(?:\.\d+)?\s*M\b/g);
  console.log('Matches for numbers like -100M or 50M:', numberMatches ? numberMatches.slice(0, 15) : []);

}

run();
