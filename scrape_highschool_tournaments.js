import puppeteer from 'puppeteer';
import fs from 'fs';

const tournaments = [
    { name: 'hspolicy25', type: 'High School Policy' },
    { name: 'hsld25', type: 'High School Lincoln-Douglas' },
    { name: 'hspf25', type: 'High School Public Forum' }
];

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function saveProgress(data, filename = 'highschool_data.json') {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

async function scrapeAllTournaments(username, password) {
    let browser;
    const allRounds = [];
    const errors = [];
    const BATCH_SIZE = 10;
    const WAIT_TIME = 2 * 60 * 1000; // 2 minutes

    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });

        for (const tournament of tournaments) {
            console.log(`\n\n=== Processing ${tournament.type} (${tournament.name}) ===\n`);
            
            let page = await browser.newPage();
            page.setDefaultTimeout(60000);

            try {
                // Login
                await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                await page.type('input[name="username"]', username);
                await page.type('input[name="password"]', password);
                await page.click('button[type="submit"]');
                await sleep(3000);

                // Navigate to tournament
                await page.goto(`https://opencaselist.com/${tournament.name}`, { waitUntil: 'networkidle2', timeout: 60000 });
                await sleep(5000);

                // Get all school links
                const schoolLinks = await page.evaluate(() => {
                    const links = Array.from(document.querySelectorAll('a'));
                    return links
                        .filter(link => {
                            const href = link.href;
                            const text = link.textContent.trim();
                            // Filter out navigation and system links
                            return href.includes('/') && 
                                   !href.includes('opencaselist.com/login') &&
                                   !href.includes('opencaselist.com/faq') &&
                                   !href.includes('opencaselist.com/logout') &&
                                   !href.includes('opencaselist.com/history') &&
                                   !href.includes('opencaselist.com/privacy') &&
                                   !href.includes('opencaselist.com/terms') &&
                                   !href.includes('paperlessdebate.com') &&
                                   !href.includes('ndtceda.com') &&
                                   !href.includes('debatecoaches.org') &&
                                   !href.includes('speechanddebate.org') &&
                                   !href.includes('americanforensics.org') &&
                                   !href.includes('cndi.org') &&
                                   !text.includes('openCaselist') &&
                                   !text.includes('Account') &&
                                   !text.includes('Logout') &&
                                   !text.includes('NDT') &&
                                   !text.includes('NDCA') &&
                                   !text.includes('NFA') &&
                                   !text.includes('Evidence') &&
                                   !text.includes('Speech') &&
                                   !text.includes('Debate') &&
                                   !text.includes('Forensic') &&
                                   !text.includes('California') &&
                                   !text.includes('Donate') &&
                                   !text.includes('Contact') &&
                                   !text.includes('FAQ') &&
                                   !text.includes('Ashtar') &&
                                   !text.includes('History') &&
                                   !text.includes('Privacy') &&
                                   !text.includes('Terms') &&
                                   text.length > 0 &&
                                   text.length < 50; // School names shouldn't be too long
                        })
                        .map(link => ({
                            name: link.textContent.trim(),
                            href: link.href
                        }));
                });

                console.log(`Found ${schoolLinks.length} schools for ${tournament.type}`);

                // Process schools in batches
                for (let batchIndex = 0; batchIndex < schoolLinks.length; batchIndex += BATCH_SIZE) {
                    const batch = schoolLinks.slice(batchIndex, batchIndex + BATCH_SIZE);
                    console.log(`\nProcessing batch ${Math.floor(batchIndex / BATCH_SIZE) + 1}/${Math.ceil(schoolLinks.length / BATCH_SIZE)} (${batch.length} schools)`);

                    for (const school of batch) {
                        try {
                            console.log(`  Scraping school: ${school.name}`);
                            
                            await page.goto(school.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
                            await sleep(3000);

                            // Get team links
                            const teamLinks = await page.evaluate(() => {
                                const links = Array.from(document.querySelectorAll('a'));
                                const currentUrl = window.location.href;
                                const schoolPath = currentUrl.split('/').slice(-1)[0]; // Get school identifier
                                
                                return links
                                    .filter(link => {
                                        const href = link.href;
                                        const text = link.textContent.trim();
                                        return href.includes(`/${schoolPath}/`) && 
                                               !href.includes('/All') &&
                                               text !== 'Aff' && 
                                               text !== 'Neg' &&
                                               text.length > 0;
                                    })
                                    .map(link => ({
                                        name: link.textContent.trim(),
                                        href: link.href
                                    }));
                            });

                            console.log(`    Found ${teamLinks.length} teams`);

                            for (const team of teamLinks) {
                                try {
                                    console.log(`      Scraping team: ${team.name}`);

                                    await page.goto(team.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
                                    await sleep(2000);

                                    const roundData = await page.evaluate(() => {
                                        const rounds = [];
                                        const tables = document.querySelectorAll('table');
                                        let roundsTable = null;
                                        
                                        for (const table of tables) {
                                            const headerRow = table.querySelector('tr');
                                            if (headerRow) {
                                                const headers = Array.from(headerRow.querySelectorAll('td, th')).map(h => h.innerText.trim());
                                                if (headers.includes('Tournament') && headers.includes('Round')) {
                                                    roundsTable = table;
                                                    break;
                                                }
                                            }
                                        }
                                        
                                        if (!roundsTable) return rounds;
                                        
                                        const rows = Array.from(roundsTable.querySelectorAll('tr'));
                                        
                                        for (let i = 1; i < rows.length; i++) {
                                            const row = rows[i];
                                            const cells = row.querySelectorAll('td');
                                            
                                            if (cells.length >= 3) {
                                                const tournament = cells[0]?.innerText.trim() || '';
                                                const roundNum = cells[1]?.innerText.trim() || '';
                                                const side = cells[2]?.innerText.trim() || '';
                                                const opponent = cells[3]?.innerText.trim() || '';
                                                const judge = cells[4]?.innerText.trim() || '';
                                                const roundReport = cells[5]?.innerText.trim() || '';
                                                
                                                // Get preview URL and convert to API download URL
                                                let previewUrl = null;
                                                let downloadUrl = null;
                                                
                                                if (cells[6]) {
                                                    const previewLink = cells[6].querySelector('a[href*="/preview"]');
                                                    if (previewLink) {
                                                        previewUrl = previewLink.href;
                                                        const urlParams = new URLSearchParams(new URL(previewUrl).search);
                                                        const path = urlParams.get('path');
                                                        if (path) {
                                                            downloadUrl = `https://api.opencaselist.com/v1/download?path=${path}`;
                                                        }
                                                    }
                                                }
                                                
                                                if (tournament && roundNum) {
                                                    rounds.push({
                                                        tournament,
                                                        round: roundNum,
                                                        side,
                                                        opponent,
                                                        judge,
                                                        roundReport,
                                                        previewUrl,
                                                        downloadUrl
                                                    });
                                                }
                                            }
                                        }
                                        
                                        return rounds;
                                    });

                                    if (roundData && roundData.length > 0) {
                                        roundData.forEach(round => {
                                            allRounds.push({
                                                debateType: tournament.type,
                                                school: school.name,
                                                team: team.name,
                                                tournament: round.tournament,
                                                round: round.round,
                                                side: round.side,
                                                opponent: round.opponent,
                                                judge: round.judge,
                                                roundReport: round.roundReport,
                                                previewUrl: round.previewUrl,
                                                downloadUrl: round.downloadUrl
                                            });
                                        });
                                        console.log(`        Found ${roundData.length} rounds`);
                                    }

                                    await sleep(500);
                                } catch (teamError) {
                                    console.log(`      Error scraping team ${team.name}: ${teamError.message}`);
                                    errors.push({ tournament: tournament.name, school: school.name, team: team.name, error: teamError.message });
                                }
                            }

                            await sleep(1000);
                        } catch (schoolError) {
                            console.log(`    Error scraping school ${school.name}: ${schoolError.message}`);
                            errors.push({ tournament: tournament.name, school: school.name, error: schoolError.message });
                        }
                    }

                    // Save progress after each batch
                    saveProgress(allRounds);
                    console.log(`    Progress saved: ${allRounds.length} total rounds`);

                    // Wait between batches
                    if (batchIndex + BATCH_SIZE < schoolLinks.length) {
                        console.log(`    Waiting 2 minutes before next batch...`);
                        await sleep(WAIT_TIME);
                    }
                }

                await page.close();
                
            } catch (tournamentError) {
                console.log(`Error processing ${tournament.name}: ${tournamentError.message}`);
                errors.push({ tournament: tournament.name, error: tournamentError.message });
                if (page) await page.close();
            }

            // Wait between tournaments
            console.log(`\n⏳ Waiting 3 minutes before next tournament...\n`);
            await sleep(3 * 60 * 1000);
        }

        if (browser) await browser.close();

        if (errors.length > 0) {
            fs.writeFileSync('highschool_scrape_errors.json', JSON.stringify(errors, null, 2));
            console.log(`\n${errors.length} errors logged to highschool_scrape_errors.json`);
        }

        return allRounds;
    } catch (error) {
        if (browser) await browser.close();
        saveProgress(allRounds);
        console.log(`\nFatal error. Saved ${allRounds.length} rounds before crash.`);
        throw error;
    }
}

const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

scrapeAllTournaments(username, password)
    .then(result => {
        saveProgress(result);
        console.log(`\nData saved to highschool_data.json (${result.length} rounds from all high school tournaments)`);
        
        // Print summary
        const summary = result.reduce((acc, round) => {
            acc[round.debateType] = (acc[round.debateType] || 0) + 1;
            return acc;
        }, {});
        
        console.log('\nSummary by debate type:');
        Object.entries(summary).forEach(([type, count]) => {
            console.log(`  ${type}: ${count} rounds`);
        });
    })
    .catch(error => {
        console.error('Fatal error:', error.message);
    });