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
 * Uses the exact same gradient as the legend: rgb(120, 60, 140) at 5 to rgb(245, 252, 255) at 30
 * Gradient stops match the CSS gradient-bar:
 *   0%: rgb(120, 60, 140)   - Purple (SLR 5)
 *   20%: rgb(30, 60, 120)   - Dark blue
 *   40%: rgb(70, 130, 180)  - Medium blue
 *   70%: rgb(135, 206, 250) - Light blue
 *   100%: rgb(245, 252, 255) - Ice blue (SLR 30)
 */
function getSnowColor(slr) {
  // Define gradient color stops matching the CSS gradient
  const gradientStops = [
    { percent: 0, color: [120, 60, 140] },      // Purple
    { percent: 20, color: [30, 60, 120] },      // Dark blue
    { percent: 40, color: [70, 130, 180] },     // Medium blue
    { percent: 70, color: [135, 206, 250] },    // Light blue
    { percent: 100, color: [245, 252, 255] }    // Ice blue
  ];

  // Clamp SLR to range [5, 30]
  const clampedSlr = Math.max(5, Math.min(30, slr));
  
  // Map SLR (5-30) to gradient percentage (0-100)
  const gradientPercent = ((clampedSlr - 5) / (30 - 5)) * 100;

  // Find the two color stops to interpolate between
  let startStop = gradientStops[0];
  let endStop = gradientStops[gradientStops.length - 1];
  
  for (let i = 0; i < gradientStops.length - 1; i++) {
    if (gradientPercent >= gradientStops[i].percent && gradientPercent <= gradientStops[i + 1].percent) {
      startStop = gradientStops[i];
      endStop = gradientStops[i + 1];
      break;
    }
  }

  // Interpolate between the two color stops
  const range = endStop.percent - startStop.percent;
  const factor = range > 0 ? (gradientPercent - startStop.percent) / range : 0;
  
  const r = Math.round(startStop.color[0] + factor * (endStop.color[0] - startStop.color[0]));
  const g = Math.round(startStop.color[1] + factor * (endStop.color[1] - startStop.color[1]));
  const b = Math.round(startStop.color[2] + factor * (endStop.color[2] - startStop.color[2]));
  
  return `rgb(${r}, ${g}, ${b})`;
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
    const response = await fetch('data/aggregated_data.csv');
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
 * Build shared series for daily and cumulative charts
 */
function prepareDailySeries(data, hourlyData = null) {
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

  // Identify rain days from CSV: days where snowfall_cm is negative (actual precipitation amount)
  const rainDays = new Set();
  data.forEach((row, index) => {
    const snowfallVal = parseFloat(row.snowfall_cm);
    if (snowfallVal < 0) {
      rainDays.add(index);
    }
  });

  // Replace today's value with calculated value from hourly data if available
  if (hourlyData && hourlyData.length > 0) {
    try {
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
          
          // If today has rain, mark it (snowfall < 0 or slr === -1)
          if (todayValue.snowfall < 0) {
            rainDays.add(todayIndex);
          }
          
          console.log(`Updated today's value: ${todayValue.snowfall.toFixed(1)} cm, SLR: ${todayValue.slr.toFixed(1)}`);
        } else {
          console.warn('Today not found in daily data. Today CET:', todayCET, 'Available dates:', data.slice(-5).map(r => getDateKeyInCET(new Date(r.date))));
        }
      } else {
        console.warn('No hourly data found for today since 8 AM');
      }
    } catch (error) {
      console.error('Error calculating today from hourly data:', error);
    }
  } else if (hourlyData) {
    console.warn('Hourly data not available for today calculation');
  }

  // Build cumulative snowfall (ignore rain/negative values)
  const cumulative = [];
  let runningTotal = 0;
  snowfall.forEach((val) => {
    const safeVal = val > 0 ? val : 0;
    runningTotal += safeVal;
    cumulative.push(Number(runningTotal.toFixed(1)));
  });

  return {
    labels,
    fullDates,
    snowfall,
    slrValues,
    rainDays,
    cumulative
  };
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
  if (!hourlyData || hourlyData.length === 0) {
    return null;
  }
  
  // Get current time and convert to CET timezone
  const now = new Date();
  const todayCET = getDateKeyInCET(now);
  const currentHourCET = getHourInCET(now);
  
  // Filter hourly data to only include hours from 8 AM today onwards (in CET)
  // Ensure we properly handle the timestamp - it might be a Date object or ISO string
  const todayHours = hourlyData.filter(hour => {
    if (!hour || !hour.timestamp) {
      return false;
    }
    
    // Ensure we have a proper Date object
    let hourDate;
    if (hour.timestamp instanceof Date) {
      hourDate = hour.timestamp;
    } else if (typeof hour.timestamp === 'string') {
      hourDate = new Date(hour.timestamp);
    } else {
      return false;
    }
    
    // Check if the date is valid
    if (isNaN(hourDate.getTime())) {
      return false;
    }
    
    // Convert to CET timezone for comparison
    const hourDateCET = getDateKeyInCET(hourDate);
    const hourHourCET = getHourInCET(hourDate);
    
    // Include if it's today (in CET) and hour is >= 8 (in CET)
    const isToday = hourDateCET === todayCET;
    const isAfter8 = hourHourCET >= 8;
    
    return isToday && isAfter8;
  });
  
  if (todayHours.length === 0) {
    console.log('No hours found for today since 8 AM. Today CET:', todayCET, 'Current hour CET:', currentHourCET, 'Hourly data range:', {
      first: hourlyData[0] ? getDateKeyInCET(new Date(hourlyData[0].timestamp)) + ' ' + getHourInCET(new Date(hourlyData[0].timestamp)) : 'N/A',
      last: hourlyData[hourlyData.length - 1] ? getDateKeyInCET(new Date(hourlyData[hourlyData.length - 1].timestamp)) + ' ' + getHourInCET(new Date(hourlyData[hourlyData.length - 1].timestamp)) : 'N/A'
    });
    return null;
  }
  
  // Check if it rained (any hour with negative amount or slr === -1)
  const hasRain = todayHours.some(hour => hour.snowfall < 0);
  
  // If it rained, return -1, -1
  if (hasRain) {
    return { snowfall: -1, slr: -1 };
  }
  
  // Sum snowfall amounts (filter out -1 values)
  const totalSnowfall = todayHours.reduce((sum, hour) => {
    const amount = hour.snowfall || 0;
    return amount >= 0 ? sum + amount : sum;
  }, 0);
  
  // Average SLR (only for hours with snowfall > 0)
  const hoursWithSnow = todayHours.filter(hour => hour.snowfall > 0);
  if (hoursWithSnow.length === 0) {
    return { snowfall: totalSnowfall, slr: 0 };
  }
  
  const avgSlr = hoursWithSnow.reduce((sum, hour) => sum + (hour.slr || 0), 0) / hoursWithSnow.length;
  
  return { snowfall: totalSnowfall, slr: avgSlr };
}

