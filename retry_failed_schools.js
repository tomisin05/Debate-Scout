import puppeteer from 'puppeteer';
import fs from 'fs';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function retryFailedSchools(username, password) {
    console.log('=== RETRYING FAILED SCHOOLS ===\n');
    
    // Load existing data and errors
    let existingData = [];
    let errors = [];
    
    try {
        const data = fs.readFileSync('data.json', 'utf8');
        existingData = JSON.parse(data);
    } catch (error) {
        console.log('No existing data.json found, starting fresh');
    }
    
    try {
        const errorData = fs.readFileSync('scrape_errors.json', 'utf8');
        errors = JSON.parse(errorData);
    } catch (error) {
        console.error('Could not load scrape_errors.json:', error.message);
        return;
    }

    // Load round count map for verification
    let roundCountMap = {};
    try {
        const mapData = fs.readFileSync('round_count_map.json', 'utf8');
        roundCountMap = JSON.parse(mapData);
    } catch (error) {
        console.error('Could not load round_count_map.json:', error.message);
        return;
    }

    const newRounds = [];
    let browser;

    try {
        browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });

        // Group errors by type
        const schoolNotFoundErrors = errors.filter(e => e.error === 'School link not found');
        const teamMismatchErrors = errors.filter(e => e.error.includes('Round count mismatch'));

        console.log(`Found ${schoolNotFoundErrors.length} schools with link issues`);
        console.log(`Found ${teamMismatchErrors.length} teams with count mismatches`);

        // Retry schools with link issues
        for (const error of schoolNotFoundErrors) {
            console.log(`\nRetrying school: ${error.school}`);
            
            let page;
            try {
                page = await browser.newPage();
                page.setDefaultTimeout(60000);

                await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                await page.type('input[name="username"]', username);
                await page.type('input[name="password"]', password);
                await page.click('button[type="submit"]');
                await sleep(3000);

                // Navigate directly to school page
                const schoolUrlName = error.school.replace(/\s+/g, '').replace(/-/g, '');
                const schoolUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}`;
                
                await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
                await sleep(3000);

                const teamLinks = await page.evaluate((schoolUrlName) => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const schoolLinks = links.filter(link => link.href.includes(`/${schoolUrlName}/`));
                    
                    return schoolLinks.map(link => ({
                        name: link.textContent.trim(),
                        href: link.href
                    })).filter(link =>
                        !link.href.includes('/All') &&
                        link.name !== 'Aff' &&
                        link.name !== 'Neg' &&
                        link.name.length > 0
                    );
                }, schoolUrlName);

                console.log(`  Found ${teamLinks.length} teams`);

                for (const team of teamLinks) {
                    try {
                        console.log(`    Scraping team: ${team.name}`);

                        await page.goto(team.href, { waitUntil: 'domcontentloaded' });
                        await sleep(2000);

                        const roundData = await page.evaluate(() => {
                            const rounds = [];
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
                            
                            if (!roundsTable) return rounds;
                            
                            const rows = Array.from(roundsTable.querySelectorAll('tr'));
                            
                            for (let i = 1; i < rows.length; i++) {
                                const row = rows[i];
                                const cells = row.querySelectorAll('td');
                                
                                if (cells.length >= 6) {
                                    const tournament = cells[0]?.innerText.trim() || '';
                                    const roundNum = cells[1]?.innerText.trim() || '';
                                    const side = cells[2]?.innerText.trim() || '';
                                    const opponent = cells[3]?.innerText.trim() || '';
                                    const judge = cells[4]?.innerText.trim() || '';
                                    const roundReport = cells[5]?.innerText.trim() || '';
                                    
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

                        roundData.forEach(round => {
                            newRounds.push({
                                school: error.school,
                                team: team.name,
                                ...round
                            });
                        });

                        console.log(`      Found ${roundData.length} rounds`);
                        await sleep(500);

                    } catch (teamError) {
                        console.log(`      Error scraping team ${team.name}: ${teamError.message}`);
                    }
                }

                await page.close();
                await sleep(1000);

            } catch (schoolError) {
                console.log(`  Error retrying school ${error.school}: ${schoolError.message}`);
                if (page) await page.close();
            }
        }

        // Retry specific teams with count mismatches
        for (const error of teamMismatchErrors) {
            console.log(`\nRetrying team: ${error.school} - ${error.team}`);
            
            let page;
            try {
                page = await browser.newPage();
                page.setDefaultTimeout(60000);

                await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                await page.type('input[name="username"]', username);
                await page.type('input[name="password"]', password);
                await page.click('button[type="submit"]');
                await sleep(3000);

                // Navigate directly to school page to find team link
                const schoolUrlName = error.school.replace(/\s+/g, '').replace(/-/g, '');
                const schoolUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}`;
                
                await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
                await sleep(2000);

                const teamLink = await page.evaluate((schoolUrlName, teamName) => {
                    const links = Array.from(document.querySelectorAll('a'));
                    const schoolLinks = links.filter(link => link.href.includes(`/${schoolUrlName}/`));
                    
                    const team = schoolLinks.find(link => link.textContent.trim() === teamName);
                    return team ? team.href : null;
                }, schoolUrlName, error.team);

                if (!teamLink) {
                    console.log(`    Team link not found`);
                    await page.close();
                    continue;
                }

                await page.goto(teamLink, { waitUntil: 'domcontentloaded' });
                await sleep(2000);

                const roundData = await page.evaluate(() => {
                    const rounds = [];
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
                    
                    if (!roundsTable) return rounds;
                    
                    const rows = Array.from(roundsTable.querySelectorAll('tr'));
                    
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const cells = row.querySelectorAll('td');
                        
                        if (cells.length >= 6) {
                            const tournament = cells[0]?.innerText.trim() || '';
                            const roundNum = cells[1]?.innerText.trim() || '';
                            const side = cells[2]?.innerText.trim() || '';
                            const opponent = cells[3]?.innerText.trim() || '';
                            const judge = cells[4]?.innerText.trim() || '';
                            const roundReport = cells[5]?.innerText.trim() || '';
                            
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

                roundData.forEach(round => {
                    newRounds.push({
                        school: error.school,
                        team: error.team,
                        ...round
                    });
                });

                console.log(`    Found ${roundData.length} rounds`);
                await page.close();
                await sleep(500);

            } catch (teamError) {
                console.log(`    Error retrying team: ${teamError.message}`);
                if (page) await page.close();
            }
        }

        await browser.close();

        // Append new rounds to existing data
        const allRounds = [...existingData, ...newRounds];
        fs.writeFileSync('data.json', JSON.stringify(allRounds, null, 2));
        
        console.log(`\nCompleted! Added ${newRounds.length} new rounds to data.json`);
        console.log(`Total rounds in data.json: ${allRounds.length}`);

    } catch (error) {
        if (browser) await browser.close();
        console.error('Fatal error:', error.message);
    }
}

async function main() {
    const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
    const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

    await retryFailedSchools(username, password);
}

main();