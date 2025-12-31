// Compare page - 30 years of snowfall visualization

let compareChartInstance = null;
let allSeasonsData = [];
let currentView = 'periods'; // 'periods' or 'band'

/**
 * Parse CSV text to array of objects
 */
function parseCSV(csvText) {
    const lines = csvText.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',');
    const data = [];

    for (let i = 1; i < lines.length; i++) {
        const values = lines[i].split(',');
        const obj = {};
        headers.forEach((header, index) => {
            obj[header.trim()] = values[index]?.trim() || '';
        });
        data.push(obj);
    }

    return data;
}

/**
 * Get season filename from year
 */
function getSeasonFilename(year) {
    const year1 = String(year).slice(-2);
    const year2 = String(year + 1).slice(-2);
    return `agg${year1}${year2}.csv`;
}

/**
 * Fetch data for a specific season
 */
async function fetchSeasonData(year) {
    const filename = getSeasonFilename(year);
    try {
        const response = await fetch(`data/historic/${filename}`);
        if (!response.ok) {
            return null;
        }
        const csvText = await response.text();
        return parseCSV(csvText);
    } catch (error) {
        console.warn(`Could not load season ${year}-${year + 1}:`, error);
        return null;
    }
}

/**
 * Convert date to day-of-season index (Nov 1 = 0, Apr 30 = 181)
 */
function dateToDayOfSeason(dateStr) {
    const date = new Date(dateStr);
    const month = date.getMonth();
    const day = date.getDate();

    let dayOfSeason;
    if (month === 10) { // November
        dayOfSeason = day - 1;
    } else if (month === 11) { // December
        dayOfSeason = 30 + day - 1;
    } else if (month === 0) { // January
        dayOfSeason = 61 + day - 1;
    } else if (month === 1) { // February
        dayOfSeason = 92 + day - 1;
    } else if (month === 2) { // March
        dayOfSeason = 120 + day - 1;
    } else if (month === 3) { // April
        dayOfSeason = 151 + day - 1;
    } else {
        return -1;
    }

    return dayOfSeason;
}

/**
 * Get label for day of season
 */
function getDayOfSeasonLabel(dayIndex) {
    const months = [
        { name: 'nov', days: 30 },
        { name: 'dec', days: 31 },
        { name: 'jan', days: 31 },
        { name: 'feb', days: 28 },
        { name: 'mar', days: 31 },
        { name: 'apr', days: 30 }
    ];

    let remaining = dayIndex;
    for (const month of months) {
        if (remaining < month.days) {
            return `${remaining + 1} ${month.name}`;
        }
        remaining -= month.days;
    }
    return '';
}

/**
 * Get today's day-of-season index
 */
function getTodayDayOfSeason() {
    const today = new Date();
    // Format as YYYY-MM-DD in CET timezone
    const formatter = new Intl.DateTimeFormat('en-CA', {
        timeZone: 'Europe/Stockholm',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    });
    const dateStr = formatter.format(today);
    return dateToDayOfSeason(dateStr);
}

/**
 * Process season data into normalized format
 * @param {boolean} isCurrentSeason - If true, only fill data up to today
 */
function processSeasonData(data, year, isCurrentSeason = false) {
    const dailyData = new Array(182).fill(null);
    let runningTotal = 0;
    const todayIndex = isCurrentSeason ? getTodayDayOfSeason() : 182;

    data.forEach(row => {
        const dayIndex = dateToDayOfSeason(row.date);
        if (dayIndex >= 0 && dayIndex < 182 && dayIndex <= todayIndex) {
            const snowfall = parseFloat(row.snowfall_cm);
            if (snowfall > 0) {
                runningTotal += snowfall;
            }
            dailyData[dayIndex] = Number(runningTotal.toFixed(1));
        }
    });

    // Only forward-fill for completed seasons
    if (!isCurrentSeason) {
        let lastValue = 0;
        for (let i = 0; i < dailyData.length; i++) {
            if (dailyData[i] === null) {
                dailyData[i] = lastValue;
            } else {
                lastValue = dailyData[i];
            }
        }
    } else {
        // For current season, forward-fill only up to today
        let lastValue = 0;
        for (let i = 0; i <= todayIndex && i < dailyData.length; i++) {
            if (dailyData[i] === null) {
                dailyData[i] = lastValue;
            } else {
                lastValue = dailyData[i];
            }
        }
    }

    return {
        year,
        seasonLabel: `${year}-${String(year + 1).slice(-2)}`,
        data: dailyData,
        finalTotal: isCurrentSeason ? (dailyData[todayIndex] || runningTotal) : (dailyData[dailyData.length - 1] || runningTotal),
        isCurrent: isCurrentSeason,
        todayIndex: isCurrentSeason ? todayIndex : null
    };
}

