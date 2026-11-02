// SPIKE (throwaway): can a Tauri 2 thin wrapper replace the Electron app in apps/desktop?
//
// What it does, in the order apps/desktop/src/main.js does it:
//   1. finds a system Node >= 22.19 the way a launcher would (PATH, then nvm, then Homebrew);
//   2. copies the shipped `omni` profile into a DSH home (dsh.js installProfile, simplified);
//   3. writes node/pnpm shims and the default privacy overlay (dsh.js writeTools, privacy.js);
//   4. spawns DSH on a free 127.0.0.1 port (dsh.js startDsh) and waits for its `dsh web:` line;
//   5. points a WKWebView window at that URL (with dsh's per-launch token), with an init
//      script standing in for preload.cjs and one command (`spike_bridge`) the remote origin
//      http://127.0.0.1:* may call (capabilities/dsh.json).
//
// Knobs (all optional):
//   SPIKE_HOME       the app home (default: $TMPDIR/automagik-tauri-spike/desktop). Never ~/.automagik.
//   SPIKE_RESOURCES  a folder with runtime/ and profile/ (default: apps/desktop/build if built,
//                    else /Applications/Automagik.app/Contents/Resources)
//   SPIKE_NODE       a node binary to use instead of the lookup
//   SPIKE_URL        skip DSH and load this URL (to test the bridge from any origin)
//   SPIKE_PROBES     "basic" or "mic": run the WebKit feature probes after the page loads
//   SPIKE_REPORT     where the probe report (JSON) goes (default: <home>/report.json)
//   SPIKE_BOT_URL    also lay two Bot browser views (bot-a, bot-b) beside DSH's page, each on its
//                    own persistent WKWebsiteDataStore, loading this URL with ?bot=a / ?bot=b
use std::{
    env, fs,
    io::{BufRead, BufReader, Write},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{mpsc, Mutex, OnceLock},
    thread,
    time::{Duration, Instant},
};

use serde_json::{json, Value};
use tauri::{Manager, RunEvent, TitleBarStyle, WebviewUrl, WebviewWindowBuilder};

const PROFILE: &str = "omni";
const MIN_NODE: (u32, u32) = (22, 19);
const READY_TIMEOUT: Duration = Duration::from_secs(120);
const STOP_GRACE: Duration = Duration::from_secs(8);

static T0: OnceLock<Instant> = OnceLock::new();
static DSH: Mutex<Option<Child>> = Mutex::new(None);

fn since_start() -> u128 {
    T0.get().map(|t| t.elapsed().as_millis()).unwrap_or(0)
}

fn mark(what: &str) {
    println!("[spike] +{}ms {}", since_start(), what);
}

/// "v24.13.1" or "24.13.1" -> (24, 13)
fn version_of(text: &str) -> Option<(u32, u32)> {
    let mut parts = text.trim().trim_start_matches('v').split('.');
    Some((parts.next()?.parse().ok()?, parts.next()?.parse().ok()?))
}

