const fs = require('fs');
const path = require('path');
const { calculateSnowfall } = require('./snowfall.js');
const { addAccumulatedSnowfall } = require('./accumulation.js');
const { STATION_ID, PARAMETER_CODES, parseSMHITimestamp, parseSMHIEntry, fetchSMHIData } = require('./smhi_api.js');

const DATA_DIR = path.join(__dirname, 'data');
const WEATHER_DATA_FILE = path.join(DATA_DIR, 'weather_data.csv');
const AGGREGATED_DATA_FILE = path.join(DATA_DIR, 'aggregated_data.csv');

// fetchSMHIData is now in smhi_api.js (shared)

/**
 * Fetch historical data from SMHI API for a specific parameter and date range
 * SMHI API supports 'latest-months' period which gives several months of data
 */
async function fetchSMHIHistoricalData(parameter, stationId, startDate) {
  // Try latest-months first, which typically gives 3-6 months of data
  try {
    const data = await fetchSMHIData(parameter, stationId, 'latest-months');
    
    // Filter data to only include entries from startDate onwards
    if (data && data.value && Array.isArray(data.value)) {
      const startTimestamp = new Date(startDate).getTime();
      data.value = data.value.filter(entry => {
        const entryTime = entry.from || entry.date || entry.dateTime;
        if (typeof entryTime === 'number') {
          return entryTime >= startTimestamp;
        }
        // If it's a date string, parse it
        const entryDate = new Date(entryTime);
        return entryDate >= new Date(startDate);
      });
    }
    
    return data;
  } catch (error) {
    // Fallback to latest-day if latest-months fails
    console.warn(`Failed to fetch parameter ${parameter} with latest-months, trying latest-day: ${error.message}`);
    try {
      return await fetchSMHIData(parameter, stationId, 'latest-day');
    } catch (fallbackError) {
      // If latest-day also fails, throw to be handled by caller
      throw fallbackError;
    }
  }
}

/**
 * Convert Date object to ISO string for CSV storage
 */
function dateToISOString(date) {
  return date ? date.toISOString() : null;
}

/**
 * Initialize CSV files with headers if they don't exist
 */
function initializeCSVFiles() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  // Initialize weather_data.csv
  if (!fs.existsSync(WEATHER_DATA_FILE)) {
    const header = 'timestamp,temperature,precipitation,wind_direction,wind_speed,humidity,visibility\n';
    fs.writeFileSync(WEATHER_DATA_FILE, header);
  }

  // Initialize aggregated_data.csv
  if (!fs.existsSync(AGGREGATED_DATA_FILE)) {
    const header = 'date,snowfall_cm,slr,temp_max,temp_min,humidity_avg,accumulated_snowfall_cm\n';
    fs.writeFileSync(AGGREGATED_DATA_FILE, header);
  }
}

/**
 * Get existing data from CSV to avoid duplicates
 */
