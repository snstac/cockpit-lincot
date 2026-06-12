# Cockpit Application for LINCOT

This [Cockpit](https://cockpit-project.org/) application manages [LINCOT](https://lincot.rtfd.io), the Linux GPS to TAK gateway: service control, `/etc/default/lincot` configuration, TLS certificates, and journal output in a web UI.

## Installing

Download the `.deb` (Debian, Ubuntu, Raspberry Pi OS) or `.rpm` (Fedora, RHEL, CentOS Stream, Rocky, Alma) package from [GitHub Releases](https://github.com/snstac/cockpit-lincot/releases):

```sh
# Debian & derivatives
sudo apt install ./cockpit-lincot_*_all.deb

# Red Hat & derivatives
sudo dnf install ./cockpit-lincot-*.noarch.rpm
```

Install [LINCOT](https://github.com/snstac/lincot) itself alongside the plugin.

Reload Cockpit — **Edge Position (LINCOT)** appears under Tools.

## Building from source

```sh
make                  # build the plugin into dist/
sudo make install     # install to /usr/share/cockpit/lincot
make devel-install    # or: symlink into ~/.local/share/cockpit for development
make deb rpm          # build packages with nfpm
```

## Development

```sh
make watch            # rebuild on change
make ci               # unit tests, eslint, stylelint, production bundle
```

## The snstac TAK sensor ecosystem

Different sensor, same workflow — pick the gateway for your application; most have a
matching Cockpit plugin for browser-based management:

| Application | Gateway | Cockpit plugin |
|---|---|---|
| Aircraft via ADS-B (1090 MHz / 978 MHz UAT) | [adsbcot](https://github.com/snstac/adsbcot) | [cockpit-adsbcot](https://github.com/snstac/cockpit-adsbcot) |
| Ships & vessels via AIS | [aiscot](https://github.com/snstac/aiscot) | [cockpit-aiscot](https://github.com/snstac/cockpit-aiscot), [cockpit-aiscatcher](https://github.com/snstac/cockpit-aiscatcher) |
| Drone / UAS Remote ID (counter-UAS) | [dronecot](https://github.com/snstac/dronecot) | [cockpit-dronecot](https://github.com/snstac/cockpit-dronecot) |
| Own position via GPS/GNSS | [lincot](https://github.com/snstac/lincot) | [cockpit-lincot](https://github.com/snstac/cockpit-lincot), [cockpit-gps](https://github.com/snstac/cockpit-gps) |
| Radio direction finding (KrakenSDR) | [kraktak](https://github.com/snstac/kraktak) | — |
| APRS amateur radio | [aprscot](https://github.com/snstac/aprscot) | — |
| Weather stations | [windtak](https://github.com/snstac/windtak) | — |
| CoT routing / TAK Server bridging | [charontak](https://github.com/snstac/charontak) | — |

All gateways are built on [PyTAK](https://github.com/snstac/pytak), speak
**Cursor on Target (CoT)** to **ATAK, WinTAK, iTAK, TAK Server, and Mesh SA**, ship as
signed Debian/RPM packages at [snstac.github.io/packages](https://snstac.github.io/packages),
and come pre-installed on [AryaOS](https://github.com/snstac/aryaos), the
situational-awareness OS for Raspberry Pi.
