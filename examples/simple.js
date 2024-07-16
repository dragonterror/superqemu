// A simple example of how to use superqemu.
// Note that this example requires a valid desktop environment to function
// due to `-display gtk`, but you can remove it and run it headless.

import { QemuVM } from "../dist/index.js";

import pino from 'pino';

let logger = pino();

let vm = new QemuVM(
    {
        id: "testvm",
        command: "qemu-system-x86_64 -M pc,hpet=off,accel=kvm -cpu host -m 512 -display gtk",
        snapshot: true
    }
);

vm.on('statechange', (newState) => {
    logger.info(`state changed to ${newState}`);
});

(async () => {
    await vm.Start();
})();