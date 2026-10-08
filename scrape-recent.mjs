/**
 * scrape-recent.mjs
 * Scrapes /ndtceda26/recent (or any year's /recent page) and merges
 * newly updated team rounds into the existing data file.
 *
 * Usage:
 *   node scrape-recent.mjs --year ndtceda26
 *   node scrape-recent.mjs --year ndtceda26 --output data_ndtceda26.json
 *   node scrape-recent.mjs --year ndtceda26 --requests-per-batch 25 --batch-delay 60
 */

import puppeteer from 'puppeteer';
import fs from 'fs';
import path from 'path';

// ─── CLI ──────────────────────────────────────────────────────────────────────

function parseArgs() {
    const args = process.argv.slice(2);
    const opts = {
        year: 'ndtceda26',
        output: null,
        pageDelay: 2000,
        requestsPerBatch: 25,
        batchDelay: 60_000,
        maxAttempts: 3,
        username: process.env.OPENCASELIST_USERNAME,
        password: process.env.OPENCASELIST_PASSWORD,
    };
    for (let i = 0; i < args.length; i++) {
        if (args[i] === '--year')   opts.year   = args[++i];
        if (args[i] === '--output') opts.output = args[++i];
        if (args[i] === '--requests-per-batch') opts.requestsPerBatch = +args[++i];
        if (args[i] === '--batch-size') opts.requestsPerBatch = +args[++i];
        if (args[i] === '--batch-delay') opts.batchDelay = +args[++i] * 1000;
        if (args[i] === '--username') opts.username = args[++i];
        if (args[i] === '--password') opts.password = args[++i];
    }
    opts.output = opts.output || `public/data_${opts.year}.json`;
    return opts;
}

// ─── Utilities ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));
const jitter = ms => sleep(ms * (0.6 + Math.random() * 0.8));

class RequestBatcher {
    constructor(limit, delay) {
        this.limit = limit;
        this.delay = delay;
        this.requestCount = 0;
        this.batchNumber = 1;
    }

    async beforeRequest(description) {
        if (this.requestCount >= this.limit) {
            console.log(
                `\n⏳ Request batch ${this.batchNumber} complete ` +
                `(${this.requestCount} requests). Waiting ${this.delay / 1000}s…`
            );
            await sleep(this.delay);
            this.requestCount = 0;
            this.batchNumber++;
        }
        this.requestCount++;
        console.log(
            `    [request ${this.requestCount}/${this.limit}, batch ${this.batchNumber}] ${description}`
        );
    }

    async cooldown(reason) {
        console.log(`\n⏳ ${reason}. Cooling down for ${this.delay / 1000}s and refreshing the session…`);
        await sleep(this.delay);
        this.requestCount = 0;
        this.batchNumber++;
    }
}

function loadJSON(file, fallback) {
    try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function saveJSON(file, data) {
    fs.writeFileSync(file, JSON.stringify(data, null, 2));
}

function documentPath(record) {
    for (const value of [record.previewUrl, record.downloadUrl]) {
        if (!value) continue;
        try {
            const documentPath = new URL(value).searchParams.get('path');
            if (documentPath) return documentPath;
        } catch {}
    }
    return null;
}

function normalizedTeamIdentity(teamName) {
    return String(teamName || '')
        .replace(/\s+\(.*$/, '')
        .replace(/\s+-\s+.*$/, '')
        .trim()
        .toLowerCase();
}

function roundKey(r) {
    const path = documentPath(r);
    if (path) return `document:${path}`;
    return [
        'round', r.year, String(r.school || '').toLowerCase(),
        normalizedTeamIdentity(r.team), String(r.tournament || '').toLowerCase(),
        String(r.round || '').toLowerCase(), String(r.side || '').toLowerCase(),
    ].join('|');
}

function canonicalTeamName(rounds, schoolName, teamSlug) {
    const identity = `${schoolName} ${teamSlug}`.toLowerCase();
    const candidates = rounds
        .filter(round => normalizedTeamIdentity(round.team) === identity)
        .map(round => round.team)
        .filter((name, index, names) => names.indexOf(name) === index);

    // Prefer the roster-style name used by the full scraper.
    return candidates.find(name => /\([^)]*\)$/.test(name)) ||
        candidates.find(name => !name.includes(' - ')) ||
        `${schoolName} ${teamSlug}`;
}

function deduplicateRounds(rounds) {
    const seen = new Set();
    const deduplicated = [];
    for (let index = rounds.length - 1; index >= 0; index--) {
        const round = rounds[index];
        const key = roundKey(round);
        if (seen.has(key)) continue;
        seen.add(key);
        deduplicated.push(round);
    }
    return deduplicated.reverse();
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function login(browser, username, password) {
    const page = await browser.newPage();
    page.setDefaultTimeout(60_000);
    await page.goto('https://opencaselist.com/login', { waitUntil: 'domcontentloaded' });
    await page.$eval('input[name="username"]', el => el.value = '');
    await page.type('input[name="username"]', username, { delay: 30 });
    await page.$eval('input[name="password"]', el => el.value = '');
    await page.type('input[name="password"]', password, { delay: 30 });
    await Promise.all([
        page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 15_000 }).catch(() => null),
        page.click('button[type="submit"]'),
    ]);
    await sleep(2000);
    const failed = new URL(page.url()).pathname === '/login' || await page.$('input[name="password"]') !== null;
    if (failed) { await page.close(); throw new Error('Login failed.'); }
    return page;
}

