import { execaCommand, ExecaChildProcess } from 'execa';
import { EventEmitter } from 'events';
import { QmpClient, IQmpClientWriter, QmpEvent } from './QmpClient.js';
import { unlink } from 'node:fs/promises';

import pino from 'pino';
import { Readable, Writable } from 'stream';
import { IProcess, IProcessLauncher } from './ProcessInterface.js';
import { DefaultProcessLauncher } from './DefaultProcess.js';

export enum VMState {
	Stopped,
	Starting,
	Started,
	Stopping
}

/// VM definition.
export type QemuVmDefinition = {
	id: string;
	command: string;
	snapshot: boolean;
	forceTcp: boolean;
	vncHost: string | undefined;
	vncPort: number | undefined;
};

/// Display information.
export interface QemuVMDisplayInfo {
	type: 'vnc-uds' | 'vnc-tcp';
	// 'vnc-uds'
	path?: string;

	// 'vnc-tcp'
	host?: string;
	port?: number;
}

/// Temporary path base (for UNIX sockets/etc.)
const kVmTmpPathBase = `/tmp`;

// writer implementation for process standard I/O
class StdioWriter implements IQmpClientWriter {
	stdout;
	stdin;
	client;

	constructor(stdout: Readable, stdin: Writable, client: QmpClient) {
		this.stdout = stdout;
		this.stdin = stdin;
		this.client = client;

		this.stdout.on('data', (data) => {
			this.client.feed(data);
		});
	}

	writeSome(buffer: Buffer) {
		if (!this.stdin.closed) this.stdin.write(buffer);
	}
}

export declare interface QemuVM {
	on(event: 'statechange', listener: (newState: VMState) => void): this;
}

export class QemuVM extends EventEmitter {
	private state = VMState.Stopped;

	// QMP stuff.
	private qmpInstance: QmpClient = new QmpClient();

	private qemuProcess: IProcess | null = null;
	private qemuLauncher: IProcessLauncher;

	private displayInfo: QemuVMDisplayInfo | null = null;
	private definition: QemuVmDefinition;
	private addedAdditionalArguments = false;

	private logger: pino.Logger;

	constructor(def: QemuVmDefinition, processLauncher?: IProcessLauncher) {
		super();
		this.definition = def;
		this.logger = pino({
			name: `SuperQEMU.QemuVM/${this.definition.id}`
		});

		// Fall back to the default process launcher. This is
		// done so we can have our cake (compatibility) and eat it too
		// (do this fun process abstraction stuff for whatever really)
		if (!processLauncher) {
			this.qemuLauncher = new DefaultProcessLauncher();
		} else {
			this.qemuLauncher = processLauncher;
		}

		let self = this;

		// Handle the STOP event sent when using -no-shutdown
		this.qmpInstance.on(QmpEvent.Stop, async () => {
			await self.qmpInstance.execute('system_reset');
		});

		this.qmpInstance.on(QmpEvent.Reset, async () => {
			await self.qmpInstance.execute('cont');
		});

		this.qmpInstance.on('connected', async () => {
			self.logger.info('QMP ready');
			self.SetState(VMState.Started);
		});
	}

	async Start() {
		// Don't start while either trying to start or starting.
		//if (this.state == VMState.Started || this.state == VMState.Starting) return;
		if (this.qemuProcess) return;

		let cmd = this.definition.command;

		// Build additional command line statements to enable qmp/vnc over unix sockets
		if (!this.addedAdditionalArguments) {
			cmd += ' -no-shutdown';
			if (this.definition.snapshot) cmd += ' -snapshot';
			cmd += ` -qmp stdio`;
			if (this.definition.forceTcp || process.platform === 'win32') {
				let host = this.definition.vncHost || '127.0.0.1';
				let port = this.definition.vncPort || 5900;
				if (port < 5900) {
					throw new Error('VNC port must be greater than or equal to 5900');
				}
				cmd += ` -vnc ${host}:${port - 5900}`;
				this.displayInfo = {
					type: 'vnc-tcp',
					host: host,
					port: port
				};
			} else {
				cmd += ` -vnc unix:${this.GetVncPath()}`;
				this.displayInfo = {
					type: 'vnc-uds',
					path: this.GetVncPath()
				};
			}

			this.definition.command = cmd;
			this.addedAdditionalArguments = true;
		}

		await this.StartQemu(cmd);
	}

	SnapshotsSupported(): boolean {
		return this.definition.snapshot;
	}

	async Reboot(): Promise<void> {
		await this.MonitorCommand('system_reset');
	}

	async Stop(): Promise<void> {
		this.AssertState(VMState.Started, 'cannot use QemuVM#Stop on a non-started VM');
		// I'm not sure this is better, but I'm also not sure it should be an assertion
		//if(this.state !== VMState.Started)
		//	return;

		// Indicate we're stopping, so we don't erroneously start trying to restart everything we're going to tear down.
		this.SetState(VMState.Stopping);

		// Stop the QEMU process, which will bring down everything else.
		await this.StopQemu();

		// Wait for the VM to reach the stopped state.
		return new Promise((res, rej) => {
			this.once('statechange', (state) => {
				if (state == VMState.Stopped) res();
			});
		});
	}