fn node_version(node: &Path) -> Option<String> {
    let out = Command::new(node)
        .args(["-p", "process.versions.node"])
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

/// The first Node >= 22.19, looked for the way a launcher would: node on PATH, then the newest
/// nvm install, then Homebrew's. An app opened from the Dock has a bare PATH, so the later
/// places are what find it there.
fn find_node(user_home: &Path) -> Option<(PathBuf, String, &'static str)> {
    let mut candidates: Vec<(PathBuf, &'static str)> = Vec::new();
    if let Ok(node) = env::var("SPIKE_NODE") {
        candidates.push((PathBuf::from(node), "SPIKE_NODE"));
    }
    if let Some(path) = env::var_os("PATH") {
        for dir in env::split_paths(&path) {
            candidates.push((dir.join("node"), "PATH"));
        }
    }
    let nvm = user_home.join(".nvm/versions/node");
    if let Ok(entries) = fs::read_dir(&nvm) {
        let mut installs: Vec<(u32, u32, u32, PathBuf)> = entries
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().to_string();
                let mut p = name.trim_start_matches('v').split('.');
                let v = (
                    p.next()?.parse().ok()?,
                    p.next()?.parse().ok()?,
                    p.next()?.parse().ok()?,
                );
                Some((v.0, v.1, v.2, e.path().join("bin/node")))
            })
            .collect();
        installs.sort();
        for (.., node) in installs.into_iter().rev() {
            candidates.push((node, "nvm"));
        }
    }
    candidates.push((PathBuf::from("/opt/homebrew/bin/node"), "homebrew"));
    candidates.push((PathBuf::from("/usr/local/bin/node"), "/usr/local"));
    for (node, how) in candidates {
        if !node.is_file() {
            continue;
        }
        if let Some(version) = node_version(&node) {
            if version_of(&version).is_some_and(|v| v >= MIN_NODE) {
                return Some((node, version, how));
            }
        }
    }
    None
}

fn resources_dir() -> PathBuf {
    if let Ok(dir) = env::var("SPIKE_RESOURCES") {
        return PathBuf::from(dir);
    }
    let build = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../desktop/build");
    if build.join("runtime").is_dir() {
        return build;
    }
    PathBuf::from("/Applications/Automagik.app/Contents/Resources")
}

fn app_home() -> PathBuf {
    env::var("SPIKE_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|_| {
            env::temp_dir()
                .join("automagik-tauri-spike")
                .join("desktop")
        })
}

/// dsh.js installProfile, first-install case only: copy (not link) the shipped profile into
/// DSH_HOME/profiles/omni. `cp -R` keeps the profile's relative symlinks as symlinks.
fn install_profile(dsh_home: &Path, source: &Path) -> std::io::Result<bool> {
    let target = dsh_home.join("profiles").join(PROFILE);
    if target.join("package.json").is_file() {
        return Ok(false);
    }
    fs::create_dir_all(dsh_home.join("profiles"))?;
    let status = Command::new("cp")
        .arg("-R")
        .arg(source)
        .arg(&target)
        .status()?;
    if !status.success() {
        return Err(std::io::Error::other("cp -R of the profile failed"));
    }
    Ok(true)
}

fn shell_quote(text: &str) -> String {
    format!("'{}'", text.replace('\'', "'\\''"))
}

/// dsh.js writeTools: `node` and `pnpm` for dsh's PATH, on the Node we found.
fn write_tools(dir: &Path, node: &Path, pnpm: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::create_dir_all(dir)?;
    let node_q = shell_quote(&node.to_string_lossy());
    for (name, line) in [
        ("node", format!("exec {node_q} \"$@\"")),
        (
            "pnpm",
            format!(
                "exec {node_q} {} \"$@\"",
                shell_quote(&pnpm.to_string_lossy())
            ),
        ),
    ] {
        let file = dir.join(name);
        fs::write(
            &file,
            format!("#!/bin/sh\n# Written by the Tauri spike at launch.\n{line}\n"),
        )?;
        fs::set_permissions(&file, fs::Permissions::from_mode(0o755))?;
    }
    Ok(())
}

/// privacy.js overlayOf(DEFAULTS): the rows that stay off for a person who chose nothing.
const PRIVACY_OVERLAY: &str =
    "# Written by the Tauri spike (privacy.js overlayOf with the defaults).\n\
- id: product-analytics\n  disabled: true\n\
- id: desktop-product-telemetry\n  disabled: true\n\
- id: session-log-deepseek\n  disabled: true\n\
- id: plugin-package-inventory-deepseek\n  disabled: true\n\
- id: session-telemetry-otel\n  disabled: true\n";

fn free_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .expect("free port")
}

