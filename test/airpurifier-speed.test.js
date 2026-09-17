const assert = require('node:assert/strict');
const { describe, it } = require('node:test');

const AirPurifierAccessory = require('../lib/modules/airpurifier/AirPurifierAccessory.js');

/**
 * The accessory reads and writes through the device; nothing else of it is needed to check what
 * the rotation speed does.
 */
function accessoryFor(device) {
  const accessory = Object.create(AirPurifierAccessory.prototype);
  accessory.isMiotDeviceConnected = () => true;
  accessory.getDevice = () => device;
  return accessory;
}

function fakePurifier(state = {}) {
  const device = {
    mode: state.mode || 'auto',
    speed: state.speed === undefined ? 33 : state.speed,
    favouriteSpeed: state.favouriteSpeed === undefined ? 100 : state.favouriteSpeed,
    isFavoriteModeEnabled: () => device.mode === 'favorite',
    getFavoriteSpeedPercentage: () => device.favouriteSpeed,
    getRotationSpeedPercentage: () => device.speed,
    turnOnFavoriteModeIfNecessary: () => {
      device.mode = 'favorite';
    },
    setFavoriteSpeedPercentage: (value) => {
      device.favouriteSpeed = value;
    },
  };
  return device;
}

describe('the speed an air purifier shows HomeKit', () => {
  it('is what it is actually doing, even in auto', () => {
    // A zero here reads to HomeKit as "switched on but not running", and it sends 100% the next
    // time the tile is tapped - which drops the purifier out of auto and sets it roaring.
    const device = fakePurifier({ mode: 'auto', speed: 33 });
    assert.equal(accessoryFor(device).getRotationSpeed(), 33);
  });

  it('is the favourite speed while favourite mode is what it is in', () => {
    const device = fakePurifier({ mode: 'favorite', favouriteSpeed: 60 });
    assert.equal(accessoryFor(device).getRotationSpeed(), 60);
  });
});

describe('a speed HomeKit asks for', () => {
  it('leaves auto alone when it is the speed already shown', () => {
    const device = fakePurifier({ mode: 'auto', speed: 33 });
    accessoryFor(device).setRotationSpeed(33);

    assert.equal(device.mode, 'auto', 'restoring the slider must not change the mode');
    assert.equal(device.favouriteSpeed, 100, 'nor the favourite speed');
  });

  it('is obeyed when it is a different speed', () => {
    const device = fakePurifier({ mode: 'auto', speed: 33 });
    accessoryFor(device).setRotationSpeed(60);

    assert.equal(device.mode, 'favorite');
    assert.equal(device.favouriteSpeed, 60);
  });
});
