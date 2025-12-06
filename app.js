// SMHI API configuration - loaded from shared file
// Note: In browser, smhi_api.js must be loaded before app.js

/**
 * Parse CSV string to array of objects
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
 * Fetch daily snowfall data from CSV
 */
async function fetchDailySnowfall() {
  try {
    const response = await fetch('data/snowfall_daily.csv');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const csvText = await response.text();
    const data = parseCSV(csvText);
    
    // Filter for Oct 2025 - Apr 2026
    const startDate = new Date('2025-10-01');
    const endDate = new Date('2026-04-30');
    
    return data.filter(row => {
      const date = new Date(row.date);
      return date >= startDate && date <= endDate;
    });
  } catch (error) {
    console.error('Error fetching daily snowfall:', error);
    throw error;
  }
}

/**
 * Fetch SMHI API data for a parameter (browser version)
 */
async function fetchSMHIDataBrowser(parameter, stationId, period = 'latest-day') {
  try {
    return await fetchSMHIData(parameter, stationId, period);
  } catch (error) {
    console.error(`Error fetching parameter ${parameter} (station ${stationId}, period ${period}):`, error);
    throw error;
  }
}

// parseSMHITimestamp and parseSMHIEntry are now in smhi_api.js (shared)

/**
 * Fetch last 24 hours of hourly data
 */
async function fetchLast24Hours() {
  try {
    // Fetch data for each parameter - use 'latest-day' to get 24 hours of data
    const parameterPromises = Object.entries(PARAMETER_CODES).map(async ([key, code]) => {
      try {
        const data = await fetchSMHIDataBrowser(code, STATION_ID, 'latest-day');
        return { key, data };
      } catch (error) {
        console.error(`Failed to fetch ${key} (parameter ${code}):`, error);
        return { key, data: null };
      }
    });
    
    const results = await Promise.all(parameterPromises);
    
    // Organize data by timestamp
    const dataByTime = {};
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    
    for (const { key, data } of results) {
      if (data && data.value && Array.isArray(data.value)) {
        for (const entry of data.value) {
          // Use shared parsing function
          const parsed = parseSMHIEntry(entry);
          if (!parsed) {
            continue;
          }
          
          // Only include last 24 hours
          if (parsed.timestamp >= oneDayAgo) {
            const timeKey = parsed.timestamp.toISOString();
            if (!dataByTime[timeKey]) {
              dataByTime[timeKey] = { timestamp: parsed.timestamp };
            }
            dataByTime[timeKey][key] = parsed.value;
          }
        }
      }
    }
    
    // Convert to array and sort by timestamp
    const hourlyData = Object.values(dataByTime)
      .filter(data => data.temperature !== undefined && data.precipitation !== undefined)
      .sort((a, b) => a.timestamp - b.timestamp);

    // SMHI API returns hourly precipitation values directly (not cumulative)
    // Calculate snowfall for each hour
    return hourlyData.map(data => ({
      timestamp: data.timestamp,
      temperature: data.temperature,
      precipitation: data.precipitation,
      snowfall: calculateSnowfall(
        data.temperature,
        data.precipitation,
        data.wind_speed || 0,  // Default to 0 if missing
        data.humidity || 90     // Default to 90% if missing
      )
    }));
  } catch (error) {
    console.error('Error fetching last 24 hours:', error);
    throw error;
  }
}

/**
 * Check if device is mobile/touch-enabled
 */
function isMobileDevice() {
  return (('ontouchstart' in window) ||
     (navigator.maxTouchPoints > 0) ||
     (navigator.msMaxTouchPoints > 0));
}

/**
 * Render daily snowfall chart
 */
function renderDailyChart(data) {
  const dates = data.map(row => row.date);
  const snowfall = data.map(row => parseFloat(row.snowfall_cm) || 0);

  const isMobile = isMobileDevice();

  const trace = {
    x: dates,
    y: snowfall,
    type: 'bar',
    marker: {
      color: '#3498db',
      line: {
        color: '#2980b9',
        width: 1
      }
    },
    name: 'Snöfall (cm)',
    hovertemplate: isMobile ? '%{y:.1f} cm<br>%{x}<extra></extra>' : undefined
  };

  const layout = {
    title: {
      text: '',
      font: { size: 16 }
    },
    xaxis: {
      title: 'Datum',
      type: 'date'
    },
    yaxis: {
      title: 'Snöfall (cm)'
    },
    margin: { l: 60, r: 20, t: 20, b: 60 },
    responsive: true,
    displayModeBar: false,
    hovermode: isMobile ? 'closest' : 'x unified',
    dragmode: isMobile ? false : 'zoom'
  };

  const config = {
    responsive: true,
    displayModeBar: false,
    staticPlot: isMobile, // Disable all interactions on mobile except tooltips
    modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d']
  };

  Plotly.newPlot('dailyChart', [trace], layout, config);

  // Add mobile-specific event handling
  if (isMobile) {
    const chartDiv = document.getElementById('dailyChart');
    chartDiv.addEventListener('touchstart', function(e) {
      // Prevent default touch behavior that might cause zooming
      e.preventDefault();
    }, { passive: false });

    // Add tap-to-show-tooltip functionality
    chartDiv.addEventListener('touchend', function(e) {
      const rect = chartDiv.getBoundingClientRect();
      const x = e.changedTouches[0].clientX - rect.left;
      const y = e.changedTouches[0].clientY - rect.top;

      // Trigger hover event at touch position
      const event = new MouseEvent('mousemove', {
        clientX: e.changedTouches[0].clientX,
        clientY: e.changedTouches[0].clientY
      });
      chartDiv.dispatchEvent(event);
    });
  }
}