function getExistingTimestamps() {
  if (!fs.existsSync(WEATHER_DATA_FILE)) {
    return new Set();
  }
  
  const content = fs.readFileSync(WEATHER_DATA_FILE, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header
  const timestamps = new Set();
  
  for (const line of lines) {
    if (line.trim()) {
      const timestamp = line.split(',')[0];
      timestamps.add(timestamp);
    }
  }
  
  return timestamps;
}

/**
 * Fetch hourly data for the last 24-48 hours to ensure we capture the full day
 */
async function fetchHourlyData() {
  const existingTimestamps = getExistingTimestamps();
  const hourlyData = [];
  
  // Fetch data for each parameter - use 'latest-day' to get more data
  const parameterPromises = Object.entries(PARAMETER_CODES).map(async ([key, code]) => {
    try {
      // Try latest-day first, fallback to latest-hour if needed
      let data = null;
      try {
        data = await fetchSMHIData(code, STATION_ID, 'latest-day');
      } catch (error) {
        // Try latest-hour as fallback
        try {
          data = await fetchSMHIData(code, STATION_ID, 'latest-hour');
        } catch (fallbackError) {
          // Parameter not available for this period
          console.error(`Failed to fetch ${key} (parameter ${code}): ${fallbackError.message}`);
          return { key, data: null };
        }
      }
      return { key, data };
      } catch (error) {
        // Parameter not available
        console.error(`Failed to fetch ${key} (parameter ${code}): ${error.message}`);
        return { key, data: null };
      }
  });
  
  const results = await Promise.all(parameterPromises);
  
  // Organize data by timestamp
  const dataByTime = {};
  
  for (const { key, data } of results) {
    if (data && data.value && Array.isArray(data.value)) {
      for (const entry of data.value) {
        // Use shared parsing function (now handles all timestamp formats)
        const parsed = parseSMHIEntry(entry);
        
        if (!parsed) {
          // If parsing fails, log a warning with entry details for debugging
          console.warn(`Failed to parse entry for ${key}, skipping:`, JSON.stringify(entry));
          continue;
        }
        
        if (parsed && parsed.timestamp) {
          // Validate that timestamp is a valid Date object (should already be validated in parseSMHIEntry)
          if (!(parsed.timestamp instanceof Date) || isNaN(parsed.timestamp.getTime())) {
            console.error(`Invalid timestamp for ${key} after parsing, skipping entry:`, entry);
            continue;
          }
          
          const timestampISO = parsed.timestamp.toISOString();
          if (!dataByTime[timestampISO]) {
            dataByTime[timestampISO] = {};
          }
          dataByTime[timestampISO][key] = parsed.value;
        }
      }
    }
  }
  
  // Convert to array and filter out existing timestamps
  for (const [timestamp, values] of Object.entries(dataByTime)) {
    // Only include records that have at least temperature and precipitation
    if (timestamp && !existingTimestamps.has(timestamp) && 
        values.temperature !== undefined && values.precipitation !== undefined) {
      hourlyData.push({
        timestamp,
        ...values
      });
    }
  }
  
  return hourlyData;
}

/**
 * Append hourly data to weather_data.csv
 */
function appendHourlyData(hourlyData) {
  if (hourlyData.length === 0) {
    console.log('No new hourly data to append');
    return;
  }
  
  const lines = hourlyData.map(data => {
    return [
      data.timestamp || '',
      data.temperature ?? '',
      data.precipitation ?? '',
      data.wind_direction ?? '',
      data.wind_speed ?? '',
      data.humidity ?? '',
      data.visibility ?? ''
    ].join(',');
  });
  
  fs.appendFileSync(WEATHER_DATA_FILE, lines.join('\n') + '\n');
  console.log(`Appended ${hourlyData.length} new hourly records`);
}

/**
 * Get hour in CET timezone (handles both CET and CEST)
 * CET is UTC+1, CEST is UTC+2 (last Sunday in March to last Sunday in October)
 */
function getHourInCET(date) {
  // Use Intl.DateTimeFormat to get time in Europe/Stockholm timezone (CET/CEST)
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Europe/Stockholm',
    hour: '2-digit',
    hour12: false
  });
  return parseInt(formatter.format(date));
}

/**
 * Get date string in CET timezone for day grouping
 */
function getDateKeyInCET(date) {
  // Use Intl.DateTimeFormat to get date in Europe/Stockholm timezone (CET/CEST)
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Stockholm',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  return formatter.format(date); // Returns YYYY-MM-DD format
}

/**
 * Calculate daily snowfall totals from hourly data
 */
