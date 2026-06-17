---
title: "Out-of-bounds write vulnerability in Snes9x 1.63"
date: 2026-06-17T10:30:00+05:30
author: Karan Saini
excerpt: A crafted UPS patch file can write past the end of Memory.ROM, crashing the emulator when a matching ROM is loaded.
layout: post
permalink: /snes9x-oob-write/
categories:
  - Security
tags:
  - emulator
  - super nintendo
---

# Introduction

This short article details an out-of-bounds write vulnerability in `snes9x-1.63-win32`.

![](/media/snes9x-logo.png){: width="250" }

This is the first vulnerability that I've guided an LLM (Anthropic's Claude Opus 4.6) into discovering. I was inspired to take a look at popular emulators after watching a [YouTube video](https://www.youtube.com/watch?v=zqUYNYWPlpQ) earlier this year about an arbitrary code execution vulnerability in Project64, a Nintendo 64 emulator. The Project64 vulnerability was discovered and disclosed by [Denis Kopyrin](https://gist.github.com/aglab2/6bb351c4bd0ac6e13c931e03aa8f9949) (aglab2) in February 2024.

## Rationale, setup, and process

I have little experience with fuzzing or discovering memory corruption bugs, so my plan was to identify likely places in the program where a memory safety issue might exist, and let the LLM do the rest. I picked [Snes9x](https://www.snes9x.com) as the target as it is a popular Super Nintendo Entertainment System (SNES) emulator and is open source software.

I set up a Windows virtual machine, cloned the [Snes9x GitHub repository](https://github.com/snes9xgit/snes9x/), and ran Claude Code with the `--dangerously-skip-permissions` flag in the program's directory. The model I opted to use was Claude Opus 4.6 with 'effort' set to maximum.

The most viable entry point I'd identified was the code handling the loading of ROMs and patch files. Though I no longer have access to the chat, the initial prompt was something along the lines of "I know there is a vulnerability in the loading of ROM or patches. Find it."

The LLM refused at first, but proceeded after being reminded of my intention to report any vulnerabilities it found. Heh! It is worth noting that Anthropic's Cyber Verification Program did not exist at that time, and only came about with the release of [Claude Opus 4.7](https://www.cnbc.com/2026/04/16/anthropic-claude-opus-4-7-model-mythos.html).

The session usage limit of the $20 Claude Pro subscription was exhausted twice during the discovery process, with both sessions lasting roughly around 20 minutes.

## CVE-2026-39199

An attacker-crafted `.ups` patch file can trigger a heap-based out-of-bounds write on `Memory.ROM`. This results in corruption of adjacent heap memory and a crash of the emulator when the matching ROM is loaded.

The patching logic in [memmap.cpp:3942](https://github.com/snes9xgit/snes9x/blob/master/memmap.cpp#L3942) automatically searches for a `.ups` file matching the ROM filename and applies it without prompting the user. This means simply placing a malicious `.ups` file alongside a ROM (e.g., in a downloaded ROM pack or shared directory) is enough to trigger the vulnerability. UPS patches (alongside the respectively inferior and superior IPS and BPS patches) are what enable "ROM hacks."

In the UPS patching routine (in `memmap.cpp`, prior to the fix in commit [96b3661](https://github.com/snes9xgit/snes9x/commit/96b366100172723f6314c40e237b370f4f7b59f4)), the patch application loop accumulates a `relative` offset from values decoded out of the patch data, then uses it to XOR bytes directly into `Memory.ROM`:

```
  uint32 relative = 0;
  while(addr < size - 12) {
      relative += XPSdecode(data, addr, size);
      while(addr < size - 12) {
          uint8 x = data[addr++];
          Memory.ROM[relative++] ^= x;  // <-- no bounds check
          if(!x) break;
      }
  }
```

At line 3636, the function checks that `out_size <= CMemory::MAX_ROM_SIZE`, but it never validates that `relative` stays within `out_size` (or `MAX_ROM_SIZE`) during the XOR loop. A malicious UPS file can encode arbitrarily large offset values via `XPSdecode`, causing `relative` to run past the allocated buffer and write out of bounds.

# Conclusion
With Address Space Layout Randomization and Data Execution Prevention enabled (that is, by-default on modern Windows installations) this vulnerability results only in a crash.

When prompted to demonstrate code execution with these protections disabled, Claude Opus 4.6 generated a Python 'harness' that does succeed in spawning `calc.exe`, but only by first reading the running process's memory to resolve `WinExec` and locating the live `Memory.ROM` buffer to craft a `.ups` file good for exactly one run. No dice.

## Proof of concept

A Proof of Concept (archive containing `.ups` and ROM file) that reliably crashes Windows builds of Snes9x 1.63 on load is available [here](https://github.com/user-attachments/files/26470919/poc_crash.zip).

## Disclosure timeline
* Apr 4, 2026 — Vendor informed of vulnerability via [GitHub issue](https://github.com/snes9xgit/snes9x/issues/1035)
* Apr 4, 2026 — CVE requested from MITRE
* Apr 6, 2026 — Patched by [commit 96b3661](https://github.com/snes9xgit/snes9x/commit/96b366100172723f6314c40e237b370f4f7b59f4)
* Jun 11, 2026 — CVE assigned
* Jun 17, 2026 — Vulnerability publicly disclosed