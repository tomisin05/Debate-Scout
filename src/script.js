// Load CSV data from file
let csvData = '';

// Function to load data
async function loadCSVData() {
    try {
        // Load JSON data
        const response = await fetch('data.json');
        if (!response.ok) {
            throw new Error('Failed to load JSON file');
        }
        return await response.json();
    } catch (error) {
        console.error('Error loading data:', error);
        // Minimal fallback data
        return [
            {
                school: 'Arizona State',
                team: 'Arizona State SaSm',
                tournament: 'Owen L. Coon',
                round: 'Round 1',
                side: 'Aff',
                opponent: 'Kansas LS',
                judge: 'Solomon Watson',
                roundReport: '1AC - Sklavenmoral v1 1NC - Imperialism K, Case 2NR - Imperialism K, Case'
            }
        ];
    }
}

class DebateScout {
    constructor() {
        this.data = [];
        this.filteredData = [];
        this.currentPage = 1;
        this.itemsPerPage = 50;
        this.sortColumn = 'school';
        this.sortDirection = 'asc';
        this.groupBy = '';
        
        this.init();
    }

    async init() {
        await this.loadData();
        this.setupEventListeners();
        this.populateFilters();
        this.updateRecordCount();
        this.renderTable();
    }

    async loadData() {
        const data = await loadCSVData();
        // Data is already parsed as JavaScript objects from JSON
        this.data = data;
        this.filteredData = [...this.data];
    }

    parseCSV(csvText) {
        const lines = csvText.split('\n');
        const headers = lines[0].split(',').map(h => h.trim());
        const data = [];

        for (let i = 1; i < lines.length; i++) {
            if (lines[i].trim()) {
                const values = this.parseCSVLine(lines[i]);
                if (values.length >= 7) { // Ensure we have at least the basic columns
                    const row = {};
                    row.school = values[0] ? values[0].trim() : '';
                    row.team = values[1] ? values[1].trim() : '';
                    row.tournament = values[2] ? values[2].trim() : '';
                    row.round = values[3] ? values[3].trim() : '';
                    row.side = values[4] ? values[4].trim() : '';
                    row.opponent = values[5] ? values[5].trim() : '';
                    row.judge = values[6] ? values[6].trim() : '';
                    // Find the roundReport column (it might be in different positions)
                    row.roundReport = '';
                    for (let j = 7; j < values.length; j++) {
                        if (values[j] && values[j].trim()) {
                            row.roundReport = values[j].trim();
                            break;
                        }
                    }
                    data.push(row);
                }
            }
        }
        return data;
    }

    parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        
        for (let i = 0; i < line.length; i++) {
            const char = line[i];
            
            if (char === '"') {
                if (inQuotes && line[i + 1] === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuotes = !inQuotes;
                }
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    setupEventListeners() {
        // Search
        document.getElementById('searchInput').addEventListener('input', (e) => {
            this.filterData();
        });

        // Filters
        ['schoolFilter', 'tournamentFilter', 'sideFilter'].forEach(id => {
            document.getElementById(id).addEventListener('change', () => {
                this.filterData();
            });
        });



        // Table headers
        document.querySelectorAll('th[data-sort]').forEach(th => {
            th.addEventListener('click', () => {
                const column = th.dataset.sort;
                if (this.sortColumn === column) {
                    this.sortDirection = this.sortDirection === 'asc' ? 'desc' : 'asc';
                } else {
                    this.sortColumn = column;
                    this.sortDirection = 'asc';
                }
                this.sortData();
                this.renderTable();
            });
        });

        // Pagination
        document.getElementById('prevPage').addEventListener('click', () => {
            if (this.currentPage > 1) {
                this.currentPage--;
                this.renderTable();
            }
        });

        document.getElementById('nextPage').addEventListener('click', () => {
            const totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
            if (this.currentPage < totalPages) {
                this.currentPage++;
                this.renderTable();
            }
        });

        // Export CSV
        document.getElementById('exportBtn').addEventListener('click', () => {
            this.exportToCSV();
        });

        // Filter button
        document.getElementById('filterBtn').addEventListener('click', () => {
            const filterGroup = document.querySelector('.filter-group');
            filterGroup.style.display = filterGroup.style.display === 'none' ? 'flex' : 'none';
        });

        // Sort button
        document.getElementById('sortBtn').addEventListener('click', () => {
            const sortSelect = document.getElementById('sortSelect');
            sortSelect.style.display = sortSelect.style.display === 'none' ? 'block' : 'none';
        });

        // Group button
        document.getElementById('groupBtn').addEventListener('click', () => {
            const groupSelect = document.getElementById('groupSelect');
            groupSelect.style.display = groupSelect.style.display === 'none' ? 'block' : 'none';
        });

        // Sort select
        document.getElementById('sortSelect').addEventListener('change', (e) => {
            this.sortColumn = e.target.value;
            this.sortData();
            this.renderTable();
        });

        // Group select
        document.getElementById('groupSelect').addEventListener('change', (e) => {
            this.groupBy = e.target.value;
            this.renderTable();
        });

        // Items per page
        document.getElementById('itemsPerPageSelect').addEventListener('change', (e) => {
            if (e.target.value === 'custom') {
                document.getElementById('customItemsInput').style.display = 'inline-block';
                document.getElementById('customItemsInput').focus();
            } else {
                document.getElementById('customItemsInput').style.display = 'none';
                this.itemsPerPage = parseInt(e.target.value);
                this.currentPage = 1;
                this.renderTable();
            }
        });

        // Custom items input
        document.getElementById('customItemsInput').addEventListener('change', (e) => {
            const value = parseInt(e.target.value);
            if (value && value > 0 && value <= 10000) {
                this.itemsPerPage = value;
                this.currentPage = 1;
                this.renderTable();
            }
        });

        document.getElementById('customItemsInput').addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                e.target.blur();
            }
        });