function calculateDailySnowfall() {
  if (!fs.existsSync(WEATHER_DATA_FILE)) {
    console.log('No weather data file found');
    return;
  }
  
  const content = fs.readFileSync(WEATHER_DATA_FILE, 'utf-8');
  const lines = content.trim().split('\n').slice(1); // Skip header
  
  // Group by day (8 AM CET - 8 AM CET next day)
  const dailyTotals = {};
  
  for (const line of lines) {
    if (!line.trim()) continue;
    
    const [timestamp, temp, precip, windDir, windSpeed, humidity, visibility] = line.split(',');
    const temperature = parseFloat(temp);
    const precipitation = parseFloat(precip);
    const wind = parseFloat(windSpeed) || 0; // Default to 0 if missing
    const hum = parseFloat(humidity) || 90; // Default to 90% if missing
    
    if (isNaN(temperature) || isNaN(precipitation)) continue;
    
    // Parse timestamp and determine which day it belongs to (8 AM CET - 8 AM CET next day)
    const date = new Date(timestamp);
    const hourCET = getHourInCET(date);
    
    // If before 8 AM CET, it belongs to previous day
    let dayKey;
    if (hourCET < 8) {
      const prevDay = new Date(date);
      prevDay.setDate(prevDay.getDate() - 1);
      dayKey = getDateKeyInCET(prevDay);
    } else {
      dayKey = getDateKeyInCET(date);
    }
    
    if (!dailyTotals[dayKey]) {
      dailyTotals[dayKey] = { 
        total: 0, 
        weightedSlr: 0, 
        totalAmount: 0, 
        hasRain: false,
        temperatures: [],
        humidities: []
      };
    }
    
    // Collect temperature and humidity for daily aggregation
    if (!isNaN(temperature)) {
      dailyTotals[dayKey].temperatures.push(temperature);
    }
    if (!isNaN(hum) && hum > 0) {
      dailyTotals[dayKey].humidities.push(hum);
    }
    
    const snowCalc = calculateSnowfall(temperature, precipitation, wind, hum);
    // Check if it's rain (slr === -1, or amount is negative which indicates rain)
    if (snowCalc.slr === -1 || snowCalc.amount < 0) {
      dailyTotals[dayKey].hasRain = true;
    } else if (!isNaN(snowCalc.amount) && snowCalc.amount > 0) {
      dailyTotals[dayKey].total += snowCalc.amount;
      // Weighted average SLR (weighted by snowfall amount)
      dailyTotals[dayKey].weightedSlr += snowCalc.slr * snowCalc.amount;
      dailyTotals[dayKey].totalAmount += snowCalc.amount;
    }
  }
  
  // Build rows with daily metrics
  const rows = Object.keys(dailyTotals).sort().map(date => {
    const day = dailyTotals[date];

    const tempMax = day.temperatures.length > 0 
      ? Math.max(...day.temperatures).toFixed(1) 
      : '';
    const tempMin = day.temperatures.length > 0 
      ? Math.min(...day.temperatures).toFixed(1) 
      : '';

    const humidityAvg = day.humidities.length > 0
      ? (day.humidities.reduce((sum, h) => sum + h, 0) / day.humidities.length).toFixed(1)
      : '';

    if (day.hasRain) {
      return {
        date,
        snowfall_cm: '-1',
        slr: '-1',
        temp_max: tempMax,
        temp_min: tempMin,
        humidity_avg: humidityAvg,
      };
    }

    const avgSlr = day.totalAmount > 0 ? (day.weightedSlr / day.totalAmount).toFixed(1) : '0';
    return {
      date,
      snowfall_cm: day.total.toFixed(2),
      slr: avgSlr,
      temp_max: tempMax,
      temp_min: tempMin,
      humidity_avg: humidityAvg,
    };
  });

  // Add accumulated snowfall, filtering out days before Nov 1, 2025
  const accumulatedRows = addAccumulatedSnowfall(rows, {
    seasonStartMonth: 10, // November
    seasonStartDay: 1,
    cutoffDate: '2025-11-01',
  });

  const header = 'date,snowfall_cm,slr,temp_max,temp_min,humidity_avg,accumulated_snowfall_cm\n';
  const dailyLines = accumulatedRows.map(row =>
    `${row.date},${row.snowfall_cm},${row.slr},${row.temp_max},${row.temp_min},${row.humidity_avg},${row.accumulated_snowfall_cm}`
  );

  fs.writeFileSync(AGGREGATED_DATA_FILE, header + dailyLines.join('\n') + '\n');
  console.log(`Updated daily aggregated data for ${dailyLines.length} days (filtered to Nov 1st, 2025 onwards)`);
}

/**
 * Bootstrap function to fetch historical data from a start date
 */
