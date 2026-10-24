<p align="center"><img src="assets/icon.png" width="112" alt="The octopus"></p>

<h1 align="center">Automagik</h1>

<p align="center"><b>A team of AI helpers that lives in your chats.</b><br>
WhatsApp, Telegram, Slack and more, in one window, with helpers that act the moment something happens.</p>

<p align="center">
  <a href="https://github.com/automagik-dev/automagik/releases/latest/download/Automagik-Mac.dmg"><b>⬇ Download for Mac</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/automagik-dev/automagik/releases/latest/download/Automagik-Linux.deb"><b>⬇ Download for Linux (Ubuntu, Debian)</b></a>
  &nbsp;·&nbsp;
  <a href="https://github.com/automagik-dev/automagik/releases/latest/download/Automagik-Linux.AppImage">Linux (AppImage)</a>
</p>

<p align="center"><sub>Mac with Apple silicon (M1 or newer), macOS 13 or newer · Linux on a 64-bit PC · Windows is not supported yet<br>
Free and open source. <a href="https://github.com/automagik-dev/automagik/releases/latest">All downloads and what's new</a></sub></p>

---

## What it does

Automagik puts all your conversations in one place, and gives you **Bots**: AI helpers that work in your chats for you.

- **One window for every chat.** Your WhatsApp, Telegram, Slack and other channels, side by side.
- **Bots that don't wait to be asked.** A message arrives, a group gets busy, a customer writes at 3 AM: the Bot you put on it acts. Ask for *"a summary of this group every morning at 8"* and it simply happens.
- **You stay in charge.** A Bot only reads the chats you allow. The first time it wants a new one, it asks you, and you answer **Once**, **Always** or **No**. Before it sends anything as you, deletes something or disconnects a channel, it shows you exactly what it will do and asks first, every time.
- **Answers you can use.** Bots can reply with lists, boards and forms that keep themselves up to date.

## Before you start

You need two things. The app walks you through both, and you can skip either and come back later.

1. **An Omni to connect to.** Omni is the service that links your chat apps to Automagik. If your team or company runs one, ask for its address (it looks like a web address). You'll approve this computer from your phone; there are no passwords or keys to copy.
2. **An AI account.** Any one of: DeepSeek, OpenAI (Codex), Anthropic (Claude), Kimi, Z.ai, OpenCode, or an API key from a provider you already use.

## Install on a Mac

