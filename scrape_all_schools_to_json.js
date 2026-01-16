


import puppeteer from 'puppeteer';
import fs from 'fs';

// empty_schools = ['Vanderbilt', 'USC', 'UNC - Chapel Hill', 'UChicago Lab', 'South Anchorage', 'Pines', 'Larned', 'Lanier', 'Kingwood', 'Illinois', 'Hutchinson', 'Georgia State', 'Edmond Memorial', 'Edgemont']
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

async function retry(fn, retries = 3, delay = 2000) {
    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (error) {
            if (i === retries - 1) throw error;
            console.log(`    Retry ${i + 1}/${retries} after error: ${error.message}`);
            await new Promise(resolve => setTimeout(resolve, delay * (i + 1)));
        }
    }
}

function saveProgress(data, filename = 'data.json') {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

async function scrapeAllSchools(username, password) {
    let browser;
    const allRounds = [];
    const errors = [];
    const failedSchools = [];
    const BATCH_SIZE = 15;
    const WAIT_TIME = 5 * 60 * 1000; // 5 minutes

    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });

        for (let batchIndex = 0; batchIndex < schools.length; batchIndex += BATCH_SIZE) {
            const batch = schools.slice(batchIndex, batchIndex + BATCH_SIZE);
            console.log(`\n\n=== Processing batch ${Math.floor(batchIndex / BATCH_SIZE) + 1}/${Math.ceil(schools.length / BATCH_SIZE)} (${batch.length} schools) ===\n`);

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

                    await page.goto('https://opencaselist.com/ndtceda25', { waitUntil: 'networkidle2', timeout: 60000 });
                    await sleep(5000);

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
                        console.log(`  School "${school}" not found in page`);
                        errors.push({ school, error: 'School link not found' });
                        failedSchools.push(school);
                        await page.close();
                        continue;
                    }

                    await sleep(5000);

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

                    if (teamLinks.length === 0) {
                        console.log(`  No teams found for ${school}`);
                        errors.push({ school, error: 'No teams found' });
                    }

                    for (const team of teamLinks) {
                        try {
                            console.log(`    Scraping team: ${team.name}`);

                            await page.goto(team.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
                            await sleep(3000);

                            const roundData = await page.evaluate(() => {
                                const content = document.body.innerText;
                                const startPattern = /Round ReportExpand All/;
                                const startMatch = content.match(startPattern);
                                const lastAccountIndex = content.lastIndexOf('Account Untrusted');

                                if (!startMatch || lastAccountIndex === -1) return null;

                                const relevantSection = content.substring(startMatch.index, lastAccountIndex);
                                const rounds = [];
                                const lines = relevantSection.split('\n');

                                for (let i = 0; i < lines.length; i++) {
                                    const line = lines[i].trim();

                                    if (line.includes('\t') && (line.includes('Aff') || line.includes('Neg'))) {
                                        const parts = line.split('\t').filter(p => p.trim());

                                        if (parts.length >= 3) {
                                            const tournament = parts[0];
                                            const round = parts[1];
                                            const side = parts[2];
                                            const opponent = parts[3] || '';
                                            const judge = parts[4] || '';

                                            let roundReport = '';
                                            if (i + 1 < lines.length) {
                                                roundReport = lines[i + 1].trim();
                                            }

                                            rounds.push({
                                                tournament,
                                                round,
                                                side,
                                                opponent,
                                                judge,
                                                roundReport
                                            });
                                        }
                                    }
                                }

                                return rounds;
                            });

                            if (roundData && roundData.length > 0) {
                                roundData.forEach(round => {
                                    allRounds.push({
                                        school: school,
                                        team: team.name,
                                        tournament: round.tournament,
                                        round: round.round,
                                        side: round.side,
                                        opponent: round.opponent,
                                        judge: round.judge,
                                        roundReport: round.roundReport
                                    });
                                });
                                console.log(`      Found ${roundData.length} rounds`);
                            } else {
                                console.log(`      No rounds found for ${team.name}`);
                            }

                            await sleep(1000);
                        } catch (teamError) {
                            console.log(`    Error scraping team ${team.name}: ${teamError.message}`);
                            errors.push({ school, team: team.name, error: teamError.message });
                        }
                    }

                    saveProgress(allRounds);
                    console.log(`  Progress saved: ${allRounds.length} total rounds`);

                    await page.close();
                    await sleep(2000);
                } catch (schoolError) {
                    console.log(`  Error scraping school ${school}: ${schoolError.message}`);
                    errors.push({ school, error: schoolError.message });
                    failedSchools.push(school);
                    if (page) await page.close();
                    saveProgress(allRounds);
                }
            }

            // Wait 5 minutes between batches (except after last batch)
            if (batchIndex + BATCH_SIZE < schools.length) {
                console.log(`\n\n⏳ Waiting 5 minutes before next batch...\n`);
                await sleep(WAIT_TIME);
            }
        }

        if (browser) await browser.close();

        if (errors.length > 0) {
            fs.writeFileSync('scrape_errors.json', JSON.stringify(errors, null, 2));
            console.log(`\n${errors.length} errors logged to scrape_errors.json`);
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

scrapeAllSchools(username, password)
    .then(result => {
        saveProgress(result);
        console.log(`\nData saved to data.json (${result.length} rounds from all schools)`);
    })
    .catch(error => {
        console.error('Fatal error:', error.message);
    });
