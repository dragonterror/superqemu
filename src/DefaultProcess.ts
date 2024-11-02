// Default process implementation.
// This uses execa like the current code, but conforms to our abstration :)

import EventEmitter from "events";
import { IProcess, IProcessLauncher, ProcessLaunchOptions } from "./ProcessInterface";
import { execaCommand } from "execa";
import { Readable, Writable } from "stream";


class DefaultProcess extends EventEmitter implements IProcess {
    private process;
    stdin: Writable | null = null;
    stdout: Readable | null = null;
    stderr: Readable | null = null;

    constructor(command: string, opts?: ProcessLaunchOptions) {
        super();

        this.process = execaCommand(command, opts);

        this.stdin = this.process.stdin;
        this.stdout = this.process.stdout;
        this.stderr = this.process.stderr;

        let self = this;
        this.process.on('spawn', () => {
            self.emit('spawn');
        });

        this.process.on('exit', (code) => {
            self.emit('exit', code);
        });
    }

    kill(signal?: number | NodeJS.Signals): boolean {
        return this.process.kill(signal);
    }
}

export class DefaultProcessLauncher implements IProcessLauncher {
    launch(command: string, opts?: ProcessLaunchOptions | undefined): IProcess {
        return new DefaultProcess(command, opts);
    }
}