/**
 * Update subtitle with season info and total snowfall
 * @param {Object} series - The data series with cumulative and fullDates
 * @param {number|null} historicYear - If set, this is a historic season (start year)
 */
function updateSubtitle(series, historicYear = null) {
  const subtitleEl = document.getElementById('subtitle');
  if (!subtitleEl) return;

  const { cumulative, fullDates } = series;
  const totalSnow = cumulative[cumulative.length - 1] || 0;
  
  // Determine season from dates
  let seasonText;
  if (historicYear) {
    seasonText = `Säsongen ${historicYear}-${historicYear + 1}`;
  } else {
    // Current season - determine from first date
    if (fullDates && fullDates.length > 0) {
      const firstDate = new Date(fullDates[0]);
      const startYear = firstDate.getMonth() >= 6 ? firstDate.getFullYear() : firstDate.getFullYear() - 1;
      seasonText = `Säsongen ${startYear}-${startYear + 1}`;
    } else {
      const now = new Date();
      const startYear = now.getMonth() >= 6 ? now.getFullYear() : now.getFullYear() - 1;
      seasonText = `Säsongen ${startYear}-${startYear + 1}`;
    }
  }

  // Format text based on whether it's historic or current
  const snowText = `${Math.round(totalSnow)} cm`;
  if (historicYear) {
    subtitleEl.textContent = `${seasonText}: ${snowText} snö`;
  } else {
    subtitleEl.textContent = `${seasonText}: ${snowText} hittills`;
  }
}

/**
 * Render daily snowfall chart using Chart.js
 */