/**
 * Fetch current season data
 */
async function fetchCurrentSeasonData() {
    try {
        const response = await fetch('data/aggregated_data.csv');
        if (!response.ok) {
            return null;
        }
        const csvText = await response.text();
        return parseCSV(csvText);
    } catch (error) {
        console.warn('Could not load current season:', error);
        return null;
    }
}

/**
 * Load all seasons data
 */
async function loadAllSeasons() {
    const seasons = [];

    // Seasons to exclude (broken measurement equipment)
    const excludedSeasons = [2017]; // 2017-2018 season had broken equipment

    // Load historic seasons (1995-2024)
    const historicYears = [];
    for (let year = 1995; year <= 2024; year++) {
        if (!excludedSeasons.includes(year)) {
            historicYears.push(year);
        }
    }

    const historicResults = await Promise.all(
        historicYears.map(async (year) => {
            const data = await fetchSeasonData(year);
            if (data && data.length > 0) {
                return processSeasonData(data, year);
            }
            return null;
        })
    );

    historicResults.forEach(result => {
        if (result) {
            seasons.push(result);
        }
    });

    // Load current season (2025-2026)
    const currentData = await fetchCurrentSeasonData();
    if (currentData && currentData.length > 0) {
        const firstDate = new Date(currentData[0].date);
        const currentYear = firstDate.getMonth() >= 6 ? firstDate.getFullYear() : firstDate.getFullYear() - 1;
        seasons.push(processSeasonData(currentData, currentYear, true));
    }

    seasons.sort((a, b) => a.year - b.year);

    return seasons;
}

/**
 * Group seasons into 5-year periods
 */
function groupIntoFiveYearPeriods(seasons) {
    // Using gradient: older periods more transparent, newer more opaque
    // All using similar blue/purple hue but varying opacity
    const periods = [
        { label: '1995-99', years: [1995, 1996, 1997, 1998, 1999], opacity: 0.25 },
        { label: '2000-04', years: [2000, 2001, 2002, 2003, 2004], opacity: 0.40 },
        { label: '2005-09', years: [2005, 2006, 2007, 2008, 2009], opacity: 0.55 },
        { label: '2010-14', years: [2010, 2011, 2012, 2013, 2014], opacity: 0.70 },
        { label: '2015-19', years: [2015, 2016, 2018, 2019], opacity: 0.85 }, // Note: 2017 excluded
        { label: '2020-24', years: [2020, 2021, 2022, 2023, 2024], opacity: 1.0 }
    ].map((p, i, arr) => ({
        ...p,
        color: `rgba(102, 126, 234, ${p.opacity})` // Purple-blue gradient
    }));

    const result = [];

    for (const period of periods) {
        const periodSeasons = seasons.filter(s => period.years.includes(s.year));
        if (periodSeasons.length === 0) continue;

        // Calculate average for each day
        const avgData = new Array(182).fill(0);
        for (let day = 0; day < 182; day++) {
            const values = periodSeasons.map(s => s.data[day]).filter(v => v !== null);
            if (values.length > 0) {
                avgData[day] = values.reduce((a, b) => a + b, 0) / values.length;
            }
        }

        result.push({
            label: period.label,
            data: avgData,
            color: period.color,
            seasonCount: periodSeasons.length,
            finalTotal: avgData[avgData.length - 1]
        });
    }

    // Add current season as separate line
    const now = new Date();
    const currentSeasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const currentSeason = seasons.find(s => s.year === currentSeasonYear);
    if (currentSeason) {
        result.push({
            label: `${currentSeasonYear}-${String(currentSeasonYear + 1).slice(-2)} (nu)`,
            data: currentSeason.data,
            color: 'rgba(220, 53, 69, 0.95)',
            seasonCount: 1,
            finalTotal: currentSeason.finalTotal,
            isCurrent: true,
            todayIndex: currentSeason.todayIndex
        });
    }

    return result;
}