	async Reset(): Promise<void> {
		this.AssertState(VMState.Started, 'cannot use QemuVM#Reset on a non-started VM');
		await this.StopQemu();

		let self = this;

		// Wait for the VM to regain the started state
		return new Promise((res, rej) => {
			let cb = (state: VMState) => {
				if (state == VMState.Started) {
					this.removeListener('statechange', cb);
					res();
				}
			};
			this.on('statechange', cb);
		});
	}

	async QmpCommand(command: string, args: any | null): Promise<any> {
		return await this.qmpInstance?.execute(command, args);
	}

	async MonitorCommand(command: string) {
		this.AssertState(VMState.Started, 'cannot use QemuVM#MonitorCommand on a non-started VM');
		let result = await this.QmpCommand('human-monitor-command', {
			'command-line': command
		});
		if (result == null) result = '';
		return result;
	}

	async ChangeRemovableMedia(deviceName: string, imagePath: string): Promise<void> {
		this.AssertState(VMState.Started, 'cannot use QemuVM#ChangeRemovableMedia on a non-started VM');
		// N.B: if this throws, the code which called this should handle the error accordingly
		await this.QmpCommand('blockdev-change-medium', {
			device: deviceName, // techinically deprecated, but I don't feel like figuring out QOM path just for a simple function
			filename: imagePath
		});
	}

	async EjectRemovableMedia(deviceName: string) {
		this.AssertState(VMState.Started, 'cannot use QemuVM#EjectRemovableMedia on a non-started VM');
		await this.QmpCommand('eject', {
			device: deviceName
		});
	}

	// Gets the required information to connect to the VNC server
	// that Superqemu enables by adding arguments to the QEMU launch
	// command. Superqemu no longer directly has a VNC client.
	//
	// This is only null if the VM has never been started.
	GetDisplayInfo() {
		return this.displayInfo;
	}

	GetState() {
		return this.state;
	}

	/// Private fun bits :)

	private VMLog() {
		return this.logger;
	}

	private AssertState(stateShouldBe: VMState, message: string) {
		if (this.state !== stateShouldBe) throw new Error(message);
	}

	private SetState(state: VMState) {
		this.state = state;
		this.emit('statechange', this.state);
	}

	// No longer internal
	private GetVncPath() {
		return `${kVmTmpPathBase}/superqemu-${this.definition.id}-vnc`;
	}

	private async StartQemu(split: string) {
		let self = this;

		this.SetState(VMState.Starting);

		this.logger.info(`Starting QEMU with command \"${split}\"`);

		// Start QEMU
		this.qemuProcess = this.qemuLauncher.launch(split, {
			stdin: 'pipe',
			stdout: 'pipe',
			stderr: 'pipe'
		});

		this.qemuProcess.stderr?.on('data', (data) => {
			self.logger.error(`QEMU stderr: ${data.toString('utf8')}`);
		});

		this.qemuProcess.on('spawn', async () => {
			self.logger.info('QEMU started');
			await self.QmpStdioInit();
		});

		this.qemuProcess.on('exit', async (code) => {
			self.logger.info('QEMU process exited');

			// Dispose events. StartQemu() will assign them again to the new process.
			// A bit mucky but /shrug.
			self.qemuProcess?.dispose();
			self.qemuProcess = null;

			self.qmpInstance.reset();
			self.qmpInstance.setWriter(null);

			if (!this.definition.forceTcp || process.platform !== 'win32') {
				// Remove the VNC UDS socket.
				try {
					await unlink(this.GetVncPath());
				} catch (_) {}
			}

			if (self.state != VMState.Stopping) {
				if (code == 0) {
					await self.StartQemu(split);
				} else {
					self.logger.error('QEMU exited with a non-zero exit code. This usually means an error in the command line. Stopping VM.');
					// Note that we've already tore down everything upon entry to this event handler; therefore
					// we can simply set the state and move on.
					this.SetState(VMState.Stopped);
					self.qemuProcess = null;
				}
			} else {
				// Indicate we have stopped.
				this.SetState(VMState.Stopped);
				self.qemuProcess = null;
			}
		});
	}

	private async StopQemu() {
		if (this.qemuProcess) {
			this.qemuProcess?.kill('SIGTERM');
		}
	}

	private async QmpStdioInit() {
		let self = this;

		self.logger.info('Initializing QMP over stdio');

		// Setup the QMP client.
		let writer = new StdioWriter(this.qemuProcess?.stdout!, this.qemuProcess?.stdin!, self.qmpInstance);
		self.qmpInstance.reset();
		self.qmpInstance.setWriter(writer);
	}
}
