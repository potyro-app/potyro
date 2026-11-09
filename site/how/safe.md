---
title: Safe to try anyone's app.
lead: An app made by someone else runs in a box on your phone. It reaches your camera or your location only if you say yes.
description: How Potyro decides where an app runs, what the box around someone else's app allows, what is asked before it is granted, and what is not protected.
---

## Where an app came from decides how it runs

Your own app runs as yours, with everything your phone allows. An app that arrived from anyone
else, by link, by file, by paste or by sharing, runs sealed, and nothing in the app can change that.
Only you can, by choosing to run it as yours.

## The box

A sealed app's code runs in a frame of its own with no origin of its own, no network, no popups,
no forms and nowhere to navigate to; each of its screens runs in a frame of its own as well. The
only way out is one door to Potyro, which checks every call the app makes. A watchdog gives every
call a deadline: an app that runs away is stopped within a second and started fresh.

## Asked, never assumed

Camera, location, files, the network, a model: a sealed app has none of these until it asks and
you say yes, once per app. **Allow** is remembered; **Not now** refuses this time.

## Honest limits

Your own apps have your full authority, so run an app as yours only if you would run its code. The
box does not cap memory. Found a hole? Report it privately, the way `SECURITY.md` in the repository
says.

## Go deeper

- [Your apps and other people's apps](docs/concepts/trusted-and-sealed.md): what keeps a shared app in its box, what the servers can see, what is not protected
