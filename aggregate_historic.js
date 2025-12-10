const fs = require('fs');
const path = require('path');
const { calculateSnowfall } = require('./snowfall.js');

const RAW_DATA_DIR = path.join(__dirname, 'data', 'raw');
const HISTORIC_DATA_DIR = path.join(__dirname, 'data', 'historic');

/**
 * Parse SMHI CSV file and extract hourly data
 * SMHI CSV format: semicolon-separated, data starts at line 11
 * Format: Datum;Tid (UTC);Value;Kvalitet;...
 */
function parseSMHICSV(filePath, valueColumnIndex = 2) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  // Data starts at line 11 (index 10)
  const data = [];
  for (let i = 10; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';')) continue;
    
    const parts = line.split(';');
    if (parts.length < 3) continue;
    
    const dateStr = parts[0];
    const timeStr = parts[1];
    const valueStr = parts[valueColumnIndex];
    
    if (!dateStr || !timeStr || !valueStr) continue;
    
    // Parse date and time
    const dateTimeStr = `${dateStr}T${timeStr}`;
    const timestamp = new Date(dateTimeStr + 'Z'); // UTC
    
    if (isNaN(timestamp.getTime())) continue;
    
    const value = parseFloat(valueStr);
    if (isNaN(value)) continue;
    
    data.push({ timestamp, value });
  }
  
  return data;
}

/**
 * Parse wind data CSV (has both direction and speed)
 */
function parseWindCSV(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  
  const data = { direction: [], speed: [] };
  for (let i = 10; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith(';')) continue;
    
    const parts = line.split(';');
    if (parts.length < 5) continue;
    
    const dateStr = parts[0];
    const timeStr = parts[1];
    const directionStr = parts[2];
    const speedStr = parts[4];
    
    if (!dateStr || !timeStr) continue;
    
    const dateTimeStr = `${dateStr}T${timeStr}`;
    const timestamp = new Date(dateTimeStr + 'Z');
    
    if (isNaN(timestamp.getTime())) continue;
    
    if (directionStr) {
      const direction = parseFloat(directionStr);
      if (!isNaN(direction)) {
        data.direction.push({ timestamp, value: direction });
      }
    }
    
    if (speedStr) {
      const speed = parseFloat(speedStr);
      if (!isNaN(speed)) {
        data.speed.push({ timestamp, value: speed });
      }
    }
  }
  
  return data;
}

/**
 * Get hour in CET (UTC+1, or UTC+2 during DST)
 * Simplified: CET is UTC+1, CEST is UTC+2
 */
function getHourInCET(date) {
  const utcHour = date.getUTCHours();
  // DST: last Sunday in March to last Sunday in October
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  const dayOfWeek = date.getUTCDay();
  
  // Approximate DST: March-October (simplified)
  const isDST = month >= 2 && month <= 9; // March (2) to October (9)
  return isDST ? (utcHour + 2) % 24 : (utcHour + 1) % 24;
}

/**
 * Get date key in CET (YYYY-MM-DD)
 */
function getDateKeyInCET(date) {
  const utcDate = new Date(date);
  const month = utcDate.getUTCMonth();
  const day = utcDate.getUTCDate();
  const year = utcDate.getUTCFullYear();
  
  // Adjust for CET timezone
  const hourCET = getHourInCET(date);
  const hourUTC = date.getUTCHours();
  
  // If CET hour is before UTC hour, we're in next day in CET
  let cetYear = year;
  let cetMonth = month;
  let cetDay = day;
  
  if (hourCET < hourUTC || (hourCET === 0 && hourUTC > 0)) {
    const nextDay = new Date(utcDate);
    nextDay.setUTCDate(nextDay.getUTCDate() + 1);
    cetYear = nextDay.getUTCFullYear();
    cetMonth = nextDay.getUTCMonth();
    cetDay = nextDay.getUTCDate();
  }
  
  return `${cetYear}-${String(cetMonth + 1).padStart(2, '0')}-${String(cetDay).padStart(2, '0')}`;
}

/**
 * Get winter season key (e.g., "9596" for Nov 1995 - Apr 1996)
 */
function getWinterSeason(date) {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // 1-12
  
  // Winter season: November (11) - April (4)
  if (month >= 11) {
    // Nov-Dec: current year to next year
    const year1 = String(year).slice(-2);
    const year2 = String(year + 1).slice(-2);
    return `${year1}${year2}`;
  } else if (month <= 4) {
    // Jan-Apr: previous year to current year
    const year1 = String(year - 1).slice(-2);
    const year2 = String(year).slice(-2);
    return `${year1}${year2}`;
  } else {
    // May-Oct: not in winter season
    return null;
  }
}

/**
 * Load all raw data files
 */