// ─── Discover recently modified teams ────────────────────────────────────────

async function getRecentTeams(page, yearSlug, requestBatcher) {
    console.log(`\nFetching https://opencaselist.com/${yearSlug}/recent …`);
    await requestBatcher.beforeRequest(`recent teams for ${yearSlug}`);
    await page.goto(`https://opencaselist.com/${yearSlug}/recent`, { waitUntil: 'networkidle2' });
    await sleep(3000);

    // Reload if page looks thin (SPA hydration delay)
    const bodyLen = await page.evaluate(() => document.body.innerText.length);
    if (bodyLen < 300) {
        console.log('  Page thin, reloading…');
        await requestBatcher.beforeRequest(`reload recent teams for ${yearSlug}`);
        await page.reload({ waitUntil: 'networkidle2' });
        await sleep(3000);
    }

    const teams = await page.evaluate((slug) => {
        // Team links look like /ndtceda26/SchoolSlug/TeamSlug
        const candidates = Array.from(document.querySelectorAll('a[href]'))
            .filter(a => {
                const m = a.href.match(new RegExp(`/${slug}/([^/]+)/([^/]+)$`));
                return m && !a.href.includes('/All') && !a.href.includes('/recent');
            })
            .map(a => {
                const m = a.href.match(new RegExp(`/${slug}/([^/]+)/([^/]+)$`));
                return {
                    href: a.href,
                    schoolSlug: m[1],
                    teamSlug: m[2],
                    label: a.textContent.trim(),
                };
            });

        // A team URL often appears more than once. Keep the most useful anchor
        // text instead of whichever occurrence happens to be first (which can
        // be the site logo text, "openCaselist").
        const labelScore = label => {
            if (!label) return -100;
            if (['aff', 'neg', 'opencaselist'].includes(label.toLowerCase())) return -50;
            return Math.min(label.length, 100);
        };
        const byHref = new Map();
        for (const candidate of candidates) {
            const current = byHref.get(candidate.href);
            if (!current || labelScore(candidate.label) > labelScore(current.label)) {
                byHref.set(candidate.href, candidate);
            }
        }
        return Array.from(byHref.values()).filter(t => labelScore(t.label) >= 0);
    }, yearSlug);

    console.log(`  Found ${teams.length} recently modified teams`);
    return teams;
}

// ─── Extract rounds from a team page ─────────────────────────────────────────

