---
title: "1-click MMI execution in Android"
date: 2026-10-09T16:05:00+02:00
author: Karan Saini
excerpt: An application with the CALL_PHONE permission can execute carrier MMI/USSD codes with no user confirmation. A vulnerable application with browsable deeplinks can trigger MMI execution with a single tap.
layout: post
permalink: /mmi-android/
image: /media/1-click-mmi-card.png
twitter:
  card: summary
categories:
  - Security
tags:
  - android
  - ussd
  - call forwarding
  - deeplinks
---

This article describes how vulnerable dialer applications can be exploited to achieve 1-click MMI execution in Android.

# Introduction

I've known for some time that Android apps with the `CALL_PHONE` permission can dial USSD and MMI codes alongside regular phone numbers. For as long as I have known this, I have wanted to develop an attack to execute MMI codes from an application or a web page with little or no user interaction. Three years ago, I created a proof of concept that would silently forward calls on a handset by abusing the `CALL_PHONE` permission. This would have obviously required a user to sideload the malicious application, undermining its impact. Last month, I discovered and reported vulnerabilities resulting in 1-click MMI execution where a user has a vulnerable dialer application installed on their device.

## What are MMI/USSD codes?

MMI and USSD codes are strings of digits, asterisks and hashes that are typed into a dialer but are not phone numbers — `*123#`, `*#06#`, `**21*<number>#`. Both are specified by 3GPP: the Man-Machine Interface codes in TS 22.030, and Unstructured Supplementary Service Data in TS 22.090. On devices, these codes are reachable only by the dialer (or SIM apps).

These strings fall into two groups. The first is handled on the device and never leaves the handset — `*#06#`, for example, returns the handset IMEI. The second is sent over the GSM signalling channel to the carrier, which either acts on the code or replies to it. This second group is USSD proper, and it is session-oriented: the handset opens a session, the network responds with text, and the exchange continues until either side ends it. It is what carriers build their menus on — account management, recharges, and even mobile banking (e.g., the UPI payments menu on `*99#`).

