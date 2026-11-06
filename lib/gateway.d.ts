import { c as KernelCheckCadence, f as ServerStatus, i as GatewayHost, l as KernelUpdateStatus, s as GatewayStatus, t as DeviceSignalStatus } from "./gateway-contract-r1m7qjxn.js";
import z from "@deepseek-ai/schemastery";
import { Context, Service } from "@deepseek-ai/cordis";
/** Host-row composition defaults. */
declare const Config: z<Schemastery.ObjectS<NoInfer<{
  /** Loopback port the gateway listens on and the health probe uses. */
  port: z<number, number, "defined">;
  /** Start the gateway with the host row (and restart it after a crash). */
  autoStart: z<boolean, boolean, "defined">;
  /** Restarts allowed in one run before supervision gives up. */
  restartLimit: z<number, number, "defined">;
  /** Accounts directory; empty means '<workdir>/auths'. */
  authDir: z<string, string, "defined">;
  /** Download the pinned server automatically when it is missing. */
  autoDownload: z<boolean, boolean, "defined">;
  /** Optional HTTPS mirror for the release assets; checksums stay pinned. */
  serverBaseUrl: z<string, string, "defined">;
  /**
   * Default update cadence for the kernel channel: 'hourly' or 'never'.
   *
   * The settings page persists the user's choice separately; this value is the
   * install default and the fallback when that document is missing.
   */
  checkUpdates: z<string, string, "defined">;
  /** Explicit channel document URL; empty = discover through GitHub Releases. */
  manifestUrl: z<string, string, "defined">;
  /** An explicit WorkBuddy install directory; empty = discover one. */
  workbuddyRoot: z<string, string, "defined">;
  /**
   * Collect the client's device id and device token.
   *
   * Off means the kernel sends neither header: the gateway still works, it just
   * looks less like the desktop client it is imitating.
   */
  deviceSignals: z<boolean, boolean, "defined">;
}>>, Schemastery.ObjectT<NoInfer<{
  /** Loopback port the gateway listens on and the health probe uses. */
  port: z<number, number, "defined">;
  /** Start the gateway with the host row (and restart it after a crash). */
  autoStart: z<boolean, boolean, "defined">;
  /** Restarts allowed in one run before supervision gives up. */
  restartLimit: z<number, number, "defined">;
  /** Accounts directory; empty means '<workdir>/auths'. */
  authDir: z<string, string, "defined">;
  /** Download the pinned server automatically when it is missing. */
  autoDownload: z<boolean, boolean, "defined">;
  /** Optional HTTPS mirror for the release assets; checksums stay pinned. */
  serverBaseUrl: z<string, string, "defined">;
  /**
   * Default update cadence for the kernel channel: 'hourly' or 'never'.
   *
   * The settings page persists the user's choice separately; this value is the
   * install default and the fallback when that document is missing.
   */
  checkUpdates: z<string, string, "defined">;
  /** Explicit channel document URL; empty = discover through GitHub Releases. */
  manifestUrl: z<string, string, "defined">;
  /** An explicit WorkBuddy install directory; empty = discover one. */
  workbuddyRoot: z<string, string, "defined">;
  /**
   * Collect the client's device id and device token.
   *
   * Off means the kernel sends neither header: the gateway still works, it just
   * looks less like the desktop client it is imitating.
   */
  deviceSignals: z<boolean, boolean, "defined">;
}>>, "plain">;
/** Parsed host-row config. */
interface Config {
  port: number;
  autoStart: boolean;
  restartLimit: number;
  authDir: string;
  autoDownload: boolean;
  serverBaseUrl: string;
  checkUpdates: string;
  manifestUrl: string;
  workbuddyRoot: string;
  deviceSignals: boolean;
}
/**
 * The host-owned gateway service.
 *
 * It survives a panel reload because it is a separate composition row. A host
 * row reload terminates and restarts the gateway; that is the intended
 * boundary.
 */