async function extractRounds(page) {
    return page.evaluate(() => {
        const HEADERS = ['Tournament', 'Round', 'Side'];
        const tables = Array.from(document.querySelectorAll('table'));
        const roundsTable = tables.find(t => {
            const ths = Array.from(t.querySelectorAll('tr:first-child td, tr:first-child th'))
                .map(h => h.innerText.trim());
            return HEADERS.every(h => ths.includes(h));
        });
        if (!roundsTable) return null;
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
            let previewUrl = null, downloadUrl = null;
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

// ─── Resolve school name from slug ───────────────────────────────────────────

async function resolveSchoolName(page, yearSlug, schoolSlug, requestBatcher) {
    // Try to get the display name from the school page heading
    try {
        await requestBatcher.beforeRequest(`school ${schoolSlug}`);
        await page.goto(`https://opencaselist.com/${yearSlug}/${schoolSlug}`, { waitUntil: 'domcontentloaded' });
        await sleep(1000);
        const name = await page.evaluate(() => {
            const h = document.querySelector('h1, h2, [class*="title"], [class*="heading"]');
            return h ? h.innerText.trim() : null;
        });
        if (name && name.length > 1 && name.toLowerCase() !== 'opencaselist') return name;
    } catch {}
    // Fallback: convert slug back to spaced name
    return schoolSlug.replace(/([A-Z])/g, ' $1').trim();
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
    const opts = parseArgs();
    if (!opts.username || !opts.password) {
        throw new Error('Set OPENCASELIST_USERNAME and OPENCASELIST_PASSWORD before running.');
    }
    if (!Number.isInteger(opts.requestsPerBatch) || opts.requestsPerBatch < 1) {
        throw new Error('--requests-per-batch must be a positive integer.');
    }
    if (!Number.isFinite(opts.batchDelay) || opts.batchDelay < 0) {
        throw new Error('--batch-delay must be zero or a positive number of seconds.');
    }

    console.log('═══ scrape-recent ═══');
    console.log(`Year:   ${opts.year}`);
    console.log(`Output: ${opts.output}`);

    const browser = await puppeteer.launch({
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });

    try {
        // 1. Login and get recent team list
        let page = await login(browser, opts.username, opts.password);
        const requestBatcher = new RequestBatcher(opts.requestsPerBatch, opts.batchDelay);
        const recentTeams = await getRecentTeams(page, opts.year, requestBatcher);

        if (recentTeams.length === 0) {
            console.log('No recently modified teams found. Exiting.');
            return;
        }

        // 2. Load existing data
        const data = loadJSON(opts.output, { meta: {}, rounds: [] });
        if (!Array.isArray(data.rounds)) data.rounds = [];

        // A document path is the stable identity. Metadata can be scraped
        // incorrectly (especially team headings), so it is only a fallback for
        // rounds without a document URL.
        const beforeDeduplication = data.rounds.length;
        data.rounds = deduplicateRounds(data.rounds);
        const removedDuplicates = beforeDeduplication - data.rounds.length;
        if (removedDuplicates) {
            console.log(`Removed ${removedDuplicates} existing duplicate document records`);
        }
        const existingKeys = new Set(data.rounds.map(roundKey));

        // School slug → display name cache
        const schoolNameCache = {};

        let totalAdded = 0;

        // 3. Scrape each recently modified team
        for (const team of recentTeams) {
            try {
                // Resolve school display name (cached)
                if (!schoolNameCache[team.schoolSlug]) {
                    schoolNameCache[team.schoolSlug] = await resolveSchoolName(
                        page, opts.year, team.schoolSlug, requestBatcher
                    );
                }
                const schoolName = schoolNameCache[team.schoolSlug];

                console.log(`\n  ${schoolName} / ${team.label} (${team.teamSlug})`);

                let rounds = null;
                let lastError;
                for (let attempt = 1; attempt <= opts.maxAttempts; attempt++) {
                    try {
                        if (attempt > 1) {
                            await requestBatcher.cooldown(
                                `${schoolName} / ${team.label} returned incomplete data`
                            );
                            if (page) await page.close().catch(() => {});
                            page = await login(browser, opts.username, opts.password);
                        }

                        await requestBatcher.beforeRequest(
                            `team ${schoolName} / ${team.label} (attempt ${attempt})`
                        );
                        await page.goto(team.href, { waitUntil: 'networkidle2' });
                        await page.waitForFunction(
                            () => document.body.innerText.includes('No rounds yet') ||
                                Array.from(document.querySelectorAll('table')).some(table => {
                                    const headers = Array.from(
                                        table.querySelectorAll('tr:first-child td, tr:first-child th')
                                    ).map(cell => cell.innerText.trim());
                                    return ['Tournament', 'Round', 'Side'].every(header => headers.includes(header));
                                }),
                            { timeout: 60_000 }
                        );
                        await jitter(opts.pageDelay);
                        rounds = await extractRounds(page);
                        if (rounds === null) throw new Error('rounds table not found');
                        lastError = null;
                        break;
                    } catch (err) {
                        lastError = err;
                        if (attempt < opts.maxAttempts) {
                            console.log(`    ↻ attempt ${attempt} failed (${err.message})`);
                        }
                    }
                }
                if (lastError) throw lastError;

                // The generic page-heading selector can match a round title or
                // the site name. The recent-page team link is the reliable label.
                const teamName = canonicalTeamName(data.rounds, schoolName, team.teamSlug);

                console.log(`    ${rounds.length} rounds on page`);

                let added = 0;
                for (const r of rounds) {
                    const record = {
                        year: opts.year,
                        school: schoolName,
                        team: teamName,
                        ...r,
                        scrapedAt: new Date().toISOString(),
                    };
                    const k = roundKey(record);
                    if (!existingKeys.has(k)) {
                        data.rounds.push(record);
                        existingKeys.add(k);
                        added++;
                    }
                }
                totalAdded += added;
                console.log(`    +${added} new rounds (${totalAdded} total added so far)`);

                await jitter(500);
            } catch (err) {
                console.log(`  ✗ Error on ${team.href}: ${err.message}`);
                if (!page || page.isClosed()) {
                    page = await login(browser, opts.username, opts.password);
                }
            }
        }

        // 4. Save
        data.meta.lastUpdated = new Date().toISOString();
        data.meta.totalRounds = data.rounds.length;
        saveJSON(opts.output, data);

        console.log(`\n✔ Done. Added ${totalAdded} new rounds. Total: ${data.rounds.length} in ${opts.output}`);

    } finally {
        await browser.close();
    }
}

main().catch(err => {
    console.error('Fatal:', err.message);
    process.exit(1);
});