/// dsh.js launchUrlOf: the launch URL with dsh's per-launch token in a line of its output.
fn launch_url_of(line: &str, port: u16) -> Option<String> {
    let prefix = format!("dsh web: http://127.0.0.1:{port}/");
    let start = line.find(&prefix)? + "dsh web: ".len();
    let url: String = line[start..].split_whitespace().next()?.to_string();
    url.contains("token=").then_some(url)
}

/// dsh.js startDsh. Answers the launch URL once dsh prints it.
fn start_dsh(home: &Path, resources: &Path, user_home: &Path) -> Result<String, String> {
    let (node, version, how) =
        find_node(user_home).ok_or("no Node >= 22.19 on PATH, in nvm or in Homebrew")?;
    mark(&format!(
        "node {} v{} (found via {})",
        node.display(),
        version,
        how
    ));
    let bin = resources.join("runtime/node_modules/@deepseek-ai/dsh/lib/bin.js");
    let pnpm = resources.join("runtime/node_modules/pnpm/bin/pnpm.cjs");
    if !bin.is_file() {
        return Err(format!("no DSH runtime at {}", bin.display()));
    }
    let dsh_home = home.join("dsh");
    let installed =
        install_profile(&dsh_home, &resources.join("profile")).map_err(|e| e.to_string())?;
    mark(if installed {
        "profile installed (copied)"
    } else {
        "profile already there"
    });
    let bin_dir = home.join("bin");
    write_tools(&bin_dir, &node, &pnpm).map_err(|e| e.to_string())?;
    let overlay = home.join("privacy.patch.yml");
    fs::write(&overlay, PRIVACY_OVERLAY).map_err(|e| e.to_string())?;
    fs::create_dir_all(home.join("logs")).map_err(|e| e.to_string())?;
    let mut log = fs::File::create(home.join("logs/dsh.log")).map_err(|e| e.to_string())?;

    // dsh.js dshEnv: the machine's PATH, then the usual tool folders, then the app's node/pnpm.
    let mut path: Vec<PathBuf> = env::var_os("PATH")
        .map(|p| env::split_paths(&p).collect())
        .unwrap_or_default();
    for dir in [".local/bin", ".claude/local"] {
        path.push(user_home.join(dir));
    }
    path.extend([
        PathBuf::from("/opt/homebrew/bin"),
        PathBuf::from("/usr/local/bin"),
        bin_dir,
    ]);
    let mut seen = Vec::new();
    path.retain(|d| {
        !d.as_os_str().is_empty() && !seen.contains(d) && {
            seen.push(d.clone());
            true
        }
    });

    let port = free_port();
    let mut command = Command::new(&node);
    command
        .arg(&bin)
        .args(["--profile", PROFILE, "--patch"])
        .arg(&overlay)
        .args([
            "--no-open",
            "--host",
            "127.0.0.1",
            "--port",
            &port.to_string(),
        ])
        .current_dir(home)
        .env("PATH", env::join_paths(path).unwrap())
        .env("DSH_HOME", &dsh_home)
        .env("AUTOMAGIK_BOTS_HOME", home.join("bots"))
        .env("OMNI_CLIENT_ID", "omni-desktop")
        .env("AUTOMAGIK_PRIVACY_FILE", home.join("privacy.json"))
        .env("AUTOMAGIK_BUSY_FILE", home.join("busy.json"))
        // privacy.js privacyEnv(DEFAULTS)
        .env("DO_NOT_TRACK", "1")
        .env("DISABLE_TELEMETRY", "1")
        .env("OPENUI_TELEMETRY_DISABLED", "1")
        .env("npm_config_update_notifier", "false")
        .env("DSH_TELEMETRY_DISABLED", "1")
        // Not set: AUTOMAGIK_APP_BROWSER. It makes the Bot team ask the app for a browser over
        // Node's IPC channel (stdio fd 3), which a Rust parent does not have.
        .env_remove("AUTOMAGIK_APP_BROWSER")
        .env_remove("ELECTRON_RUN_AS_NODE")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("spawn dsh: {e}"))?;
    let pid = child.id();
    mark(&format!("dsh spawned (pid {pid}, port {port})"));
    let _ = fs::write(home.join("dsh.pid"), pid.to_string());
    let (tx, rx) = mpsc::channel::<String>();
    let (log_tx, log_rx) = mpsc::channel::<String>();
    for stream in [
        Box::new(child.stdout.take().unwrap()) as Box<dyn std::io::Read + Send>,
        Box::new(child.stderr.take().unwrap()),
    ] {
        let tx = tx.clone();
        let log_tx = log_tx.clone();
        thread::spawn(move || {
            for line in BufReader::new(stream).lines().map_while(Result::ok) {
                if let Some(url) = launch_url_of(&line, port) {
                    let _ = tx.send(url);
                }
                let _ = log_tx.send(line);
            }
        });
    }
    drop(log_tx);
    thread::spawn(move || {
        for line in log_rx {
            let _ = writeln!(log, "{line}");
        }
    });
    *DSH.lock().unwrap() = Some(child);
    rx.recv_timeout(READY_TIMEOUT)
        .map_err(|_| "dsh did not print its launch URL in time".to_string())
}