function loadAllRawData(startDate = null, endDate = null) {
  const files = fs.readdirSync(RAW_DATA_DIR);
  
  let temperature = [];
  let precipitation = [];
  let humidity = [];
  let visibility = [];
  let windDirection = [];
  let windSpeed = [];
  
  for (const file of files) {
    if (!file.endsWith('.csv')) continue;
    
    const filePath = path.join(RAW_DATA_DIR, file);
    
    if (file.includes('opendata_1_')) {
      // Temperature
      console.log(`Loading temperature from ${file}...`);
      temperature = parseSMHICSV(filePath, 2);
    } else if (file.includes('opendata_3_4_')) {
      // Wind direction and speed
      console.log(`Loading wind data from ${file}...`);
      const windData = parseWindCSV(filePath);
      windDirection = windData.direction;
      windSpeed = windData.speed;
    } else if (file.includes('opendata_6_')) {
      // Humidity
      console.log(`Loading humidity from ${file}...`);
      humidity = parseSMHICSV(filePath, 2);
    } else if (file.includes('opendata_7_')) {
      // Precipitation
      console.log(`Loading precipitation from ${file}...`);
      precipitation = parseSMHICSV(filePath, 2);
    } else if (file.includes('opendata_12_')) {
      // Visibility
      console.log(`Loading visibility from ${file}...`);
      visibility = parseSMHICSV(filePath, 2);
    }
  }
  
  // Filter by date range if provided
  if (startDate) {
    const start = new Date(startDate);
    temperature = temperature.filter(d => d.timestamp >= start);
    precipitation = precipitation.filter(d => d.timestamp >= start);
    humidity = humidity.filter(d => d.timestamp >= start);
    visibility = visibility.filter(d => d.timestamp >= start);
    windDirection = windDirection.filter(d => d.timestamp >= start);
    windSpeed = windSpeed.filter(d => d.timestamp >= start);
  }
  
  if (endDate) {
    const end = new Date(endDate);
    temperature = temperature.filter(d => d.timestamp <= end);
    precipitation = precipitation.filter(d => d.timestamp <= end);
    humidity = humidity.filter(d => d.timestamp <= end);
    visibility = visibility.filter(d => d.timestamp <= end);
    windDirection = windDirection.filter(d => d.timestamp <= end);
    windSpeed = windSpeed.filter(d => d.timestamp <= end);
  }
  
  return {
    temperature,
    precipitation,
    humidity,
    visibility,
    windDirection,
    windSpeed
  };
}

/**
 * Combine hourly data by timestamp
 */
function combineHourlyData(data) {
  // Create a map keyed by timestamp (rounded to hour)
  const combined = new Map();
  
  // Helper to get timestamp key
  const getKey = (ts) => {
    const d = new Date(ts);
    d.setUTCMinutes(0);
    d.setUTCSeconds(0);
    d.setUTCMilliseconds(0);
    return d.getTime();
  };
  
  // Add all data points
  for (const item of data.temperature) {
    const key = getKey(item.timestamp);
    if (!combined.has(key)) {
      combined.set(key, { timestamp: new Date(key) });
    }
    combined.get(key).temperature = item.value;
  }
  
  for (const item of data.precipitation) {
    const key = getKey(item.timestamp);
    if (!combined.has(key)) {
      combined.set(key, { timestamp: new Date(key) });
    }
    combined.get(key).precipitation = item.value;
  }
  
  for (const item of data.humidity) {
    const key = getKey(item.timestamp);
    if (!combined.has(key)) {
      combined.set(key, { timestamp: new Date(key) });
    }
    combined.get(key).humidity = item.value;
  }
  
  for (const item of data.windSpeed) {
    const key = getKey(item.timestamp);
    if (!combined.has(key)) {
      combined.set(key, { timestamp: new Date(key) });
    }
    combined.get(key).windSpeed = item.value;
  }
  
  return Array.from(combined.values());
}

/**
 * Calculate daily aggregates grouped by winter season
 */