        // Column resizing
        this.setupColumnResizing();
    }

    populateFilters() {
        const schools = [...new Set(this.data.map(row => row.school))].sort();
        const tournaments = [...new Set(this.data.map(row => row.tournament))].sort();

        const schoolFilter = document.getElementById('schoolFilter');
        schools.forEach(school => {
            const option = document.createElement('option');
            option.value = school;
            option.textContent = school;
            schoolFilter.appendChild(option);
        });

        const tournamentFilter = document.getElementById('tournamentFilter');
        tournaments.forEach(tournament => {
            const option = document.createElement('option');
            option.value = tournament;
            option.textContent = tournament;
            tournamentFilter.appendChild(option);
        });
    }

    filterData() {
        const searchTerm = document.getElementById('searchInput').value.toLowerCase();
        const schoolFilter = document.getElementById('schoolFilter').value;
        const tournamentFilter = document.getElementById('tournamentFilter').value;
        const sideFilter = document.getElementById('sideFilter').value;

        this.filteredData = this.data.filter(row => {
            const matchesSearch = !searchTerm || 
                Object.values(row).some(value => 
                    value.toLowerCase().includes(searchTerm)
                );
            
            const matchesSchool = !schoolFilter || row.school === schoolFilter;
            const matchesTournament = !tournamentFilter || row.tournament === tournamentFilter;
            const matchesSide = !sideFilter || row.side === sideFilter;

            return matchesSearch && matchesSchool && matchesTournament && matchesSide;
        });

        this.currentPage = 1;
        this.sortData();
        this.renderTable();
        this.updateRecordCount();
    }

    sortData() {
        this.filteredData.sort((a, b) => {
            let aVal = a[this.sortColumn] || '';
            let bVal = b[this.sortColumn] || '';
            
            // Handle numeric sorting for rounds
            if (this.sortColumn === 'round') {
                const aNum = parseInt(aVal.replace(/\D/g, '')) || 0;
                const bNum = parseInt(bVal.replace(/\D/g, '')) || 0;
                return this.sortDirection === 'asc' ? aNum - bNum : bNum - aNum;
            }
            
            aVal = aVal.toLowerCase();
            bVal = bVal.toLowerCase();
            
            if (aVal < bVal) return this.sortDirection === 'asc' ? -1 : 1;
            if (aVal > bVal) return this.sortDirection === 'asc' ? 1 : -1;
            return 0;
        });
    }

    renderTable() {
        const tbody = document.getElementById('tableBody');
        const startIndex = (this.currentPage - 1) * this.itemsPerPage;
        const endIndex = startIndex + this.itemsPerPage;
        
        let dataToRender = this.filteredData;
        
        // Group data if groupBy is selected
        if (this.groupBy) {
            const grouped = this.groupData(dataToRender, this.groupBy);
            tbody.innerHTML = this.renderGroupedData(grouped);
        } else {
            const pageData = dataToRender.slice(startIndex, endIndex);
            if (pageData.length === 0) {
                tbody.innerHTML = '<tr><td colspan="8" class="empty-state"><i class="fas fa-search"></i><div>No results found</div></td></tr>';
                return;
            }
            tbody.innerHTML = pageData.map(row => `
                <tr>
                    <td class="school-cell">${this.escapeHtml(row.school)}</td>
                    <td class="team-cell" title="${this.escapeHtml(row.team)}">${this.escapeHtml(row.team)}</td>
                    <td class="tournament-cell" title="${this.escapeHtml(row.tournament)}">${this.escapeHtml(row.tournament)}</td>
                    <td class="round-cell">${this.escapeHtml(row.round)}</td>
                    <td><span class="side-cell side-${row.side.toLowerCase()}">${this.escapeHtml(row.side)}</span></td>
                    <td class="opponent-cell" title="${this.escapeHtml(row.opponent)}">${this.escapeHtml(row.opponent)}</td>
                    <td class="judge-cell" title="${this.escapeHtml(row.judge)}">${this.escapeHtml(row.judge)}</td>
                    <td class="report-cell" title="${this.escapeHtml(row.roundReport)}">${this.escapeHtml(row.roundReport)}</td>
                </tr>
            `).join('');
        }
        
        this.updatePagination();
    }

    groupData(data, groupBy) {
        return data.reduce((groups, item) => {
            const key = item[groupBy] || 'Unknown';
            if (!groups[key]) groups[key] = [];
            groups[key].push(item);
            return groups;
        }, {});
    }

    renderGroupedData(grouped) {
        return Object.entries(grouped).map(([group, items]) => {
            const groupId = group.replace(/\s+/g, '-').toLowerCase();
            const showingCount = Math.min(10, items.length);
            const hasMore = items.length > 10;
            
            const groupHeader = `<tr class="group-header"><td colspan="8"><strong>${group} (${items.length} records)</strong></td></tr>`;
            const groupRows = items.slice(0, 10).map(row => `
                <tr class="group-row-${groupId}">
                    <td class="school-cell">${this.escapeHtml(row.school)}</td>
                    <td class="team-cell" title="${this.escapeHtml(row.team)}">${this.escapeHtml(row.team)}</td>
                    <td class="tournament-cell" title="${this.escapeHtml(row.tournament)}">${this.escapeHtml(row.tournament)}</td>
                    <td class="round-cell">${this.escapeHtml(row.round)}</td>
                    <td><span class="side-cell side-${row.side.toLowerCase()}">${this.escapeHtml(row.side)}</span></td>
                    <td class="opponent-cell" title="${this.escapeHtml(row.opponent)}">${this.escapeHtml(row.opponent)}</td>
                    <td class="judge-cell" title="${this.escapeHtml(row.judge)}">${this.escapeHtml(row.judge)}</td>
                    <td class="report-cell" title="${this.escapeHtml(row.roundReport)}">${this.escapeHtml(row.roundReport)}</td>
                </tr>
            `).join('');
            
            const hiddenRows = items.slice(10).map(row => `
                <tr class="group-row-${groupId} hidden-row" style="display: none;">
                    <td class="school-cell">${this.escapeHtml(row.school)}</td>
                    <td class="team-cell" title="${this.escapeHtml(row.team)}">${this.escapeHtml(row.team)}</td>
                    <td class="tournament-cell" title="${this.escapeHtml(row.tournament)}">${this.escapeHtml(row.tournament)}</td>
                    <td class="round-cell">${this.escapeHtml(row.round)}</td>
                    <td><span class="side-cell side-${row.side.toLowerCase()}">${this.escapeHtml(row.side)}</span></td>
                    <td class="opponent-cell" title="${this.escapeHtml(row.opponent)}">${this.escapeHtml(row.opponent)}</td>
                    <td class="judge-cell" title="${this.escapeHtml(row.judge)}">${this.escapeHtml(row.judge)}</td>
                    <td class="report-cell" title="${this.escapeHtml(row.roundReport)}">${this.escapeHtml(row.roundReport)}</td>
                </tr>
            `).join('');
            
            const expandButton = hasMore ? `<tr><td colspan="8" style="text-align: center; padding: 10px;"><button class="expand-btn" onclick="debateScout.toggleGroup('${groupId}')" style="background: #667eea; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">Show ${items.length - 10} more records</button></td></tr>` : '';
            
            return groupHeader + groupRows + hiddenRows + expandButton;
        }).join('');
    }

    escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    updatePagination() {
        const totalPages = Math.ceil(this.filteredData.length / this.itemsPerPage);
        const startRecord = (this.currentPage - 1) * this.itemsPerPage + 1;
        const endRecord = Math.min(this.currentPage * this.itemsPerPage, this.filteredData.length);
        
        document.getElementById('prevPage').disabled = this.currentPage === 1;
        document.getElementById('nextPage').disabled = this.currentPage === totalPages || totalPages === 0;
        document.getElementById('paginationInfo').textContent = 
            `Showing ${startRecord}-${endRecord} of ${this.filteredData.length.toLocaleString()}`;
    }

    updateRecordCount() {
        const totalRecords = this.filteredData.length;
        document.getElementById('recordCount').textContent = `${totalRecords.toLocaleString()} records`;
    }

    exportToCSV() {
        const headers = ['school', 'team', 'tournament', 'round', 'side', 'opponent', 'judge', 'roundReport'];
        const csvContent = [
            headers.join(','),
            ...this.filteredData.map(row => 
                headers.map(header => {
                    const value = row[header] || '';
                    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
                        return `"${value.replace(/"/g, '""')}"`;
                    }
                    return value;
                }).join(',')
            )
        ].join('\n');
        
        const blob = new Blob([csvContent], { type: 'text/csv' });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `debate-scout-data-${new Date().toISOString().split('T')[0]}.csv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }

    toggleGroup(groupId) {
        const hiddenRows = document.querySelectorAll(`.group-row-${groupId}.hidden-row`);
        const button = event.target;
        const isExpanded = hiddenRows[0].style.display !== 'none';
        
        hiddenRows.forEach(row => {
            row.style.display = isExpanded ? 'none' : 'table-row';
        });
        
        const totalHidden = hiddenRows.length;
        button.textContent = isExpanded ? `Show ${totalHidden} more records` : 'Show less';
    }

    setupColumnResizing() {
        const resizeHandles = document.querySelectorAll('.resize-handle');
        let isResizing = false;
        let currentColumn = null;
        let startX = 0;
        let startWidth = 0;

        resizeHandles.forEach(handle => {
            handle.addEventListener('mousedown', (e) => {
                isResizing = true;
                currentColumn = handle.parentElement;
                startX = e.clientX;
                startWidth = currentColumn.offsetWidth;
                document.body.style.cursor = 'col-resize';
                e.preventDefault();
            });
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const diff = e.clientX - startX;
            const newWidth = Math.max(50, startWidth + diff);
            currentColumn.style.width = newWidth + 'px';
            currentColumn.style.minWidth = newWidth + 'px';
        });

        document.addEventListener('mouseup', () => {
            if (isResizing) {
                isResizing = false;
                currentColumn = null;
                document.body.style.cursor = 'default';
            }
        });
    }
}

// Initialize the application when DOM is loaded
let debateScout;
document.addEventListener('DOMContentLoaded', () => {
    debateScout = new DebateScout();
});