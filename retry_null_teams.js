import puppeteer from 'puppeteer';
import fs from 'fs';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function saveProgress(data, filename) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

async function retryNullTeams(username, password) {
    console.log('=== RETRYING NULL TEAMS ===\n');
    
    // Load existing round count map
    let roundCountMap = {};
    try {
        const data = fs.readFileSync('round_count_map.json', 'utf8');
        roundCountMap = JSON.parse(data);
    } catch (error) {
        console.error('Could not load round_count_map.json:', error.message);
        return;
    }

    // Find teams with null values (missing from map)
    const nullTeams = [];
    for (const [school, teams] of Object.entries(roundCountMap)) {
        for (const [teamName, count] of Object.entries(teams)) {
            if (count === null || count === undefined) {
                nullTeams.push({ school, teamName });
            }
        }
    }

    console.log(`Found ${nullTeams.length} teams to retry`);
    if (nullTeams.length === 0) return;

    let browser;
    try {
        browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });

        for (let i = 0; i < nullTeams.length; i++) {
            const { school, teamName } = nullTeams[i];
            console.log(`\nRetrying ${i + 1}/${nullTeams.length}: ${school} - ${teamName}`);

            let page;
            try {
                page = await browser.newPage();
                page.setDefaultTimeout(60000);

                // Login
                await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                await page.type('input[name="username"]', username);
                await page.type('input[name="password"]', password);
                await page.click('button[type="submit"]');
                await sleep(3000);

                // Navigate to team page
                const schoolUrlName = school.replace(/\s+/g, '').replace(/-/g, '');
                const teamUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}/${teamName.replace(/\s+/g, '').replace(/[()]/g, '')}`;
                
                await page.goto(teamUrl, { waitUntil: 'domcontentloaded' });
                await sleep(2000);

                const roundCount = await page.evaluate(() => {
                    const tables = document.querySelectorAll('table');
                    let roundsTable = null;
                    
                    for (const table of tables) {
                        const headerRow = table.querySelector('tr');
                        if (headerRow) {
                            const headers = Array.from(headerRow.querySelectorAll('td, th')).map(h => h.innerText.trim());
                            if (headers.includes('Tournament') && headers.includes('Round') && headers.includes('Side')) {
                                roundsTable = table;
                                break;
                            }
                        }
                    }
                    
                    if (!roundsTable) return null;
                    
                    // Check if page shows "No rounds yet, add one!"
                    const bodyText = document.body.innerText;
                    if (bodyText.includes('No rounds yet, add one!')) {
                        return 0;
                    }
                    
                    const rows = Array.from(roundsTable.querySelectorAll('tr'));
                    let count = 0;
                    
                    for (let i = 1; i < rows.length; i++) {
                        const cells = rows[i].querySelectorAll('td');
                        if (cells.length >= 3) {
                            const tournament = cells[0]?.innerText.trim() || '';
                            const roundNum = cells[1]?.innerText.trim() || '';
                            if (tournament && roundNum) count++;
                        }
                    }
                    
                    return count;
                });

                if (roundCount !== null) {
                    roundCountMap[school][teamName] = roundCount;
                    console.log(`  Success: ${roundCount} rounds`);
                } else {
                    console.log(`  Still failed to load`);
                }

                await page.close();
                await sleep(1000);

            } catch (error) {
                console.log(`  Error: ${error.message}`);
                if (page) await page.close();
            }

            // Save progress every 10 teams
            if ((i + 1) % 10 === 0) {
                saveProgress(roundCountMap, 'round_count_map.json');
                console.log(`  Progress saved (${i + 1}/${nullTeams.length})`);
            }
        }

        await browser.close();
        saveProgress(roundCountMap, 'round_count_map.json');
        console.log('\nRetry completed. Updated round_count_map.json');

    } catch (error) {
        if (browser) await browser.close();
        console.error('Fatal error:', error.message);
    }
}

async function main() {
    const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
    const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

    await retryNullTeams(username, password);
}

main();