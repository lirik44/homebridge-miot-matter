<h1 align="center">Homebridge MIoT — Matter fork</h1>

<p align="center">
    <a href="https://www.npmjs.com/package/homebridge">
        <img src="https://img.shields.io/badge/powered%20by-homebridge-blue" alt="powered by homebridge">
    </a>
    <a href="#talking-to-a-lamp-that-only-knows-the-old-commands">
        <img src="https://img.shields.io/badge/cloud-not%20required-brightgreen" alt="cloud not required">
    </a>
    <a href="#the-devices-over-matter">
        <img src="https://img.shields.io/badge/matter-lights%20%7C%20fans%20%7C%20air-brightgreen" alt="Matter: lights, fans, air quality">
    </a>
    <a href="LICENSE">
        <img src="https://img.shields.io/badge/license-MIT-lightgrey" alt="license MIT">
    </a>
</p>

---

This is a fork of [`merdok/homebridge-miot`](https://github.com/merdok/homebridge-miot), which brings Xiaomi
MIoT devices into HomeKit and carries the device knowledge for hundreds of models. Everything that plugin
does, this one does.

The fork adds three things: the same devices over **Matter**, a way to talk locally to devices that only
understand the commands they shipped with, and **adaptive lighting** for any lamp that can take it.

## The devices over Matter

| Device | Over Matter |
| --- | --- |
| Light | On/off, a dimmer where the lamp has one, and a colour temperature where it has that |
| Fan, air purifier, humidifier | A fan: on/off and speed |
| Air purifier | Plus an air quality sensor, where the device measures PM2.5 |

An air purifier goes across as a fan because Matter has no air purifier type that controllers render, and a
purifier is a fan with a filter in front of it.

Both halves drive the same device object and hear about every change, so neither ecosystem has its own idea
of what a device is doing. Two guards keep them still, and both were paid for in evening debugging:

- A command asking for what the device is already doing is ignored.
- So is one arriving within a few seconds of this plugin's own report. Reporting a fan's speed makes a
  controller work out the mode and send a speed of its own choosing back — which, obeyed, once set an air
  purifier roaring in manual when all anyone had done was switch it on.

Matter is on wherever the Homebridge bridge running this plugin has Matter enabled; `enableMatter: false`
on a device leaves that one out.

## Talking to a lamp that only knows the old commands

Some devices are described by a MIoT spec and reachable through the Xiaomi cloud with it, but on the local
network they answer nothing to a MIoT property read: they only understand what they shipped with, which for
a Yeelight lamp is `get_prop ["power","bright","ct"]` and `set_power`. Upstream's answer for those is the
cloud — an account, a round trip to a datacentre, and a desk lamp that stops working when the internet does.

A device class can now spell out how to say each of its properties in the old commands, and the protocol
layer translates. The rest of the plugin goes on thinking it is talking to MIoT.

`yeelink.light.lamp4` — the Mi Smart LED Desk Lamp 1S — is supported this way, and its class was generated
from the published spec rather than written by hand.

## Adaptive lighting

HomeKit can move the colour temperature through the day on its own. It asks nothing of a lamp beyond a
dimmer and a colour temperature, so it is offered by every light service that has both, and
`adaptiveLightingControl: false` on a device turns it off.

## Also fixed

Switching an air purifier on from HomeKit used to set it roaring at full speed in manual mode. The
accessory reported a rotation speed of zero in any mode but favourite; HomeKit read that as "switched on
but not running" and helpfully sent 100% along with the tap, which landed on the speed handler, which
turns favourite mode on before setting a speed. The slider now shows what the purifier is actually doing,
and a speed matching what is already shown is ignored — that is HomeKit restoring its slider, not a person
moving it.

## Installation

The package name is unchanged, so this installs over the upstream plugin and your existing configuration
and HomeKit accessories carry on as they were:

```
npm --prefix /var/lib/homebridge install github:lirik44/homebridge-miot-matter
```

## Development

```
npm install
npm test
```

The tests cover the parts that can be checked without hardware: the local command translation, what each
kind of device becomes over Matter, the scales, and the guards above — including the exact sequence that
used to set a purifier roaring.

## Credits

- [merdok/homebridge-miot](https://github.com/merdok/homebridge-miot) — the plugin this fork is based on,
  and the device knowledge behind it
- [homebridge/homebridge](https://github.com/homebridge/homebridge) — Homebridge, and its Matter support

## License

MIT, same as the upstream project.
