// The update's splash on macOS. To install an update the app quits, and macOS swaps the bundle
// and checks the new one before it opens it: about 18 seconds with nothing of Automagik on
// screen (3.18 to 3.20 on the owner's Mac: 7 s checking the signature, 2 s moving, 5.5 s
// vetting the first launch, 3 s starting). Nothing inside the bundle can draw meanwhile, so a
// small window is drawn by macOS's own osascript (JavaScript for Automation, AppKit through its
// ObjC bridge), from files copied out of the app first: the lockup and the script, in
// <home>/splash. It stays until the new copy's page is in, which removes <home>/splash/up,
// or two minutes pass. Elsewhere there is no splash.
import { spawn as spawnChild } from 'node:child_process'
import { copyFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
export const LOCKUP = join(HERE, 'splash', 'lockup.png')
export const OSASCRIPT = '/usr/bin/osascript'
export const SPLASH_MAX_MS = 120_000

// A borderless, non-activating panel in the middle of the screen, in the system's own light or
// dark material: the lockup, what is happening, and a spinner. It never takes focus. With "dry"
// it builds everything and shows nothing (a check that AppKit takes every call).
export const SPLASH_SCRIPT = `ObjC.import('Cocoa');
function run(argv) {
  const image = argv[0], title = argv[1], detail = argv[2], up = argv[3], dry = argv[4] === 'dry', maxMs = Number(argv[5]) || ${SPLASH_MAX_MS};
  const app = $.NSApplication.sharedApplication;
  app.setActivationPolicy(1);
  app.finishLaunching;
  const W = 380, H = 236;
  const screen = $.NSScreen.mainScreen.visibleFrame;
  const frame = $.NSMakeRect(screen.origin.x + (screen.size.width - W) / 2, screen.origin.y + (screen.size.height - H) / 2, W, H);
  const panel = $.NSPanel.alloc.initWithContentRectStyleMaskBackingDefer(frame, 128, 2, false);
  panel.setLevel(3);
  panel.setOpaque(false);
  panel.setBackgroundColor($.NSColor.clearColor);
  panel.setHasShadow(true);
  panel.setCollectionBehavior(1 | 16);
  const card = $.NSVisualEffectView.alloc.initWithFrame($.NSMakeRect(0, 0, W, H));
  card.setMaterial(6);
  card.setState(1);
  card.setBlendingMode(0);
  card.setWantsLayer(true);
  card.layer.setCornerRadius(22);
  card.layer.setMasksToBounds(true);
  const art = $.NSImageView.alloc.initWithFrame($.NSMakeRect(46, 124, W - 92, 64));
  art.setImage($.NSImage.alloc.initWithContentsOfFile(image));
  art.setImageScaling(3);
  const heading = $.NSTextField.labelWithString(title);
  heading.setFont($.NSFont.boldSystemFontOfSize(15));
  heading.setAlignment(1);
  heading.setFrame($.NSMakeRect(20, 86, W - 40, 22));
  const line = $.NSTextField.labelWithString(detail);
  line.setFont($.NSFont.systemFontOfSize(12));
  line.setTextColor($.NSColor.secondaryLabelColor);
  line.setAlignment(1);
  line.setFrame($.NSMakeRect(20, 64, W - 40, 18));
  const spinner = $.NSProgressIndicator.alloc.initWithFrame($.NSMakeRect((W - 20) / 2, 26, 20, 20));
  spinner.setStyle(1);
  spinner.setIndeterminate(true);
  card.addSubview(art);
  card.addSubview(heading);
  card.addSubview(line);
  card.addSubview(spinner);
  panel.setContentView(card);
  if (dry) return 'ok';
  spinner.startAnimation(null);
  panel.orderFrontRegardless;
  const files = $.NSFileManager.defaultManager;
  const until = Date.now() + maxMs;
  while (files.fileExistsAtPath(up) && Date.now() < until) {
    $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(0.25));
  }
  panel.orderOut(null);
  return 'done';
}
`

/** Where the splash keeps its copies, and the file whose removal takes it down. */
export const splashFiles = home => ({ dir: join(home, 'splash'), script: join(home, 'splash', 'splash.js'), image: join(home, 'splash', 'lockup.png'), up: join(home, 'splash', 'up') })

/** The splash's words for an update to `version`. */
export const splashText = (product, version) => ({
  title: version ? `Updating ${product} to ${version}` : `Updating ${product}`,
  detail: `${product} opens again by itself in a few seconds.`,
})

/**
 * Puts the splash up for an update to `version` and leaves it running after this process quits.
 * Answers whether it went up: only on macOS, and only when its files could be written.
 */
export function showUpdateSplash({ home, product, version, platform = process.platform, spawn = spawnChild, image = LOCKUP }) {
  if (platform !== 'darwin') return false
  const files = splashFiles(home)
  try {
    mkdirSync(files.dir, { recursive: true })
    writeFileSync(files.script, SPLASH_SCRIPT)
    copyFileSync(image, files.image)
    writeFileSync(files.up, `${Date.now()}\n`)
  } catch {
    return false
  }
  const { title, detail } = splashText(product, version)
  try {
    const child = spawn(OSASCRIPT, ['-l', 'JavaScript', files.script, files.image, title, detail, files.up], { detached: true, stdio: 'ignore' })
    child.on?.('error', () => {})
    child.unref?.()
    return true
  } catch {
    rmSync(files.up, { force: true })
    return false
  }
}

/** Takes the splash down: this copy is up and its page is in. */
export function dismissSplash(home) {
  try { rmSync(splashFiles(home).up, { force: true }) } catch {}
}
