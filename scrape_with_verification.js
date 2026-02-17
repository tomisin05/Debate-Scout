import puppeteer from 'puppeteer';
import fs from 'fs';

const schools = [
    'Arizona State', 'Baylor', 'Binghamton', 'Boston College', 'Central Oklahoma', 'Columbia', 'Cornell',
    'CSU Fullerton', 'CSU Long Beach', 'CSU Northridge', 'Dartmouth College',
    'Emory', 'Fairmont State', 'George Mason', 'Georgetown', 'Georgia', 'Gonzaga',
    'Harvard', 'Houston', 'Indiana', 'Iowa', 'James Madison',
    'Johnson County Community College', 'Kansas', 'Kansas State', 'Kentucky', 'Liberty', 'Macalester College', 'Marian', 'Massachusetts Amherst', 'Miami', 'Miami OH',
    'Michigan', 'Michigan State', 'Minnesota', 'Missouri State', 'Monmouth', 'Navy', 'New Mexico',
    'New School', 'North Texas', 'Northern Iowa', 'Northwestern', 'NYU', 'Ohio State', 'Oklahoma',
    'Purdue', 'Rochester', 'Samford', 'Southern California', 'Southern Nazarene',
    'Stanford', 'Suffolk', 'Texas', 'Texas AM', 'Towson', 'Trinity', 'UC Berkeley', 'UC Davis',
    'Utah', 'UTD', 'UTSA', 'Wake Forest',
    'West Georgia', 'West Point', 'Western Kentucky', 'Wichita State', 'Wyoming'
];


async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function saveProgress(data, filename) {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

async function retryNullTeams(username, password) {
    console.log('\n=== RETRYING NULL TEAMS ===\n');
    
    let roundCountMap = {};
    try {
        const data = fs.readFileSync('round_count_map.json', 'utf8');
        roundCountMap = JSON.parse(data);
    } catch (error) {
        console.error('Could not load round_count_map.json:', error.message);
        return;
    }

    // Find teams that failed to load (missing from map)
    const nullTeams = [];
    
    // We need to re-scan schools to find all teams, then check which are missing
    let browser;
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        page.setDefaultTimeout(60000);

        await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await sleep(6000);

        for (const school of schools) {
            if (!roundCountMap[school]) continue;
            
            const schoolUrlName = school.replace(/\s+/g, '').replace(/-/g, '');
            const schoolUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}`;
            
            await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
            await sleep(6000);

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

            // Check which teams are missing from the map
            for (const team of teamLinks) {
                if (!(team.name in roundCountMap[school])) {
                    nullTeams.push({ school, teamName: team.name, href: team.href });
                }
            }
        }

        await page.close();
        console.log(`Found ${nullTeams.length} teams to retry`);
        if (nullTeams.length === 0) {
            await browser.close();
            return;
        }

        for (let i = 0; i < nullTeams.length; i++) {
            const { school, teamName, href } = nullTeams[i];
            console.log(`Retrying ${i + 1}/${nullTeams.length}: ${school} - ${teamName}`);

            let page;
            try {
                page = await browser.newPage();
                page.setDefaultTimeout(60000);

                await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                await page.type('input[name="username"]', username);
                await page.type('input[name="password"]', password);
                await page.click('button[type="submit"]');
                await sleep(3000);
                
                await page.goto(href, { waitUntil: 'domcontentloaded' });
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
                    console.log(`  Still failed`);
                }

                await page.close();
                await sleep(500);

            } catch (error) {
                console.log(`  Error: ${error.message}`);
                if (page) await page.close();
            }
        }

        await browser.close();
        saveProgress(roundCountMap, 'round_count_map.json');
        console.log('Retry completed\n');

    } catch (error) {
        if (browser) await browser.close();
        console.error('Retry error:', error.message);
    }
}

async function createRoundCountMap(username, password) {
    console.log('=== PHASE 1: Creating round count map ===\n');
    
    let browser;
    const roundCountMap = {};
    
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        
        for (let batchIndex = 0; batchIndex < schools.length; batchIndex += 5) {
            const batch = schools.slice(batchIndex, batchIndex + 5);
            console.log(`\nProcessing batch ${Math.floor(batchIndex / 5) + 1}/${Math.ceil(schools.length / 5)} (${batch.length} schools)`);

            for (const school of batch) {
                let page;
                try {
                    console.log(`Mapping school: ${school}`);
                    
                    page = await browser.newPage();
                    page.setDefaultTimeout(60000);

                    // Login for each page
                    await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                    await page.type('input[name="username"]', username);
                    await page.type('input[name="password"]', password);
                    await page.click('button[type="submit"]');
                    await sleep(3000);
                    
                    // Navigate directly to school page
                    const schoolUrlName = school.replace(/\s+/g, '').replace(/-/g, '');
                    const schoolUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}`;
                    
                    await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
                    await sleep(2000);
                    
                    // Check if page is empty and reload if needed
                    const isEmpty = await page.evaluate(() => {
                        const bodyText = document.body.innerText;
                        return bodyText.includes('2025-2026') && bodyText.includes('2024-2025') && !bodyText.includes('Team');
                    });
                    
                    if (isEmpty) {
                        console.log(`  Page appears empty, reloading...`);
                        await page.reload({ waitUntil: 'networkidle2' });
                        await sleep(3000);
                    }

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
                    roundCountMap[school] = {};

                    for (const team of teamLinks) {
                        try {
                            await page.goto(team.href, { waitUntil: 'domcontentloaded' });
                            await sleep(1500);

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
                                
                                const rows = Array.from(roundsTable.querySelectorAll('tr'));
                                
                                // Check if page shows "No rounds yet, add one!"
                                const bodyText = document.body.innerText;
                                if (bodyText.includes('No rounds yet, add one!')) {
                                    return 0;
                                }
                                
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

                            if (roundCount === null) {
                                console.log(`    ${team.name}: failed to load`);
                                // Don't set in map, will be retried
                            } else {
                                roundCountMap[school][team.name] = roundCount;
                                console.log(`    ${team.name}: ${roundCount} rounds`);
                            }
                            
                            await sleep(500);
                        } catch (teamError) {
                            console.log(`    Error mapping team ${team.name}: ${teamError.message}`);
                            // Don't set in map, will be retried
                        }
                    }

                } catch (schoolError) {
                    console.log(`  Error mapping school ${school}: ${schoolError.message}`);
                } finally {
                    if (page) await page.close();
                }
            }

            // Wait 2 minutes between batches
            if (batchIndex + 5 < schools.length) {
                console.log(`\n⏳ Waiting 5 minute before next batch...`);
                await sleep(5 * 60 * 1000);
            }
        }

        await browser.close();
        saveProgress(roundCountMap, 'round_count_map.json');
        console.log('\nRound count map saved to round_count_map.json');
        return roundCountMap;
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Error creating round count map:', error.message);
        throw error;
    }
}

