/**
 * Shared SMHI API utilities for both Node.js and browser
 */

// SMHI API configuration
const STATION_ID = 124300;
const PARAMETER_CODES = {
  temperature: 1,
  precipitation: 7,
  wind_direction: 3,  // Parameter 3: Vindriktning (Wind direction in degrees)
  // wind_gust: 18,  // Not available for station 124300
  humidity: 5,
  wind_speed: 4,      // Parameter 4: Vindhastighet (Wind speed in m/s)
  visibility: 19
};

/**
 * Parse SMHI timestamp to Date object
 * SMHI API returns timestamps as Unix timestamps (milliseconds) in the 'date' field
 * This function handles both number (Unix timestamp) and string formats
 */
function parseSMHITimestamp(timestamp) {
  // If it's a number (Unix timestamp in milliseconds)
  if (typeof timestamp === 'number') {
    return new Date(timestamp);
  }
  
  // If it's a string in format YYYYMMDDHHmm
  if (typeof timestamp === 'string' && timestamp.length >= 12) {
    const year = timestamp.substring(0, 4);
    const month = timestamp.substring(4, 6);
    const day = timestamp.substring(6, 8);
    const hour = timestamp.substring(8, 10);
    const minute = timestamp.substring(10, 12);
    return new Date(`${year}-${month}-${day}T${hour}:${minute}:00`);
  }
  
  // Try to parse as ISO string or date
  try {
    const date = new Date(timestamp);
    if (isNaN(date.getTime())) {
      return null;
    }
    return date;
  } catch (e) {
    return null;
  }
}

/**
 * Parse SMHI API entry and extract timestamp and value
 * Handles multiple timestamp formats: date, dateTime, time, from (Unix timestamp), ref (date string)
 */
function parseSMHIEntry(entry) {
  let timestamp = null;
  
  // Try primary timestamp fields first (Unix timestamp in milliseconds)
  if (entry.date !== undefined) {
    timestamp = parseSMHITimestamp(entry.date);
  } else if (entry.dateTime !== undefined) {
    timestamp = parseSMHITimestamp(entry.dateTime);
  } else if (entry.time !== undefined) {
    timestamp = parseSMHITimestamp(entry.time);
  } else if (entry.from !== undefined) {
    // 'from' field is Unix timestamp in milliseconds
    timestamp = parseSMHITimestamp(entry.from);
  } else if (entry.ref !== undefined) {
    // 'ref' field is a date string like "2025-10-01", add time component
    const timestampStr = entry.ref + 'T00:00:00';
    timestamp = parseSMHITimestamp(timestampStr);
  }
  
  if (!timestamp) {
    return null;
  }
  
  // Validate timestamp is a valid Date
  if (!(timestamp instanceof Date) || isNaN(timestamp.getTime())) {
    return null;
  }
  
  const value = entry.value !== undefined ? parseFloat(entry.value) : null;
  if (value === null || isNaN(value)) {
    return null;
  }
  
  return { timestamp, value };
}

/**
 * Fetch data from SMHI API for a specific parameter
 * Works in both Node.js (with node-fetch) and browser (with fetch)
 */
async function fetchSMHIData(parameter, stationId, period = 'latest-hour') {
  // SMHI API format: https://opendata-download-metobs.smhi.se/api/version/latest/parameter/{parameter}/station/{station}/period/{period}/data.json
  const url = `https://opendata-download-metobs.smhi.se/api/version/latest/parameter/${parameter}/station/${stationId}/period/${period}/data.json`;
  
  let fetchFn;
  // Use node-fetch in Node.js, native fetch in browser
  if (typeof fetch !== 'undefined') {
    fetchFn = fetch; // Browser
  } else {
    fetchFn = require('node-fetch'); // Node.js
  }
  
  try {
    const response = await fetchFn(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    return data;
  } catch (error) {
    // Re-throw error - caller will handle logging
    throw error;
  }
}

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    STATION_ID,
    PARAMETER_CODES,
    parseSMHITimestamp,
    parseSMHIEntry,
    fetchSMHIData
  };
}

