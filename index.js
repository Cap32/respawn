var events = require('events');
var spawn = require('child_process').spawn;
var util = require('util');
var xtend = require('xtend');

var Monitor = function(command, opts) {
	events.EventEmitter.call(this);

	this.id = null; // for respawn-group

	this.status = 'stopped';
	this.command = command;
	this.cwd = opts.cwd || process.cwd();
	this.env = opts.env || {};
	this.pid = 0;

	this.sleep = opts.sleep || 1000;
	this.maxRestarts = opts.maxRestarts || 10;

	this.child = null;
	this.started = null;
	this.timeout = null;
};

util.inherits(Monitor, events.EventEmitter);

Monitor.prototype.stop = function() {
	if (this.status === 'stopped' || this.status === 'stopping') return;
	this.status = 'stopping';

	clearTimeout(this.timeout);

	if (this.child) this.child.kill();
	else this._stopped();
};

Monitor.prototype.start = function() {
	if (this.status === 'running') return;

	var self = this;
	var restarts = 0;
	var clock = 60000;

	var loop = function() {
		var child = spawn(self.command[0], self.command.slice(1), {
			cwd: self.cwd,
			env: xtend(process.env, self.env)
		});

		self.started = new Date();
		self.status = 'running';
		self.child = child;
		self.pid = child.pid;
		self.emit('spawn', child);

		child.stdout.on('data', function(data) {
			self.emit('stdout', data);
		});

		child.stderr.on('data', function(data) {
			self.emit('stderr', data);
		});

		var clear = function() {
			if (self.child !== child) return false;
			self.child = null;
			self.pid = 0;
			return true;
		};

		child.on('error', function(err) {
			self.emit('warn', err); // too opionated? maybe just forward err
			if (!clear()) return;
			if (self.status === 'stopping') return self._stopped();
			self.stop();
		});

		child.on('exit', function(code, signal) {
			self.emit('exit', code, signal);
			if (!clear()) return;
			if (self.status === 'stopping') return self._stopped();

			clock -= (Date.now() - (self.started ? self.started.getTime() : 0));

			if (clock <= 0) {
				clock = 60000;
				restarts = 0;
			}

			if (++restarts > self.maxRestarts) return self.stop();

			self.status = 'sleeping';
			self.emit('sleep');

			self.timeout = setTimeout(loop, self.sleep);
		});
	};

	clearTimeout(this.timeout);
	loop();

	if (this.status === 'running') this.emit('start');
};

Monitor.prototype.toJSON = function() {
	var doc = {
		id: this.id,
		status: this.status,
		started: this.started,
		pid: this.pid,
		command: this.command,
		cwd: this.cwd,
		env: this.env
	};

	if (!doc.id) delete doc.id;
	if (!doc.pid) delete doc.pid;
	if (!doc.started) delete doc.started;

	return doc;
};

Monitor.prototype._stopped = function() {
	if (this.status === 'stopped') return;
	this.status = 'stopped';

	this.started = null;
	this.emit('stop');
};

var respawn = function(command, opts) {
	if (!Array.isArray(command)) return respawn(command.command, command);
	return new Monitor(command, opts || {});
};

module.exports = respawn;