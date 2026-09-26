import fs from 'fs';

const main = fs.existsSync('data_ndtceda26.json')
  ? JSON.parse(fs.readFileSync('data_ndtceda26.json', 'utf8'))
  : { meta: {}, rounds: [] };

const patch = JSON.parse(fs.readFileSync('patch_rounds.json', 'utf8'));
const newRounds = patch.rounds ?? patch;

// Deduplicate by year+school+team+tournament+round+side
const key = r => `${r.year}|${r.school}|${r.team}|${r.tournament}|${r.round}|${r.side}`;
const existing = new Set(main.rounds.map(key));

let added = 0;
for (const r of newRounds) {
  const roundKey = key(r);
  if (!existing.has(roundKey)) {
    main.rounds.push(r);
    existing.add(roundKey);
    added++;
  }
}

main.meta.lastUpdated = new Date().toISOString();
main.meta.totalRounds = main.rounds.length;

fs.writeFileSync('data_ndtceda26.json', JSON.stringify(main, null, 2));
console.log(`Added ${added} new rounds. Total: ${main.rounds.length}`);
