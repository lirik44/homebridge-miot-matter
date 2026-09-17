const MatterTwin = require('./MatterTwin.js');


/**
 * What Matter calls the air. Only these three are allowed of a plain air quality sensor: the finer
 * gradations - fair, moderate, very poor, extremely poor - are separate features of the cluster,
 * and setting one without them is refused with "Matter does not allow enum value Fair here".
 */
const AIR_QUALITY = { UNKNOWN: 0, GOOD: 1, POOR: 4 };

/** The PM2.5 reading, in µg/m³, at which the air stops being called good. */
const GOOD_UP_TO = 35;

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
    return pm25 <= GOOD_UP_TO ? AIR_QUALITY.GOOD : AIR_QUALITY.POOR;
  }

}


module.exports = AirQualityTwin;
module.exports.AIR_QUALITY = AIR_QUALITY;
