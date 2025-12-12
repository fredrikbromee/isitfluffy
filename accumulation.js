const DEFAULT_SEASON_START_MONTH = 10; // 0-indexed, 10 = November
const DEFAULT_SEASON_START_DAY = 1;

/**
 * Add accumulated_snowfall_cm to a list of daily rows.
 *
 * Rules:
 * - Season resets on seasonStartMonth/seasonStartDay (defaults to Nov 1)
 * - Rain days (snowfall_cm === -1) keep previous accumulated value
 * - Only snowfall > 0 is added to the accumulated value
 * - Optionally filter out rows before cutoffDate (inclusive of cutoff)
 *
 * @param {Array<Object>} rows Array of rows with at least { date, snowfall_cm }
 * @param {Object} options
 * @param {number} options.seasonStartMonth 0-indexed month for winter start (default 10 = Nov)
 * @param {number} options.seasonStartDay Day of month for winter start (default 1)
 * @param {string|null} options.cutoffDate ISO date string; rows before this are dropped
 * @returns {Array<Object>} rows with accumulated_snowfall_cm appended (string fixed to 2 decimals)
 */
function addAccumulatedSnowfall(
  rows,
  {
    seasonStartMonth = DEFAULT_SEASON_START_MONTH,
    seasonStartDay = DEFAULT_SEASON_START_DAY,
    cutoffDate = null
  } = {}
) {
  if (!Array.isArray(rows)) return [];

  const cutoff = cutoffDate ? new Date(cutoffDate) : null;

  // Sort rows by date ascending
  const sorted = [...rows].sort((a, b) => new Date(a.date) - new Date(b.date));

  let accumulated = 0;
  let currentWinterYear = null;
  const result = [];

  for (const row of sorted) {
    if (!row || !row.date) continue;

    const dateObj = new Date(row.date);
    if (isNaN(dateObj.getTime())) continue;

    // Apply cutoff filter if provided
    if (cutoff && dateObj < cutoff) {
      continue;
    }

    const month = dateObj.getMonth();
    const day = dateObj.getDate();
    const year = dateObj.getFullYear();

    // Determine winter year bucket
    const winterYear =
      month < seasonStartMonth || (month === seasonStartMonth && day < seasonStartDay)
        ? year - 1
        : year;

    // Reset at start of winter
    if (
      month === seasonStartMonth &&
      day === seasonStartDay
    ) {
      accumulated = 0;
      currentWinterYear = winterYear;
    } else if (currentWinterYear === null) {
      // First row encountered (not necessarily on season start) — set winter year
      currentWinterYear = winterYear;
      // If we start mid-winter, we still start accumulation from 0 for simplicity
      accumulated = 0;
    } else if (winterYear !== currentWinterYear) {
      // Safety: if data spans multiple winters in one pass
      accumulated = 0;
      currentWinterYear = winterYear;
    }

    const snowfallVal = parseFloat(row.snowfall_cm);
    const isRain = snowfallVal === -1;
    const isSnow = !isNaN(snowfallVal) && snowfallVal > 0;

    if (!isRain && isSnow) {
      accumulated += snowfallVal;
    }

    result.push({
      ...row,
      accumulated_snowfall_cm: accumulated.toFixed(2)
    });
  }

  return result;
}

module.exports = {
  addAccumulatedSnowfall,
};