Supplementary service codes configure the subscriber's service within the carrier's records. They are defined in section 6.5.2 of TS 22.030, which specifies the format as `*SC*SI#` - a leading action code, a service code `SC` of two or three digits, the supplementary information `SI` that the service takes, and a terminating `#`. Service code `21` is unconditional call forwarding, `67` is forwarding on busy, `61` on no reply, `62` on unreachable; `33` is call barring, `31` is caller ID suppression (which doesn't work in India). `**21*5550000000#` translates to "register unconditional forwarding to this number," and the network registers that for whichever caller that dials the string. The registration is stored by the carrier and not the handset.

## The issue

`android.permission.CALL_PHONE` is an ordinary runtime permission. There are probably a handful of applications on your device to which you've granted this permission (e.g. WhatsApp, Signal, Truecaller). The text a user sees when granting the permission reads "make and manage phone calls."

![The CALL_PHONE runtime permission dialog](/media/call-phone-permission-dialog.png){: width="400" }
*The `CALL_PHONE` permission dialog as the user sees it. Screenshot courtesy of [Raghav Aggarwal / ProAndroidDev](https://proandroiddev.com/android-permissions-unveiled-a-developers-insight-131c829c150b).*

However, this permission also allows an app to execute arbitrary USSD and MMI codes against the SIM. A USSD/MMI code is a carrier control command rather than a call — `**21*<number>#`, for example, registers unconditional call forwarding.

The issue is twofold:
1. The permission text does not describe the USSD capability, so the grant does not constitute "informed consent," and 
2. nothing is shown to the user at the time of execution, i.e., the platform runs the code and only then displays a transient "USSD code running" dialog, with no point at which the user can decline. MMI execution does not write an entry to the standard call-log, so there is no obvious record either.

## Vulnerable dialer applications

The precondition for all of this is an application with the `CALL_PHONE` permission which also exposes a browser-reachable deeplink to its dial path. An application of this sort turns our local capability remote. Both of these properties are unremarkable on their own, but allow for 1-click MMI execution when combined.

To get a sense of how common browser-reachable dialer deeplinks are, I performed a manifest-level scan of 88 call, dialer and VoIP applications. Of these, 66 declared `CALL_PHONE`, and 54 exposed some browser-reachable dial surface. It should be noted that the majority of these only pre-fill a dialer with the supplied number rather than dialling it, which means that not all of them are exploitable as they stand today.

The scan is not a count of vulnerable applications. Whether any given application can be abused in this manner comes down to how that application handles its deeplinks. The scan produced a list of candidate applications worth examining.

## Testing

Working through those candidates, I started testing on an emulator (API 34, Android 14) since I didn't initially have an Android device at hand. An added benefit of testing in an emulator is that telephony behaviour can be captured with `dumpsys`. Driving a dialer's deeplink from a web page worked on the first try! Alas, Google requires that security vulnerabilities reported to them be tested on builds no more than 30 days old. I tried to bring up an Android 17 emulator next and had trouble getting a working image running, so I stopped for a bit and tried to find a handset on which to confirm the behaviour end-to-end.

After some searching I was able to get hold of a physical handset — a Samsung Galaxy M16 5G running Android 16 (One UI 8.5), build `BP4A.251205.006.M166PXXS7DZG1`, with a security patch level of 5 July 2026 — which let me confirm the behaviour against a live carrier network rather than against an emulated one. I did eventually get an Android 17 emulator image working as well, and re-ran everything on it, which reproduced unchanged.

## Demonstration: 1-click MMI execution through Chrome

ACR Phone / Cube ACR (`com.nll.cb`, which has over 5 million installs) has an intent filter which declares the action `android.intent.action.CALL_BUTTON`, the category `android.intent.category.BROWSABLE`, and a `tel:` data scheme. The activity it resolves to passes the `tel:` data into an auto-dial path, i.e., the supplied string is dialled rather than being presented to the user for confirmation.

Chrome's `intent:` URI syntax allows a page to nominate an arbitrary action for the intent which it emits. The only check that Chrome performs before dispatching is that the filter which resolves the intent declares `BROWSABLE`; it does not apply any filtering to the action itself. A page is therefore free to nominate `CALL_BUTTON`, at which point ACR's auto-dial path runs, and the supplied string is executed under ACR's own `CALL_PHONE` grant rather than under any grant held by the browser.

One further precondition is specific to ACR: it must hold the `DIALER` role — `DialerActivity.a0()` checks default-dialer status and redirects to its setup screen otherwise — in addition to holding `CALL_PHONE`. Both conditions are expected for a dialer replacement (such as ACR) but neither are default. Further, the preconditions apply to the demonstration rather than the underlying issue, that is the absence of consent and of confirmation for MMI execution holds for any `CALL_PHONE` holder, whatever role it does or does not have.

I ran two payloads: the balance query below, and the call forwarding registration in the section which follows. Both executed successfully. The terminating hash is percent-encoded as `%23` in each case:

```html
<a href="intent:*123%23#Intent;scheme=tel;action=android.intent.action.CALL_BUTTON;end">tap</a>
```

A literal `#` will survive `Intent.parseUri()`, which locates the fragment using `lastIndexOf("#Intent;")` rather than by searching for the first hash in the URI — but the hash is subsequently lost further down the dial path, and what remains of the string is then placed as an ordinary call to the number instead of being processed as an MMI code. `%23` must be used.

Tapping the link produces no chooser — ACR is the sole handler for that action with both `BROWSABLE` and a `tel:` scheme — and no confirmation of any kind. The intent which Android delivered, as captured from `dumpsys activity recents`:

```
act=android.intent.action.CALL_BUTTON
cat=[android.intent.category.BROWSABLE]     <-- added by Chrome; identifies the sender
dat=tel:*123%23
cmp=com.nll.cb/.dialer.dialer.DialerActivity
```

And the corresponding telephony record, from `dumpsys telecom`:

```
CallTC@2 (MO - outgoing)
  CREATED (com.nll.cb; ...)
  START_CONNECTION (tel:***** via:com.android.phone)
  SET_DISCONNECTED ... Reason: (Connection is null, DIALED_MMI)
```

`DIALED_MMI` means the framework processed the supplied string as an MMI code rather than dialling it as a number. The time elapsed between the tap and the creation of the call was roughly 1.3 seconds, with no interaction required beyond the single tap.

## Registering call forwarding

The balance query establishes that the path executes MMI codes. Only the payload changes from here. As described earlier, `**21*<number>#` registers unconditional call forwarding — so if the destination is a number which the attacker controls, the victim's incoming calls will be delivered to the attacker instead.

```html
<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>C1 forwarding</title></head><body style="margin:0;font-family:system-ui">
<div style="padding:20px"><h2>Case C1: call forwarding</h2>
<p style="font-size:13px;word-break:break-all">
intent:**21*5550000000%23#Intent;scheme=tel;action=android.intent.action.CALL_BUTTON;end</p>
<p style="font-size:13px;color:#a00">Registers unconditional call forwarding. Use a test line you control.
Undo with <code>##21#</code>.</p></div>
<a href="intent:**21*5550000000%23#Intent;scheme=tel;action=android.intent.action.CALL_BUTTON;end"
   style="display:block;margin:20px;padding:80px 0;background:#733;color:#fff;text-align:center;font-size:30px;text-decoration:none;border-radius:12px">TAP C1</a>
</body></html>
```

A single tap on this link registered forwarding: the network returned a successful-registration response, and a persistent diversion indicator appeared in the status bar.

![Call forwarding registered from a single tap on Android 17](/media/android17-call-forwarding-registered.png){: width="330" }
*The Android 17 reproduction. The diversion indicator is visible in the status bar, beside the clock.*

On the borrowed handset, which carried an Airtel India SIM, I confirmed the single-asterisk form, `*21*<number>%23`; the double-asterisk form above was run against the emulator's simulated network. The forwarding destination I registered was my own main line. I then called the borrowed handset from a third phone: the call arrived on my main line, and the borrowed handset never rang. On a live SIM, one tap on a web page is enough to send a victim's incoming calls somewhere else. Forwarding can be cleared with `##21#`, and the state the network holds can be interrogated with `*#21#`.

Both `*21*<number>%23` and `**21*<number>%23` will register forwarding, and in both cases the terminating hash must be `%23`.

## Impact

Call diversion converts code execution into call interception. For as long as a diversion remains registered, the attacker will receive the user's incoming calls — which includes voice-delivered one-time passcodes and bank verification callbacks, both of which remain in common use. The carrier network stores the registration of call forwarding, though modern handsets will display some text or icon letting the user know that call forwarding is active. At the same time, since the call forwarding registration is stored at the carrier-side, rebooting, uninstalling the dialer application, and even performing a factory reset will not cancel the forwarding.

MMI execution is never added to the call list, so there is nothing in the call log to examine. The only visible artefacts are a dialog which dismisses itself after about two seconds, and a diversion indicator in the status bar which I suspect very few users to recognise or act upon — let alone attribute it to a link they tapped earlier in the day. A user who suspects that something has happened has no record available to them which would confirm it.

The demonstrated chain requires an installed  application holding an ordinary runtime permission, a browsable deeplink leading into its dial path — in ACR's case, one the user has also chosen as their default dialer — and one tap which the user can be induced into making on just about anything — a play button, cookie banner, etc.

## Android 17 and the loss of caller identity

Everything above depends on the chosen application having an exposed deeplink which auto-dials. While testing on Android 17, however, I came across a related platform change which removes even that requirement. It was reported separately, and was only confirmed on an emulator.

Android 17 moves Telecom into the `com.android.telephonycore` mainline module, and splits its user interface out into a separate privileged application. `com.android.server.telecom` is now a shim which re-starts the `ACTION_CALL` intent it receives against `com.google.android.telecomui`, which in turn calls `TelecomManager.placeCall()` under its own identity. The package which originally made the call is not carried across this hand-off. Since `telecomui` holds `CALL_PRIVILEGED`, the identity Telecom evaluates is that of a privileged dialer, and the check which would otherwise reject a dangerous MMI string is skipped.

The effect of this is that on Android 17 a plain `**21*<number>#` sent through `ACTION_CALL` by an application which holds only `CALL_PHONE` — and which has no dialer role — is dispatched as an MMI code, with no crafted payload and no vulnerable third-party application anywhere in the path. The evaluated becomes `com.google.android.telecomui` instead of the identity of the application that made the call.

The control was added in Android 14, and on Android 14 through 16 reaching the same capability required a payload which evaded `MmiUtils` while surviving normalisation. Android 17 appears to have closed that evasion, and then made it unnecessary. The gate it ships is weaker than the one Android 14 shipped.

I had no physical Android 17 device, so this was confirmed on an emulator, which has no real SIM. `DIALED_MMI` establishes that the framework parsed and dispatched the string as an MMI code. It does not establish that a carrier registered the diversion, which would need a live SIM.

I reported this separately on 14 September. Google closed it on 24 September as a duplicate of an issue which one of their own engineers had reported earlier. I asked to be added to that report, and was told it could not be shared, being an internal bug containing confidential system information — but that my report described the same root cause, namely the `UserCallActivity` trampoline dropping the original caller's identity.

## On "working as intended"

That `CALL_PHONE` authorises a silent voice call is both documented and defensible. Whether that authorisation ought to extend to MMI execution is a separate question.

The permission text makes no reference to reconfiguration of the subscriber's service, which means that a user cannot meaningfully be said to have consented to it when granting "make and manage phone calls." The class of consequence is also different in kind — a silent call is observable and it costs the attacker money, whereas silent forwarding costs nothing and intercepts the victim's calls. The mitigation which is usually offered for the silent-call case does not carry over either, since a call leaves behind a log entry and an MMI code does not. And Google does already treat USSD as dangerous elsewhere, in that Play policy restricts its use by applications — which would presumably be unnecessary if silent execution were considered an ordinary and expected consequence of holding `CALL_PHONE`.

A narrow fix would be a confirmation prompt which displays the literal code, shown before the telephony stack executes an MMI string that has arrived through `ACTION_CALL` from an application which is not the user's chosen default dialer acting on direct user input. The broader fix would be to decouple the capability altogether: keep `CALL_PHONE` for dialling, and gate MMI execution behind either a distinctly-worded permission of its own or an explicit, confirmed API — much as `TelephonyManager.sendUssdRequest()` already is. Either approach would remove the web-reachable path without being dependent on individual developers fixing their deeplink handling.

## Disclosure

I reported the `CALL_PHONE`/MMI issue to the Android & Google Devices VRP on 12 September 2026, and followed it with an Android 17 retest on 14 September, confirming that the chain still worked. The report was closed as Won't Fix (Infeasible) on 17 September. The assessment given was that this is not a vulnerability in Android itself, but rather a consequence of insecure deeplink handling in third-party dialer applications such as ACR, and that hardening at the platform level would be treated as a future improvement rather than as a fix.

I disagree, for the reasons set out in the section above — that the permission grant does not inform the user of the possibility of MMI execution, and in the absence of a platform-level change the security of the model rests on every call-capable application's deeplinks being reviewed for auto-dial paths, which I do not believe is feasible. I raised these same points in reply. Google's position did not change. On the question of what "logged this issue for potential remediation in a future version" had meant:

> When we mentioned that we "logged this issue for potential remediation in a future version," we meant that our team is looking into ways we might improve the Android platform in the future to help prevent third-party apps from making this type of mistake. However, because this would be an overall platform improvement and not a direct fix for an Android vulnerability, the report was closed on our end.

On the remediation I had suggested:

> While we agree that this is an area where the Android platform could be improved—such as your suggestions to decouple the permissions or add user confirmation prompts—this type of architectural change is considered a platform improvement rather than a security vulnerability in the current OS. Because the exploit relies on third-party apps improperly exposing their dial paths, it remains outside the scope of the Android & Google Devices Vulnerability Reward Program.

I reported the ACR Phone deeplink issue to its developer on 9 October along with a recommendation that MMI and USSD strings be rejected on the externally-reachable dial path.

The response was much quicker than I had expected. The developer responded 48 minutes later, mentioning that a fix was committed to the next release, supplying a beta build for verification. The developer noted that the Play release would be dependent on Google's review, which he expected to complete towards the end of the following week.

Re: ACR Phone, `DialerActivity` has been reported before. The same component was the subject of [CVE-2024-36064](https://github.com/actuator/com.nll.cb/blob/main/CVE-2024-36064), reported by Edward Warren, which described the activity as being reachable by any installed application — one without any permissions — such that a crafted intent would place a call with no user interaction, affecting versions through `0.330-playStore-NoAccessibility-arm8`. The two issues share a root cause, in that an exported entry point into the dial path performs no validation of either its caller or its payload. The earlier report required a malicious application to have been installed on the device already, and resulted in a call being placed. The path described here is reachable from any web page, and reconfigures the subscriber's service with the carrier.

## Disclosure timeline

**`CALL_PHONE` and MMI execution**

- 12 Sep 2026 — Reported to the Android & Google Devices VRP
- 14 Sep 2026 — Added an Android 17 retest
- 17 Sep 2026 — Closed as Won't Fix (Infeasible); not an OS vulnerability, but third-party deeplink handling
- 09 Oct 2026 — Reported the deeplink issue to the ACR Phone developer
- 09 Oct 2026 — ACR Phone developer acknowledged the report, fix committed to the next release
- 9 Oct 2026 — Public disclosure

**The TelecomUi trampoline**

- 14 Sep 2026 — Reported to the Android & Google Devices VRP as a separate issue
- 24 Sep 2026 — Closed as a duplicate of an issue reported earlier by a Google engineer
- 25 Sep 2026 — Request to be invited to the original report declined by Google
- 9 Oct 2026 — Public disclosure