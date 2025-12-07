// SMHI API configuration - loaded from shared file
// Note: In browser, smhi_api.js must be loaded before app.js

let dailyChartInstance = null;
let hourlyChartInstance = null;

// --- [ COLOR LOGIC - KEPT AS IS ] ---

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
  const g = Math.round(color1[1] + factor * (color2[1] - color2[1]));
  const b = Math.round(color1[2] + factor * (color2[2] - color1[2]));
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Get color based on snow fluffiness (SLR)
 * Gradient: Purple (wet/heavy snow) -> Dark blue -> Icy white-blue (dry/fluffy snow)
 */
function getSnowColor(slr) {
  // Define color points - purple to dark blue to icy white-blue
  const cPurple = [120, 60, 140];
  const cDarkBlue = [30, 60, 120];
  const cMediumBlue = [70, 130, 180];
  const cLightBlue = [135, 206, 250];
  const cIceBlue = [245, 252, 255];

  if (slr < 5) return `rgb(${cPurple.join(',')})`;
  if (slr >= 30) return `rgb(${cIceBlue.join(',')})`;

  if (slr < 8) {
    return interpolateColor(slr, 5, 8, cPurple, cDarkBlue, 1.2);
  } else if (slr < 12) {
    return interpolateColor(slr, 8, 12, cDarkBlue, cMediumBlue, 1.2);
  } else if (slr < 22) {
    return interpolateColor(slr, 12, 22, cMediumBlue, cLightBlue, 1.2);
  } else {
    return interpolateColor(slr, 22, 30, cLightBlue, cIceBlue, 1.5);
  }
}

// --- [ DATA FETCHING LOGIC - KEPT AS IS ] ---