async function scrapeWithVerification(username, password, roundCountMap) {
    console.log('\n=== PHASE 2: Scraping with verification ===\n');
    
    let browser;
    const allRounds = [];
    const errors = [];
    const BATCH_SIZE = 5;
    const MAX_RETRIES = 3;

    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

        for (let batchIndex = 0; batchIndex < schools.length; batchIndex += BATCH_SIZE) {
            const batch = schools.slice(batchIndex, batchIndex + BATCH_SIZE);
            console.log(`\nProcessing batch ${Math.floor(batchIndex / BATCH_SIZE) + 1}/${Math.ceil(schools.length / BATCH_SIZE)}`);

            for (const school of batch) {
                let page;
                try {
                    console.log(`\nScraping school: ${school}`);
                    
                    page = await browser.newPage();
                    page.setDefaultTimeout(60000);

                    await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                    await page.type('input[name="username"]', username);
                    await page.type('input[name="password"]', password);
                    await page.click('button[type="submit"]');
                    await sleep(3000);

                    await page.goto('https://opencaselist.com/ndtceda25', { waitUntil: 'networkidle2' });
                    await sleep(3000);

                    const schoolFound = await page.evaluate((schoolName) => {
                        const links = Array.from(document.querySelectorAll('a'));
                        let schoolLink = links.find(link => link.textContent.trim() === schoolName);
                        if (!schoolLink) {
                            schoolLink = links.find(link =>
                                link.textContent.trim().toLowerCase().includes(schoolName.toLowerCase()) ||
                                schoolName.toLowerCase().includes(link.textContent.trim().toLowerCase())
                            );
                        }
                        if (schoolLink) {
                            schoolLink.click();
                            return true;
                        }
                        return false;
                    }, school);

                    if (!schoolFound) {
                        console.log(`  School "${school}" not found`);
                        errors.push({ school, error: 'School link not found' });
                        await page.close();
                        continue;
                    }

                    await sleep(3000);

                    const schoolUrlName = school.replace(/\s+/g, '').replace(/-/g, '');
                    const teamLinks = await page.evaluate((schoolUrlName) => {
                        const links = Array.from(document.querySelectorAll(`a[href*="/${schoolUrlName}/"]`));
                        return links.map(link => ({
                            name: link.textContent.trim(),
                            href: link.href
                        })).filter(link =>
                            !link.href.includes('/All') &&
                            link.name !== 'Aff' &&
                            link.name !== 'Neg'
                        );
                    }, schoolUrlName);

                    console.log(`  Found ${teamLinks.length} teams`);

                    for (const team of teamLinks) {
                        const expectedRounds = roundCountMap[school]?.[team.name] || 0;
                        let actualRounds = 0;
                        let retryCount = 0;
                        
                        while (retryCount <= MAX_RETRIES) {
                            try {
                                console.log(`    Scraping team: ${team.name} (expected: ${expectedRounds})`);

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

                                actualRounds = roundData.length;
                                
                                if (actualRounds === expectedRounds || expectedRounds === 0) {
                                    // Success or no expected rounds
                                    if (roundData.length > 0) {
                                        roundData.forEach(round => {
                                            allRounds.push({
                                                school: school,
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
                                    }
                                    console.log(`      Found ${actualRounds} rounds ✓`);
                                    break;
                                } else {
                                    // Mismatch - retry
                                    retryCount++;
                                    console.log(`      Found ${actualRounds} rounds, expected ${expectedRounds} - retry ${retryCount}/${MAX_RETRIES}`);
                                    if (retryCount <= MAX_RETRIES) {
                                        await sleep(3000);
                                    }
                                }
                                
                            } catch (teamError) {
                                retryCount++;
                                console.log(`      Error scraping team ${team.name} (attempt ${retryCount}): ${teamError.message}`);
                                if (retryCount <= MAX_RETRIES) {
                                    await sleep(2000);
                                }
                            }
                        }
                        
                        if (actualRounds !== expectedRounds && expectedRounds > 0) {
                            errors.push({ 
                                school, 
                                team: team.name, 
                                error: `Round count mismatch: expected ${expectedRounds}, got ${actualRounds}` 
                            });
                        }

                        await sleep(500);
                    }

                    saveProgress(allRounds, 'data.json');
                    console.log(`  Progress saved: ${allRounds.length} total rounds`);

                    await page.close();
                    await sleep(1000);
                } catch (schoolError) {
                    console.log(`  Error scraping school ${school}: ${schoolError.message}`);
                    errors.push({ school, error: schoolError.message });
                    if (page) await page.close();
                }
            }

            if (batchIndex + BATCH_SIZE < schools.length) {
                console.log(`\n⏳ Waiting 5 minutes before next batch...`);
                await sleep(5 * 60 * 1000);
            }
        }

        await browser.close();

        if (errors.length > 0) {
            fs.writeFileSync('scrape_errors.json', JSON.stringify(errors, null, 2));
            console.log(`\n${errors.length} errors logged to scrape_errors.json`);
        }

        return allRounds;
    } catch (error) {
        if (browser) await browser.close();
        saveProgress(allRounds, 'data.json');
        console.log(`\nFatal error. Saved ${allRounds.length} rounds before crash.`);
        throw error;
    }
}

async function main() {
    const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
    const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

    try {
        // Phase 1: Create round count map
        const roundCountMap = await createRoundCountMap(username, password);
        
        // Phase 1.5: Retry null teams
        await retryNullTeams(username, password);
        
        // Reload updated map
        const updatedMap = JSON.parse(fs.readFileSync('round_count_map.json', 'utf8'));
        
        // Phase 2: Scrape with verification
        const result = await scrapeWithVerification(username, password, updatedMap);
        
        console.log(`\nCompleted! Data saved to data.json (${result.length} rounds from all schools)`);
    } catch (error) {
        console.error('Fatal error:', error.message);
    }
}

main();