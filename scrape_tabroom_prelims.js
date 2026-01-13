const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrapeTabroomPrelims() {
    try {
        const browser = await puppeteer.launch({ headless: "new" });
        const page = await browser.newPage();
        page.setDefaultTimeout(60000);
        
        await page.goto('https://www.tabroom.com/index/tourn/results/index.mhtml?tourn_id=36610', { waitUntil: 'domcontentloaded' });
        await page.waitForTimeout(3000);
        
        // Extract prelims data and links
        const { prelimsData, links } = await page.evaluate(() => {
            const results = [];
            const rows = Array.from(document.querySelectorAll('table tr'));
            
            rows.forEach(row => {
                const cells = Array.from(row.querySelectorAll('td, th'));
                if (cells.length > 0) {
                    const rowData = cells.map(cell => {
                        // Clean up text content by removing extra whitespace and newlines
                        return cell.textContent.replace(/\s+/g, ' ').trim();
                    });
                    if (rowData.some(cell => cell.length > 0)) {
                        results.push(rowData);
                    }
                }
            });
            
            // Extract all links
            const allLinks = Array.from(document.querySelectorAll('a[href]')).map(link => ({
                text: link.textContent.trim(),
                href: link.href,
                title: link.title || ''
            })).filter(link => 
                link.href.includes('round') || 
                link.href.includes('result') ||
                link.href.includes('bracket') ||
                link.text.toLowerCase().includes('round') ||
                link.text.match(/R\d+/) ||
                link.href.includes('tourn')
            );
            
            return { prelimsData: results, links: allLinks };
        });
        
        await browser.close();
        return { prelimsData, links };
    } catch (error) {
        return `Error: ${error.message}`;
    }
}

function arrayToCSV(data) {
    if (data.length === 0) return '';
    
    return data.map(row => 
        row.map(cell => {
            const value = cell || '';
            if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                return `"${value.replace(/"/g, '""')}"`;
            }
            return value;
        }).join(',')
    ).join('\n');
}

function linksToCSV(links) {
    if (links.length === 0) return 'text,href,title\n';
    
    const csvContent = [
        'text,href,title',
        ...links.map(link => {
            const text = (link.text || '').replace(/"/g, '""');
            const href = (link.href || '').replace(/"/g, '""');
            const title = (link.title || '').replace(/"/g, '""');
            return `"${text}","${href}","${title}"`;
        })
    ].join('\n');
    
    return csvContent;
}

const username = 'tyur55357@gmail.com';
const password = 'Debate-Scrapper';

scrapeTabroomPrelims()
    .then(result => {
        if (typeof result === 'string') {
            console.log('Error:', result);
        } else {
            const csvContent = arrayToCSV(result.prelimsData);
            fs.writeFileSync('tabroom_prelims.csv', csvContent);
            console.log(`Prelims data saved to tabroom_prelims.csv (${result.prelimsData.length} rows)`);
            
            const linksContent = linksToCSV(result.links);
            fs.writeFileSync('tabroom_links.csv', linksContent);
            console.log(`Links saved to tabroom_links.csv (${result.links.length} links)`);
        }
    });