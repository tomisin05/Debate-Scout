import puppeteer from 'puppeteer';
import fs from 'fs';

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = ms => sleep(ms * (0.6 + Math.random() * 0.8));

function loadJSON(filepath, fallback = null) {
    try {
        return JSON.parse(fs.readFileSync(filepath, 'utf8'));
    } catch {
        return fallback;
    }
}

function saveJSON(filepath, data) {
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

async function launchBrowser() {
    return puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
}

async function loginPage(browser, username, password) {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });

    await page.$eval('input[name="username"]', el => (el.value = ''));
    await page.type('input[name="username"]', username, { delay: 30 });
    await page.$eval('input[name="password"]', el => (el.value = ''));
    await page.type('input[name="password"]', password, { delay: 30 });
    await page.click('button[type="submit"]');
    await sleep(5000);

    return page;
}

async function extractRounds(page) {
    return page.evaluate(() => {
        const HEADERS = ['Tournament', 'Round', 'Side'];
        const tables = Array.from(document.querySelectorAll('table'));
        const roundsTable = tables.find(t => {
            const ths = Array.from(t.querySelectorAll('tr:first-child td, tr:first-child th'))
                .map(h => h.innerText.trim());
            return HEADERS.every(h => ths.includes(h));
        });

        if (!roundsTable) return [];
        if (document.body.innerText.includes('No rounds yet, add one!')) return [];

        return Array.from(roundsTable.querySelectorAll('tr')).slice(1).reduce((acc, row) => {
            const cells = row.querySelectorAll('td');
            if (cells.length < 6) return acc;

            const tournament = cells[0]?.innerText.trim();
            const round      = cells[1]?.innerText.trim();
            if (!tournament || !round) return acc;

            const side        = cells[2]?.innerText.trim() || '';
            const opponent    = cells[3]?.innerText.trim() || '';
            const judge       = cells[4]?.innerText.trim() || '';
            const roundReport = cells[5]?.innerText.trim() || '';

            let previewUrl  = null;
            let downloadUrl = null;

            if (cells[6]) {
                const link = cells[6].querySelector('a[href*="/preview"]');
                if (link) {
                    previewUrl = link.href;
                    try {
                        const p = new URLSearchParams(new URL(previewUrl).search).get('path');
                        if (p) downloadUrl = `https://api.opencaselist.com/v1/download?path=${encodeURIComponent(p)}`;
                    } catch {}
                }
            }

            acc.push({ tournament, round, side, opponent, judge, roundReport, previewUrl, downloadUrl });
            return acc;
        }, []);
    });
}