function parseCSV(csvText) {
  // ... (Code for parseCSV remains the same)
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

async function fetchDailySnowfall() {
  // ... (Code for fetchDailySnowfall remains the same)
  try {
    const response = await fetch('data/snowfall_daily.csv');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const csvText = await response.text();
    const data = parseCSV(csvText);

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

async function fetchSMHIDataBrowser(parameter, stationId, period = 'latest-day') {
  // ... (Code for fetchSMHIDataBrowser remains the same)
  try {
    return await fetchSMHIData(parameter, stationId, period);
  } catch (error) {
    console.error(`Error fetching parameter ${parameter} (station ${stationId}, period ${period}):`, error);
    throw error;
  }
}

async function fetchLast24Hours() {
  // ... (Code for fetchLast24Hours remains the same)
  try {
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

    const dataByTime = {};
    let latestHourWithData = null;

    for (const { key, data } of results) {
      if (data && data.value && Array.isArray(data.value)) {
        for (const entry of data.value) {
          const parsed = parseSMHIEntry(entry);
          if (!parsed) {
            continue;
          }

          const hourTimestamp = new Date(parsed.timestamp);
          hourTimestamp.setMinutes(0, 0, 0);
          const timeKey = hourTimestamp.toISOString();

          if (!dataByTime[timeKey]) {
            dataByTime[timeKey] = { timestamp: hourTimestamp };
          }
          dataByTime[timeKey][key] = parsed.value;

          if (key === 'temperature' && (!latestHourWithData || hourTimestamp > latestHourWithData)) {
            latestHourWithData = hourTimestamp;
          }
        }
      }
    }

    const endTime = latestHourWithData || new Date();
    endTime.setMinutes(0, 0, 0);

    const hourlyData = [];
    const startTime = new Date(endTime);
    startTime.setHours(startTime.getHours() - 23);

    for (let i = 0; i < 24; i++) {
      const hourTime = new Date(startTime);
      hourTime.setHours(startTime.getHours() + i);
      const timeKey = hourTime.toISOString();

      const data = dataByTime[timeKey];
      if (data && data.temperature !== undefined) {
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

// --- [ CHART.JS RENDERING LOGIC ] ---

/**
 * Destroy existing chart instance if it exists
 * @param {Chart} instance
 */
function destroyChart(instance) {
    if (instance) {
        instance.destroy();
    }
}

/**
 * Get Swedish month abbreviation
 */
function getSwedishMonthAbbr(date) {
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'maj', 'jun', 
                      'jul', 'aug', 'sep', 'okt', 'nov', 'dec'];
  return monthNames[date.getMonth()];
}

/**
 * Get date string in CET timezone for day grouping
 */
function getDateKeyInCET(date) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date);
}

/**
 * Get hour in CET timezone
 */
function getHourInCET(date) {
  const formatter = new Intl.DateTimeFormat('en', {
    timeZone: 'Europe/Stockholm',
    hour: 'numeric',
    hourCycle: 'h23'
  });
  return parseInt(formatter.format(date));
}

/**
 * Calculate today's value from hourly data (since 8 AM CET)
 */
function calculateTodayFromHourly(hourlyData) {
  const now = new Date();
  const todayCET = getDateKeyInCET(now);
  const currentHourCET = getHourInCET(now);
  
  // Filter hourly data to only include hours from 8 AM today onwards
  const todayHours = hourlyData.filter(hour => {
    const hourDate = new Date(hour.timestamp);
    const hourDateCET = getDateKeyInCET(hourDate);
    const hourHourCET = getHourInCET(hourDate);
    
    // Include if it's today and hour is >= 8
    return hourDateCET === todayCET && hourHourCET >= 8;
  });
  
  if (todayHours.length === 0) {
    return null;
  }
  
  // Sum snowfall amounts
  const totalSnowfall = todayHours.reduce((sum, hour) => sum + (hour.snowfall || 0), 0);
  
  // Average SLR (only for hours with snowfall > 0)
  const hoursWithSnow = todayHours.filter(hour => hour.snowfall > 0);
  if (hoursWithSnow.length === 0) {
    return { snowfall: totalSnowfall, slr: 0 };
  }
  
  const avgSlr = hoursWithSnow.reduce((sum, hour) => sum + (hour.slr || 0), 0) / hoursWithSnow.length;
  
  return { snowfall: totalSnowfall, slr: avgSlr };
}

/**
 * Render daily snowfall chart using Chart.js
 */
function renderDailyChart(data, hourlyData = null) {
  destroyChart(dailyChartInstance);

  const ctx = document.getElementById('dailyChart').getContext('2d');
  
  // Group data by month and find middle index for each month
  const monthGroups = {};
  data.forEach((row, index) => {
    const date = new Date(row.date);
    const monthKey = `${date.getFullYear()}-${date.getMonth()}`;
    if (!monthGroups[monthKey]) {
      monthGroups[monthKey] = { indices: [], monthAbbr: getSwedishMonthAbbr(date) };
    }
    monthGroups[monthKey].indices.push(index);
  });
  
  // Create labels array - only show month abbreviation at middle of each month
  const labels = new Array(data.length).fill('');
  Object.values(monthGroups).forEach(group => {
    if (group.indices.length > 0) {
      const middleIndex = group.indices[Math.floor(group.indices.length / 2)];
      labels[middleIndex] = group.monthAbbr;
    }
  });
  
  const fullDates = data.map(row => row.date); // Keep for tooltips
  let snowfall = data.map(row => parseFloat(row.snowfall_cm) || 0);
  let slrValues = data.map(row => parseFloat(row.slr) || 0);
  
  // Replace today's value with calculated value from hourly data if available
  if (hourlyData && hourlyData.length > 0) {
    const todayValue = calculateTodayFromHourly(hourlyData);
    if (todayValue) {
      const todayCET = getDateKeyInCET(new Date());
      
      // Find today's index in the daily data
      const todayIndex = data.findIndex(row => {
        const rowDate = new Date(row.date);
        const rowDateCET = getDateKeyInCET(rowDate);
        return rowDateCET === todayCET;
      });
      
      if (todayIndex !== -1) {
        // Replace today's values
        snowfall[todayIndex] = todayValue.snowfall;
        slrValues[todayIndex] = todayValue.slr;
      }
    }
  }
  
  const colors = slrValues.map(slr => getSnowColor(slr));

  dailyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Snöfall (cm)',
        data: snowfall,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
        // Lägg SLR-data i 'custom' fältet för Tooltips
        custom: slrValues 
      }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false, // Låter Chart.js ta container-storleken
        plugins: {
            legend: {
                display: false // Tar bort Chart.js legend, vi har en egen
            },
            tooltip: {
                // Konfigurera Tooltip för touch-enheter
                mode: 'index',
                intersect: false,
                callbacks: {
                    title: (context) => {
                        // Visa fullt datum i tooltip
                        return fullDates[context[0].dataIndex];
                    },
                    label: (context) => {
                        const cm = context.parsed.y.toFixed(1);
                        const slr = context.dataset.custom[context.dataIndex].toFixed(1);
                        
                        // Förenklad tooltip på mobil - Chart.js hanterar touch bra
                        if (window.innerWidth < 768) {
                            return `Snöfall: ${cm} cm`;
                        }
                        
                        return [
                            `Snöfall: ${cm} cm`,
                            `Fluffighet (SLR): ${slr}`
                        ];
                    }
                }
            }
        },
        scales: {
            x: {
                title: {
                    display: false
                },
                // Show labels (empty strings will be automatically skipped by Chart.js)
                ticks: {
                    maxRotation: 0, // Month abbreviations are short, no rotation needed
                    minRotation: 0,
                    autoSkip: false // Don't auto-skip - we control which labels to show
                },
                grid: {
                    display: false
                }
            },
            y: {
                title: {
                    display: true,
                    text: 'Snöfall (cm)'
                },
                beginAtZero: true
            }
        }
    }
  });

  // Ta bort laddningsmeddelandet efter att grafen har ritats
  const loadingElement = document.querySelector('#dailyChart').nextElementSibling;
  if (loadingElement && loadingElement.classList.contains('loading')) {
    loadingElement.style.display = 'none';
  }
}