1. **[Download Automagik for Mac](https://github.com/automagik-dev/automagik/releases/latest/download/Automagik-Mac.dmg)**. It's about 330 MB.
2. Open the file you downloaded (**Automagik-Mac.dmg**, in your Downloads folder).
3. In the window that opens, **drag the Automagik icon onto the Applications folder**.
4. Open **Automagik** from your Applications folder (or press ⌘ Space and type *Automagik*).
5. If your Mac asks *"Automagik is an app downloaded from the Internet. Are you sure you want to open it?"*, click **Open**. Automagik is signed and checked by Apple, so you only see this the first time.

You can then eject the Automagik disk in Finder's sidebar and delete the downloaded file.

## Install on Linux

**Ubuntu or Debian (recommended):**

1. **[Download Automagik for Linux (.deb)](https://github.com/automagik-dev/automagik/releases/latest/download/Automagik-Linux.deb)**.
2. Double-click the downloaded file and choose **Install**, or in a terminal run `sudo apt install ./Automagik-Linux.deb` from your Downloads folder.
3. Open **Automagik** from your apps.

**Other Linux (AppImage):** [download the AppImage](https://github.com/automagik-dev/automagik/releases/latest/download/Automagik-Linux.AppImage), right-click it, open **Properties → Permissions**, tick **Allow executing file as program**, then double-click it. If it doesn't start, your system may need `libfuse2` (on Ubuntu: `sudo apt install libfuse2t64`), or use the .deb instead.

## Your first five minutes

1. **Say hi to the octopus.** Automagik opens with a short welcome.
2. **Connect your Omni.** Type your Omni's address and click **Get a code**. A QR code appears.
   - Scan it with your phone's camera. WhatsApp opens your chat with yourself, with the code already typed. **Send it**, and the app connects.
   - Or approve it on your phone with Face ID or your fingerprint, if your Omni offers that.
3. **Connect your AI.** Pick the account you have: sign in to Codex, Claude or Kimi, or paste a DeepSeek or other API key.
4. **Start talking.** Your **Main Bot** sees across your channels. Ask it something about your chats, or ask it to look after a group for you.

> Signing in to Codex, Claude or Kimi uses your personal plan with that company. Check their terms before using a personal plan for work. API keys don't have that limit.

## Updates

Automagik updates itself. It checks when it starts and every few hours, and downloads a new version in the background. When it's ready, the top of the window says **Automagik X is ready** with **Restart now** and **Later**. After Later, a small **Restart to update** button stays there, and quitting Automagik installs the update too.

To check yourself, use **Automagik → Check for Updates…** on macOS, or right-click the top bar on Linux.

The .deb version on Linux doesn't replace itself, because your package manager owns it. Instead the top bar says **Automagik X is out**, and **Download** opens the release page.

A build follows its own channel: a stable release only moves to newer stable releases. `OMNI_DESKTOP_UPDATE_CHANNEL=prerelease` follows prereleases too, and `OMNI_DESKTOP_UPDATES=off` turns updates off. Each check is written to `logs/update.log` in the app's data folder.

## Was it called Omni?

Until October 2026 this app was called Omni. An installed Omni updates itself into Automagik like any other update (the notice still says **Omni X is ready**: the old app shows it), and keeps everything: your Bots, chats, memory, settings and the Omni you linked. Nothing to do.

- **Mac:** the app updates where it is, so its file in Applications stays **Omni**, and Finder, Launchpad and the Dock may go on showing that name, while its window and menu bar say Automagik. You can rename it to Automagik in Finder (quit it first); it keeps updating either way. Don't also install Automagik-Mac.dmg next to it: that gives you two copies of one app.
- **Linux AppImage:** the new AppImage takes the old one's place in the same folder, named `Automagik-<version>-linux-x86_64.AppImage`. One whose name has no version in it (say, one you renamed) is replaced under its own name.
- **Linux .deb:** install the new .deb over the old one, as with any update. It is still the package `omni`, so it replaces the old one cleanly.

## Your data

- What Automagik keeps on your computer is in one folder: **`.omni/desktop`** in your home folder. Only the window keeps a little of its own (sign-ins in a Bot's browser, the page's storage) in **`Omni`**, in `~/Library/Application Support` on a Mac and `~/.config` on Linux: the app's old name, so an update finds it.
- Your chats stay in your Omni. The app shows them and keeps what your Bots need to work.
- What your Bots read and write goes to the AI account you connected, under that company's terms.

## Uninstall

- **Mac:** quit Automagik, then drag it from Applications to the Trash (an install that updated from Omni is still called **Omni** there).
- **Linux (.deb):** `sudo apt remove omni`. **AppImage:** delete the file.
- To also remove everything it kept, delete the **`.omni/desktop`** folder in your home folder, and the **`Omni`** folder in `~/Library/Application Support` (Mac) or `~/.config` (Linux). (On a Mac, press ⌘ ⇧ . in Finder to show hidden folders.)

## Help

Something not working, or an idea? [Open an issue](https://github.com/automagik-dev/automagik/issues) and tell us what you did and what you saw.

---

<sub>For developers: this is the Automagik desktop app (until 3.261023.x named Omni): Automagik's Bot team and welcome with [Omni](https://github.com/automagik-dev/omni)'s channels and canvases, on a DeepSeek Harness of its own. `omni desktop` opens it with Omni preloaded, `genie desktop` with Genie. It was automagik-dev/omni-desktop until 2.261023.x; those installs update into it. How it's built, released and updated: [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md). Apache-2.0.</sub>