/**
 * Calculate min/max/average bands from all seasons
 */
function calculateBands(seasons) {
    // Exclude current incomplete season from min/max/avg calculation
    const now = new Date();
    const currentSeasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const completedSeasons = seasons.filter(s => s.year !== currentSeasonYear);
    const currentSeason = seasons.find(s => s.year === currentSeasonYear);

    const minData = new Array(182).fill(Infinity);
    const maxData = new Array(182).fill(-Infinity);
    const avgData = new Array(182).fill(0);

    for (let day = 0; day < 182; day++) {
        const values = completedSeasons.map(s => s.data[day]).filter(v => v !== null && v !== undefined);
        if (values.length > 0) {
            minData[day] = Math.min(...values);
            maxData[day] = Math.max(...values);
            avgData[day] = values.reduce((a, b) => a + b, 0) / values.length;
        } else {
            minData[day] = 0;
            maxData[day] = 0;
            avgData[day] = 0;
        }
    }

    return {
        min: minData,
        max: maxData,
        avg: avgData,
        currentSeason: currentSeason
    };
}

/**
 * Calculate statistics from all seasons
 */
function calculateStats(seasons) {
    if (seasons.length === 0) return null;

    const now = new Date();
    const currentSeasonYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
    const completedSeasons = seasons.filter(s => s.year !== currentSeasonYear);

    const totals = seasons.map(s => ({ year: s.year, total: s.finalTotal }));
    totals.sort((a, b) => b.total - a.total);

    const completedTotals = completedSeasons.map(s => ({ year: s.year, total: s.finalTotal }));
    completedTotals.sort((a, b) => a.total - b.total);

    const bestSeason = totals[0];
    const worstSeason = completedTotals.length > 0 ? completedTotals[0] : totals[totals.length - 1];

    const avgTotal = totals.reduce((sum, s) => sum + s.total, 0) / totals.length;
    const sortedTotals = totals.map(t => t.total).sort((a, b) => a - b);
    const medianTotal = sortedTotals[Math.floor(sortedTotals.length / 2)];

    const recentSeasons = seasons.filter(s => s.year >= 2015);
    const recentAvg = recentSeasons.length > 0
        ? recentSeasons.reduce((sum, s) => sum + s.finalTotal, 0) / recentSeasons.length
        : avgTotal;

    const earlySeasons = seasons.filter(s => s.year < 2005);
    const earlyAvg = earlySeasons.length > 0
        ? earlySeasons.reduce((sum, s) => sum + s.finalTotal, 0) / earlySeasons.length
        : avgTotal;

    return {
        bestSeason,
        worstSeason,
        avgTotal: Math.round(avgTotal),
        medianTotal: Math.round(medianTotal),
        recentAvg: Math.round(recentAvg),
        earlyAvg: Math.round(earlyAvg),
        totalSeasons: seasons.length
    };
}

/**
 * Render statistics
 */
function renderStats(stats) {
    if (!stats) return;

    const statsGrid = document.getElementById('statsGrid');
    if (!statsGrid) return;

    statsGrid.innerHTML = `
        <div class="stat-card">
            <div class="stat-label">Bästa säsong</div>
            <div class="stat-value best">${Math.round(stats.bestSeason.total)} cm</div>
            <div class="stat-season">${stats.bestSeason.year}-${String(stats.bestSeason.year + 1).slice(-2)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Sämsta säsong</div>
            <div class="stat-value worst">${Math.round(stats.worstSeason.total)} cm</div>
            <div class="stat-season">${stats.worstSeason.year}-${String(stats.worstSeason.year + 1).slice(-2)}</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Genomsnitt</div>
            <div class="stat-value">${stats.avgTotal} cm</div>
            <div class="stat-season">${stats.totalSeasons} säsonger</div>
        </div>
        <div class="stat-card">
            <div class="stat-label">Trend</div>
            <div class="stat-value ${stats.recentAvg > stats.earlyAvg ? 'best' : 'worst'}">${stats.recentAvg > stats.earlyAvg ? '+' : ''}${stats.recentAvg - stats.earlyAvg} cm</div>
            <div class="stat-season">2015-nu vs 1995-2005</div>
        </div>
    `;
}

