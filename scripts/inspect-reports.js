import fs from 'fs';

const data = JSON.parse(fs.readFileSync('scripts/validation-results.json', 'utf8'));
data.results.forEach((r, i) => {
  console.log(`==================================================`);
  console.log(`[#${i + 1}] TOKEN: ${r.tokenSymbol} (${r.chain}) | INTENT: ${r.intent} | INPUT: "${r.input}"`);
  console.log(`==================================================`);
  console.log(r.formattedTelegramResponse);
  console.log('\n');
});
