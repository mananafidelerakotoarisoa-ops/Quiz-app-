## Step 1 — Install Termux or use your terminal if you have a computer

## Step 2 — First launch and update

Open Termux. You'll see a black screen with a `$` prompt. That's normal — it's a Linux terminal.

The very first thing you must do is update its packages. Type this exactly and press Enter:

```bash
pkg update
```

It will ask `Do you want to continue? [Y/n]` — type `Y` and press Enter. Wait for it to finish.

Then run:

```bash
pkg upgrade
```

Again type `Y` when asked. This takes 1–2 minutes.

---

## Step 3 — Give Termux access to your files

Termux needs permission to read your Downloads folder. Run:

```bash
termux-setup-storage
```

A popup will appear asking for storage permission — tap **Allow**. This creates a shortcut called `storage` in your home folder that links to your phone's storage.

---

## Step 4 — Install Python

```bash
pkg install python
```

Type `Y` when asked. Takes about a minute.

---

## Step 5 — Put your MEXT files in the right place

Before continuing in Termux, go to your **Files** app and make sure your folder looks exactly like this inside your Downloads folder:

```
Downloads/
└── mext/
    ├── index.html
    ├── sw.js
    ├── js/
    │   ├── main.js
    │   ├── state.js
    │   ├── timer.js
    │   ├── analytics.js
    │   ├── loader.js
    │   └── quiz.js
    └── data/
        ├── english.json
        └── japanese.json
```

The `js/` and `data/` subfolders must exist — not all files dumped in the same folder.

---

## Step 6 — Navigate to your folder in Termux

Back in Termux, type:

```bash
cd ~/storage/downloads/mext
```

Then verify the files are there:

```bash
ls
```

You should see `index.html`, `sw.js`, `js`, and `data` listed. If you see those, you're in the right place.

---

## Step 7 — Start the server

```bash
python -m http.server 8080
```

You'll see this message:

```
Serving HTTP on 0.0.0.0 port 8080 (http://0.0.0.0:8080/) ...
```

That means it's running. **Don't close Termux** — just leave it in the background.

---

## Step 8 — Open the app in Chrome

Open Chrome and go to:

```
http://127.0.0.1:8080
```

The MEXT app will load fully.

---

## Step 9 — Next time you want to launch it again

You don't need to redo everything. Next time just open Termux and run these two lines:

```bash
cd ~/storage/downloads/mext
python -m http.server 8080
```

Then open Chrome at `http://127.0.0.1:8080` as before.

---

## Troubleshooting

| Problem | Fix |
|---|---|
| `cd: mext: No such file or directory` | Check your folder name in Files — it might be `Mext` or `MEXT` (case-sensitive). Try `ls ~/storage/downloads/` to see what's there |
| `python: command not found` | Run `pkg install python` again |
| Chrome shows "This site can't be reached" | Make sure Termux is still open in the background and the server is running |
| `ls` shows files but no `js/` or `data/` folders | You need to create those subfolders and move the files into them using your Files app |