declare class GatewayHostService extends Service implements GatewayHost {
  static Config: z<Schemastery.ObjectS<NoInfer<{
    /** Loopback port the gateway listens on and the health probe uses. */
    port: z<number, number, "defined">;
    /** Start the gateway with the host row (and restart it after a crash). */
    autoStart: z<boolean, boolean, "defined">;
    /** Restarts allowed in one run before supervision gives up. */
    restartLimit: z<number, number, "defined">;
    /** Accounts directory; empty means '<workdir>/auths'. */
    authDir: z<string, string, "defined">;
    /** Download the pinned server automatically when it is missing. */
    autoDownload: z<boolean, boolean, "defined">;
    /** Optional HTTPS mirror for the release assets; checksums stay pinned. */
    serverBaseUrl: z<string, string, "defined">;
    /**
     * Default update cadence for the kernel channel: 'hourly' or 'never'.
     *
     * The settings page persists the user's choice separately; this value is the
     * install default and the fallback when that document is missing.
     */
    checkUpdates: z<string, string, "defined">;
    /** Explicit channel document URL; empty = discover through GitHub Releases. */
    manifestUrl: z<string, string, "defined">;
    /** An explicit WorkBuddy install directory; empty = discover one. */
    workbuddyRoot: z<string, string, "defined">;
    /**
     * Collect the client's device id and device token.
     *
     * Off means the kernel sends neither header: the gateway still works, it just
     * looks less like the desktop client it is imitating.
     */
    deviceSignals: z<boolean, boolean, "defined">;
  }>>, Schemastery.ObjectT<NoInfer<{
    /** Loopback port the gateway listens on and the health probe uses. */
    port: z<number, number, "defined">;
    /** Start the gateway with the host row (and restart it after a crash). */
    autoStart: z<boolean, boolean, "defined">;
    /** Restarts allowed in one run before supervision gives up. */
    restartLimit: z<number, number, "defined">;
    /** Accounts directory; empty means '<workdir>/auths'. */
    authDir: z<string, string, "defined">;
    /** Download the pinned server automatically when it is missing. */
    autoDownload: z<boolean, boolean, "defined">;
    /** Optional HTTPS mirror for the release assets; checksums stay pinned. */
    serverBaseUrl: z<string, string, "defined">;
    /**
     * Default update cadence for the kernel channel: 'hourly' or 'never'.
     *
     * The settings page persists the user's choice separately; this value is the
     * install default and the fallback when that document is missing.
     */
    checkUpdates: z<string, string, "defined">;
    /** Explicit channel document URL; empty = discover through GitHub Releases. */
    manifestUrl: z<string, string, "defined">;
    /** An explicit WorkBuddy install directory; empty = discover one. */
    workbuddyRoot: z<string, string, "defined">;
    /**
     * Collect the client's device id and device token.
     *
     * Off means the kernel sends neither header: the gateway still works, it just
     * looks less like the desktop client it is imitating.
     */
    deviceSignals: z<boolean, boolean, "defined">;
  }>>, "plain">;
  readonly serviceVersion = 3;
  private readonly owner;
  private readonly config;
  /**
   * The cache the supervisor runs from.
   *
   * Replaced when a kernel from the release channel installs: the supervisor
   * reads it through a getter, so the swap takes effect on the next start
   * without rebuilding the process row.
   */
  private server;
  private readonly bundledManifest;
  private readonly supervisor;
  /**
   * The device signals this machine's client can prove.
   *
   * Built here rather than in the panel because minting a token needs the
   * subprocess seam; the panel only reads {@link deviceSignals}.
   */
  private readonly signals;
  private subprocess?;
  private timer?;
  private checkTimer?;
  private downloadPromise?;
  private started;
  /** The manifest discovered by the latest successful check. */
  private remote?;
  /** When the last check finished, and why it failed if it did. */
  private lastCheck?;
  /** True while a discovered kernel is downloading/installing. */
  private installing;
  /** Aborts the in-flight discovery when the row unloads. */
  private readonly checkAbort;
  constructor(ctx: Context, config: Config);
  /** The process snapshot. */
  status(): GatewayStatus;
  /** The pinned server and its local cache state. */
  serverStatus(): ServerStatus;
  start(): Promise<GatewayStatus>;
  stop(): Promise<GatewayStatus>;
  restart(): Promise<GatewayStatus>;
  /**
   * Start the download and return immediately.
   *
   * The panel polls `serverStatus()` for progress. When the download finishes,
   * an auto-start row brings the gateway up with the new binary.
   */
  downloadServer(): Promise<ServerStatus>;
  /** Abort the in-flight download. */
  cancelDownload(): void;
  /** Re-hash the installed binary. */
  verifyServer(): Promise<ServerStatus>;
  ensureConfig(): {
    path: string;
    created: boolean;
    apiKey?: string;
  };
  apiKeyFromConfig(): string | undefined;
  updateConfigApiKey(key: string): boolean;
  /** Kernel discovery state (cadence, last check, offered version). */
  kernelUpdate(): KernelUpdateStatus;
  /** The last collected device signals; never blocks, never spawns. */
  deviceSignals(): DeviceSignalStatus;
  /** Collect the device signals now (the settings page's refresh button). */
  refreshDeviceSignals(): Promise<DeviceSignalStatus>;
  /**
   * Ask the channel what the newest kernel is.
   *
   * Discovery never installs anything and never throws: a failed check is part
   * of the status (the page shows it as a warning), because an offline machine
   * must keep running the kernel it already has.
   */
  checkKernelUpdate(): Promise<KernelUpdateStatus>;
  /**
   * Download and adopt the discovered kernel.
   *
   * The install keeps the pinned-download guarantees (gzip, size, SHA-256,
   * atomic rename); what changes afterwards is which manifest the host row
   * serves. The manifest is persisted first, so a restart keeps the version the
   * user just installed instead of falling back to the packaged pin.
   */
  installKernelUpdate(): Promise<ServerStatus>;
  /** Persist the update cadence and reschedule the checker. */
  setKernelCadence(cadence: KernelCheckCadence): KernelUpdateStatus;
  /** The effective cadence: the saved choice, else the install default. */
  private cadence;
  /** (Re)arm the self-rescheduling checker. 'never' disarms it. */
  private scheduleKernelCheck;
  /** Persist the last check stamp next to the cadence. */
  private persistCheck;
  /** Build a cache bound to one manifest, keeping the row's mirror preferences. */
  private createStore;
  /**
   * The manifest the cache currently serves.
   *
   * A kernel installed from the channel persists its manifest; that document
   * wins only while it is at least as new as the packaged pin, so upgrading the
   * plugin pulls the pin forward instead of being pinned back by an old choice.
   */
  private loadActiveManifest;
  /** Start once the subprocess seam is available; never spawn from the panel. */
  private startIfConfigured;
}
export { Config, GatewayHostService as default };