/**
 * Render hourly snowfall chart
 */
function renderHourlyChart(data) {
  if (data.length === 0) {
    document.getElementById('hourlyChart').innerHTML = '<div class="loading">Ingen data tillgänglig</div>';
    return;
  }

  const isMobile = isMobileDevice();

  const hours = data.map(d => {
    const date = new Date(d.timestamp);
    const hour = date.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit' });
    return `kl ${hour}`;
  });
  const snowfall = data.map(d => d.snowfall);

  // Calculate total accumulated snowfall
  const totalSnowfall = data.reduce((sum, d) => sum + d.snowfall, 0);

  // Update HTML title
  const chartTitleElement = document.querySelector('#hourlyChart').previousElementSibling;
  if (chartTitleElement && chartTitleElement.classList.contains('chart-title')) {
    chartTitleElement.textContent = `Senaste 24 timmarna: ${totalSnowfall.toFixed(1)}cm`;
  }

  const trace = {
    x: hours,
    y: snowfall,
    type: 'bar',
    marker: {
      color: '#e74c3c',
      line: {
        color: '#c0392b',
        width: 1
      }
    },
    name: 'Snöfall (cm)',
    hovertemplate: isMobile ? '%{y:.1f} cm<br>%{x}<extra></extra>' : undefined
  };

  const layout = {
    title: {
      text: '',
      font: { size: 16 }
    },
    xaxis: {
      title: 'Tid',
      tickangle: -45
    },
    yaxis: {
      title: 'Snöfall (cm)'
    },
    margin: { l: 60, r: 20, t: 20, b: 80 },
    responsive: true,
    displayModeBar: false,
    hovermode: isMobile ? 'closest' : 'x unified',
    dragmode: isMobile ? false : 'zoom'
  };

  const config = {
    responsive: true,
    displayModeBar: false,
    staticPlot: isMobile, // Disable all interactions on mobile except tooltips
    modeBarButtonsToRemove: ['pan2d', 'select2d', 'lasso2d', 'zoom2d', 'zoomIn2d', 'zoomOut2d', 'autoScale2d', 'resetScale2d']
  };

  Plotly.newPlot('hourlyChart', [trace], layout, config);

  // Add mobile-specific event handling
  if (isMobile) {
    const chartDiv = document.getElementById('hourlyChart');
    chartDiv.addEventListener('touchstart', function(e) {
      // Prevent default touch behavior that might cause zooming
      e.preventDefault();
    }, { passive: false });

    // Add tap-to-show-tooltip functionality
    chartDiv.addEventListener('touchend', function(e) {
      const rect = chartDiv.getBoundingClientRect();
      const x = e.changedTouches[0].clientX - rect.left;
      const y = e.changedTouches[0].clientY - rect.top;

      // Trigger hover event at touch position
      const event = new MouseEvent('mousemove', {
        clientX: e.changedTouches[0].clientX,
        clientY: e.changedTouches[0].clientY
      });
      chartDiv.dispatchEvent(event);
    });
  }
}

/**
 * Show error message
 */
function showError(elementId, message) {
  const element = document.getElementById(elementId);
  element.innerHTML = `<div class="error">${message}</div>`;
}

/**
 * Initialize application
 */
async function init() {
  try {
    // Load daily chart
    try {
      const dailyData = await fetchDailySnowfall();
      if (dailyData.length > 0) {
        renderDailyChart(dailyData);
      } else {
        showError('dailyChart', 'Ingen daglig data tillgänglig');
      }
    } catch (error) {
      showError('dailyChart', `Fel vid laddning av daglig data: ${error.message}`);
    }
    
    // Load hourly chart
    try {
      const hourlyData = await fetchLast24Hours();
      if (hourlyData.length > 0) {
        renderHourlyChart(hourlyData);
      } else {
        showError('hourlyChart', 'Ingen timdata tillgänglig');
      }
    } catch (error) {
      showError('hourlyChart', `Fel vid laddning av timdata: ${error.message}`);
      console.error('Hourly data error:', error);
    }
  } catch (error) {
    console.error('Initialization error:', error);
  }
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}