/**
 * Create x-axis labels
 */
function createXLabels() {
    const labels = new Array(182).fill('');
    const monthMidpoints = [
        { index: 15, label: 'nov' },
        { index: 45, label: 'dec' },
        { index: 76, label: 'jan' },
        { index: 106, label: 'feb' },
        { index: 135, label: 'mar' },
        { index: 166, label: 'apr' }
    ];
    monthMidpoints.forEach(m => {
        labels[m.index] = m.label;
    });
    return labels;
}

/**
 * Render 5-year periods chart
 */
function renderPeriodsChart(seasons) {
    if (compareChartInstance) {
        compareChartInstance.destroy();
    }

    const ctx = document.getElementById('compareChart').getContext('2d');
    const periods = groupIntoFiveYearPeriods(seasons);
    const labels = createXLabels();

    const datasets = periods.map(period => {
        // For current season, only show data up to today
        let dataToShow = period.data;
        if (period.isCurrent && period.todayIndex !== null) {
            dataToShow = period.data.map((val, index) => 
                index > period.todayIndex ? null : val
            );
        }

        return {
            label: period.label,
            data: dataToShow,
            borderColor: period.color,
            backgroundColor: 'transparent',
            borderWidth: period.isCurrent ? 3 : 2.5,
            borderDash: period.isCurrent ? [5, 5] : [],
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: period.color,
            tension: 0.2,
            fill: false,
            spanGaps: false // Don't connect across null values
        };
    });

    compareChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'nearest',
                intersect: false,
                axis: 'xy'
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    enabled: true,
                    mode: 'nearest',
                    intersect: false,
                    callbacks: {
                        title: (context) => {
                            const dayIndex = context[0].dataIndex;
                            const label = context[0].dataset.label;
                            return `${label} — ${getDayOfSeasonLabel(dayIndex)}`;
                        },
                        label: (context) => `${Math.round(context.parsed.y)} cm`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { maxRotation: 0, autoSkip: false },
                    grid: { display: false }
                },
                y: {
                    title: { display: true, text: 'Ackumulerat snöfall (cm)' },
                    beginAtZero: true,
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                }
            }
        }
    });

    document.querySelector('.loading').style.display = 'none';
}

/**
 * Render min/max/average band chart
 */
