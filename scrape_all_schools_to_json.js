const puppeteer = require('puppeteer');
const fs = require('fs');

const schools = [
    'Arizona State', 'Baylor', 'Binghamton', 'Boston College', 'Central Oklahoma', 'Columbia', 'Cornell',
    'CSU Fullerton', 'CSU Long Beach', 'CSU Northridge', 'Dartmouth College', 'Edgemont', 'Edmond Memorial',
    'Emory', 'Fairmont State', 'George Mason', 'Georgetown', 'Georgia', 'Georgia State', 'Gonzaga',
    'Harvard', 'Houston', 'Hutchinson', 'Illinois', 'Indiana', 'Iowa', 'James Madison',
    'Johnson County Community College', 'Kansas', 'Kansas State', 'Kentucky', 'Kingwood', 'Lanier',
    'Larned', 'Liberty', 'Macalester College', 'Marian', 'Massachusetts Amherst', 'Miami', 'Miami OH',
    'Michigan', 'Michigan State', 'Minnesota', 'Missouri State', 'Monmouth', 'Navy', 'New Mexico',
    'New School', 'North Texas', 'Northern Iowa', 'Northwestern', 'NYU', 'Ohio State', 'Oklahoma',
    'Pines', 'Purdue', 'Rochester', 'Samford', 'South Anchorage', 'Southern California', 'Southern Nazarene',
    'Stanford', 'Suffolk', 'Texas', 'Texas AM', 'Towson', 'Trinity', 'UC Berkeley', 'UC Davis',
    'UChicago Lab', 'UNC - Chapel Hill', 'USC', 'Utah', 'UTD', 'UTSA', 'Vanderbilt', 'Wake Forest',
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

    try {
        browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        page.setDefaultTimeout(90000);

        await retry(async () => {
            await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
            await page.type('input[name="username"]', username);
            await page.type('input[name="password"]', password);
            await page.click('button[type="submit"]');
            await sleep(3000);
        });

        for (const school of schools) {
            try {
                console.log(`\nScraping school: ${school}`);

                await retry(async () => {
                    await page.goto('https://opencaselist.com/ndtceda25', { waitUntil: 'networkidle2', timeout: 90000 });
                    await sleep(8000);
                });

                const schoolFound = await page.evaluate((schoolName) => {
                    const links = Array.from(document.querySelectorAll('a'));
                    // Try exact match first
                    let schoolLink = links.find(link => link.textContent.trim() === schoolName);
                    // Try partial match if exact fails
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

                        await retry(async () => {
                            await page.goto(team.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
                            await sleep(3000);
                        });

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

                await sleep(2000);
            } catch (schoolError) {
                console.log(`  Error scraping school ${school}: ${schoolError.message}`);
                errors.push({ school, error: schoolError.message });
                failedSchools.push(school);
                saveProgress(allRounds);
            }
        }

        // Retry failed schools
        if (failedSchools.length > 0) {
            console.log(`\n\nRetrying ${failedSchools.length} failed schools...\n`);

            for (const school of failedSchools) {
                try {
                    console.log(`\nRetrying school: ${school}`);

                    await retry(async () => {
                        await page.goto('https://opencaselist.com/ndtceda25', { waitUntil: 'networkidle2', timeout: 90000 });
                        await sleep(10000);
                    });

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
                        console.log(`  School "${school}" still not found`);
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

                    for (const team of teamLinks) {
                        try {
                            console.log(`    Scraping team: ${team.name}`);

                            await retry(async () => {
                                await page.goto(team.href, { waitUntil: 'domcontentloaded', timeout: 90000 });
                                await sleep(3000);
                            });

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
                            }

                            await sleep(1000);
                        } catch (teamError) {
                            console.log(`    Error scraping team ${team.name}: ${teamError.message}`);
                        }
                    }

                    saveProgress(allRounds);
                    console.log(`  Progress saved: ${allRounds.length} total rounds`);

                    await sleep(2000);
                } catch (retryError) {
                    console.log(`  Retry failed for ${school}: ${retryError.message}`);
                }
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
        console.log(`\nData saved to data2.json (${result.length} rounds from all schools)`);
    })
    .catch(error => {
        console.error('Fatal error:', error.message);
    });
