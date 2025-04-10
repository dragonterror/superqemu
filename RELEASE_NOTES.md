# Superqemu Release Notes

## `v0.3.1`

This minor release fixes a bug that would result in the process interface's `dispose()` method never actually being called.

This version is published as `0.3.2` because the npm registry is the most utterly useless piece of garbage I've ever used. This sentiment tends to echo for much of the JavaScript ecosystem. Almost like shoehorning a language meant literally for DHTML clocks and other stuff into being a backend language wasn't a great idea or something...

## `v0.3.0`

This release contains *possibly* breaking changes:

Superqemu now uses a interface to launch and interact with the QEMU process.

This is intended to allow for an external user of superqemu to perform resource control on the QEMU process, which previously was pretty much impossible. 

The library does not enforce this and for compatibility with previous versions of superqemu the process launcher argument in QemuVM is optional.

## `v0.2.4`

This release contans breaking changes:

- Superqemu no longer depends on nodejs-rfb, or provides its own VNC client support. Instead, it still sets up VNC in QEMU, and it provides the required information to connect, but allows you the control to connect to the VNC server QEMU has setup yourself.

## `v0.2.3`

- TCP support