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

async function scrapeAllSchools(username, password) {
    try {
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        page.setDefaultTimeout(60000);
        
        // Login
        await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
        await page.type('input[name="username"]', username);
        await page.type('input[name="password"]', password);
        await page.click('button[type="submit"]');
        await page.waitForTimeout(3000);
        
        const allRounds = [];
        
        for (const school of schools) {
            console.log(`\nScraping school: ${school}`);
            
            // Navigate to tournament page
            await page.goto('https://opencaselist.com/ndtceda25', { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(5000);
            
            // Try to find and click on the school
            const schoolFound = await page.evaluate((schoolName) => {
                const links = Array.from(document.querySelectorAll('a'));
                const schoolLink = links.find(link => link.textContent.trim() === schoolName);
                if (schoolLink) {
                    schoolLink.click();
                    return true;
                }
                return false;
            }, school);
            
            if (!schoolFound) {
                console.log(`  School "${school}" not found, skipping...`);
                await page.waitForTimeout(2000);
                continue;
            }
            
            await page.waitForTimeout(5000);
            
            // Get all team links for this school
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
            
            // Visit each team page
            for (const team of teamLinks) {
                console.log(`    Scraping team: ${team.name}`);
                await page.goto(team.href, { waitUntil: 'domcontentloaded' });
                await page.waitForTimeout(3000);
                
                // Extract round data
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
                }
                
                await page.waitForTimeout(1000);
            }
            
            await page.waitForTimeout(2000);
        }
        
        await browser.close();
        return allRounds;
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

const username = process.env.OPENCASELIST_USERNAME || 'tyur55357@gmail.com';
const password = process.env.OPENCASELIST_PASSWORD || 'Debate-Scrapper';

scrapeAllSchools(username, password)
    .then(result => {
        if (typeof result === 'string') {
            console.log('Error:', result);
        } else {
            // Save as JSON
            fs.writeFileSync('data2.json', JSON.stringify(result, null, 2));
            console.log(`\nData saved to data2.json (${result.length} rounds from all schools)`);
        }
    });