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

async function createRoundCountMap(username, password) {
    console.log('=== Creating current round count map ===\n');
    
    let browser;
    const roundCountMap = {};
    
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        
        for (let batchIndex = 0; batchIndex < schools.length; batchIndex += 5) {
            const batch = schools.slice(batchIndex, batchIndex + 5);
            console.log(`Processing batch ${Math.floor(batchIndex / 5) + 1}/${Math.ceil(schools.length / 5)}`);

            for (const school of batch) {
                let page;
                try {
                    console.log(`Mapping school: ${school}`);
                    
                    page = await browser.newPage();
                    page.setDefaultTimeout(60000);

                    await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
                    await page.type('input[name="username"]', username);
                    await page.type('input[name="password"]', password);
                    await page.click('button[type="submit"]');
                    await sleep(3000);
                    
                    const schoolUrlName = school.replace(/\s+/g, '').replace(/-/g, '');
                    const schoolUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}`;
                    
                    await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
                    await sleep(2000);

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
                                
                                if (!roundsTable) return 0;
                                
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

                            roundCountMap[school][team.name] = roundCount;
                            console.log(`    ${team.name}: ${roundCount} rounds`);
                            
                            await sleep(500);
                        } catch (teamError) {
                            console.log(`    Error mapping team ${team.name}: ${teamError.message}`);
                            roundCountMap[school][team.name] = 0;
                        }
                    }

                } catch (schoolError) {
                    console.log(`  Error mapping school ${school}: ${schoolError.message}`);
                } finally {
                    if (page) await page.close();
                }
            }

            if (batchIndex + 5 < schools.length) {
                console.log(`⏳ Waiting 2 minutes before next batch...`);
                await sleep(2 * 60 * 1000);
            }
        }

        await browser.close();
        return roundCountMap;
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Error creating round count map:', error.message);
        throw error;
    }
}

async function scrapeNewRounds(username, password, teamsToScrape, existingData) {
    console.log(`\n=== Scraping ${teamsToScrape.length} teams with new rounds ===\n`);
    
    let browser;
    const newRounds = [];
    
    try {
        browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

        for (let i = 0; i < teamsToScrape.length; i++) {
            const { school, teamName, href, expectedRounds, currentRounds } = teamsToScrape[i];
            console.log(`Scraping ${i + 1}/${teamsToScrape.length}: ${school} - ${teamName} (${currentRounds} rounds, was ${expectedRounds})`);

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

                // Filter out existing rounds by creating unique identifiers
                const existingRoundIds = new Set(
                    existingData
                        .filter(r => r.school === school && r.team === teamName)
                        .map(r => `${r.tournament}|${r.round}|${r.side}`)
                );

                const newTeamRounds = roundData.filter(round => 
                    !existingRoundIds.has(`${round.tournament}|${round.round}|${round.side}`)
                );

                newTeamRounds.forEach(round => {
                    newRounds.push({
                        school,
                        team: teamName,
                        ...round
                    });
                });

                console.log(`  Found ${newTeamRounds.length} new rounds`);
                await page.close();
                await sleep(500);

            } catch (error) {
                console.log(`  Error scraping team: ${error.message}`);
                if (page) await page.close();
            }
        }

        await browser.close();
        return newRounds;
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Error scraping new rounds:', error.message);
        throw error;
    }
}

async function main() {
    const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
    const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

    try {
        // Load existing data and previous round count map
        let existingData = [];
        let previousRoundCountMap = {};
        
        try {
            const data = fs.readFileSync('data.json', 'utf8');
            existingData = JSON.parse(data);
            console.log(`Loaded ${existingData.length} existing rounds`);
        } catch (error) {
            console.log('No existing data.json found, starting fresh');
        }
        
        try {
            const data = fs.readFileSync('round_count_map.json', 'utf8');
            previousRoundCountMap = JSON.parse(data);
            console.log('Loaded previous round count map');
        } catch (error) {
            console.log('No previous round count map found');
        }

        // Create current round count map
        const currentRoundCountMap = await createRoundCountMap(username, password);
        
        // Compare maps to find teams with new rounds
        const teamsToScrape = [];
        
        // First, get actual team links by re-scanning schools with changes
        let browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });
        const page = await browser.newPage();
        page.setDefaultTimeout(60000);

        await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await sleep(3000);
        
        for (const [school, teams] of Object.entries(currentRoundCountMap)) {
            let hasChanges = false;
            const changedTeams = [];
            
            for (const [teamName, currentCount] of Object.entries(teams)) {
                const previousCount = previousRoundCountMap[school]?.[teamName] || 0;
                
                if (currentCount > previousCount) {
                    hasChanges = true;
                    changedTeams.push({ teamName, expectedRounds: previousCount, currentRounds: currentCount });
                }
            }
            
            if (hasChanges) {
                console.log(`Getting team links for ${school}...`);
                const schoolUrlName = school.replace(/\s+/g, '').replace(/-/g, '');
                const schoolUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}`;
                
                await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
                await sleep(2000);

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
                
                for (const changedTeam of changedTeams) {
                    const teamLink = teamLinks.find(link => link.name === changedTeam.teamName);
                    if (teamLink) {
                        teamsToScrape.push({
                            school,
                            teamName: changedTeam.teamName,
                            href: teamLink.href,
                            expectedRounds: changedTeam.expectedRounds,
                            currentRounds: changedTeam.currentRounds
                        });
                    }
                }
            }
        }
        
        await browser.close();

        console.log(`\nFound ${teamsToScrape.length} teams with new rounds`);
        
        if (teamsToScrape.length === 0) {
            console.log('No new rounds to scrape');
            return;
        }

        // Scrape only teams with new rounds
        const newRounds = await scrapeNewRounds(username, password, teamsToScrape, existingData);
        
        // Append new rounds to existing data
        const allRounds = [...existingData, ...newRounds];
        
        // Save updated files
        saveProgress(allRounds, 'data.json');
        saveProgress(currentRoundCountMap, 'round_count_map.json');
        
        console.log(`\nCompleted! Added ${newRounds.length} new rounds`);
        console.log(`Total rounds in data.json: ${allRounds.length}`);
        
    } catch (error) {
        console.error('Fatal error:', error.message);
    }
}

main();