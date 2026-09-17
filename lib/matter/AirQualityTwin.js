const MatterTwin = require('./MatterTwin.js');


/** What Matter calls the air, from good to unbreathable. */
const AIR_QUALITY = { UNKNOWN: 0, GOOD: 1, FAIR: 2, MODERATE: 3, POOR: 4, VERY_POOR: 5, EXTREMELY_POOR: 6 };

/** The PM2.5 readings, in µg/m³, at which the air stops being called what it was. */
const PM25_THRESHOLDS = [
  { upTo: 12, quality: AIR_QUALITY.GOOD },
  { upTo: 35, quality: AIR_QUALITY.FAIR },
  { upTo: 55, quality: AIR_QUALITY.MODERATE },
  { upTo: 150, quality: AIR_QUALITY.POOR },
  { upTo: 250, quality: AIR_QUALITY.VERY_POOR },
];

/**
 * What an air purifier knows about the air, published as a sensor of its own.
 *
 * The purifier itself goes to a controller as a fan; this is the part a controller can put in a
 * room's air quality card or trigger an automation from.
 */
class AirQualityTwin extends MatterTwin {

  supported() {
    return typeof this.device.supportsPm25DensityReporting === 'function' && this.device.supportsPm25DensityReporting();
  }

  deviceType() {
    return this.api.matter.deviceTypes.AirQualitySensor;
  }

  state() {
    const pm25 = Math.max(0, Math.round(Number(this.device.getPm25Density()) || 0));

    // The reading itself is not reported: Homebridge's air quality sensor carries the air quality
    // cluster and nothing else, and every attempt to set a concentration is refused with
    // "Behavior pm25ConcentrationMeasurement is not present on this endpoint". What a controller
    // gets is the quality that reading amounts to.
    return {
      airQuality: { airQuality: AirQualityTwin.qualityFor(pm25) },
    };
  }

  handlers() {
    // Nothing to command on a sensor.
    return {};
  }

  /**
   * @param {number} pm25 The reading in µg/m³.
   * @returns {number} What Matter calls air of that quality.
   */
  static qualityFor(pm25) {
    const match = PM25_THRESHOLDS.find(threshold => pm25 <= threshold.upTo);
    return match ? match.quality : AIR_QUALITY.EXTREMELY_POOR;
  }

}


module.exports = AirQualityTwin;
module.exports.AIR_QUALITY = AIR_QUALITY;
