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
