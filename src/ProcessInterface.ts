import {type Stream, EventEmitter, Readable, Writable} from 'node:stream';

export type StdioOption =
	| 'pipe'
	| 'overlapped'
	| 'ipc'
	| 'ignore'
	| 'inherit'
	| Stream
	| number
	| undefined;

// subset of options. FIXME: Add more!!!
export interface ProcessLaunchOptions {
    stdin?: StdioOption,
    stdout?: StdioOption,
    stderr?: StdioOption
}

export interface IProcess extends EventEmitter {
    stdin: Writable | null;
    stdout: Readable | null;
    stderr: Readable | null;


    // Escape hatch; only use this if you have no choice
    //native() : any;

    kill(signal?: number | NodeJS.Signals): boolean;

    dispose(): void;
}

// Launches a processs.
export interface IProcessLauncher {
    launch(command: string, opts?: ProcessLaunchOptions) : IProcess;
}