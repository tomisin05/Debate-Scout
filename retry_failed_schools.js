import puppeteer from 'puppeteer';
import fs from 'fs';

async function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function saveProgress(data, filename = 'data.json') {
    fs.writeFileSync(filename, JSON.stringify(data, null, 2));
}

async function retryFailedSchools(username, password) {
    // Read existing data and errors
    let existingData = [];
    let failedSchools = [];
    
    try {
        existingData = JSON.parse(fs.readFileSync('data.json', 'utf8'));
        console.log(`Loaded ${existingData.length} existing rounds`);
    } catch (error) {
        console.log('No existing data found, starting fresh');
    }
    
    try {
        const errors = JSON.parse(fs.readFileSync('scrape_errors.json', 'utf8'));
        failedSchools = [...new Set(errors.map(e => e.school).filter(s => s))];
        console.log(`Found ${failedSchools.length} failed schools to retry`);
    } catch (error) {
        console.log('No error file found');
        return;
    }

    if (failedSchools.length === 0) {
        console.log('No failed schools to retry');
        return;
    }

    let browser;
    const newRounds = [];
    const stillFailed = [];

    try {
        browser = await puppeteer.launch({ headless: "new", args: ['--no-sandbox'] });

        for (const school of failedSchools) {
            let page;
            try {
                console.log(`\nRetrying school: ${school}`);
                
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
                    console.log(`  School "${school}" still not found`);
                    stillFailed.push({ school, error: 'School link not found' });
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
                    stillFailed.push({ school, error: 'No teams found' });
                    await page.close();
                    continue;
                }

                for (const team of teamLinks) {
                    try {
                        console.log(`    Scraping team: ${team.name}`);

                        await page.goto(team.href, { waitUntil: 'domcontentloaded', timeout: 60000 });
                        await sleep(3000);

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

                        if (roundData && roundData.length > 0) {
                            roundData.forEach(round => {
                                newRounds.push({
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
                            console.log(`      Found ${roundData.length} rounds`);
                        }

                        await sleep(1000);
                    } catch (teamError) {
                        console.log(`    Error scraping team ${team.name}: ${teamError.message}`);
                    }
                }

                await page.close();
                await sleep(2000);
            } catch (schoolError) {
                console.log(`  Error retrying school ${school}: ${schoolError.message}`);
                stillFailed.push({ school, error: schoolError.message });
                if (page) await page.close();
            }
        }

        if (browser) await browser.close();

        // Merge with existing data
        const allData = [...existingData, ...newRounds];
        saveProgress(allData);

        console.log(`\nRetry completed:`);
        console.log(`- New rounds found: ${newRounds.length}`);
        console.log(`- Total rounds now: ${allData.length}`);
        console.log(`- Schools still failed: ${stillFailed.length}`);

        if (stillFailed.length > 0) {
            fs.writeFileSync('still_failed_schools.json', JSON.stringify(stillFailed, null, 2));
            console.log('- Still failed schools saved to still_failed_schools.json');
        }

    } catch (error) {
        if (browser) await browser.close();
        console.error('Fatal error during retry:', error.message);
    }
}

const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

retryFailedSchools(username, password);