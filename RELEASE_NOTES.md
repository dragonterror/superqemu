# Superqemu Release Notes


## `v0.2.4`

This release contans breaking changes:

- Superqemu no longer depends on nodejs-rfb, or provides its own VNC client support. Instead, it still sets up VNC in QEMU, and it provides the required information to connect, but allows you the control to connect to the VNC server QEMU has setup yourself.

## `v0.2.3`

- TCP support