const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const LightTwin = require('../lib/matter/LightTwin.js');
const FanTwin = require('../lib/matter/FanTwin.js');
const AirQualityTwin = require('../lib/matter/AirQualityTwin.js');

const silent = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

/** Enough of the Homebridge Matter API for a twin to build and report. */
function fakeApi() {
  const reported = [];
  return {
    reported,
    isMatterAvailable: () => true,
    isMatterEnabled: () => true,
    matter: {
      uuid: { generate: id => `uuid-${id}` },
      deviceTypes: {
        OnOffLight: 'OnOffLight',
        DimmableLight: 'DimmableLight',
        ColorTemperatureLight: 'ColorTemperatureLight',
        Fan: 'Fan',
        AirQualitySensor: 'AirQualitySensor',
        OnOffOutlet: 'OnOffOutlet',
      },
      registerPlatformAccessories: async () => {},
      updateAccessoryState: async (uuid, cluster, attributes) => {
        reported.push({ uuid, cluster, attributes });
      },
    },
  };
}

/** A lamp, as the plugin's device layer presents one. */
function fakeLamp(state = {}) {
  const device = {
    on: state.on === true,
    brightness: state.brightness === undefined ? 100 : state.brightness,
    kelvin: state.kelvin === undefined ? 2600 : state.kelvin,
    isOn: () => device.on,
    setOn: async (value) => {
      device.on = value;
    },
    supportsBrightness: () => state.brightness !== null,
    getBrightness: () => device.brightness,
    setBrightness: async (value) => {
      device.brightness = value;
    },
    supportsColorTemperature: () => state.kelvin !== null,
    getColorTemperature: () => device.kelvin,
    setColorTemperature: async (value) => {
      device.kelvin = value;
    },
    colorTemperatureProp: () => 'ct',
    getPropertyValueRange: () => [2600, 5000, 1],
    getDeviceName: () => 'Mi Smart LED Desk Lamp 1S',
  };
  return device;
}

/** A fan or an air purifier, which the plugin presents the same way. */
function fakeFan(state = {}) {
  const device = {
    on: state.on === true,
    speed: state.speed === undefined ? 50 : state.speed,
    isOn: () => device.on,
    setOn: async (value) => {
      device.on = value;
    },
    supportsRotationSpeed: () => state.speed !== null,
    getRotationSpeedPercentage: () => device.speed,
    setRotationSpeedPercentage: async (value) => {
      device.speed = value;
    },
    getDeviceName: () => 'Air purifier',
  };
  return device;
}

function twinFor(Twin, device, api = fakeApi()) {
  const twin = new Twin(device, {}, api, silent);
  twin.descriptor('uuid-1', 'Device');
  return { twin, api };
}

describe('a light over Matter', () => {
  it('is published as what it can actually do', () => {
    const full = new LightTwin(fakeLamp(), {}, fakeApi(), silent);
    assert.equal(full.deviceType(), 'ColorTemperatureLight');

    const dimmable = new LightTwin(fakeLamp({ kelvin: null }), {}, fakeApi(), silent);
    assert.equal(dimmable.deviceType(), 'DimmableLight');

    const plain = new LightTwin(fakeLamp({ brightness: null, kelvin: null }), {}, fakeApi(), silent);
    assert.equal(plain.deviceType(), 'OnOffLight');
  });

  it('reports brightness on the Matter scale and colour temperature in mireds', () => {
    const { twin } = twinFor(LightTwin, fakeLamp({ on: true, brightness: 50, kelvin: 4000 }));
    const state = twin.state();

    assert.deepEqual(state.onOff, { onOff: true });
    assert.equal(state.levelControl.currentLevel, 127);
    assert.equal(state.colorControl.colorTemperatureMireds, 250);
    // Mireds run the other way from kelvin: the coldest light is the smallest number.
    assert.equal(state.colorControl.colorTempPhysicalMinMireds, 200);
    assert.equal(state.colorControl.colorTempPhysicalMaxMireds, 385);
  });

  it('drives the lamp from a controller command', async () => {
    const lamp = fakeLamp({ on: false, brightness: 10, kelvin: 2600 });
    const { twin } = twinFor(LightTwin, lamp);
    const handlers = twin.handlers();

    await handlers.onOff.on();
    await handlers.levelControl.moveToLevel({ level: 254 });
    await handlers.colorControl.moveToColorTemperatureLogic({ colorTemperatureMireds: 250 });

    assert.equal(lamp.isOn(), true);
    assert.equal(lamp.getBrightness(), 100);
    assert.equal(lamp.getColorTemperature(), 4000);
  });

  it('keeps a colour temperature the lamp cannot reach within what it can', async () => {
    const lamp = fakeLamp();
    const { twin } = twinFor(LightTwin, lamp);

    // 6500K, colder than this lamp goes.
    await twin.handlers().colorControl.moveToColorTemperatureLogic({ colorTemperatureMireds: 154 });
    assert.equal(lamp.getColorTemperature(), 5000);
  });

  it('ignores a command that carries the value it just reported', async () => {
    // Reporting a value can reach these handlers as though a controller had commanded it; acted
    // on, the two ecosystems then take turns telling each other what they were just told.
    const lamp = fakeLamp({ on: true, brightness: 40 });
    const { twin } = twinFor(LightTwin, lamp);

    let setCalls = 0;
    lamp.setBrightness = async () => {
      setCalls += 1;
    };

    await twin.handlers().levelControl.moveToLevel({ level: twin.toMatterLevel(40) });
    assert.equal(setCalls, 0);

    await twin.handlers().levelControl.moveToLevel({ level: twin.toMatterLevel(80) });
    assert.equal(setCalls, 1);
  });
});

