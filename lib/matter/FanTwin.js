const MatterTwin = require('./MatterTwin.js');


/** The fan modes Matter counts in. */
const FAN_MODE = { OFF: 0, LOW: 1, MEDIUM: 2, HIGH: 3, ON: 4, AUTO: 5 };

/** Off, low, medium, high - the sequence a controller offers when it draws the fan. */
const FAN_MODE_SEQUENCE_OFF_LOW_MED_HIGH = 0;


/**
 * Anything that moves air, as a Matter controller sees it: a fan, an air purifier, a humidifier.
 *
 * Matter has no device type for an air purifier that controllers render, and a purifier is a fan
 * with a filter in front of it - so that is what it is published as, and the speed a controller
 * sets is the speed the device runs at.
 */
class FanTwin extends MatterTwin {

  supported() {
    return typeof this.device.isOn === 'function';
  }

  deviceType() {
    return this.api.matter.deviceTypes.Fan;
  }

  state() {
    return {
      fanControl: {
        // Only the percentage is reported, never the mode. matter.js keeps the two in step
        // itself, and a mode this plugin sends comes back as a percentage of matter.js's own
        // choosing - which, taken for a command, is what set a purifier running flat out in
        // manual when all anyone did was switch it on.
        percentSetting: this._reportedPercent(),
        percentCurrent: this._reportedPercent(),
      },
    };
  }

  /**
   * @returns {object} What the accessory is registered with, which unlike a report has to carry
   *   every attribute the cluster needs to exist at all.
   */
  initialState() {
    const percent = this._reportedPercent();

    return {
      fanControl: {
        fanMode: this._modeFor(percent),
        fanModeSequence: FAN_MODE_SEQUENCE_OFF_LOW_MED_HIGH,
        percentSetting: percent,
        percentCurrent: percent,
      },
    };
  }

  handlers() {
    return {
      fanControl: {
        fanModeChange: async (request) => {
          const asked = request && request.fanMode;
          this.logger.info(`Matter: ${this.name} asked for fan mode ${asked}${this.justReported('fanControl') ? ' (ignored, it followed our own report)' : ''}`);
          if (this.justReported('fanControl')) {
            return;
          }

          const fanMode = asked;
          const wanted = fanMode !== FAN_MODE.OFF;

          // A mode carries no speed of its own here: all it can say is whether the thing should
          // be running. Anything else is matter.js keeping its own attributes in step.
          if (wanted === (this.device.isOn() === true)) {
            return;
          }

          await this.device.setOn(wanted);
        },

        percentSettingChange: async (request) => {
          const asked = request && request.percentSetting;
          this.logger.info(`Matter: ${this.name} asked for ${asked}%${this.justReported('fanControl') ? ' (ignored, it followed our own report)' : ''}, device is ${this.device.isOn() === true ? `on at ${this._speed()}%` : 'off'}`);
          if (this.justReported('fanControl')) {
            return;
          }

          const percent = asked;
          if (percent === null || percent === undefined) {
            return;
          }

          // Measured against the device rather than against what was last reported: an echo of a
          // report always matches what the device is doing, and a person asking for what is
          // already happening has asked for nothing.
          if (percent === this._reportedPercent()) {
            return;
          }

          if (percent === 0) {
            await this.device.setOn(false);
            return;
          }

          if (this.device.isOn() !== true) {
            await this.device.setOn(true);
          }
          if (this._canSetSpeed()) {
            await this.device.setRotationSpeedPercentage(percent);
          }
        },
      },
    };
  }


  /*----------========== HELPERS ==========----------*/

  _canSetSpeed() {
    return typeof this.device.supportsRotationSpeed === 'function'
      && this.device.supportsRotationSpeed()
      && typeof this.device.setRotationSpeedPercentage === 'function';
  }

  _reportedPercent() {
    return this.device.isOn() === true ? this._speed() : 0;
  }

  _speed() {
    if (!this._canSetSpeed()) {
      // A device with one speed is either running or it is not.
      return 100;
    }

    const percent = Math.round(Number(this.device.getRotationSpeedPercentage()) || 0);
    return Math.max(0, Math.min(100, percent));
  }

  _modeFor(percent) {
    if (percent === 0) {
      return FAN_MODE.OFF;
    }
    if (percent <= 33) {
      return FAN_MODE.LOW;
    }
    if (percent <= 66) {
      return FAN_MODE.MEDIUM;
    }
    return FAN_MODE.HIGH;
  }

}


module.exports = FanTwin;
module.exports.FAN_MODE = FAN_MODE;
