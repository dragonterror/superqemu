// A simple/contrived? example of how to use superqemu.
//
// Note that this example requires a valid desktop environment to function
// due to `-display gtk`, but you can remove it and run it headless.
//
// Also note that while superqemu automatically sets up QEMU to use VNC,
// it does not provide its own VNC client implementation. 

import { QemuVM, VMState } from "../dist/index.js";

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
    if(newState == VMState.Started) {
        logger.info(vm.GetDisplayInfo(), `VM started: display info prepends this message`);
    }
});

(async () => {
    await vm.Start();
})();