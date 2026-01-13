const puppeteer = require('puppeteer');

async function scrapeAllCornellTeams(username, password) {
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
        
        // Navigate to tournament page
        await page.goto('https://opencaselist.com/ndtceda25', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(2000);
        
        // Click on Cornell
        await page.waitForSelector('a[href*="Cornell"]', { timeout: 10000 });
        await page.click('a[href*="Cornell"]');
        await page.waitForTimeout(3000);
        
        // Get all team links
        const teamLinks = await page.evaluate(() => {
            const links = Array.from(document.querySelectorAll('a[href*="/Cornell/"]'));
            return links.map(link => ({
                name: link.textContent.trim(),
                href: link.href
            }));
        });
        
        const allTeamData = [];
        
        // Visit each team page
        for (const team of teamLinks) {
            console.log(`Scraping team: ${team.name}`);
            await page.goto(team.href, { waitUntil: 'domcontentloaded' });
            await page.waitForTimeout(2000);
            
            const title = await page.title();
            const content = await page.evaluate(() => document.body.innerText);
            
            allTeamData.push({
                teamName: team.name,
                title: title,
                content: content
            });
        }
        
        await browser.close();
        return allTeamData;
    } catch (error) {
        return { error: error.message };
    }
}

const username = 'tyur55357@gmail.com';
const password = 'Debate-Scrapper';

scrapeAllCornellTeams(username, password)
    .then(result => {
        if (result.error) {
            console.log('Error:', result.error);
        } else {
            result.forEach((team, index) => {
                console.log(`\n=== TEAM ${index + 1}: ${team.teamName} ===`);
                console.log(`Title: ${team.title}`);
                console.log(`Content: ${team.content}\n`);
            });
        }
    });