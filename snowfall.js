
/**
 * Beräknar snödjup i cm från nederbörd i mm.
 * Tar hänsyn till temperatur, vind och luftfuktighet (wet bulb).
 *
 * @todo lägg till en ackumulerande variabel som förklarar beräkningen av snödjupet, returned
 * @todo returnera SLR (Snow-to-Liquid Ratio) i tillägg till snödjupet
 * 
 * @param {number} mm - Nederbörd i mm
 * @param {number} temp - Temperatur i °C
 * @param {number} wind - Vind i m/s
 * @param {number} hum - Luftfuktighet i % (0-100)
 * @returns {number} Snödjup i cm
 */
const calculateSnowfall = (temp, mm, wind, hum = 90) => {
  // Fail fast: Ingen nederbörd
  if (!mm || mm <= 0) return 0;

  // 1. Wet Bulb Approximation (Kritisk för gränslandet regn/snö)
  // I torr luft (låg hum) kan det snöa även vid plusgrader.
  const wetBulb = temp - ((100 - hum) / 10);

  // Fail fast: För varmt för snö (även med wet bulb-effekt)
  if (wetBulb > 1.0) return 0;

  // 2. Beräkna Base SLR (Snow-to-Liquid Ratio)
  // Interpolerar mellan tung blötsnö och fluffig dendrit-snö
  let slr = wetBulb >= -2
    ? 8 + (wetBulb * -1)            // 0°C -> 8, -2°C -> 10
    : 10 + ((-2 - wetBulb) * 1.15); // Linjär ökning mot kylan

  // Cap: SLR når sällan över 30 (extremt fluff) eller under 5 (slask)
  // Vi låter den plana ut vid -15°C (där slr blir ca 25)
  slr = Math.min(Math.max(slr, 5), 30);

  // 3. Vindfaktor (Wind Compaction)
  // Vind > 2.5 m/s slår sönder kristallerna exponentiellt
  const windFactor = wind <= 2.5 
    ? 1.0 
    : Math.exp(-0.08 * (wind - 2.5));

  // 4. Resultat: mm * ratio * vind / 10 (för att få cm)
  // Använder toFixed(2) för snyggare output, konvertera tillbaka till Number
  return Number(((mm * slr * windFactor) / 10).toFixed(2));
};

// Export for Node.js
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { calculateSnowfall };
}

