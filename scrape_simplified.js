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

async function scrapeSchool(browser, school, username, password) {
    let page;
    const schoolRounds = [];
    
    try {
        page = await browser.newPage();
        page.setDefaultTimeout(60000);

        // Login
        await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await sleep(3000);

        // Navigate to school
        const schoolUrlName = school.replace(/\s+/g, '').replace(/-/g, '');
        const schoolUrl = `https://opencaselist.com/ndtceda25/${schoolUrlName}`;
        
        await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
        await sleep(2000);

        // Get team links
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

        // Scrape each team with retry logic
        for (const team of teamLinks) {
            let attempts = 0;
            let success = false;
            
            while (attempts < 3 && !success) {
                try {
                    attempts++;
                    console.log(`    Scraping ${team.name} (attempt ${attempts})`);

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

                    // Add school and team info to each round
                    roundData.forEach(round => {
                        schoolRounds.push({
                            school: school,
                            team: team.name,
                            ...round
                        });
                    });

                    console.log(`      Found ${roundData.length} rounds`);
                    success = true;
                    
                } catch (teamError) {
                    console.log(`      Error (attempt ${attempts}): ${teamError.message}`);
                    if (attempts < 3) await sleep(2000);
                }
            }
            
            if (!success) {
                console.log(`      Failed to scrape ${team.name} after 3 attempts`);
            }
            
            await sleep(500);
        }

        return schoolRounds;
        
    } catch (error) {
        console.log(`  Error scraping school ${school}: ${error.message}`);
        return [];
    } finally {
        if (page) await page.close();
    }
}

async function main() {
    const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
    const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';
    
    let browser;
    const allRounds = [];
    const errors = [];

    try {
        browser = await puppeteer.launch({ headless: false, args: ['--no-sandbox'] });

        for (let batchIndex = 0; batchIndex < schools.length; batchIndex += 5) {
            const batch = schools.slice(batchIndex, batchIndex + 5);
            console.log(`\nProcessing batch ${Math.floor(batchIndex / 5) + 1}/${Math.ceil(schools.length / 5)} (${batch.length} schools)`);

            for (const school of batch) {
                console.log(`\nScraping school: ${school}`);
                
                const schoolRounds = await scrapeSchool(browser, school, username, password);
                allRounds.push(...schoolRounds);
                
                // Save progress after each school
                saveProgress(allRounds, 'data.json');
                console.log(`  Progress saved: ${allRounds.length} total rounds`);
                
                await sleep(1000);
            }

            // Wait between batches
            if (batchIndex + 5 < schools.length) {
                console.log(`\n⏳ Waiting 2 minutes before next batch...`);
                await sleep(2 * 60 * 1000);
            }
        }

        await browser.close();
        console.log(`\nCompleted! Final data saved to data.json (${allRounds.length} rounds)`);
        
    } catch (error) {
        if (browser) await browser.close();
        console.error('Fatal error:', error.message);
        saveProgress(allRounds, 'data.json');
    }
}

main();