/**
 * Render hourly snowfall chart using Chart.js
 */
function renderHourlyChart(data) {
  destroyChart(hourlyChartInstance);
  
  if (data.length === 0) {
    showError('hourlyChart', 'Ingen data tillgänglig');
    return;
  }
  
  const ctx = document.getElementById('hourlyChart').getContext('2d');
  
  const hours = data.map(d => {
    const date = new Date(d.timestamp);
    // Formatera som 'kl 08' etc.
    return date.toLocaleString('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', hourCycle: 'h23' });
  });
  
  const snowfall = data.map(d => d.snowfall);
  const slrValues = data.map(d => d.slr);
  const colors = slrValues.map(slr => getSnowColor(slr));

  const totalSnowfall = snowfall.reduce((sum, d) => sum + d, 0);

  // Uppdatera HTML-titeln
  const chartTitleElement = document.querySelector('#hourlyChart').previousElementSibling;
  if (chartTitleElement && chartTitleElement.classList.contains('chart-title')) {
    chartTitleElement.textContent = `Senaste 24 timmarna: ${totalSnowfall.toFixed(1)} cm`;
  }
  
  hourlyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: hours,
      datasets: [{
        label: 'Snöfall (cm)',
        data: snowfall,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
        custom: slrValues
      }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
            legend: {
                display: false
            },
            tooltip: {
                mode: 'index',
                intersect: false,
                callbacks: {
                    title: (context) => {
                        return context[0].label;
                    },
                    label: (context) => {
                        const cm = context.parsed.y.toFixed(1);
                        const slr = context.dataset.custom[context.dataIndex].toFixed(1);
                        
                        if (window.innerWidth < 768) {
                            return `Snöfall: ${cm} cm`;
                        }
                        
                        return [
                            `Snöfall: ${cm} cm`,
                            `Fluffighet (SLR): ${slr}`
                        ];
                    }
                }
            }
        },
        scales: {
            x: {
                title: {
                    display: false
                },
                // Rotera etiketter för 24-timmarsvy på mobil
                ticks: {
                    maxRotation: 45,
                    minRotation: 45,
                    // Auto-skip är bra här, men vi har bara 24 etiketter
                    autoSkip: true,
                    maxTicksLimit: 12 // Visa varannan timme på mobil
                },
                grid: {
                    display: false
                }
            },
            y: {
                title: {
                    display: true,
                    text: 'Snöfall (cm)'
                },
                beginAtZero: true
            }
        }
    }
  });

  // Ta bort laddningsmeddelandet
  const loadingElement = document.querySelector('#hourlyChart').nextElementSibling;
  if (loadingElement && loadingElement.classList.contains('loading')) {
    loadingElement.style.display = 'none';
  }
}

// --- [ INITIALIZATION LOGIC - KEPT AS IS ] ---

/**
 * Show error message
 */
function showError(elementId, message) {
  const element = document.getElementById(elementId).parentElement; // Gå upp till chart-container
  if (element) {
      element.innerHTML = `<div class="chart-title">${element.querySelector('.chart-title').textContent}</div><div class="error">${message}</div>`;
  }
}

/**
 * Initialize application
 */
async function init() {
  // Låt loading meddelandet visas i chart-container till data laddats
  
  // Load hourly chart first (needed for today's calculation)
  let hourlyData = null;
  try {
    hourlyData = await fetchLast24Hours();
    if (hourlyData.length > 0) {
      renderHourlyChart(hourlyData);
    } else {
      showError('hourlyChart', 'Ingen timdata tillgänglig');
    }
  } catch (error) {
    showError('hourlyChart', `Fel vid laddning av timdata: ${error.message}`);
    console.error('Hourly data error:', error);
  }
  
  // Load daily chart (pass hourly data to calculate today's value)
  try {
    const dailyData = await fetchDailySnowfall();
    if (dailyData.length > 0) {
      renderDailyChart(dailyData, hourlyData);
    } else {
      showError('dailyChart', 'Ingen daglig data tillgänglig');
    }
  } catch (error) {
    showError('dailyChart', `Fel vid laddning av daglig data: ${error.message}`);
  }
}

// Initialize when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}