/// dsh.js stopDsh: SIGTERM, then SIGKILL after the grace period.
fn stop_dsh() {
    let Some(mut child) = DSH.lock().unwrap().take() else {
        return;
    };
    if matches!(child.try_wait(), Ok(Some(_))) {
        return;
    }
    let _ = Command::new("kill")
        .args(["-TERM", &child.id().to_string()])
        .status();
    let deadline = Instant::now() + STOP_GRACE;
    while Instant::now() < deadline {
        if matches!(child.try_wait(), Ok(Some(_))) {
            println!("[spike] dsh stopped");
            return;
        }
        thread::sleep(Duration::from_millis(50));
    }
    let _ = child.kill();
    let _ = child.wait();
    println!("[spike] dsh killed after the grace period");
}

/// The one command the page may call. The init script sends its timings, errors and the probe
/// report through it; that it answers at all from http://127.0.0.1:<port> is the IPC proof.
#[tauri::command]
fn spike_bridge(webview: tauri::Webview, kind: String, payload: Value) -> Value {
    let origin = webview
        .url()
        .map(|u| u.origin().ascii_serialization())
        .unwrap_or_default();
    let elapsed = since_start();
    match kind.as_str() {
        "report" => {
            let file = env::var("SPIKE_REPORT")
                .map(PathBuf::from)
                .unwrap_or_else(|_| app_home().join("report.json"));
            let _ = fs::write(
                &file,
                serde_json::to_string_pretty(&payload).unwrap_or_default(),
            );
            println!(
                "[spike] +{elapsed}ms bridge report from {origin} -> {}",
                file.display()
            );
        }
        _ => println!("[spike] +{elapsed}ms bridge {kind} from {origin} {payload}"),
    }
    json!({ "ok": true, "pid": std::process::id(), "sinceStartMs": elapsed as u64, "origin": origin })
}

/// One persistent, isolated website data store per Bot: WKWebsiteDataStore(forIdentifier:),
/// macOS 14+. Electron's equivalent is the partition `persist:ds-bot-browser-<bot>`.
fn data_store_of(bot: &str) -> [u8; 16] {
    let mut id = [0u8; 16];
    for (i, b) in format!("automagik-bot-{bot}").bytes().enumerate() {
        id[i % 16] ^= b.wrapping_add(i as u8);
    }
    id
}