function calculateDailyAggregates(hourlyData) {
  // Group by day (8 AM CET - 8 AM CET next day) and winter season
  const dailyBySeason = {};
  
  for (const hour of hourlyData) {
    const date = hour.timestamp;
    const hourCET = getHourInCET(date);
    
    // Determine which day this hour belongs to (8 AM CET - 8 AM CET next day)
    let dayKey;
    if (hourCET < 8) {
      const prevDay = new Date(date);
      prevDay.setUTCDate(prevDay.getUTCDate() - 1);
      dayKey = getDateKeyInCET(prevDay);
    } else {
      dayKey = getDateKeyInCET(date);
    }
    
    // Get winter season
    const season = getWinterSeason(new Date(dayKey));
    if (!season) continue; // Skip non-winter months
    
    if (!dailyBySeason[season]) {
      dailyBySeason[season] = {};
    }
    
    if (!dailyBySeason[season][dayKey]) {
      dailyBySeason[season][dayKey] = {
        temperatures: [],
        humidities: [],
        precipitations: [],
        windSpeeds: [],
        snowfallData: []
      };
    }
    
    const day = dailyBySeason[season][dayKey];
    
    if (hour.temperature !== undefined) {
      day.temperatures.push(hour.temperature);
    }
    if (hour.humidity !== undefined) {
      day.humidities.push(hour.humidity);
    }
    if (hour.precipitation !== undefined) {
      day.precipitations.push(hour.precipitation);
    }
    if (hour.windSpeed !== undefined) {
      day.windSpeeds.push(hour.windSpeed);
    }
    
    // Calculate snowfall for this hour
    const temp = hour.temperature;
    const precip = hour.precipitation;
    const wind = hour.windSpeed || 0;
    const hum = hour.humidity || 90;
    
    if (temp !== undefined && precip !== undefined) {
      const snowCalc = calculateSnowfall(temp, precip, wind, hum);
      day.snowfallData.push(snowCalc);
    }
  }
  
  // Calculate daily totals
  const aggregated = {};
  for (const [season, days] of Object.entries(dailyBySeason)) {
    aggregated[season] = [];
    
    for (const [date, day] of Object.entries(days).sort()) {
      // Calculate temperature min/max
      const tempMax = day.temperatures.length > 0
        ? Math.max(...day.temperatures).toFixed(1)
        : '';
      const tempMin = day.temperatures.length > 0
        ? Math.min(...day.temperatures).toFixed(1)
        : '';
      
      // Calculate average humidity
      const humidityAvg = day.humidities.length > 0
        ? (day.humidities.reduce((sum, h) => sum + h, 0) / day.humidities.length).toFixed(1)
        : '90.0';
      
      // Calculate snowfall
      let hasRain = false;
      let totalSnowfall = 0;
      let weightedSlr = 0;
      let totalAmount = 0;
      
      for (const snow of day.snowfallData) {
        if (snow.slr === -1 || snow.amount < 0) {
          hasRain = true;
        } else if (snow.amount > 0) {
          totalSnowfall += snow.amount;
          weightedSlr += snow.slr * snow.amount;
          totalAmount += snow.amount;
        }
      }
      
      const avgSlr = totalAmount > 0 ? (weightedSlr / totalAmount).toFixed(1) : '0';
      const snowfall = hasRain ? '-1' : totalSnowfall.toFixed(2);
      const slr = hasRain ? '-1' : avgSlr;
      
      aggregated[season].push({
        date,
        snowfall_cm: snowfall,
        slr,
        temp_max: tempMax,
        temp_min: tempMin,
        humidity_avg: humidityAvg
      });
    }
  }
  
  return aggregated;
}

/**
 * Write aggregated data to CSV files
 */
function writeAggregatedFiles(aggregated) {
  // Create historic directory if it doesn't exist
  if (!fs.existsSync(HISTORIC_DATA_DIR)) {
    fs.mkdirSync(HISTORIC_DATA_DIR, { recursive: true });
  }
  
  const header = 'date,snowfall_cm,slr,temp_max,temp_min,humidity_avg\n';
  
  for (const [season, data] of Object.entries(aggregated)) {
    const filename = `agg${season}.csv`;
    const filepath = path.join(HISTORIC_DATA_DIR, filename);
    
    const lines = data.map(row => 
      `${row.date},${row.snowfall_cm},${row.slr},${row.temp_max},${row.temp_min},${row.humidity_avg}`
    );
    
    const content = header + lines.join('\n') + '\n';
    fs.writeFileSync(filepath, content);
    console.log(`Created ${filename} with ${data.length} days`);
  }
}

/**
 * Main function
 */
function aggregateHistoricData(startDate = null, endDate = null) {
  console.log('Loading raw data files...');
  if (startDate) console.log(`  Start date: ${startDate}`);
  if (endDate) console.log(`  End date: ${endDate}`);
  
  const rawData = loadAllRawData(startDate, endDate);
  
  console.log(`\nLoaded data:`);
  console.log(`  Temperature: ${rawData.temperature.length} records`);
  console.log(`  Precipitation: ${rawData.precipitation.length} records`);
  console.log(`  Humidity: ${rawData.humidity.length} records`);
  console.log(`  Wind speed: ${rawData.windSpeed.length} records`);
  console.log(`  Wind direction: ${rawData.windDirection.length} records`);
  console.log(`  Visibility: ${rawData.visibility.length} records`);
  
  console.log('\nCombining hourly data...');
  const hourlyData = combineHourlyData(rawData);
  console.log(`  Combined: ${hourlyData.length} hourly records`);
  
  console.log('\nCalculating daily aggregates...');
  const aggregated = calculateDailyAggregates(hourlyData);
  
  console.log('\nWriting aggregated files...');
  writeAggregatedFiles(aggregated);
  
  console.log('\nDone!');
  console.log(`Created ${Object.keys(aggregated).length} winter season files in ${HISTORIC_DATA_DIR}`);
}

// Run if called directly
if (require.main === module) {
  // Parse command line arguments
  const args = process.argv.slice(2);
  let startDate = null;
  let endDate = null;
  
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--start' && args[i + 1]) {
      startDate = args[i + 1];
      i++;
    } else if (args[i] === '--end' && args[i + 1]) {
      endDate = args[i + 1];
      i++;
    }
  }
  
  aggregateHistoricData(startDate, endDate);
}

module.exports = { aggregateHistoricData };

