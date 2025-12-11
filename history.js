// History page functionality
// Note: dailyChartInstance is declared in app.js and shared

/**
 * Get available winter seasons from historic data files
 * Returns array of years (the starting year of each season)
 */
async function getAvailableSeasons() {
  // We know the pattern: agg9596.csv means season 1995-1996 (starting year 1995)
  // The files go from agg9596 to agg2425 (1995 to 2024)
  const seasons = [];
  for (let year = 1995; year <= 2024; year++) {
    const year1 = String(year).slice(-2);
    const year2 = String(year + 1).slice(-2);
    const filename = `agg${year1}${year2}.csv`;
    
    // Try to fetch the file to see if it exists
    try {
      const response = await fetch(`data/historic/${filename}`);
      if (response.ok) {
        seasons.push(year);
      }
    } catch (error) {
      // File doesn't exist, skip
      console.debug(`Season ${year} not available: ${filename}`);
    }
  }
  return seasons;
}

/**
 * Get winter season filename from year
 * @param {number} year - Starting year of winter season (e.g., 2024 for 2024-2025)
 * @returns {string} Filename like "agg2425.csv"
 */
function getSeasonFilename(year) {
  const year1 = String(year).slice(-2);
  const year2 = String(year + 1).slice(-2);
  return `agg${year1}${year2}.csv`;
}

/**
 * Get year from URL parameter or return null
 */
function getYearFromURL() {
  const params = new URLSearchParams(window.location.search);
  const yearParam = params.get('year');
  if (yearParam) {
    const year = parseInt(yearParam, 10);
    if (!isNaN(year) && year >= 1995 && year <= 2024) {
      return year;
    }
  }
  return null;
}

/**
 * Update URL with year parameter without reloading page
 */
function updateURL(year) {
  const url = new URL(window.location);
  url.searchParams.set('year', year);
  window.history.pushState({ year }, '', url);
}

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
 * Fetch historical data for a specific winter season
 */
async function fetchHistoricalData(year) {
  const filename = getSeasonFilename(year);
  try {
    const response = await fetch(`data/historic/${filename}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const csvText = await response.text();
    const data = parseCSV(csvText);
    return data;
  } catch (error) {
    console.error('Error fetching historical data:', error);
    throw error;
  }
}

/**
 * Get available seasons and initialize navigation
 */
let availableSeasons = [];

async function initializeSeasons() {
  availableSeasons = await getAvailableSeasons();
  // Sort in descending order (newest first)
  availableSeasons.sort((a, b) => b - a);
  
  // Set selected year from URL or default to most recent
  const urlYear = getYearFromURL();
  const selectedYear = urlYear || availableSeasons[0];
  if (selectedYear) {
    await loadSeason(selectedYear);
  }
}

/**
 * Update navigation links based on current season
 */
function updateNavigation(currentYear) {
  const navContainer = document.getElementById('chartNavigation');
  const prevLink = document.getElementById('prevSeasonLink');
  const nextLink = document.getElementById('nextSeasonLink');
  
  // Find current index in sorted seasons
  const currentIndex = availableSeasons.indexOf(currentYear);
  
  // Previous season (older, higher index since sorted descending)
  if (currentIndex < availableSeasons.length - 1) {
    const prevYear = availableSeasons[currentIndex + 1];
    prevLink.textContent = `← ${prevYear}-${prevYear + 1}`;
    prevLink.href = `?year=${prevYear}`;
    prevLink.style.visibility = 'visible';
  } else {
    prevLink.style.visibility = 'hidden';
  }
  
  // Next season (newer, lower index since sorted descending)
  if (currentIndex > 0) {
    const nextYear = availableSeasons[currentIndex - 1];
    nextLink.textContent = `${nextYear}-${nextYear + 1} →`;
    nextLink.href = `?year=${nextYear}`;
    nextLink.style.visibility = 'visible';
  } else {
    // Link to current season on index page
    nextLink.textContent = 'Nuvarande säsong →';
    nextLink.href = 'index.html';
    nextLink.style.visibility = 'visible';
  }
  
  // Show navigation container with flex
  navContainer.style.display = 'flex';
}

/**
 * Load and display data for a specific season
 */
async function loadSeason(year) {
  const loadingElement = document.querySelector('#dailyChart').nextElementSibling;
  if (loadingElement && loadingElement.classList.contains('loading')) {
    loadingElement.textContent = 'Laddar data...';
    loadingElement.style.display = 'block';
  }
  
  // Hide navigation while loading
  const navContainer = document.getElementById('chartNavigation');
  navContainer.style.display = 'none';
  
  try {
    const data = await fetchHistoricalData(year);
    if (data.length > 0) {
      const dailySeries = prepareDailySeries(data);
      renderDailyChart(dailySeries);
      updateSubtitle(dailySeries, year);
      updateURL(year);
      updateNavigation(year);
      
      // Hide loading message
      if (loadingElement && loadingElement.classList.contains('loading')) {
        loadingElement.style.display = 'none';
      }
    } else {
      showError('dailyChart', 'Ingen data tillgänglig för denna vintersäsong');
    }
  } catch (error) {
    showError('dailyChart', `Fel vid laddning av data: ${error.message}`);
    console.error('Error loading season:', error);
  }
}

/**
 * Initialize history page
 */
async function initHistory() {
  // Initialize seasons and load default
  await initializeSeasons();
  
  // Add event listeners for navigation links
  const prevLink = document.getElementById('prevSeasonLink');
  const nextLink = document.getElementById('nextSeasonLink');
  
  prevLink.addEventListener('click', async (e) => {
    e.preventDefault();
    const href = prevLink.getAttribute('href');
    const year = parseInt(new URLSearchParams(href.split('?')[1]).get('year'), 10);
    if (!isNaN(year)) {
      await loadSeason(year);
    }
  });
  
  nextLink.addEventListener('click', async (e) => {
    const href = nextLink.getAttribute('href');
    // If it's an external link (no query params), let it navigate normally
    if (!href.includes('?')) {
      return;
    }
    e.preventDefault();
    const year = parseInt(new URLSearchParams(href.split('?')[1]).get('year'), 10);
    if (!isNaN(year)) {
      await loadSeason(year);
    }
  });
  
  // Handle browser back/forward buttons
  window.addEventListener('popstate', async (e) => {
    const year = e.state?.year || getYearFromURL();
    if (year) {
      await loadSeason(year);
    }
  });
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initHistory);
} else {
  initHistory();
}