async function bootstrapHistoricalData(startDate = '2025-10-01') {
  try {
    console.log(`Starting historical data bootstrap from ${startDate}...`);
    initializeCSVFiles();
    
    // Clear existing data files to start fresh
    console.log('Clearing existing data files...');
    if (fs.existsSync(WEATHER_DATA_FILE)) {
      const header = 'timestamp,temperature,precipitation,wind_direction,wind_speed,humidity,visibility\n';
      fs.writeFileSync(WEATHER_DATA_FILE, header);
    }
    if (fs.existsSync(AGGREGATED_DATA_FILE)) {
      const header = 'date,snowfall_cm,slr,temp_max,temp_min,humidity_avg,accumulated_snowfall_cm\n';
      fs.writeFileSync(AGGREGATED_DATA_FILE, header);
    }
    
    console.log('Fetching historical hourly data from SMHI API...');
    const existingTimestamps = new Set(); // Empty set for bootstrap
    const hourlyData = [];
    
    // Fetch data for each parameter using historical endpoint
    const parameterPromises = Object.entries(PARAMETER_CODES).map(async ([key, code]) => {
      try {
        const data = await fetchSMHIHistoricalData(code, STATION_ID, startDate);
        return { key, data };
      } catch (error) {
        // Log error for missing parameters - they may not be available for this station
        console.error(`Failed to fetch ${key} (parameter ${code}): ${error.message}`);
        return { key, data: null };
      }
    });
    
    const results = await Promise.all(parameterPromises);
    
    // Organize data by timestamp
    const dataByTime = {};
    
    for (const { key, data } of results) {
      if (data && data.value && Array.isArray(data.value)) {
        for (const entry of data.value) {
          // Use shared parsing function (now handles all timestamp formats)
          const parsed = parseSMHIEntry(entry);
          
          if (!parsed) {
            // If parsing fails, log a warning with entry details for debugging
            console.warn(`Failed to parse entry for ${key}, skipping:`, JSON.stringify(entry));
            continue;
          }
          
          if (parsed && parsed.timestamp) {
            // Validate that timestamp is a valid Date object (should already be validated in parseSMHIEntry)
            if (!(parsed.timestamp instanceof Date) || isNaN(parsed.timestamp.getTime())) {
              console.error(`Invalid timestamp for ${key} after parsing, skipping entry:`, entry);
              continue;
            }
            
            // Filter by start date
            const start = new Date(startDate);
            if (parsed.timestamp < start) {
              continue;
            }
            
            const timestampISO = parsed.timestamp.toISOString();
            if (!dataByTime[timestampISO]) {
              dataByTime[timestampISO] = {};
            }
            dataByTime[timestampISO][key] = parsed.value;
          }
        }
      }
    }
    
    // Convert to array and filter for complete records
    for (const [timestampISO, values] of Object.entries(dataByTime)) {
      if (timestampISO && values.temperature !== undefined && values.precipitation !== undefined) {
        hourlyData.push({
          timestamp: timestampISO,
          ...values
        });
      }
    }
    
    // Sort by timestamp
    hourlyData.sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
    
    console.log(`Fetched ${hourlyData.length} historical hourly records`);
    
    if (hourlyData.length > 0) {
      // Write all data at once (not append)
      const header = 'timestamp,temperature,precipitation,wind_direction,wind_speed,humidity,visibility\n';
      const lines = hourlyData.map(data => {
        return [
          data.timestamp || '',
          data.temperature ?? '',
          data.precipitation ?? '',
          data.wind_direction ?? '',
          data.wind_speed ?? '',
          data.humidity ?? '',
          data.visibility ?? ''
        ].join(',');
      });
      
      fs.writeFileSync(WEATHER_DATA_FILE, header + lines.join('\n') + '\n');
      console.log(`Wrote ${hourlyData.length} historical records to weather_data.csv`);
    }
    
    console.log('Calculating daily snowfall totals...');
    calculateDailySnowfall();
    
    console.log('Historical data bootstrap completed successfully!');
  } catch (error) {
    console.error('Error in bootstrap:', error);
    process.exit(1);
  }
}

/**
 * Main function
 */
async function main() {
  try {
    console.log('Starting data fetch...');
    initializeCSVFiles();
    
    console.log('Fetching hourly data from SMHI API...');
    const hourlyData = await fetchHourlyData();
    
    if (hourlyData.length > 0) {
      appendHourlyData(hourlyData);
    }
    
    console.log('Calculating daily snowfall totals...');
    calculateDailySnowfall();
    
    console.log('Data fetch completed successfully!');
  } catch (error) {
    console.error('Error in main:', error);
    process.exit(1);
  }
}

// Run if executed directly
if (require.main === module) {
  // Check for bootstrap flag
  const args = process.argv.slice(2);
  if (args.includes('--bootstrap') || args.includes('-b')) {
    const startDate = args.find(arg => arg.startsWith('--start='))?.split('=')[1] || '2025-10-01';
    bootstrapHistoricalData(startDate);
  } else {
    main();
  }
}

module.exports = { main, bootstrapHistoricalData, fetchSMHIData, calculateDailySnowfall };