function renderDailyChart(series) {
  destroyChart(dailyChartInstance);

  const ctx = document.getElementById('dailyChart').getContext('2d');

  const { labels, fullDates, snowfall, slrValues, rainDays, cumulative } = series;

  // Create display data: rain as positive values (upward bars), snow as is
  const displayData = snowfall.map((val, index) => {
    if (rainDays.has(index)) {
      return Math.abs(val); // Show rain as positive value (upward bar)
    }
    return val;
  });

  // Colors: red for rain, snow color for positive values
  const colors = snowfall.map((val, index) => {
    if (rainDays.has(index)) {
      return 'rgba(220, 53, 69, 0.8)'; // Red for rain
    }
    return getSnowColor(slrValues[index]);
  });

  dailyChartInstance = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [
        {
          label: 'Snöfall / Regn',
          data: displayData,
          backgroundColor: colors,
          borderColor: colors,
          borderWidth: 1,
          custom: { slrValues, rainDays, snowfall }, // Keep original snowfall for tooltips
          yAxisID: 'snow'
        },
        {
          type: 'line',
          label: 'Kumulativt snöfall',
          data: cumulative,
          borderColor: 'rgba(118, 75, 162, 0.9)',
          backgroundColor: 'rgba(118, 75, 162, 0.1)',
          tension: 0.2,
          pointRadius: 0,
          borderWidth: 2,
          fill: true,
          yAxisID: 'depth'
        }
      ]
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
                    title: (context) => fullDates[context[0].dataIndex],
                    label: (context) => {
                        const dataset = context.dataset;
                        if (dataset.yAxisID === 'depth') {
                            return `Totalt: ${context.parsed.y.toFixed(1)} cm`;
                        }

                        const dataIndex = context.dataIndex;
                        const { slrValues, rainDays, snowfall } = dataset.custom;
                        
                        if (rainDays.has(dataIndex)) {
                            // Show rain amount in mm (original negative value is precipitation in mm)
                            const rainMm = Math.abs(snowfall[dataIndex]);
                            return `☠️ Regn: ${rainMm.toFixed(1)} mm - snön är förstörd!`;
                        }
                        
                        const cm = context.parsed.y.toFixed(1);
                        const slr = slrValues[dataIndex];
                        const slrStr = slr === -1 ? '-1' : slr.toFixed(1);
                        
                        if (window.innerWidth < 768) {
                            return `Snöfall: ${cm} cm`;
                        }
                        
                        return [
                            `Snöfall: ${cm} cm`,
                            `Fluffighet (SLR): ${slrStr}`
                        ];
                    }
                }
            }
        },
        scales: {
            snow: {
                type: 'linear',
                position: 'left',
                title: {
                    display: true,
                    text: 'Snöfall / Regn (cm)'
                },
                beginAtZero: true
            },
            depth: {
                type: 'linear',
                position: 'right',
                title: {
                    display: true,
                    text: 'Kumulativt snöfall (cm)'
                },
                grid: {
                    drawOnChartArea: false
                },
                beginAtZero: true
            },
            x: {
                title: {
                    display: false
                },
                ticks: {
                    maxRotation: 0,
                    minRotation: 0,
                    autoSkip: false
                },
                grid: {
                    display: false
                }
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
 * Render cumulative snowfall line chart
 */
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
  
  // Identify rain hours: hours where snowfall is negative
  const rainHours = new Set();
  data.forEach((hour, index) => {
    if (hour.snowfall < 0) {
      rainHours.add(index);
    }
  });
  
  // Colors: red for rain (negative values), snow color for positive values
  const colors = snowfall.map((val, index) => {
    if (val < 0) {
      return 'rgba(220, 53, 69, 0.8)'; // Red for rain
    }
    return getSnowColor(slrValues[index]);
  });

  // Exclude negative values from total snowfall calculation
  const totalSnowfall = snowfall.reduce((sum, d) => d >= 0 ? sum + d : sum, 0);

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
        label: 'Snöfall / Regn',
        data: snowfall,
        backgroundColor: colors,
        borderColor: colors,
        borderWidth: 1,
        // Store SLR values and rain hours in custom field for tooltips
        custom: { slrValues, rainHours }
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
                        // Visa timintervallet (t.ex. "10-11" istället för bara "10")
                        const dataIndex = context[0].dataIndex;
                        const hourData = data[dataIndex];
                        if (hourData && hourData.timestamp) {
                            const date = new Date(hourData.timestamp);
                            const hour = date.toLocaleString('sv-SE', { 
                                timeZone: 'Europe/Stockholm', 
                                hour: '2-digit', 
                                hourCycle: 'h23' 
                            });
                            const nextHour = new Date(date);
                            nextHour.setHours(nextHour.getHours() + 1);
                            const nextHourStr = nextHour.toLocaleString('sv-SE', { 
                                timeZone: 'Europe/Stockholm', 
                                hour: '2-digit', 
                                hourCycle: 'h23' 
                            });
                            return `kl ${hour}-${nextHourStr}`;
                        }
                        return context[0].label;
                    },
                    label: (context) => {
                        const dataIndex = context.dataIndex;
                        const { slrValues, rainHours } = context.dataset.custom;
                        
                        if (rainHours.has(dataIndex)) {
                            // Rain hour - show rain message
                            return '☠️ Regn - snön är förstörd!';
                        }
                        
                        const cm = context.parsed.y.toFixed(1);
                        const slr = slrValues[dataIndex];
                        const slrStr = slr === -1 ? '-1' : slr.toFixed(1);
                        
                        if (window.innerWidth < 768) {
                            return `Snöfall: ${cm} cm`;
                        }
                        
                        return [
                            `Snöfall: ${cm} cm`,
                            `Fluffighet (SLR): ${slrStr}`
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
                beginAtZero: false // Allow negative values for rain
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
      const dailySeries = prepareDailySeries(dailyData, hourlyData);
      renderDailyChart(dailySeries);
      updateSubtitle(dailySeries);
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