async function retryFailedSchools(year, username, password) {
    console.log(`=== RETRYING FAILED SCHOOLS FOR ${year} ===\n`);
    
    const dataFile = `data_${year}.json`;
    const errorsFile = `scrape_errors_${year}.json`;
    
    // Load existing data and errors
    const existingData = loadJSON(dataFile, { meta: {}, rounds: [] });
    const errors = loadJSON(errorsFile, []);
    
    if (!existingData.rounds) existingData.rounds = [];
    
    if (errors.length === 0) {
        console.log(`No errors found in ${errorsFile}`);
        return;
    }

    const newRounds = [];
    let browser;

    try {
        browser = await launchBrowser();

        // Group errors by type
        const schoolErrors = errors.filter(e => e.error === 'School link not found' || !e.team);
        const teamErrors = errors.filter(e => e.team && e.error !== 'School link not found');

        console.log(`Found ${schoolErrors.length} school-level errors`);
        console.log(`Found ${teamErrors.length} team-level errors`);

        // Retry school-level errors
        for (const error of schoolErrors) {
            console.log(`\nRetrying school: ${error.school}`);
            
            let page;
            try {
                page = await loginPage(browser, username, password);
                
                // Try to find school page
                const schoolSlug = error.school.replace(/\s+/g, '').replace(/[^a-zA-Z0-9]/g, '');
                const schoolUrl = `https://opencaselist.com/${year}/${schoolSlug}`;
                
                await page.goto(schoolUrl, { waitUntil: 'networkidle2' });
                await jitter(2000);

                // Get team links
                const teamLinks = await page.evaluate((year) => {
                    return Array.from(document.querySelectorAll('a[href]'))
                        .filter(a => new RegExp(`/${year}/[^/]+/[^/]+`).test(a.href) && !a.href.includes('/All'))
                        .map(a => ({ name: a.textContent.trim(), href: a.href }))
                        .filter(l => l.name && l.name !== 'Aff' && l.name !== 'Neg')
                        .filter((l, i, arr) => arr.findIndex(x => x.href === l.href) === i);
                }, year);

                console.log(`  Found ${teamLinks.length} teams`);

                for (const team of teamLinks) {
                    try {
                        console.log(`    Scraping team: ${team.name}`);
                        
                        await page.goto(team.href, { waitUntil: 'domcontentloaded' });
                        await jitter(1500);

                        const rounds = await extractRounds(page);
                        
                        const records = rounds.map(r => ({
                            year: year,
                            school: error.school,
                            team: team.name,
                            ...r,
                            scrapedAt: new Date().toISOString(),
                        }));
                        
                        newRounds.push(...records);
                        console.log(`      Found ${rounds.length} rounds`);

                    } catch (teamError) {
                        console.log(`      Error scraping team ${team.name}: ${teamError.message}`);
                    }
                }

            } catch (schoolError) {
                console.log(`  Error retrying school ${error.school}: ${schoolError.message}`);
            } finally {
                if (page) await page.close();
            }
        }

        // Retry team-level errors
        for (const error of teamErrors) {
            console.log(`\nRetrying team: ${error.school} - ${error.team}`);
            
            let page;
            try {
                page = await loginPage(browser, username, password);
                
                // Extract team code from the team name
                // Format: "Penn-CofIdaho BrAn (Ma..... Br..... - Am..... An....)"
                // We want just "BrAn" part
                let teamCode = error.team;
                
                // Remove school name prefix if present
                if (teamCode.includes(error.school)) {
                    teamCode = teamCode.replace(error.school, '').trim();
                }
                
                // Remove parenthetical content
                teamCode = teamCode.replace(/\s*\([^)]*\)\s*/g, '').trim();
                
                // If there's still a space, take the last part (the actual team code)
                const parts = teamCode.split(/\s+/);
                if (parts.length > 1) {
                    teamCode = parts[parts.length - 1];
                }
                
                console.log(`    Looking for team code: ${teamCode}`);
                
                // Navigate directly to the team URL
                const schoolSlug = error.school.replace(/\s+/g, ''); // Only remove spaces, keep hyphens
                const teamUrl = `https://opencaselist.com/${year}/${schoolSlug}/${teamCode}`;
                
                console.log(`    Trying URL: ${teamUrl}`);
                
                await page.goto(teamUrl, { waitUntil: 'domcontentloaded' });
                await jitter(1500);
                
                // Check if we got a valid team page (not a 404 or error)
                const isValidPage = await page.evaluate(() => {
                    return !document.body.innerText.includes('404') && 
                           !document.body.innerText.includes('Not Found') &&
                           document.querySelector('table') !== null;
                });
                
                if (!isValidPage) {
                    console.log(`    Invalid page or 404 for ${teamUrl}`);
                    continue;
                }

                const rounds = await extractRounds(page);
                
                const records = rounds.map(r => ({
                    year: year,
                    school: error.school,
                    team: error.team,
                    ...r,
                    scrapedAt: new Date().toISOString(),
                }));
                
                newRounds.push(...records);
                console.log(`    Found ${rounds.length} rounds`);

            } catch (teamError) {
                console.log(`    Error retrying team: ${teamError.message}`);
            } finally {
                if (page) await page.close();
            }
        }

    } finally {
        if (browser) await browser.close();
    }

    // Update data file
    existingData.rounds.push(...newRounds);
    existingData.meta = {
        ...existingData.meta,
        lastUpdated: new Date().toISOString(),
        totalRounds: existingData.rounds.length,
        year: year,
    };
    
    saveJSON(dataFile, existingData);
    
    console.log(`\nCompleted! Added ${newRounds.length} new rounds to ${dataFile}`);
    console.log(`Total rounds in ${dataFile}: ${existingData.rounds.length}`);
}

async function main() {
    const args = process.argv.slice(2);
    const year = args[0] || 'ndtceda25';
    const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
    const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

    if (args.includes('--help')) {
        console.log(`Usage: node retry_failed_schools.mjs [year] [options]

Arguments:
  year                   Year slug (e.g. ndtceda25, ndtceda24)

Options:
  --help                 Show this help

Environment variables:
  OPENCASELIST_USERNAME
  OPENCASELIST_PASSWORD

Examples:
  node retry_failed_schools.mjs ndtceda25
  node retry_failed_schools.mjs ndtceda24
`);
        process.exit(0);
    }

    await retryFailedSchools(year, username, password);
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    process.exit(1);
});