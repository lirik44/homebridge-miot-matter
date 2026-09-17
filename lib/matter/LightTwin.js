const MatterTwin = require('./MatterTwin.js');


/**
 * A light, as a Matter controller sees it: on and off, a dimmer where the lamp has one, and a
 * colour temperature where it has that.
 */
class LightTwin extends MatterTwin {

  supported() {
    return typeof this.device.isOn === 'function';
  }

  deviceType() {
    const types = this.api.matter.deviceTypes;

    if (this._hasColorTemperature() && this._hasBrightness()) {
      return types.ColorTemperatureLight;
    }
    if (this._hasBrightness()) {
      return types.DimmableLight;
    }
    return types.OnOffLight;
  }

  state() {
    const state = { onOff: { onOff: this.device.isOn() === true } };

    if (this._hasBrightness()) {
      state.levelControl = { currentLevel: this.toMatterLevel(this.device.getBrightness()) };
    }

    if (this._hasColorTemperature()) {
      const range = this._kelvinRange();
      state.colorControl = {
        colorTemperatureMireds: this.toMireds(this.device.getColorTemperature()) || this.toMireds(range.warmest),
        // Matter counts in mireds, which run the other way from kelvin: the coldest light is the
        // smallest number, so the physical minimum comes from the highest kelvin the lamp takes.
        colorTempPhysicalMinMireds: this.toMireds(range.coldest),
        colorTempPhysicalMaxMireds: this.toMireds(range.warmest),
        // Where a lamp dims its colour temperature along with its brightness, this is the warmest
        // it may go. This one does not, but Matter requires the attribute of anything that
        // reports a colour temperature at all, and refuses the whole accessory without it.
        coupleColorTempToLevelMinMireds: this.toMireds(range.coldest),
        // 2 is "colour temperature", which is all this lamp does.
        colorMode: 2,
      };
    }

    return state;
  }

  handlers() {
    const handlers = {
      onOff: {
        on: async () => this._turn(true),
        off: async () => this._turn(false),
      },
    };

    if (this._hasBrightness()) {
      const setLevel = async (request) => {
        const level = request && request.level;
        if (this.justReported('levelControl') || this.isOwnUpdate('levelControl', 'currentLevel', level)) {
          return;
        }

        // Asking for what the lamp is already doing is asking for nothing.
        const percent = this.fromMatterLevel(level);
        if (percent === Math.round(Number(this.device.getBrightness()) || 0)) {
          return;
        }

        await this.device.setBrightness(percent);
      };

      handlers.levelControl = { moveToLevel: setLevel, moveToLevelWithOnOff: setLevel };
    }

    if (this._hasColorTemperature()) {
      handlers.colorControl = {
        moveToColorTemperatureLogic: async (request) => {
          const mireds = request && request.colorTemperatureMireds;
          if (this.justReported('colorControl') || this.isOwnUpdate('colorControl', 'colorTemperatureMireds', mireds)) {
            return;
          }

          const range = this._kelvinRange();
          const kelvin = Math.max(range.warmest, Math.min(range.coldest, this.fromMireds(mireds)));
          if (kelvin === Math.round(Number(this.device.getColorTemperature()) || 0)) {
            return;
          }

          await this.device.setColorTemperature(kelvin);
        },
      };
    }

    return handlers;
  }


  /*----------========== HELPERS ==========----------*/

  async _turn(on) {
    if (this.justReported('onOff') || this.isOwnUpdate('onOff', 'onOff', on) || on === (this.device.isOn() === true)) {
      return;
    }
    await this.device.setOn(on);
  }

  _hasBrightness() {
    return typeof this.device.supportsBrightness === 'function' && this.device.supportsBrightness();
  }

  _hasColorTemperature() {
    return typeof this.device.supportsColorTemperature === 'function' && this.device.supportsColorTemperature();
  }

  _kelvinRange() {
    const range = this.device.getPropertyValueRange
      ? this.device.getPropertyValueRange(this.device.colorTemperatureProp())
      : [];

    return {
      warmest: (range && range[0]) || 2700,
      coldest: (range && range[1]) || 6500,
    };
  }

}


module.exports = LightTwin;