describe('a fan or an air purifier over Matter', () => {
  it('reports off as off, whatever speed it was left at', () => {
    const { twin } = twinFor(FanTwin, fakeFan({ on: false, speed: 60 }));
    assert.deepEqual(twin.state().fanControl, {
      fanMode: 0,
      fanModeSequence: 0,
      percentSetting: 0,
      percentCurrent: 0,
    });
  });

  it('names the speed the way a controller draws it', () => {
    const modes = [10, 50, 90].map((speed) => {
      const { twin } = twinFor(FanTwin, fakeFan({ on: true, speed }));
      return twin.state().fanControl.fanMode;
    });

    assert.deepEqual(modes, [1, 2, 3]);
  });

  it('turns the device off when a controller asks for no speed at all', async () => {
    const fan = fakeFan({ on: true, speed: 60 });
    const { twin } = twinFor(FanTwin, fan);

    await twin.handlers().fanControl.percentSettingChange({ percentSetting: 0 });
    assert.equal(fan.isOn(), false);
  });

  it('turns it on and sets the speed when a controller asks for one', async () => {
    const fan = fakeFan({ on: false, speed: 20 });
    const { twin } = twinFor(FanTwin, fan);

    await twin.handlers().fanControl.percentSettingChange({ percentSetting: 75 });
    assert.equal(fan.isOn(), true);
    assert.equal(fan.getRotationSpeedPercentage(), 75);
  });

  it('ignores the speed it just reported', async () => {
    const fan = fakeFan({ on: true, speed: 60 });
    const { twin } = twinFor(FanTwin, fan);

    let setCalls = 0;
    fan.setRotationSpeedPercentage = async () => {
      setCalls += 1;
    };

    await twin.handlers().fanControl.percentSettingChange({ percentSetting: 60 });
    assert.equal(setCalls, 0);
  });

  it('leaves a device with one speed alone', async () => {
    const fan = fakeFan({ on: true, speed: null });
    const { twin } = twinFor(FanTwin, fan);

    assert.equal(twin.state().fanControl.percentSetting, 100);
    await twin.handlers().fanControl.percentSettingChange({ percentSetting: 40 });
    assert.equal(fan.isOn(), true);
  });
});

describe('the air a purifier reports', () => {
  it('is named the way Matter names it', () => {
    assert.equal(AirQualityTwin.qualityFor(5), 1);
    assert.equal(AirQualityTwin.qualityFor(20), 2);
    assert.equal(AirQualityTwin.qualityFor(40), 3);
    assert.equal(AirQualityTwin.qualityFor(100), 4);
    assert.equal(AirQualityTwin.qualityFor(200), 5);
    assert.equal(AirQualityTwin.qualityFor(400), 6);
  });

  it('is published only by a device that measures it', () => {
    const measures = new AirQualityTwin({ supportsPm25DensityReporting: () => true, getPm25Density: () => 7 }, {}, fakeApi(), silent);
    const does_not = new AirQualityTwin({ supportsPm25DensityReporting: () => false }, {}, fakeApi(), silent);

    assert.equal(measures.supported(), true);
    assert.equal(does_not.supported(), false);
    assert.deepEqual(measures.state().pm25ConcentrationMeasurement, { measuredValue: 7, measurementMedium: 0 });
  });
});

describe('reporting to the controllers', () => {
  it('sends what changed and nothing else', async () => {
    const lamp = fakeLamp({ on: true, brightness: 50, kelvin: 4000 });
    const { twin, api } = twinFor(LightTwin, lamp);

    twin.report();
    assert.deepEqual(api.reported, [], 'nothing changed since the accessory was built');

    await lamp.setBrightness(80);
    twin.report();

    assert.deepEqual(api.reported, [{ uuid: 'uuid-1', cluster: 'levelControl', attributes: { currentLevel: 203 } }]);
  });
});