function renderBandChart(seasons) {
    if (compareChartInstance) {
        compareChartInstance.destroy();
    }

    const ctx = document.getElementById('compareChart').getContext('2d');
    const bands = calculateBands(seasons);
    const labels = createXLabels();

    const datasets = [
        {
            label: 'Max (bästa säsong)',
            data: bands.max,
            borderColor: 'rgba(40, 167, 69, 0.8)',
            backgroundColor: 'rgba(40, 167, 69, 0.15)',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
            fill: '+1' // Fill to the next dataset (avg)
        },
        {
            label: 'Genomsnitt',
            data: bands.avg,
            borderColor: 'rgba(102, 126, 234, 1)',
            backgroundColor: 'rgba(102, 126, 234, 0.15)',
            borderWidth: 3,
            pointRadius: 0,
            tension: 0.2,
            fill: '+1' // Fill to the next dataset (min)
        },
        {
            label: 'Min (sämsta säsong)',
            data: bands.min,
            borderColor: 'rgba(220, 53, 69, 0.8)',
            backgroundColor: 'transparent',
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.2,
            fill: false
        }
    ];

    // Add current season if available
    if (bands.currentSeason) {
        // Only show data up to today for current season
        let currentData = bands.currentSeason.data;
        if (bands.currentSeason.todayIndex !== null) {
            currentData = bands.currentSeason.data.map((val, index) => 
                index > bands.currentSeason.todayIndex ? null : val
            );
        }

        datasets.push({
            label: `${bands.currentSeason.year}-${String(bands.currentSeason.year + 1).slice(-2)} (nu)`,
            data: currentData,
            borderColor: 'rgba(255, 165, 0, 1)',
            backgroundColor: 'transparent',
            borderWidth: 3,
            borderDash: [6, 4],
            pointRadius: 0,
            pointHoverRadius: 5,
            tension: 0.2,
            fill: false,
            spanGaps: false // Don't connect across null values
        });
    }

    compareChartInstance = new Chart(ctx, {
        type: 'line',
        data: { labels, datasets },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        font: { size: 12 }
                    }
                },
                tooltip: {
                    enabled: true,
                    mode: 'index',
                    intersect: false,
                    callbacks: {
                        title: (context) => getDayOfSeasonLabel(context[0].dataIndex),
                        label: (context) => `${context.dataset.label}: ${Math.round(context.parsed.y)} cm`
                    }
                }
            },
            scales: {
                x: {
                    ticks: { maxRotation: 0, autoSkip: false },
                    grid: { display: false }
                },
                y: {
                    title: { display: true, text: 'Ackumulerat snöfall (cm)' },
                    beginAtZero: true,
                    grid: { color: 'rgba(0, 0, 0, 0.05)' }
                }
            }
        }
    });

    document.querySelector('.loading').style.display = 'none';
}

/**
 * Render chart based on current view
 */
function renderChart() {
    if (currentView === 'periods') {
        renderPeriodsChart(allSeasonsData);
    } else {
        renderBandChart(allSeasonsData);
    }
}

/**
 * Setup toggle buttons
 */
function setupToggle() {
    const toggleBtns = document.querySelectorAll('.toggle-btn');
    
    toggleBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.view;
            if (view === currentView) return;

            // Update active state
            toggleBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            // Update view and re-render
            currentView = view;
            renderChart();

            // Update subtitle
            updateSubtitle();
        });
    });
}

/**
 * Update subtitle based on view
 */
function updateSubtitle() {
    const subtitleEl = document.getElementById('subtitle');
    const legendEl = document.getElementById('legendDescription');

    if (subtitleEl) {
        if (currentView === 'periods') {
            subtitleEl.textContent = `Snöfall per 5-årsperiod (${allSeasonsData.length} säsonger)`;
        } else {
            subtitleEl.textContent = `Min/Max/Medel över ${allSeasonsData.length} säsonger`;
        }
    }

    if (legendEl) {
        if (currentView === 'periods') {
            legendEl.innerHTML = `<strong>5-årsperioder:</strong> Visar medelsnöfall för varje 5-årsperiod. 
                Den nuvarande säsongen visas som streckad linje för jämförelse.`;
        } else {
            legendEl.innerHTML = `<strong>Min/Max/Medel:</strong> Det gröna området visar spannet mellan bästa och sämsta säsong. 
                Den blå linjen är genomsnittet. Orange streckad linje är nuvarande säsong.`;
        }
    }
}

/**
 * Show error message
 */
function showError(message) {
    const container = document.querySelector('.chart-container');
    if (container) {
        container.innerHTML = `<div class="error">${message}</div>`;
    }
}

/**
 * Initialize the compare page
 */
async function initCompare() {
    try {
        const seasons = await loadAllSeasons();
        allSeasonsData = seasons;

        if (seasons.length === 0) {
            showError('Ingen historisk data tillgänglig');
            return;
        }

        // Setup toggle
        setupToggle();

        // Update subtitle
        updateSubtitle();

        // Calculate and render stats
        const stats = calculateStats(seasons);
        renderStats(stats);

        // Render the chart
        renderChart();

    } catch (error) {
        console.error('Error initializing compare page:', error);
        showError(`Fel vid laddning: ${error.message}`);
    }
}

// Initialize when page loads
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCompare);
} else {
    initCompare();
}