/// Electron's bot-views.js lays WebContentsViews over the panel's rectangle; here two child
/// webviews (Tauri `unstable` multiwebview) take the right half of the window, DSH the left.
fn add_bot_views(window: &tauri::WebviewWindow, url: &str) -> tauri::Result<()> {
    use tauri::{webview::WebviewBuilder, LogicalPosition, LogicalSize};
    let size = window
        .inner_size()?
        .to_logical::<f64>(window.scale_factor()?);
    let (w, h) = (size.width, size.height);
    window.as_ref().set_size(LogicalSize::new(w * 0.5, h))?;
    let host = window.as_ref().window();
    for (i, bot) in ["a", "b"].into_iter().enumerate() {
        let target: tauri::Url = format!("{url}?bot={bot}").parse().expect("bot url");
        let builder = WebviewBuilder::new(format!("bot-{bot}"), WebviewUrl::External(target))
            .data_store_identifier(data_store_of(bot));
        host.add_child(
            builder,
            LogicalPosition::new(w * 0.5, h * 0.5 * i as f64),
            LogicalSize::new(w * 0.5, h * 0.5),
        )?;
        mark(&format!("bot view bot-{bot} added"));
    }
    Ok(())
}

fn make_window(handle: &tauri::AppHandle, url: WebviewUrl) -> tauri::Result<tauri::WebviewWindow> {
    let window = WebviewWindowBuilder::new(handle, "main", url)
        .title("Automagik (Tauri spike)")
        .inner_size(1280.0, 820.0)
        .title_bar_style(TitleBarStyle::Overlay)
        .hidden_title(true)
        .initialization_script(init_script())
        .build()?;
    mark("window created");
    Ok(window)
}

fn init_script() -> String {
    let config = json!({
        "probes": env::var("SPIKE_PROBES").unwrap_or_default(),
        "authRetry": env::var("SPIKE_AUTH_RETRY").is_ok_and(|v| v == "1"),
    });
    format!(
        "window.__SPIKE_CONFIG__ = {config};\n{}",
        include_str!("bridge.js")
    )
}

fn main() {
    T0.set(Instant::now()).ok();
    mark("process start");
    // A SIGTERM/SIGINT to the app must not leave dsh behind (it has no parent watch of its own).
    ctrlc::set_handler(|| {
        stop_dsh();
        std::process::exit(0);
    })
    .expect("signal handler");

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![spike_bridge])
        .setup(|app| {
            // SPIKE_START=placeholder (default): the window shows at once on a local page (Electron's
            // frame/splash) and navigates to DSH's page when it is ready. SPIKE_START=direct: the
            // window opens when DSH is ready, straight on DSH's URL.
            let direct = env::var("SPIKE_START").is_ok_and(|v| v == "direct");
            let early = if direct {
                None
            } else {
                Some(make_window(
                    app.handle(),
                    WebviewUrl::App("index.html".into()),
                )?)
            };
            let handle = app.handle().clone();
            thread::spawn(move || {
                let url = match env::var("SPIKE_URL") {
                    Ok(url) => url,
                    Err(_) => {
                        let home = app_home();
                        let _ = fs::create_dir_all(&home);
                        let user_home = handle
                            .path()
                            .home_dir()
                            .unwrap_or_else(|_| PathBuf::from("/"));
                        match start_dsh(&home, &resources_dir(), &user_home) {
                            Ok(url) => url,
                            Err(error) => {
                                eprintln!("[spike] {error}");
                                stop_dsh();
                                handle.exit(1);
                                return;
                            }
                        }
                    }
                };
                mark("dsh ready (launch URL seen)");
                let parsed: tauri::Url = url.parse().expect("launch url");
                let window = match early {
                    Some(window) => {
                        if let Err(error) = window.navigate(parsed) {
                            eprintln!("[spike] navigate: {error}");
                        }
                        window
                    }
                    None => match make_window(&handle, WebviewUrl::External(parsed)) {
                        Ok(window) => window,
                        Err(error) => {
                            eprintln!("[spike] window: {error}");
                            return;
                        }
                    },
                };
                if let Ok(bot_url) = env::var("SPIKE_BOT_URL") {
                    if let Err(error) = add_bot_views(&window, &bot_url) {
                        eprintln!("[spike] bot views: {error}");
                    }
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("tauri app");

    app.run(|_handle, event| {
        if let RunEvent::Exit = event {
            stop_dsh();
        }
    });
}
