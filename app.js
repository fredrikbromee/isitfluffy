// SMHI API configuration - loaded from shared file
// Note: In browser, smhi_api.js must be loaded before app.js

/**
 * Interpolate between two colors with exponential curve for more dramatic transitions
 * @param {number} value - Current value
 * @param {number} min - Range minimum
 * @param {number} max - Range maximum
 * @param {Array} color1 - Start color [r, g, b]
 * @param {Array} color2 - End color [r, g, b]
 * @param {number} curve - Curve factor (1 = linear, >1 = more dramatic)
 */
function interpolateColor(value, min, max, color1, color2, curve = 1.5) {
  let factor = Math.max(0, Math.min(1, (value - min) / (max - min)));
  // Apply exponential curve for more dramatic transitions
  factor = Math.pow(factor, 1 / curve);
  const r = Math.round(color1[0] + factor * (color2[0] - color1[0]));
  const g = Math.round(color1[1] + factor * (color2[1] - color1[1]));
  const b = Math.round(color1[2] + factor * (color2[2] - color1[2]));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Get color based on snow fluffiness (SLR)
 * Gradient: Purple (wet/heavy snow) -> Dark blue -> Icy white-blue (dry/fluffy snow)
 * Purple tones for wet snow, transitioning to blue as snow gets drier
 */
function getSnowColor(slr) {
  // Define color points - purple to dark blue to icy white-blue
  const cPurple = [120, 60, 140];       // Purple for very wet/heavy snow (low SLR)
  const cDarkBlue = [30, 60, 120];      // Dark blue for wet/heavy snow
  const cMediumBlue = [70, 130, 180];   // Medium blue
  const cLightBlue = [135, 206, 250];   // Light blue (sky blue)
  const cIceBlue = [245, 252, 255];     // Very white/icy for dry/fluffy snow (high SLR) - even whiter

  if (slr < 5) return `rgb(${cPurple.join(',')})`; // Very wet/heavy - purple
  if (slr >= 30) return `rgb(${cIceBlue.join(',')})`; // Extremely dry/fluffy

  // Smooth gradient from purple through blue to icy white-blue
  if (slr < 8) {
    // 5-8: Purple -> Dark blue
    return interpolateColor(slr, 5, 8, cPurple, cDarkBlue, 1.2);
  } else if (slr < 12) {
    // 8-12: Dark blue -> Medium blue
    return interpolateColor(slr, 8, 12, cDarkBlue, cMediumBlue, 1.2);
  } else if (slr < 22) {
    // 12-22: Medium blue -> Light blue
    return interpolateColor(slr, 12, 22, cMediumBlue, cLightBlue, 1.2);
  } else {
    // 22-30: Light blue -> Icy white-blue
    return interpolateColor(slr, 22, 30, cLightBlue, cIceBlue, 1.5);
  }
}

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
 * Shows the last 24 hours for which we have data, not a fixed window from now
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
    
    // Organize data by timestamp and find the most recent hour with data
    const dataByTime = {};
    let latestHourWithData = null;
    
    for (const { key, data } of results) {
      if (data && data.value && Array.isArray(data.value)) {
        for (const entry of data.value) {
          // Use shared parsing function
          const parsed = parseSMHIEntry(entry);
          if (!parsed) {
            continue;
          }
          
          // Round to nearest hour for consistent grouping
          const hourTimestamp = new Date(parsed.timestamp);
          hourTimestamp.setMinutes(0, 0, 0);
          const timeKey = hourTimestamp.toISOString();
          
          if (!dataByTime[timeKey]) {
            dataByTime[timeKey] = { timestamp: hourTimestamp };
          }
          dataByTime[timeKey][key] = parsed.value;
          
          // Track the latest hour that has at least temperature data
          if (key === 'temperature' && (!latestHourWithData || hourTimestamp > latestHourWithData)) {
            latestHourWithData = hourTimestamp;
          }
        }
      }
    }
    
    // If we found data, use the latest hour as the end point
    // Otherwise, fall back to current time
    const endTime = latestHourWithData || new Date();
    endTime.setMinutes(0, 0, 0);
    
    // Create complete 24-hour array ending at the latest hour with data
    const hourlyData = [];
    const startTime = new Date(endTime);
    startTime.setHours(startTime.getHours() - 23); // Start 23 hours before to get 24 hours total
    
    for (let i = 0; i < 24; i++) {
      const hourTime = new Date(startTime);
      hourTime.setHours(startTime.getHours() + i);
      const timeKey = hourTime.toISOString();
      
      const data = dataByTime[timeKey];
      if (data && data.temperature !== undefined) {
        // We have data for this hour, use it (precipitation might be 0 or undefined)
        const precipitation = data.precipitation !== undefined ? data.precipitation : 0;
        const snowCalc = calculateSnowfall(
          data.temperature,
          precipitation,
          data.wind_speed || 0,
          data.humidity || 90
        );
        
        hourlyData.push({
          timestamp: hourTime,
          temperature: data.temperature,
          precipitation: precipitation,
          snowfall: snowCalc.amount,
          slr: snowCalc.slr
        });
      } else {
        // Missing hour - fill with zero values
        hourlyData.push({
          timestamp: hourTime,
          temperature: null,
          precipitation: 0,
          snowfall: 0,
          slr: 0
        });
      }
    }

    return hourlyData;
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
  const slrValues = data.map(row => parseFloat(row.slr) || 0);
  const colors = slrValues.map(slr => getSnowColor(slr));

  const isMobile = isMobileDevice();

  const trace = {
    x: dates,
    y: snowfall,
    type: 'bar',
    marker: {
      color: colors,
      line: {
        color: colors.map(c => c.replace('rgb', 'rgba').replace(')', ', 0.8)')), // Slightly darker/alpha border
        width: 1
      }
    },
    name: 'Snöfall (cm)',
    customdata: slrValues.map(slr => slr.toFixed(1)), // SLR values for tooltip only
    hovertemplate: isMobile 
      ? '%{y:.1f} cm<br>%{x}<extra></extra>' 
      : 'Snöfall: %{y:.1f} cm<br>%{x}<br>Fluffighet (SLR): %{customdata}<extra></extra>'
  };

  const layout = {
    title: {
      text: '',
      font: { size: 16 }
    },
    xaxis: {
      type: 'date'
    },
    yaxis: {
      title: 'Snöfall (cm)'
    },
    margin: { l: 60, r: 20, t: 20, b: 60 },
    responsive: true,
    displayModeBar: false,
    hovermode: isMobile ? 'closest' : 'closest', // Changed to closest for better tooltip control with colored bars
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
  const colors = data.map(d => getSnowColor(d.slr));

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
      color: colors,
      line: {
        color: colors.map(c => c.replace('rgb', 'rgba').replace(')', ', 0.8)')), // Slightly darker/alpha border
        width: 1
      }
    },
    name: 'Snöfall (cm)',
    customdata: data.map(d => d.slr.toFixed(1)), // SLR values for tooltip only
    hovertemplate: isMobile 
      ? '%{y:.1f} cm<br>%{x}<extra></extra>' 
      : 'Snöfall: %{y:.1f} cm<br>%{x}<br>Fluffighet (SLR): %{customdata}<extra></extra>'
  };

  const layout = {
    title: {
      text: '',
      font: { size: 16 }
    },
    xaxis: {
      tickangle: -45
    },
    yaxis: {
      title: 'Snöfall (cm)'
    },
    margin: { l: 60, r: 20, t: 20, b: 80 },
    responsive: true,
    displayModeBar: false,
    hovermode: isMobile ? 'closest' : 'closest', // Changed to closest for better tooltip control with colored bars
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
