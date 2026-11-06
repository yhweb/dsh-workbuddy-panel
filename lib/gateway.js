import { S as kernelUpdateSettingsPath, T as serverRootDir, _ as deviceTokenPath, a as serverManifest, c as readStoreDocument, g as deviceSignalsPath, i as releaseAssetUrl, l as writeStoreDocument, n as parseServerManifest, o as GATEWAY_HOST_SERVICE, p as activeServerManifestPath, r as platformKey, t as assetForPlatform, v as dshHome, x as gatewayWorkdir, y as gatewayConfigPath } from "./server-release-DgEqjLtX.js";
import { createHash, randomBytes } from "node:crypto";
import z from "@deepseek-ai/schemastery";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { chmodSync, closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { Service } from "@deepseek-ai/cordis";
import { request } from "node:http";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
// src/device-signals.ts
/**
* WorkBuddy's device signals, minted where they can be minted.
*
* Two values the WorkBuddy client attaches to its own requests cannot be
* invented by a Go gateway: `qimei36`, the device id the client's telemetry SDK
* caches on disk, and the Turing device token its native shield library signs on
* this machine. Both are produced locally, so this row reads the first from the
* client's cache and asks the client's own native module for the second.
*
* The row never imports `node:child_process`: the token comes back from a child
* started through `ctx.subprocess`, exactly like the gateway binary. Everything
* the kernel needs lands in two files beside the gateway's own documents, so the
* kernel reads a path instead of reaching into the plugin:
*
* - `device-signals.json` — the whole answer, for the panel and for operators;
* - `device-token.txt` — the bare token, for `upstream.device_token_file`.
*
* A failed mint keeps the previous token. The client itself reuses one token for
* about five minutes, so the last value this machine produced is still the value
* the upstream saw; serving it a little stale beats serving nothing.
*
* @module dsh-workbuddy2api-gateway/device-signals
*/
/** Format version of the device-signals document. */
const DOCUMENT_VERSION = 1;
/** The channel WorkBuddy's domestic build registers its shield with (5.9.x). */
const FALLBACK_CHANNEL_ID = 109144;
/** How often the row re-mints; the client reuses a token for five minutes. */
const DEVICE_REFRESH_MS = 6e4;
/** How long the native library may take before the child is terminated. */
const MINT_TIMEOUT_MS = 2e4;
/** Ceiling on the child's output, so a chatty runtime cannot flood the row. */
const MAX_STDOUT_BYTES = 65536;
/** The script the node child runs: load the shield, ask for one token, print it. */
const TOKEN_SCRIPT = [
	"const fs = require('node:fs')",
	"const input = JSON.parse(process.argv[1])",
	"const answer = (value) => { process.stdout.write(JSON.stringify(value)) }",
	"if (!fs.existsSync(input.native)) {",
	"  answer({ ok: false, error: 'the Turing native module is missing' })",
	"} else {",
	"  try {",
	"    const sdk = require(input.native)",
	"    if (typeof sdk.configure !== \"function\" || typeof sdk.fetchDeviceToken !== \"function\") {",
	"      answer({ ok: false, error: \"the Turing module does not export configure/fetchDeviceToken\" })",
	"    } else {",
	"      sdk.configure(input.channelId, input.productName, input.productVersion)",
	"      Promise.resolve(sdk.fetchDeviceToken({ includesDeviceInfo: false }))",
	"        .then((result) => {",
	"          const token = typeof result === \"string\" ? result : result && result.token",
	"          answer(typeof token === \"string\" && token !== \"\" ? { ok: true, token } : { ok: false, error: \"the Turing module returned no token\" })",
	"        })",
	"        .catch((error) => { answer({ ok: false, error: String((error && error.message) || error) }) })",
	"    }",
	"  } catch (error) {",
	"    answer({ ok: false, error: String((error && error.message) || error) })",
	"  }",
	"}"
].join("\n");
/** Error → one line, for the status document. */
function messageOf$3(error) {
	return error instanceof Error ? error.message : String(error);
}
/** Replace a file atomically with owner-only permissions. */
function writePrivateFile(path, contents) {
	mkdirSync(dirname(path), { recursive: true });
	const temporary = resolve(`${path}.${randomBytes(6).toString("hex")}.tmp`);
	writeFileSync(temporary, contents, {
		mode: 384,
		flag: "wx"
	});
	renameSync(temporary, path);
}
/** The client's own config directory (%WORKBUDDY_CONFIG_DIR%, else ~/.workbuddy). */
function workbuddyConfigDir() {
	const configured = process.env["WORKBUDDY_CONFIG_DIR"];
	return configured !== void 0 && configured.trim() !== "" ? configured : join(homedir(), ".workbuddy");
}
/** The device id the client cached, when it has one. */
function readQimei36() {
	try {
		const parsed = JSON.parse(readFileSync(join(workbuddyConfigDir(), "qimei-cache.json"), "utf8"));
		if (typeof parsed !== "object" || parsed === null) return void 0;
		const value = parsed["qimei36"];
		return typeof value === "string" && /^[0-9A-Za-z]{36}$/u.test(value) ? value : void 0;
	} catch {
		return;
	}
}
/** Read one JSON document, tolerating every kind of absence. */
function readJson$1(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
/** The Turing module to load: the extracted one first, the archived one second. */
function findTuringModule(resources) {
	const roots = [join(resources, "app.asar.unpacked"), join(resources, "app.asar")];
	for (const root of roots) {
		const candidates = [join(root, "native", "turing-sdk", "index.cjs"), join(root, "native", "turing-sdk", "build", "Release", "turing_sdk.node")];
		for (const candidate of candidates) if (existsSync(candidate)) return candidate;
	}
}
/**
* Describe one install, or reject the candidate.
*
* The client keeps its product document inside `cli/product.json` and its native
* shield beside the app archive; both are needed, so a directory that has only
* one of them is not an install.
*/
function describeInstall(candidate) {
	const resources = existsSync(join(candidate, "app.asar")) ? candidate : join(candidate, "resources");
	if (!existsSync(join(resources, "app.asar"))) return void 0;
	const nativeModule = findTuringModule(resources);
	if (nativeModule === void 0) return void 0;
	const product = readJson$1(join(resources, "app.asar", "cli", "product.json"));
	const turing = typeof product?.["config"] === "object" && product["config"] !== null ? product["config"]["turingSdk"] : void 0;
	const channel = typeof turing === "object" && turing !== null ? turing["channelId"] : void 0;
	const app = readJson$1(join(resources, "app.asar", "package.json"));
	const version = typeof product?.["genieVersion"] === "string" ? product["genieVersion"] : typeof app?.["version"] === "string" ? app["version"] : void 0;
	const productName = typeof product?.["productName"] === "string" ? product["productName"] : "WorkBuddy";
	return {
		root: candidate,
		...version === void 0 ? {} : { version },
		channelId: typeof channel === "number" && Number.isFinite(channel) ? channel : FALLBACK_CHANNEL_ID,
		productName,
		nativeModule
	};
}
/** Every place a client is plausibly installed, cheapest first. */
function installCandidates(override) {
	const candidates = [];
	if (override.trim() !== "") candidates.push(override.trim());
	for (const name of [
		"WORKBUDDY_HOME",
		"WORKBUDDY_INSTALL_DIR",
		"WORKBUDDY_ROOT"
	]) {
		const value = process.env[name];
		if (value !== void 0 && value.trim() !== "") candidates.push(value.trim());
	}
	if (process.platform === "win32") {
		const local = process.env["LOCALAPPDATA"];
		if (local !== void 0 && local !== "") candidates.push(join(local, "Programs", "WorkBuddy"), join(local, "WorkBuddy"));
		for (const name of [
			"ProgramW6432",
			"ProgramFiles",
			"ProgramFiles(x86)"
		]) {
			const base = process.env[name];
			if (base !== void 0 && base !== "") candidates.push(join(base, "WorkBuddy"));
		}
		for (const drive of [
			"C:",
			"D:",
			"E:",
			"F:"
		]) for (const sub of [
			"Software",
			"Apps",
			"Tools",
			"Program Files"
		]) candidates.push(join(drive + "\\", sub, "WorkBuddy"));
	} else {
		candidates.push("/Applications/WorkBuddy.app/Contents/Resources");
		candidates.push(join(homedir(), "Applications", "WorkBuddy.app", "Contents", "Resources"));
	}
	return candidates;
}
/** Find the first candidate that is really an install. */
function findWorkBuddy(override) {
	for (const candidate of installCandidates(override)) {
		const install = describeInstall(candidate);
		if (install !== void 0) return install;
	}
}
/**
* A node that can load the shield.
*
* The harness ships its own runtimes, so the first one found is used; the host
* executable is the fallback with `ELECTRON_RUN_AS_NODE`, which turns the same
* binary into a plain node. A bare `node` from PATH is never assumed: the row
* runs on machines that have none.
*/
function findNodeRuntime() {
	const runtimes = join(dshHome(), "dsh-runtimes");
	const binary = process.platform === "win32" ? "node.exe" : "node";
	try {
		for (const entry of readdirSync(runtimes, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const candidate = join(runtimes, entry.name, "dependencies", "node", "bin", binary);
			if (existsSync(candidate)) return { path: candidate };
		}
	} catch {}
	const host = process.execPath;
	if (host === void 0 || host === "") return void 0;
	const name = host.split(/[\\/]/u).pop() ?? "";
	if (name === "node" || name === "node.exe") return { path: host };
	return {
		path: host,
		env: { ELECTRON_RUN_AS_NODE: "1" }
	};
}
/** One line of output is the answer; anything else is noise from the runtime. */
function parseAnswer(text) {
	const lines = text.split("\n");
	for (let index = lines.length - 1; index >= 0; index -= 1) {
		const line = lines[index];
		if (line === void 0) continue;
		const trimmed = line.trim();
		if (!trimmed.startsWith("{")) continue;
		const parsed = readJsonFromText(trimmed);
		if (parsed === void 0) continue;
		const token = parsed["token"];
		if (parsed["ok"] === true && typeof token === "string" && token !== "") return {
			ok: true,
			token
		};
		const error = parsed["error"];
		return {
			ok: false,
			error: typeof error === "string" ? error : "the token child failed without a reason"
		};
	}
	return {
		ok: false,
		error: "the token child printed no answer"
	};
}
/** Parse JSON already in hand. */
function readJsonFromText(text) {
	try {
		const parsed = JSON.parse(text);
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
/** Read the document the previous row (or the previous run) left behind. */
function readDocument() {
	const document = readJson$1(deviceSignalsPath());
	if (document === void 0 || document["version"] !== DOCUMENT_VERSION) return void 0;
	const qimei36 = document["qimei36"];
	const deviceToken = document["deviceToken"];
	const deviceTokenAt = document["deviceTokenAt"];
	const updatedAt = document["updatedAt"];
	const workbuddy = document["workbuddy"];
	return {
		version: DOCUMENT_VERSION,
		updatedAt: typeof updatedAt === "string" ? updatedAt : (/* @__PURE__ */ new Date(0)).toISOString(),
		...typeof qimei36 === "string" ? { qimei36 } : {},
		...typeof deviceToken === "string" ? { deviceToken } : {},
		...typeof deviceTokenAt === "string" ? { deviceTokenAt } : {},
		...typeof workbuddy === "object" && workbuddy !== null ? { workbuddy: {
			root: String(workbuddy["root"] ?? ""),
			...typeof workbuddy["version"] === "string" ? { version: String(workbuddy["version"]) } : {},
			...typeof workbuddy["channelId"] === "number" ? { channelId: Number(workbuddy["channelId"]) } : {}
		} } : {}
	};
}
/**
* The device-signal collector.
*
* It owns no timer: the host row decides when to call {@link refresh}, so the
* cadence stays one visible number in one place.
*/
var DeviceSignalCollector = class {
	options;
	document;
	lastRunAt;
	lastError;
	running;
	constructor(options) {
		this.options = options;
		this.document = readDocument();
		this.lastRunAt = this.document?.updatedAt;
	}
	/** What the panel and the kernel see. */
	status() {
		const document = this.document;
		const workbuddy = document?.workbuddy;
		return {
			enabled: this.options.enabled(),
			...workbuddy?.root === void 0 || workbuddy.root === "" ? {} : { workbuddyRoot: workbuddy.root },
			...workbuddy?.version === void 0 ? {} : { workbuddyVersion: workbuddy.version },
			...document?.qimei36 === void 0 ? {} : { qimei36: document.qimei36 },
			hasToken: document?.deviceToken !== void 0,
			...document?.deviceTokenAt === void 0 ? {} : { tokenAt: document.deviceTokenAt },
			...this.lastRunAt === void 0 ? {} : { refreshedAt: this.lastRunAt },
			path: deviceSignalsPath(),
			tokenPath: deviceTokenPath(),
			...this.lastError === void 0 ? {} : { error: this.lastError }
		};
	}
	/**
	* Read the device id and mint a token, then persist both.
	*
	* Concurrent callers share one run: the panel's refresh button and the row's
	* timer must not start two children.
	*/
	refresh() {
		const running = this.running;
		if (running !== void 0) return running;
		const run = this.collect().catch((error) => {
			this.fail((/* @__PURE__ */ new Date()).toISOString(), messageOf$3(error));
			return this.status();
		}).finally(() => {
			this.running = void 0;
		});
		this.running = run;
		return run;
	}
	/** Forget nothing but the reason: a mint that works clears the last error. */
	async collect() {
		const runAt = (/* @__PURE__ */ new Date()).toISOString();
		if (!this.options.enabled()) {
			this.fail(runAt, "device signals are switched off in the host row configuration");
			return this.status();
		}
		const qimei36 = readQimei36();
		const install = findWorkBuddy(this.options.workbuddyRoot());
		if (install === void 0) {
			this.fail(runAt, "no WorkBuddy client was found; install it and start it once");
			return this.status();
		}
		const minted = await this.mint(install);
		const previous = this.document;
		const token = minted.ok ? minted.token : previous?.deviceToken;
		const tokenAt = minted.ok ? runAt : previous?.deviceTokenAt;
		const qimei = qimei36 ?? previous?.qimei36;
		this.document = {
			version: DOCUMENT_VERSION,
			updatedAt: runAt,
			...qimei === void 0 ? {} : { qimei36: qimei },
			...token === void 0 ? {} : { deviceToken: token },
			...tokenAt === void 0 ? {} : { deviceTokenAt: tokenAt },
			workbuddy: {
				root: install.root,
				...install.version === void 0 ? {} : { version: install.version },
				channelId: install.channelId
			}
		};
		this.lastRunAt = runAt;
		this.lastError = minted.ok ? qimei === void 0 ? "the client has no device id cached yet; start it once so it writes one" : void 0 : minted.error;
		if (!minted.ok) this.options.log?.("workbuddy2api-gateway-host: device token mint failed", minted.error);
		this.persist();
		return this.status();
	}
	/** Run the client's own shield in a child and read the token back. */
	async mint(install) {
		const spawner = this.options.subprocess();
		if (spawner === void 0) return {
			ok: false,
			error: "the host subprocess seam is not available yet"
		};
		const runtime = findNodeRuntime();
		if (runtime === void 0) return {
			ok: false,
			error: "no node runtime was found to load the Turing shield"
		};
		const input = JSON.stringify({
			native: install.nativeModule,
			channelId: install.channelId,
			productName: install.productName,
			productVersion: install.version ?? "0.0.0"
		});
		let handle;
		try {
			handle = spawner.spawn({
				argv: [
					runtime.path,
					"-e",
					TOKEN_SCRIPT,
					input
				],
				cwd: dirname(install.nativeModule),
				stdio: {
					stdin: "ignore",
					stdout: "pipe",
					stderr: "pipe"
				},
				graceMs: 2e3,
				...runtime.env === void 0 ? {} : { env: runtime.env }
			});
		} catch (error) {
			return {
				ok: false,
				error: "could not start the token child: " + messageOf$3(error)
			};
		}
		let stdout = "";
		let stderr = "";
		handle.stdout?.on("data", (chunk) => {
			if (stdout.length < MAX_STDOUT_BYTES) stdout += String(chunk);
		});
		handle.stderr?.on("data", (chunk) => {
			if (stderr.length < MAX_STDOUT_BYTES) stderr += String(chunk);
		});
		let timedOut = false;
		const timer = setTimeout(() => {
			timedOut = true;
			handle.terminate();
		}, MINT_TIMEOUT_MS);
		timer.unref?.();
		try {
			await handle.done;
		} catch (error) {
			return {
				ok: false,
				error: "the token child failed: " + messageOf$3(error)
			};
		} finally {
			clearTimeout(timer);
		}
		if (timedOut) return {
			ok: false,
			error: "the Turing shield did not answer within " + String(MINT_TIMEOUT_MS) + "ms"
		};
		const answer = parseAnswer(stdout);
		if (answer.ok) return answer;
		const detail = stderr.trim();
		return {
			ok: false,
			error: detail === "" ? answer.error : answer.error + " (" + detail.slice(0, 200) + ")"
		};
	}
	/** Record a failed run without touching the token already on disk. */
	fail(at, error) {
		this.lastRunAt = at;
		this.lastError = error;
		this.options.log?.("workbuddy2api-gateway-host: device signals unavailable", error);
		this.persist();
	}
	/** Write the two documents the kernel reads. A failed write stays in memory. */
	persist() {
		const document = this.document;
		if (document === void 0) return;
		try {
			writePrivateFile(deviceSignalsPath(), `${JSON.stringify(document, null, 2)}\n`);
			if (document.deviceToken !== void 0) writePrivateFile(deviceTokenPath(), document.deviceToken);
		} catch (error) {
			this.options.log?.("workbuddy2api-gateway-host: could not write the device-signal documents", error);
		}
	}
};
// src/default-config.ts
/**
* The gateway configuration this plugin writes on a fresh install.
*
* Copied field-for-field from a working workbuddy2api-panel install: every policy
* the panel ships with (pool weights, breakers, cooldowns, the schedule of
* check-in / keepalive / growth tasks, sticky sessions, prompt passthrough) is
* part of the default. A minimal document - just listen address and key - runs,
* but silently drops all of that: the scheduled tasks never fire and the pool
* behaves like its zero values.
*
* Only four fields are the plugin business, and gatewayConfigDocument()
* overwrites them: api_key, listen, auth_dir, state_file.
*
* @module dsh-workbuddy-panel/default-config
*/
/** The document a fresh install starts from. */
const DEFAULT_GATEWAY_CONFIG = {
	"api_key": "",
	"auth_dir": "./auths",
	"cn": { "chat_base": "" },
	"cooldown": {
		"soft_rate": "600s",
		"soft_rate_max": "2h"
	},
	"dns_servers": [],
	"features": { "sanitize_blacklist_fingerprints": true },
	"global": {
		"billing_base": "",
		"chat_base": "",
		"enabled": true
	},
	"listen": ":7863",
	"logging": {
		"request_archive_enabled": true,
		"request_archive_max_mb": 100,
		"request_client_info": true,
		"request_retention_days": 7
	},
	"models": {
		"_comment": "hidden: 不对外暴露的模型黑名单。裸名=两域都藏；\"cn:xxx\"/\"global:xxx\"=只藏该域。/v1/models 列表过滤 + chat 点名拒绝，面板保存后热生效。",
		"hidden": []
	},
	"panel": { "package_detail_limit": 5 },
	"pool": {
		"account_order": {
			"domestic": [],
			"international": []
		},
		"breaker_cooldown": "30m",
		"breaker_cooldown_max": "6h",
		"breaker_threshold": 3,
		"cost_explore_interval": "30m",
		"credit_floor": 100,
		"cross_domain_fallback": false,
		"degrade_cooldown": "10m",
		"degrade_cooldown_max": "2h",
		"degrade_threshold": 5,
		"expiring_soon": "168h",
		"idle_weight_max": 5,
		"idle_weight_per_hour": .5,
		"max_in_flight": 3,
		"max_in_flight_global": 2,
		"prefer_expiring": true,
		"strategy": {
			"domestic": "weighted_random",
			"international": "weighted_random"
		}
	},
	"prompt": {
		"file": "",
		"mode": "passthrough"
	},
	"schedule": {
		"activity_enabled": true,
		"activity_hours": [10],
		"balance_refresh_enabled": true,
		"balance_refresh_minutes": 5,
		"blackcat_enabled": true,
		"blackcat_hours": [23],
		"checkin_enabled": true,
		"checkin_hours": [9, 21],
		"growth_enabled": true,
		"growth_hours": [1],
		"include_disabled_in_tasks": false,
		"keepalive_enabled": true,
		"keepalive_hours": [22],
		"task_sweep_enabled": true,
		"task_sweep_minutes": 15,
		"travel_enabled": true,
		"travel_hours": [9, 21]
	},
	"server": { "read_timeout": "300s" },
	"session_sticky": {
		"enabled": true,
		"gc_interval": "5m",
		"ttl": "30m"
	},
	"state_file": "./data/state.json",
	"upstash": {
		"token": "",
		"url": ""
	},
	"upstream": {
		"chat_fingerprint": "",
		"cli_version": "",
		"client_name": "",
		"client_version": "",
		"device_token": "",
		"device_token_file": "",
		"header_timeout_seconds": 120,
		"idle_timeout_seconds": 300,
		"passthrough_ip": false,
		"timeout_seconds": 120,
		"ua_client_name": "",
		"user_agent": ""
	}
};
/** Deep copy of the default document with the four owned fields applied. */
function gatewayConfigDocument(options) {
	return {
		...JSON.parse(JSON.stringify(DEFAULT_GATEWAY_CONFIG)),
		api_key: options.apiKey,
		listen: ":" + String(options.port),
		auth_dir: options.authDir === "" ? "./auths" : options.authDir,
		state_file: "./data/state.json"
	};
}
/**
* Merge an existing gateway document over the defaults.
*
* Inheriting is what makes pointing the plugin at an existing gateway lossless:
* the user own pool weights, hidden models and upstream settings survive, while
* the four owned fields still follow this install.
*/
function inheritGatewayConfig(existing, options) {
	return {
		...existing === void 0 ? gatewayConfigDocument(options) : JSON.parse(JSON.stringify(existing)),
		api_key: options.apiKey,
		listen: ":" + String(options.port),
		auth_dir: options.authDir === "" ? "./auths" : options.authDir,
		state_file: "./data/state.json"
	};
}
// src/gateway-supervisor.ts
/**
* The process half, now owned by a host composition row.
*
* The gateway is a Go binary, so "the host runs it" can only mean the host's
* subprocess seam owns the child. This supervisor never imports
* `node:child_process`: it asks `ctx.subprocess` for a managed handle, reads the
* handle's streams, and terminates through the handle. A panel reload does not
* touch it; a host shutdown terminates the managed range.
*
* @module dsh-workbuddy-panel/gateway-supervisor
*/
/** Depth of the visible log when the caller names none. */
const DEFAULT_LOG_LIMIT = 240;
/** Ceiling for a restart's backoff. */
const MAX_BACKOFF_MS = 3e4;
/** Grace before a stop escalates to SIGKILL. */
const KILL_GRACE_MS = 5e3;
/** Read a JSON object without throwing. */
function readJsonObject(path) {
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8"));
		return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : void 0;
	} catch {
		return;
	}
}
/** Turn a chunk into complete lines, keeping the partial tail for the next one. */
function splitLines(buffer, chunk) {
	const parts = (buffer + chunk).split(/\r?\n/u);
	return {
		lines: parts.slice(0, -1),
		rest: parts.at(-1) ?? ""
	};
}
function messageOf$2(error) {
	return error instanceof Error ? error.message : String(error);
}
function isBlockedState(state) {
	return state === "server-missing" || state === "server-invalid" || state === "host-unavailable";
}
function delay(ms) {
	return new Promise((resolveWait) => {
		setTimeout(resolveWait, ms).unref?.();
	});
}
/**
* Supervise one `workbuddy2api` gateway through the host subprocess seam.
*
* Every method is safe to call at any time: paths and the server cache are read
* lazily, so a settings change lands without restarting the host row.
*/
var GatewaySupervisor = class {
	options;
	handle;
	stopping = false;
	restartTimer;
	restarts = 0;
	since;
	lastExit;
	error;
	state = "stopped";
	ready = false;
	logLines = [];
	stdoutBuffer = "";
	stderrBuffer = "";
	disposed = false;
	constructor(options) {
		this.options = options;
	}
	/** The ring buffer's depth. */
	get limit() {
		return this.options.logLimit ?? DEFAULT_LOG_LIMIT;
	}
	/** Append one line, dropping the oldest beyond the limit. */
	note(stream, text) {
		this.logLines.push({
			at: (/* @__PURE__ */ new Date()).toISOString(),
			stream,
			text
		});
		while (this.logLines.length > this.limit) this.logLines.shift();
	}
	/** Feed one stream chunk into the line buffer. */
	feed(stream, chunk) {
		const text = typeof chunk === "string" ? chunk : chunk.toString("utf8");
		const split = splitLines(stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer, text);
		if (stream === "stdout") this.stdoutBuffer = split.rest;
		else this.stderrBuffer = split.rest;
		for (const line of split.lines) {
			const trimmed = line.trimEnd();
			if (trimmed !== "") this.note(stream, trimmed);
		}
	}
	/** Flush a partial line before a process is declared gone. */
	flushLines() {
		for (const stream of ["stdout", "stderr"]) {
			const buffer = stream === "stdout" ? this.stdoutBuffer : this.stderrBuffer;
			if (buffer.trim() !== "") this.note(stream, buffer.trimEnd());
			if (stream === "stdout") this.stdoutBuffer = "";
			else this.stderrBuffer = "";
		}
	}
	/** The verified executable this row would run right now. */
	resolveBinary() {
		return this.options.server().resolveBinary();
	}
	/**
	* Ensure a usable `config.json`, generating one when it is missing.
	*
	* The generated document is the full panel default, not a five-field
	* minimum: a minimal config starts the process but silently drops the pool
	* policy and every scheduled task.
	*/
	ensureConfig() {
		const path = this.options.configPath();
		if (readJsonObject(path) !== void 0) return {
			path,
			created: false
		};
		mkdirSync(this.options.workdir(), { recursive: true });
		const apiKey = "wb2a-" + randomBytes(18).toString("hex");
		const authDir = this.options.authDir?.() ?? "";
		const document = inheritGatewayConfig(this.options.baseConfig?.(), {
			apiKey,
			port: this.options.port(),
			authDir
		});
		mkdirSync(join(this.options.workdir(), "data"), { recursive: true });
		writeFileSync(path, JSON.stringify(document, null, 2) + String.fromCharCode(10), "utf8");
		this.note("plugin", "generated " + path + " with a fresh api key");
		return {
			path,
			created: true,
			apiKey
		};
	}
	/** Write a new api_key into the gateway config, keeping every other field. */
	updateConfigApiKey(key) {
		const path = this.options.configPath();
		const document = readJsonObject(path) ?? { listen: ":" + String(this.options.port()) };
		try {
			mkdirSync(this.options.workdir(), { recursive: true });
			writeFileSync(path, JSON.stringify({
				...document,
				api_key: key
			}, null, 2) + String.fromCharCode(10), "utf8");
			this.note("plugin", "api key updated in " + path);
			return true;
		} catch (error) {
			this.note("plugin", "could not write the api key: " + messageOf$2(error));
			return false;
		}
	}
	/** The API key the gateway's config.json carries, when readable. */
	apiKeyFromConfig() {
		const key = readJsonObject(this.options.configPath())?.["api_key"];
		return typeof key === "string" && key !== "" ? key : void 0;
	}
	/**
	* Probe `/healthz` and verify the service identity.
	*
	* A raw `http` request, not `fetch`: this is a loopback liveness check, and a
	* `fetch` would honour an ambient proxy. The identity check is what separates
	* "our gateway" from "some other service on the same port".
	*/
	async probe() {
		return await new Promise((resolveProbe) => {
			const req = request({
				host: "127.0.0.1",
				port: this.options.port(),
				path: "/healthz",
				method: "GET",
				timeout: this.options.probeTimeoutMs ?? 2e3,
				headers: { Accept: "application/json" }
			}, (response) => {
				let body = "";
				response.setEncoding("utf8");
				response.on("data", (chunk) => {
					if (body.length < 4096) body += chunk;
				});
				response.on("end", () => {
					const status = response.statusCode ?? 0;
					const rawHeader = response.headers["x-service"];
					const header = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;
					let jsonService;
					try {
						const parsed = JSON.parse(body);
						if (typeof parsed === "object" && parsed !== null) jsonService = parsed["service"];
					} catch {}
					if ((status === 200 || status === 503) && (header === "workbuddy2api" || jsonService === "workbuddy2api")) resolveProbe("up");
					else resolveProbe("foreign");
				});
			});
			req.on("timeout", () => {
				req.destroy();
				resolveProbe("down");
			});
			req.on("error", () => {
				resolveProbe("down");
			});
			req.end();
		});
	}
	/** Recompute the state without spawning anything. */
	async refresh() {
		if (this.handle !== void 0) {
			if (!this.ready) {
				const probe = await this.probe();
				if (probe === "up") {
					this.ready = true;
					this.state = "running";
					this.error = void 0;
				} else if (probe === "foreign") {
					this.state = "port-conflict";
					this.error = "port " + String(this.options.port()) + " is used by another service";
				} else this.state = "starting";
			} else this.state = "running";
			return this.status();
		}
		const probe = await this.probe();
		if (probe === "up") {
			this.state = "external";
			this.error = void 0;
		} else if (probe === "foreign") {
			this.state = "port-conflict";
			this.error = "port " + String(this.options.port()) + " is used by another service";
		} else if (!isBlockedState(this.state)) this.state = this.error === void 0 ? "stopped" : "failed";
		return this.status();
	}
	/** Start the gateway if it is not already up. */
	async start() {
		this.disposed = false;
		if (this.handle !== void 0) return this.status();
		const probe = await this.probe();
		if (probe === "up") {
			this.state = "external";
			this.error = void 0;
			return this.status();
		}
		if (probe === "foreign") {
			this.state = "port-conflict";
			this.error = "port " + String(this.options.port()) + " is used by another service";
			this.note("plugin", this.error);
			return this.status();
		}
		const config = this.ensureConfig();
		const binary = this.resolveBinary();
		if (binary === void 0) {
			const server = this.options.server().status();
			const installedButInvalid = server.installedVersion !== void 0 && server.installedVersion === server.version;
			this.state = installedButInvalid ? "server-invalid" : "server-missing";
			this.error = server.error ?? (installedButInvalid ? "the server binary failed verification" : "the server is not installed; download it in the gateway tab");
			this.note("plugin", this.error);
			return this.status();
		}
		const subprocess = this.options.subprocess();
		if (subprocess === void 0) {
			this.state = "host-unavailable";
			this.error = "the DSH subprocess service is unavailable; this host cannot run the gateway";
			this.note("plugin", this.error);
			return this.status();
		}
		this.stopping = false;
		this.error = void 0;
		this.ready = false;
		this.since = (/* @__PURE__ */ new Date()).toISOString();
		try {
			const handle = subprocess.spawn({
				argv: [
					binary,
					"-config",
					config.path
				],
				cwd: this.options.workdir(),
				stdio: {
					stdin: "ignore",
					stdout: "pipe",
					stderr: "pipe"
				},
				graceMs: this.options.killGraceMs ?? KILL_GRACE_MS
			});
			this.handle = handle;
			this.state = "starting";
			this.note("plugin", "spawned via DSH host subprocess: " + binary);
			handle.stdout?.on("data", (chunk) => {
				this.feed("stdout", chunk);
			});
			handle.stderr?.on("data", (chunk) => {
				this.feed("stderr", chunk);
			});
			handle.done.then((outcome) => {
				this.afterExit(outcome.exitCode, outcome.signal);
			}, (error) => {
				this.afterExit(null, null, error);
			});
		} catch (error) {
			this.handle = void 0;
			this.state = "failed";
			this.error = messageOf$2(error);
			this.note("plugin", "spawn failed: " + this.error);
		}
		return this.status();
	}
	/** Decide what follows one exit: a backed-off restart, or a resting failure. */
	afterExit(code, signal, failure) {
		this.flushLines();
		this.handle = void 0;
		this.ready = false;
		this.since = void 0;
		this.lastExit = {
			code,
			signal,
			at: (/* @__PURE__ */ new Date()).toISOString()
		};
		if (failure !== void 0) {
			this.error = messageOf$2(failure);
			this.note("plugin", "subprocess failed: " + this.error);
		}
		this.note("plugin", "exited (code " + String(code ?? "null") + ", signal " + String(signal ?? "null") + ")");
		if (this.stopping || this.disposed) {
			this.state = "stopped";
			return;
		}
		if (!this.options.autoStart()) {
			this.state = "failed";
			return;
		}
		const limit = this.options.restartLimit();
		if (this.restarts >= limit) {
			this.error = "gateway exited " + String(this.restarts) + " times; automatic restart gave up";
			this.note("plugin", this.error);
			this.state = "failed";
			return;
		}
		const wait = Math.min(MAX_BACKOFF_MS, 1e3 * 2 ** this.restarts);
		this.restarts += 1;
		this.state = "failed";
		this.note("plugin", "restarting in " + String(wait) + "ms (" + String(this.restarts) + "/" + String(limit) + ")");
		this.restartTimer = setTimeout(() => {
			this.restartTimer = void 0;
			if (this.disposed) return;
			this.start();
		}, wait);
		this.restartTimer.unref?.();
	}
	/**
	* Stop the gateway.
	*
	* A child this row started is terminated through its host handle. An external
	* gateway is left alone: stopping a process this row did not spawn belongs
	* where it was started.
	*/
	async stop() {
		this.stopping = true;
		if (this.restartTimer !== void 0) {
			clearTimeout(this.restartTimer);
			this.restartTimer = void 0;
		}
		const handle = this.handle;
		if (handle === void 0) {
			const probe = await this.probe();
			if (probe === "up") {
				this.state = "external";
				this.error = "this gateway was started outside the host row; stop it where it was started";
				return this.status();
			}
			if (probe === "foreign") {
				this.state = "port-conflict";
				this.error = "port " + String(this.options.port()) + " is used by another service";
				return this.status();
			}
			this.state = "stopped";
			this.error = void 0;
			return this.status();
		}
		try {
			handle.terminate();
		} catch {}
		await Promise.race([handle.waitForExit().catch(() => {}), delay((this.options.killGraceMs ?? KILL_GRACE_MS) + 1e3)]);
		this.flushLines();
		this.handle = void 0;
		this.state = "stopped";
		this.since = void 0;
		this.ready = false;
		this.restarts = 0;
		this.note("plugin", "stopped");
		return this.status();
	}
	/** Stop then start, keeping the restart counter reset. */
	async restart() {
		this.restarts = 0;
		await this.stop();
		return this.start();
	}
	/** The current snapshot. */
	status() {
		const server = this.options.server().status();
		const binary = server.binaryPath;
		return {
			state: this.state,
			managed: this.handle !== void 0,
			host: this.options.subprocess() === void 0 ? "unavailable" : "dsh-subprocess",
			...binary === void 0 ? {} : { binary },
			serverVersion: server.version,
			configPath: this.options.configPath(),
			workdir: this.options.workdir(),
			port: this.options.port(),
			...this.since === void 0 ? {} : { since: this.since },
			restarts: this.restarts,
			...this.lastExit === void 0 ? {} : { lastExit: this.lastExit },
			...this.error === void 0 ? {} : { error: this.error },
			autoStart: this.options.autoStart(),
			log: this.logLines.slice(-60)
		};
	}
	/** Terminate the handle and wait for the managed range to settle. */
	async dispose() {
		this.disposed = true;
		if (this.restartTimer !== void 0) {
			clearTimeout(this.restartTimer);
			this.restartTimer = void 0;
		}
		const handle = this.handle;
		this.handle = void 0;
		if (handle === void 0) return;
		try {
			handle.terminate();
		} catch {}
		await Promise.race([handle.waitForExit().catch(() => {}), delay((this.options.killGraceMs ?? KILL_GRACE_MS) + 1e3)]);
	}
};
// src/kernel-update.ts
/** The cadences the settings page offers. */
const KERNEL_CADENCES = ["hourly", "never"];
/** Narrow an untrusted value to a cadence. */
function isKernelCadence(value) {
	return value === "hourly" || value === "never";
}
/** The release tag prefix the kernel channel uses. */
const TAG_PREFIX = "server-v";
/** GitHub caps `per_page` at 100; 30 releases is far more than this channel needs. */
const RELEASE_PAGE_SIZE = 30;
/** Compare two `x.y.z[-suffix]` versions. Positive when `a` is newer. */
function compareVersions(a, b) {
	const [aCore = "", aSuffix = ""] = splitVersion(a);
	const [bCore = "", bSuffix = ""] = splitVersion(b);
	const aParts = aCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const bParts = bCore.split(".").map((part) => Number.parseInt(part, 10) || 0);
	const length = Math.max(aParts.length, bParts.length);
	for (let index = 0; index < length; index += 1) {
		const left = aParts[index] ?? 0;
		const right = bParts[index] ?? 0;
		if (left !== right) return left > right ? 1 : -1;
	}
	if (aSuffix === bSuffix) return 0;
	if (aSuffix === "") return 1;
	if (bSuffix === "") return -1;
	return aSuffix > bSuffix ? 1 : -1;
}
/** Split `1.2.3-panel` into `['1.2.3', 'panel']`. */
function splitVersion(version) {
	const trimmed = version.trim();
	const dash = trimmed.indexOf("-");
	return dash < 0 ? [trimmed, ""] : [trimmed.slice(0, dash), trimmed.slice(dash + 1)];
}
/** Derive `owner/repo` from a GitHub release base URL. */
function githubRepoFromBase(baseUrl) {
	try {
		const url = new URL(baseUrl);
		if (url.protocol !== "https:" || !/(^|\.)github\.com$/iu.test(url.hostname)) return void 0;
		const segments = url.pathname.split("/").filter((segment) => segment !== "");
		if (segments.length < 2) return void 0;
		const [owner = "", repo = ""] = segments;
		if (owner === "" || repo === "") return void 0;
		return {
			owner,
			repo
		};
	} catch {
		return;
	}
}
/**
* Fetch the newest published kernel manifest.
*
* With `manifestUrl` set the document is read directly (a user-hosted channel).
* Otherwise the newest non-draft `server-v*` release is located through the
* GitHub API and its `server.json` asset is read. Both paths validate the
* document with the same parser the packaged manifest uses.
*/
async function fetchLatestServerManifest(options) {
	const { fetchImpl } = options;
	const manifestUrl = options.manifestUrl?.trim() ?? "";
	if (manifestUrl !== "") {
		const raw = await readJson(fetchImpl, manifestUrl, options.signal);
		const manifest = parseServerManifest(raw);
		assertChannel(manifest);
		return manifest;
	}
	const repo = githubRepoFromBase(options.releaseBaseUrl);
	if (repo === void 0) throw new Error("update channel is not a GitHub release base: " + options.releaseBaseUrl);
	const releases = await readJson(fetchImpl, "https://api.github.com/repos/" + repo.owner + "/" + repo.repo + "/releases?per_page=" + String(RELEASE_PAGE_SIZE), options.signal);
	const tag = newestKernelTag(releases);
	if (tag === void 0) throw new Error("no server-v* release found");
	const assetUrl = manifestAssetUrl(releases, tag);
	if (assetUrl === void 0) throw new Error("release " + tag + " has no server.json asset");
	const manifest = parseServerManifest(await readJson(fetchImpl, assetUrl, options.signal));
	assertChannel(manifest);
	if (manifest.version !== tag.slice(8)) throw new Error("manifest version " + manifest.version + " does not match release " + tag);
	return manifest;
}
/** The newest kernel tag in a release listing, ignoring drafts and pre-releases. */
function newestKernelTag(releases) {
	if (!Array.isArray(releases)) return void 0;
	const tags = [];
	for (const entry of releases) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		if (record["draft"] === true || record["prerelease"] === true) continue;
		const tag = record["tag_name"];
		if (typeof tag !== "string" || !tag.startsWith(TAG_PREFIX)) continue;
		if (tag.length === 8) continue;
		tags.push(tag);
	}
	tags.sort((left, right) => compareVersions(right.slice(8), left.slice(8)));
	return tags[0];
}
/** The browser URL of the manifest asset inside one release. */
function manifestAssetUrl(releases, tag) {
	if (!Array.isArray(releases)) return void 0;
	for (const entry of releases) {
		if (typeof entry !== "object" || entry === null) continue;
		const record = entry;
		if (record["tag_name"] !== tag) continue;
		const assets = record["assets"];
		if (!Array.isArray(assets)) continue;
		for (const asset of assets) {
			if (typeof asset !== "object" || asset === null) continue;
			const fields = asset;
			if (fields["name"] !== "server.json") continue;
			const url = fields["browser_download_url"];
			if (typeof url === "string" && url.startsWith("https://")) return url;
		}
	}
}
/** A discovered manifest must stay on the packaged channel origin. */
function assertChannel(manifest) {
	if (manifest.releaseBaseUrl !== "") {
		if (githubRepoFromBase(manifest.releaseBaseUrl) === void 0) throw new Error("manifest releaseBaseUrl is not a GitHub release base");
	}
}
/** GET a JSON document with a hard timeout. */
async function readJson(fetchImpl, url, signal) {
	const controller = new AbortController();
	const timer = setTimeout(() => {
		controller.abort();
	}, 15e3);
	const onAbort = () => {
		controller.abort();
	};
	signal?.addEventListener("abort", onAbort, { once: true });
	try {
		const response = await fetchImpl(url, {
			headers: {
				accept: "application/vnd.github+json, application/json",
				"user-agent": "dsh-workbuddy-panel"
			},
			signal: controller.signal
		});
		if (!response.ok) throw new Error("HTTP " + String(response.status) + " for " + url);
		return await response.json();
	} finally {
		clearTimeout(timer);
		signal?.removeEventListener("abort", onAbort);
	}
}
// src/server-store.ts
/**
* The verified server cache.
*
* One pinned release, one platform directory, one checksum. Downloads are
* streamed through gzip, hashed while decompressing, written to a private temp
* file, and renamed into place only after the size and SHA-256 match
* `server.json`. The panel never executes a partial file and never trusts a
* remote manifest.
*
* @module dsh-workbuddy-panel/server-store
*/
/** The lock is stale after this long; a crashed host must not block forever. */
const LOCK_STALE_MS = 6e5;
/** Hard ceiling for the decompressed binary. */
const DEFAULT_MAX_BYTES = 67108864;
/** A download is already in flight in this process. */
var ServerDownloadInProgressError = class extends Error {
	constructor() {
		super("a server download is already in progress");
		this.name = "ServerDownloadInProgressError";
	}
};
/** The pinned release has no asset for this platform. */
var ServerUnsupportedPlatformError = class extends Error {
	constructor(key) {
		super("server release has no build for " + key);
		this.name = "ServerUnsupportedPlatformError";
	}
};
/** The downloaded bytes did not match the pinned size or hash. */
var ServerChecksumError = class extends Error {
	constructor(message) {
		super(message);
		this.name = "ServerChecksumError";
	}
};
/** The caller aborted the download. */
var ServerDownloadCancelledError = class extends Error {
	constructor() {
		super("server download cancelled");
		this.name = "ServerDownloadCancelledError";
	}
};
/** The local server cache and its one download state machine. */
var ServerStore = class {
	manifest;
	rootDir;
	platform;
	arch;
	key;
	releaseBaseUrl;
	fetchImpl;
	log;
	maxBytes;
	progress = {
		state: "idle",
		received: 0,
		total: 0
	};
	lastError;
	active;
	verified;
	invalid = false;
	constructor(options = {}) {
		this.manifest = options.manifest ?? serverManifest();
		this.rootDir = options.rootDir ?? serverRootDir();
		this.platform = options.platform ?? process.platform;
		this.arch = options.arch ?? process.arch;
		this.key = platformKey(this.platform, this.arch);
		this.log = options.log;
		const requestedBase = options.releaseBaseUrl?.trim() ?? "";
		this.releaseBaseUrl = requestedBase === "" ? this.manifest.releaseBaseUrl : allowedReleaseBase(requestedBase) ? requestedBase : this.manifest.releaseBaseUrl;
		if (requestedBase !== "" && this.releaseBaseUrl !== requestedBase) this.log?.("workbuddy2api-gateway: ignoring a non-HTTPS server mirror");
		this.fetchImpl = options.fetchImpl ?? fetch;
		this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
	}
	/** The pinned asset for this platform, when the release has one. */
	asset() {
		return assetForPlatform(this.manifest, this.platform, this.arch);
	}
	/** The release asset URL this store would download. */
	releaseUrl() {
		const asset = this.asset();
		return asset === void 0 ? "" : releaseAssetUrl(this.manifest, asset, this.releaseBaseUrl);
	}
	/** The current cache and download state. */
	status() {
		const asset = this.asset();
		const current = this.readCurrent();
		const binary = current === void 0 ? void 0 : this.binaryPath(current.version);
		const installed = !this.invalid && asset !== void 0 && current?.version === this.manifest.version && binary !== void 0 && this.fileMatches(binary, asset.size);
		const fallbackError = asset === void 0 ? "server release has no build for " + this.key : void 0;
		const working = this.progress.state === "downloading" || this.progress.state === "verifying" || this.progress.state === "installing";
		const download = installed && !working ? {
			state: "idle",
			received: asset?.downloadSize ?? 0,
			total: asset?.downloadSize ?? 0
		} : { ...this.progress };
		const error = installed && !working ? void 0 : this.lastError ?? fallbackError;
		return {
			platform: this.platform,
			arch: this.arch,
			supported: asset !== void 0,
			version: this.manifest.version,
			apiVersion: this.manifest.apiVersion,
			installed,
			...current?.version === void 0 ? {} : { installedVersion: current.version },
			...installed && binary !== void 0 ? { binaryPath: binary } : {},
			sha256: asset?.sha256 ?? "",
			size: asset?.size ?? 0,
			downloadSize: asset?.downloadSize ?? 0,
			releaseUrl: asset === void 0 ? "" : releaseAssetUrl(this.manifest, asset, this.releaseBaseUrl),
			download,
			...error === void 0 ? {} : { error }
		};
	}
	/** The verified executable for the pinned version, or undefined. */
	resolveBinary() {
		const asset = this.asset();
		const current = this.readCurrent();
		if (asset === void 0 || current === void 0 || current.version !== this.manifest.version) return void 0;
		const binary = this.binaryPath(current.version);
		if (!this.fileMatches(binary, asset.size)) return void 0;
		try {
			const stat = statSync(binary);
			if (this.verified?.path === binary && this.verified.size === stat.size && this.verified.mtimeMs === stat.mtimeMs) return binary;
			if (hashFileSync(binary) !== asset.sha256) {
				this.invalid = true;
				this.verified = void 0;
				this.lastError = "server checksum mismatch; download it again";
				this.log?.("workbuddy2api-gateway: " + this.lastError);
				return;
			}
			this.invalid = false;
			this.lastError = void 0;
			this.verified = {
				path: binary,
				size: stat.size,
				mtimeMs: stat.mtimeMs
			};
			return binary;
		} catch (error) {
			this.lastError = "server binary is unreadable: " + messageOf$1(error);
			this.log?.("workbuddy2api-gateway: " + this.lastError, error);
			return;
		}
	}
	/** Re-hash the installed binary and report the result. */
	async verify() {
		const asset = this.asset();
		const current = this.readCurrent();
		if (asset === void 0 || current === void 0 || current.version !== this.manifest.version) {
			this.lastError = "the pinned server is not installed";
			return this.status();
		}
		const binary = this.binaryPath(current.version);
		if (!this.fileMatches(binary, asset.size)) {
			this.lastError = "the server binary is missing or has the wrong size";
			return this.status();
		}
		if (await hashFile(binary) !== asset.sha256) {
			this.invalid = true;
			this.verified = void 0;
			this.lastError = "server checksum mismatch; download it again";
			return this.status();
		}
		const stat = statSync(binary);
		this.invalid = false;
		this.verified = {
			path: binary,
			size: stat.size,
			mtimeMs: stat.mtimeMs
		};
		this.lastError = void 0;
		return this.status();
	}
	/** Download, verify, and install the pinned release. */
	async download() {
		if (this.active !== void 0) throw new ServerDownloadInProgressError();
		const asset = this.asset();
		if (asset === void 0) {
			this.lastError = "server release has no build for " + this.key;
			throw new ServerUnsupportedPlatformError(this.key);
		}
		if (this.status().installed) {
			this.lastError = void 0;
			return this.status();
		}
		const controller = new AbortController();
		this.active = { controller };
		this.invalid = false;
		this.verified = void 0;
		this.lastError = void 0;
		this.progress = {
			state: "downloading",
			received: 0,
			total: asset.downloadSize
		};
		mkdirSync(this.versionDir(), {
			recursive: true,
			mode: 448
		});
		const temp = join(this.versionDir(), ".part-" + String(process.pid) + "-" + randomBytes(4).toString("hex"));
		let lockHeld = false;
		try {
			this.acquireLock();
			lockHeld = true;
			const response = await this.fetchImpl(this.releaseUrl(), {
				signal: controller.signal,
				redirect: "follow",
				headers: { Accept: "application/octet-stream" }
			});
			if (!response.ok) throw new Error("server download failed: HTTP " + String(response.status));
			if (response.body === null) throw new Error("server download returned no body");
			let received = 0;
			let bytes = 0;
			const hash = createHash("sha256");
			const counter = new Transform({ transform: (chunk, _encoding, callback) => {
				received += chunk.length;
				this.progress = {
					state: "downloading",
					received,
					total: asset.downloadSize
				};
				callback(null, chunk);
			} });
			const hasher = new Transform({ transform: (chunk, _encoding, callback) => {
				bytes += chunk.length;
				if (bytes > this.maxBytes) {
					callback(/* @__PURE__ */ new Error("server download exceeded the size cap"));
					return;
				}
				hash.update(chunk);
				callback(null, chunk);
			} });
			await pipeline(Readable.fromWeb(response.body), counter, createGunzip(), hasher, createWriteStream(temp, { mode: 384 }));
			this.progress = {
				state: "verifying",
				received: asset.downloadSize,
				total: asset.downloadSize
			};
			if (bytes !== asset.size) throw new ServerChecksumError("server size mismatch: expected " + String(asset.size) + ", got " + String(bytes));
			if (hash.digest("hex") !== asset.sha256) throw new ServerChecksumError("server checksum mismatch");
			this.progress = {
				state: "installing",
				received: asset.downloadSize,
				total: asset.downloadSize
			};
			if (this.platform !== "win32") chmodSync(temp, 493);
			const target = this.binaryPath();
			if (existsSync(target)) unlinkSync(target);
			renameSync(temp, target);
			const record = {
				version: this.manifest.version,
				platform: this.platform,
				arch: this.arch,
				binary: target,
				sha256: asset.sha256,
				size: asset.size,
				installedAt: (/* @__PURE__ */ new Date()).toISOString()
			};
			this.writeJsonAtomic(this.installedPath(), record);
			this.writeJsonAtomic(this.currentPath(), record);
			const stat = statSync(target);
			this.verified = {
				path: target,
				size: stat.size,
				mtimeMs: stat.mtimeMs
			};
			this.invalid = false;
			this.progress = {
				state: "idle",
				received: asset.downloadSize,
				total: asset.downloadSize
			};
			this.lastError = void 0;
			this.cleanupParts();
			this.log?.("workbuddy2api-gateway: installed server " + this.manifest.version + " at " + target);
			return this.status();
		} catch (error) {
			if (controller.signal.aborted) {
				this.progress = {
					state: "cancelled",
					received: this.progress.received,
					total: this.progress.total
				};
				this.lastError = "server download cancelled";
				throw new ServerDownloadCancelledError();
			}
			const message = messageOf$1(error);
			this.progress = {
				state: "failed",
				received: this.progress.received,
				total: this.progress.total,
				error: message
			};
			this.lastError = message;
			this.log?.("workbuddy2api-gateway: server download failed", error);
			throw error;
		} finally {
			try {
				if (existsSync(temp)) unlinkSync(temp);
			} catch {}
			if (lockHeld) this.releaseLock();
			this.active = void 0;
		}
	}
	/** Abort the in-flight download, if any. */
	cancel() {
		this.active?.controller.abort();
	}
	/** The version directory for the pinned release. */
	versionDir(version = this.manifest.version) {
		return join(this.rootDir, version, this.key);
	}
	/** The executable path for a version. */
	binaryPath(version = this.manifest.version) {
		const exe = this.platform === "win32" ? "workbuddy2api.exe" : "workbuddy2api";
		return join(this.versionDir(version), exe);
	}
	installedPath() {
		return join(this.versionDir(), "installed.json");
	}
	currentPath() {
		return join(this.rootDir, "current.json");
	}
	lockPath() {
		return join(this.rootDir, "download.lock");
	}
	fileMatches(path, size) {
		try {
			const stat = statSync(path);
			return stat.isFile() && stat.size === size;
		} catch {
			return false;
		}
	}
	readCurrent() {
		try {
			const parsed = JSON.parse(readFileSync(this.currentPath(), "utf8"));
			if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return void 0;
			const record = parsed;
			if (typeof record["version"] !== "string" || typeof record["binary"] !== "string") return void 0;
			return record;
		} catch {
			return;
		}
	}
	writeJsonAtomic(path, value) {
		mkdirSync(dirname(path), {
			recursive: true,
			mode: 448
		});
		const temp = path + ".tmp-" + randomBytes(4).toString("hex");
		writeFileSync(temp, JSON.stringify(value, null, 2) + String.fromCharCode(10), { mode: 384 });
		if (existsSync(path)) unlinkSync(path);
		renameSync(temp, path);
	}
	acquireLock() {
		mkdirSync(this.rootDir, {
			recursive: true,
			mode: 448
		});
		const path = this.lockPath();
		for (let attempt = 0; attempt < 2; attempt += 1) try {
			const fd = openSync(path, "wx", 384);
			try {
				writeFileSync(fd, JSON.stringify({
					pid: process.pid,
					at: (/* @__PURE__ */ new Date()).toISOString()
				}));
			} finally {
				closeSync(fd);
			}
			return;
		} catch (error) {
			if (!isErrno(error, "EEXIST")) throw error;
			try {
				if (Date.now() - statSync(path).mtimeMs > LOCK_STALE_MS) {
					unlinkSync(path);
					continue;
				}
			} catch {
				continue;
			}
			throw new ServerDownloadInProgressError();
		}
		throw new ServerDownloadInProgressError();
	}
	releaseLock() {
		try {
			unlinkSync(this.lockPath());
		} catch {}
	}
	/** Remove stale temp files from a crashed download. */
	cleanupParts() {
		try {
			for (const entry of readdirSync(this.versionDir(), { withFileTypes: true })) {
				if (!entry.isFile() || !entry.name.startsWith(".part-")) continue;
				const path = join(this.versionDir(), entry.name);
				try {
					if (Date.now() - statSync(path).mtimeMs > 864e5) unlinkSync(path);
				} catch {}
			}
		} catch {}
	}
};
/** Synchronous SHA-256 for the start path; the file is only a few MB. */
function hashFileSync(path) {
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
/** Async SHA-256 for an explicit verify action. */
async function hashFile(path) {
	const hash = createHash("sha256");
	await pipeline(createReadStream(path), hash);
	return hash.digest("hex");
}
function messageOf$1(error) {
	return error instanceof Error ? error.message : String(error);
}
function isErrno(error, code) {
	return typeof error === "object" && error !== null && error.code === code;
}
/** A mirror is HTTPS, or loopback HTTP for tests. */
function allowedReleaseBase(value) {
	return /^https:\/\//u.test(value) || /^http:\/\/(?:127\.0\.0\.1|localhost)(?::|\/|$)/u.test(value);
}
// src/gateway.ts
/**
* The host composition row: the gateway's lifecycle belongs here, not in the
* panel.
*
* The row registers `workbuddy2apiGateway`, owns the server cache, and asks
* `ctx.subprocess` for a managed child. The panel row reads this service; it
* never imports `node:child_process` and never writes the gateway's config.
*
* @module dsh-workbuddy-panel/gateway
*/
/** Poll floor for the process state. */
const TICK_MS = 5e3;
/** Format version of the kernel-update document. */
const KERNEL_SETTINGS_VERSION = 1;
/** First discovery run after the row loads; keeps startup off the network. */
const KERNEL_FIRST_CHECK_MS = 3e4;
/** Hourly cadence. */
const KERNEL_CHECK_INTERVAL_MS = 36e5;
/** Error → one line, for the status document. */
function messageOf(error) {
	return error instanceof Error ? error.message : String(error);
}
/**
* Find an existing gateway document to inherit from.
*
* A user who already runs a panel has real settings in it — pool weights, hidden
* models, an upstream fingerprint. Pointing this plugin at that machine must not
* throw them away, so the first readable candidate becomes the base of the
* generated document (the owned fields are still overwritten).
*/
function discoverGatewayConfig(ownPath) {
	const home = homedir();
	const candidates = [
		join(home, "Downloads", "workbuddy2api-panel", "config.json"),
		join(home, "workbuddy2api-panel", "config.json"),
		join(home, "Desktop", "workbuddy2api-panel", "config.json")
	];
	for (const candidate of candidates) {
		if (candidate === ownPath) continue;
		try {
			const parsed = JSON.parse(readFileSync(candidate, "utf8"));
			if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) return parsed;
		} catch {}
	}
}
/** Host-row composition defaults. */
const Config = z.object({
	/** Loopback port the gateway listens on and the health probe uses. */
	port: z.natural().min(1).max(65535).default(7863),
	/** Start the gateway with the host row (and restart it after a crash). */
	autoStart: z.boolean().default(true),
	/** Restarts allowed in one run before supervision gives up. */
	restartLimit: z.natural().default(5),
	/** Accounts directory; empty means '<workdir>/auths'. */
	authDir: z.string().default(""),
	/** Download the pinned server automatically when it is missing. */
	autoDownload: z.boolean().default(false),
	/** Optional HTTPS mirror for the release assets; checksums stay pinned. */
	serverBaseUrl: z.string().default(""),
	/**
	* Default update cadence for the kernel channel: 'hourly' or 'never'.
	*
	* The settings page persists the user's choice separately; this value is the
	* install default and the fallback when that document is missing.
	*/
	checkUpdates: z.string().default("hourly"),
	/** Explicit channel document URL; empty = discover through GitHub Releases. */
	manifestUrl: z.string().default(""),
	/** An explicit WorkBuddy install directory; empty = discover one. */
	workbuddyRoot: z.string().default(""),
	/**
	* Collect the client's device id and device token.
	*
	* Off means the kernel sends neither header: the gateway still works, it just
	* looks less like the desktop client it is imitating.
	*/
	deviceSignals: z.boolean().default(true)
});
/**
* The host-owned gateway service.
*
* It survives a panel reload because it is a separate composition row. A host
* row reload terminates and restarts the gateway; that is the intended
* boundary.
*/
var GatewayHostService = class extends Service {
	static Config = Config;
	serviceVersion = 3;
	owner;
	config;
	/**
	* The cache the supervisor runs from.
	*
	* Replaced when a kernel from the release channel installs: the supervisor
	* reads it through a getter, so the swap takes effect on the next start
	* without rebuilding the process row.
	*/
	server;
	bundledManifest;
	supervisor;
	/**
	* The device signals this machine's client can prove.
	*
	* Built here rather than in the panel because minting a token needs the
	* subprocess seam; the panel only reads {@link deviceSignals}.
	*/
	signals;
	subprocess;
	timer;
	checkTimer;
	downloadPromise;
	started = false;
	/** The manifest discovered by the latest successful check. */
	remote;
	/** When the last check finished, and why it failed if it did. */
	lastCheck;
	/** True while a discovered kernel is downloading/installing. */
	installing = false;
	/** Aborts the in-flight discovery when the row unloads. */
	checkAbort = new AbortController();
	constructor(ctx, config) {
		super(ctx, GATEWAY_HOST_SERVICE);
		this.owner = ctx;
		this.config = config;
		this.bundledManifest = serverManifest();
		const active = this.createStore(this.loadActiveManifest());
		const fallback = active.status().installed || active.status().version === this.bundledManifest.version ? void 0 : this.createStore(this.bundledManifest);
		this.server = fallback !== void 0 && fallback.status().installed ? fallback : active;
		this.supervisor = new GatewaySupervisor({
			subprocess: () => this.subprocess,
			server: () => this.server,
			configPath: gatewayConfigPath,
			workdir: gatewayWorkdir,
			port: () => this.config.port,
			authDir: () => this.config.authDir,
			baseConfig: () => discoverGatewayConfig(gatewayConfigPath()),
			autoStart: () => this.config.autoStart,
			restartLimit: () => this.config.restartLimit,
			log: (message, error) => {
				if (error === void 0) ctx.logger.info(message);
				else ctx.logger.warn(message, error);
			}
		});
		this.signals = new DeviceSignalCollector({
			subprocess: () => this.subprocess,
			enabled: () => this.config.deviceSignals,
			workbuddyRoot: () => this.config.workbuddyRoot,
			log: (message, error) => {
				if (error === void 0) ctx.logger.info(message);
				else ctx.logger.warn(message, error);
			}
		});
		ctx.effect(() => {
			this.timer = setInterval(() => {
				this.supervisor.refresh();
			}, TICK_MS);
			this.timer.unref?.();
			return async () => {
				if (this.timer !== void 0) clearInterval(this.timer);
				this.timer = void 0;
				await this.supervisor.dispose();
			};
		}, "workbuddy2api-gateway-host: process ticker");
		ctx.effect(() => {
			this.scheduleKernelCheck();
			return () => {
				if (this.checkTimer !== void 0) clearTimeout(this.checkTimer);
				this.checkTimer = void 0;
				this.checkAbort.abort();
			};
		}, "workbuddy2api-gateway-host: kernel update ticker");
		ctx.effect(() => {
			const first = setTimeout(() => {
				this.signals.refresh().catch(() => {});
			}, 2e3);
			first.unref?.();
			const ticker = setInterval(() => {
				this.signals.refresh().catch(() => {});
			}, DEVICE_REFRESH_MS);
			ticker.unref?.();
			return () => {
				clearTimeout(first);
				clearInterval(ticker);
			};
		}, "workbuddy2api-gateway-host: device signal ticker");
		ctx.inject(["subprocess"], (subCtx) => {
			this.subprocess = subCtx.get("subprocess");
			subCtx.effect(() => () => {
				this.subprocess = void 0;
			}, "workbuddy2api-gateway-host: subprocess seam");
			this.startIfConfigured();
		});
	}
	/** The process snapshot. */
	status() {
		return this.supervisor.status();
	}
	/** The pinned server and its local cache state. */
	serverStatus() {
		return this.server.status();
	}
	async start() {
		return this.supervisor.start();
	}
	async stop() {
		return this.supervisor.stop();
	}
	async restart() {
		return this.supervisor.restart();
	}
	/**
	* Start the download and return immediately.
	*
	* The panel polls `serverStatus()` for progress. When the download finishes,
	* an auto-start row brings the gateway up with the new binary.
	*/
	downloadServer() {
		if (this.downloadPromise === void 0) this.downloadPromise = this.server.download().then((status) => {
			if (this.config.autoStart) this.supervisor.start();
			return status;
		}).catch((error) => {
			this.owner.logger.warn("workbuddy2api-gateway-host: server download failed", error);
			return this.server.status();
		}).finally(() => {
			this.downloadPromise = void 0;
		});
		return Promise.resolve(this.server.status());
	}
	/** Abort the in-flight download. */
	cancelDownload() {
		this.server.cancel();
	}
	/** Re-hash the installed binary. */
	async verifyServer() {
		return this.server.verify();
	}
	ensureConfig() {
		return this.supervisor.ensureConfig();
	}
	apiKeyFromConfig() {
		return this.supervisor.apiKeyFromConfig();
	}
	updateConfigApiKey(key) {
		return this.supervisor.updateConfigApiKey(key);
	}
	/** Kernel discovery state (cadence, last check, offered version). */
	kernelUpdate() {
		const active = this.server.status().version;
		const latest = this.remote?.version;
		return {
			cadence: this.cadence(),
			...this.lastCheck?.at === void 0 ? {} : { lastCheckedAt: this.lastCheck.at },
			...latest === void 0 ? {} : { latestVersion: latest },
			available: latest !== void 0 && compareVersions(latest, active) > 0,
			installing: this.installing,
			...this.lastCheck?.error === void 0 ? {} : { error: this.lastCheck.error }
		};
	}
	/** The last collected device signals; never blocks, never spawns. */
	deviceSignals() {
		return this.signals.status();
	}
	/** Collect the device signals now (the settings page's refresh button). */
	async refreshDeviceSignals() {
		return this.signals.refresh();
	}
	/**
	* Ask the channel what the newest kernel is.
	*
	* Discovery never installs anything and never throws: a failed check is part
	* of the status (the page shows it as a warning), because an offline machine
	* must keep running the kernel it already has.
	*/
	async checkKernelUpdate() {
		if (this.installing) return this.kernelUpdate();
		try {
			const manifest = await fetchLatestServerManifest({
				fetchImpl: fetch,
				releaseBaseUrl: this.bundledManifest.releaseBaseUrl,
				manifestUrl: this.config.manifestUrl,
				signal: this.checkAbort.signal
			});
			this.remote = manifest;
			this.lastCheck = { at: (/* @__PURE__ */ new Date()).toISOString() };
		} catch (error) {
			this.lastCheck = {
				at: (/* @__PURE__ */ new Date()).toISOString(),
				error: messageOf(error)
			};
			this.owner.logger.warn("workbuddy2api-gateway-host: kernel check failed", error);
		}
		this.persistCheck();
		return this.kernelUpdate();
	}
	/**
	* Download and adopt the discovered kernel.
	*
	* The install keeps the pinned-download guarantees (gzip, size, SHA-256,
	* atomic rename); what changes afterwards is which manifest the host row
	* serves. The manifest is persisted first, so a restart keeps the version the
	* user just installed instead of falling back to the packaged pin.
	*/
	async installKernelUpdate() {
		const manifest = this.remote;
		if (manifest === void 0 || this.installing) return this.server.status();
		if (compareVersions(manifest.version, this.server.status().version) <= 0) return this.server.status();
		this.installing = true;
		try {
			const store = this.createStore(manifest);
			const status = await store.download();
			if (!status.installed) {
				this.lastCheck = {
					at: (/* @__PURE__ */ new Date()).toISOString(),
					error: status.error ?? "kernel install did not complete"
				};
				this.persistCheck();
				return status;
			}
			try {
				writeStoreDocument(activeServerManifestPath(), manifest);
			} catch (error) {
				this.owner.logger.warn("workbuddy2api-gateway-host: could not persist the active manifest", error);
			}
			this.server = store;
			this.lastCheck = { at: (/* @__PURE__ */ new Date()).toISOString() };
			this.persistCheck();
			if (this.config.autoStart) this.supervisor.restart();
			return store.status();
		} catch (error) {
			this.owner.logger.warn("workbuddy2api-gateway-host: kernel install failed", error);
			this.lastCheck = {
				at: (/* @__PURE__ */ new Date()).toISOString(),
				error: messageOf(error)
			};
			this.persistCheck();
			return this.server.status();
		} finally {
			this.installing = false;
		}
	}
	/** Persist the update cadence and reschedule the checker. */
	setKernelCadence(cadence) {
		if (isKernelCadence(cadence)) try {
			writeStoreDocument(kernelUpdateSettingsPath(), {
				version: KERNEL_SETTINGS_VERSION,
				cadence,
				...this.lastCheck?.at === void 0 ? {} : { lastCheckedAt: this.lastCheck.at }
			});
		} catch (error) {
			this.owner.logger.warn("workbuddy2api-gateway-host: could not persist the update cadence", error);
		}
		this.scheduleKernelCheck();
		return this.kernelUpdate();
	}
	/** The effective cadence: the saved choice, else the install default. */
	cadence() {
		const stored = readStoreDocument(kernelUpdateSettingsPath(), KERNEL_SETTINGS_VERSION, (document) => isKernelCadence(document["cadence"]) ? document["cadence"] : void 0);
		if (stored !== void 0) return stored;
		if (isKernelCadence(this.config.checkUpdates)) return this.config.checkUpdates;
		return KERNEL_CADENCES[0] ?? "hourly";
	}
	/** (Re)arm the self-rescheduling checker. 'never' disarms it. */
	scheduleKernelCheck(delayMs = KERNEL_FIRST_CHECK_MS) {
		if (this.checkTimer !== void 0) {
			clearTimeout(this.checkTimer);
			this.checkTimer = void 0;
		}
		if (this.cadence() !== "hourly") return;
		this.checkTimer = setTimeout(() => {
			this.checkTimer = void 0;
			this.checkKernelUpdate().finally(() => {
				this.scheduleKernelCheck(KERNEL_CHECK_INTERVAL_MS);
			});
		}, delayMs);
		this.checkTimer.unref?.();
	}
	/** Persist the last check stamp next to the cadence. */
	persistCheck() {
		try {
			writeStoreDocument(kernelUpdateSettingsPath(), {
				version: KERNEL_SETTINGS_VERSION,
				cadence: this.cadence(),
				...this.lastCheck?.at === void 0 ? {} : { lastCheckedAt: this.lastCheck.at }
			});
		} catch {}
	}
	/** Build a cache bound to one manifest, keeping the row's mirror preferences. */
	createStore(manifest) {
		return new ServerStore({
			rootDir: serverRootDir(),
			manifest,
			...this.config.serverBaseUrl === "" ? {} : { releaseBaseUrl: this.config.serverBaseUrl },
			log: (message, error) => {
				if (error === void 0) this.owner.logger.info(message);
				else this.owner.logger.warn(message, error);
			}
		});
	}
	/**
	* The manifest the cache currently serves.
	*
	* A kernel installed from the channel persists its manifest; that document
	* wins only while it is at least as new as the packaged pin, so upgrading the
	* plugin pulls the pin forward instead of being pinned back by an old choice.
	*/
	loadActiveManifest() {
		const path = activeServerManifestPath();
		if (!existsSync(path)) return this.bundledManifest;
		try {
			const stored = parseServerManifest(JSON.parse(readFileSync(path, "utf8")));
			if (compareVersions(stored.version, this.bundledManifest.version) < 0) return this.bundledManifest;
			return stored;
		} catch (error) {
			this.owner?.logger.warn("workbuddy2api-gateway-host: ignoring an unreadable active manifest", error);
			return this.bundledManifest;
		}
	}
	/** Start once the subprocess seam is available; never spawn from the panel. */
	startIfConfigured() {
		if (this.started) return;
		this.started = true;
		if (this.config.autoStart) {
			this.supervisor.start().then((status) => {
				if (status.state === "server-missing" && this.config.autoDownload) this.downloadServer();
			});
			return;
		}
		if (this.config.autoDownload && !this.server.status().installed) this.downloadServer();
	}
};
export { Config, GatewayHostService as default };
