# Privacy

Effective: 2026-11-07

## The short version

- Potyro runs in your browser. Your apps and what you put in them stay on your device, unless you
  turn on sync or backup, share an app, or use a feature that needs the internet.
- There are no accounts, no ads, no cookies and no analytics. Nothing is sold.
- When something leaves your device, it is because you used a feature that needs it. This page
  says, for each one, what goes, where, and for how long.
- Some parts of Potyro use AI models. What they make can be wrong.

## Who runs Potyro

Potyro is run by Edgar Zanella Alvarenga, an individual resident in Italy, not a company.
Write to contact@potyro.com.

In this text, "we" means that person. We decide how the data described here is handled, so under
the EU's data protection law (the GDPR) we are its controller.

## What stays on your device

These are kept in your browser's storage for the Potyro site (or in the app's own storage on
Android). We never receive them unless a section below says so.

- **Your apps**: their code, records, photos, files, history and Studio conversations.
- **Who you are**: a key made on your device, and the recovery words that bring it back. The secret
  part is kept encrypted in your browser (or in the phone's keystore on Android). We never see it,
  and we cannot recover it for you.
- **A name, if you set one** under You. It goes with you when you sync or share (see below).
- **A random device id.** It is used only to count the free AI allowance and requests to the
  Potyro team. It says nothing about you.
- **Keys you paste for AI services** are kept for the open tab only. Close the tab and they are
  gone. Keys for data sources in Ask are kept in the device's encrypted storage.

Potyro sets no cookies. What it keeps in your browser is what makes it work, not a way to follow
you. To delete it, delete an app, or clear the site's data in your browser. If an app is not
synced or backed up, clearing it deletes that app for good.

## When something leaves your device

### Sync, sharing with people, and backup

Sync is off until you turn it on, for one app, or for all of them with "Back up my apps". Sharing
an app with people ("Use it together") needs sync on for it.

When it is on, the app's data goes to Potyro's sync relay, a server we run.

- **It is encrypted on your device**, with keys that only your devices and the people you invite
  hold. An invite carries its secret in the part of the link after `#`, which your browser never
  sends to a server. The relay cannot read your records, files, photos or chat messages.
- **What the relay can see:** your account id (a random code made from your key), which shared
  spaces your account is in and who else is in them, when your devices connect and sync, how much
  data they send, and your device's IP address while it is connected.
- **Your name, if you set one, is readable on the relay.** It is kept that way so the people you
  share with can see it.
- **How long:** the relay keeps everything a space ever wrote, including what was later changed or
  deleted. Nothing is cleaned up over time. Turning sync off for an app stops new data. It does not
  remove what is already on the relay. See [Your rights](#your-rights) for what we can remove.
- **People you share with** get a copy on their own devices. If you made the app, you can remove a
  person. They keep what already reached their device.

### Links anyone can try

A demo link lets someone try one of your apps in their browser.

- **The app is encrypted on your device** before it is uploaded. The key is in the link, after
  `#`, so our server never has it and cannot open the app.
- **It carries sample records only**, never your own.
- **Some of it is public on purpose**, so chats can show a preview: the app's name, one line of
  text, the language, and a preview picture drawn from the sample records. If you leave
  "Say it is by" ticked, the line includes your name. Anyone who has the link can see these. The
  pages ask search engines not to list them.
- **How long:** a link does not expire. It stays until it is deleted. There is no button for that
  in Potyro yet: write to us with the link and we delete it.
- **Limits:** we count links per IP address per day, in memory only. The count is not written to
  disk.
- If the link service cannot be reached, Potyro puts the whole app inside the link instead. That
  kind of link never reaches our server.

### AI inside apps, and the free allowance

An app can send a photo, a text or a short recording to an AI model when you use it, for example to
read a receipt. An app someone else made asks you first. Only what the app sends goes, nothing else
in it. Photos are made smaller on your device before they go.

**With the free allowance** (when you have not added your own key):

- The request goes to our AI relay. The relay sends it to OpenRouter, which passes it to the
  company that runs the model. Today the model is Gemini 2.5 Flash Lite, run by Google.
  <!-- The relay's default; the live AI_MODEL setting is facts.md F-35. -->
- We ask OpenRouter to use only providers that do not keep or train on what they are sent.
- OpenRouter does not get your IP address or your device id from us.
- The relay does not keep what you send, and does not log it, your device id or your IP address.
- To keep the allowance fair, the relay counts requests. For the current month it keeps, in a file,
  the number of requests per device id and the total cost. These are replaced when the next month
  starts. Daily counts per device id and per IP address are kept in memory only, for a day.

**With your own key**, your browser talks to OpenRouter directly. We see nothing. OpenRouter's terms
and your own account's settings apply.

### Voice

Where your speech is turned into words depends on your browser. Potyro asks you before your speech
leaves your device, and shows where the words are made while it listens.

- **On your device**, where the browser or phone can do it. Nothing leaves.
- **Your browser's own service**: Google's for Chrome, Microsoft's for Edge, Apple's for Safari.
  That company's terms apply, not ours.
- **In Firefox**, which has no such service, the recording goes the same way as AI inside apps
  (above): through the free allowance or your own key. A recording is at most one minute. If you
  leave before it is sent, it is thrown away.

### Building apps in the Studio, and Ask

The Studio and Ask use the model you choose in Model settings:

- **A model on your device**, or Chrome's built-in model: nothing leaves your device.
- **A cloud service with your own key** (OpenRouter or Anthropic): what you type, and the app's
  code and structure, go from your browser to that service. We see none of it. That service's terms
  apply.

Ask sends the app's structure, your request and anything you paste. It does not send the app's
records. If you turn on web search, addresses it finds may be looked up on OpenStreetMap's address
service, from your device.

### Requests and wording suggestions to the Potyro team

You can send a request from the Studio ("Potyro can't do this yet") or a better wording from
You, Language. You see it before it goes.

- It contains your words, the app's name and its structure (never its records), and your language.
- Our relay posts it on GitHub as a **public** issue in Potyro's repository. Anyone can read it.
  Do not put anything private in it.
- Your device id and IP address are not on the issue and are not given to GitHub. The relay counts
  requests per device id and per IP address, in memory only.
- **How long:** the issue stays on GitHub until it is deleted. Ask us and we delete it.

### Rooms for multiplayer apps

Some apps, like games, connect people in a room.

- Our rooms relay passes each message on to the others in the room. Nothing is written to disk. A
  room is gone when its last person leaves.
- Messages are protected on the way, but they are not end-to-end encrypted: the relay handles them
  in readable form. It does not look at them or log them.
- While the room is live, the relay holds a random id for each person, the display name the app
  gives it (often one you typed), and counts per IP address.

### Other services your browser may contact

- **Maps** load their pictures from OpenStreetMap's servers, which see your IP address and the area
  you look at.
- **Libraries** an app uses are downloaded once, when you add the app, from where the app says
  (often esm.sh). An app you did not make asks first.
- **Apps that reach the internet**: an app you did not make can reach a website only if you allow
  it. That website then gets what the app sends.
- **A model on your device** is downloaded once, the first time you choose it, from Hugging Face
  and GitHub.

These services work under their own terms.

### Our web server

Like any website, our server receives your IP address with every request.
<!-- What the web server in front of potyro.app logs, and for how long, is not known: facts.md F-07. Say it here once confirmed. -->

## AI can be wrong

Apps made in the Studio are written by an AI model. Answers inside apps, like the lines read off a
receipt, come from an AI model. What comes back can be wrong. Check what matters before you rely
on it.

## Why we handle this data

- **Because you asked for it.** Sync, links, AI, voice, rooms and requests need the data described
  above to work. We use it only to give you that feature.
- **To keep a free service working and fair.** The limits per device and per IP address, and the
  spending cap on the free allowance, stop one person from using it up for everyone, and protect
  the service from abuse.
- **Because the law requires it**, if an authority makes a lawful request.

We do not use your data for ads, profiles or anything you did not ask for.

## Who else handles data for us

| Who | What for | Where |
|---|---|---|
| Hetzner Online GmbH | Hosts potyro.app: the site, the sync relay, links, rooms, the AI and request relays | Finland (EU) |
| OpenRouter | Passes free allowance and Firefox voice requests to the model's provider | |
| Google | Runs the model behind the free allowance (Gemini 2.5 Flash Lite), through OpenRouter | |
| GitHub | Holds requests and wording suggestions, as public issues | |
| Gandi | Holds our mailbox, if you write to us | |

<!-- Where OpenRouter, Google, GitHub and Gandi process data, and the safeguards for any transfer
outside the EU: facts.md F-40, README open points. -->

Some of these companies may handle data outside the EU, including in the United States.

## How long we keep it

| What | Where | How long |
|---|---|---|
| Synced and backed up apps (encrypted) | Sync relay | Until removed by hand. Nothing expires. |
| Who shares with whom, your name if set | Sync relay | The same |
| Demo links: the encrypted app, its title, line and picture | Link service | Until deleted. Links do not expire. |
| Free allowance: requests per device id, total cost | AI relay, a file | The current month |
| Daily counts per device id or per IP address | AI, link and request relays, memory | A day, or until the relay restarts |
| Rooms: ids, names, counts | Rooms relay, memory | While the room is live |
| Requests and wording suggestions | GitHub, public | Until deleted |
| Emails you send us | Our mailbox | 12 months after the matter is closed |
| Everything else | Your device | Until you delete it |

## Your rights

You can ask us to show you the data we hold about you, correct it, delete it, limit what we do with
it, or give it to you in a usable form. You can object to how we use it. Write to contact@potyro.com.

There are no accounts, so we can only find your data if you tell us where it is: the link, the
request, or your identity id (You, Advanced). We reply within one month.

What deleting can do today:

- **A demo link**: we delete it, with its picture and title.
- **A request or wording suggestion**: we delete the issue on GitHub.
- **Sync on your device**: you turn it off, for one app or for backup. That stops new data. It does
  not remove what is already on the relay.
- **A space on the sync relay**: there is no tool for this yet. If you ask, we will try to remove it
  by hand and tell you what was removed. Other people in that space would lose the relay's copy
  too, so we will ask you which space it is.
  <!-- Removing one space from the relay's database is untested: facts.md F-52. -->
- **What is on your device**: you delete it yourself. We never had it.

We cannot read your synced records, so we cannot give you a copy of them. You have them on your
device, and Export saves them as a file.

If you think we handle your data wrongly, you can complain to the Italian data protection
authority, the Garante per la protezione dei dati personali (garanteprivacy.it), or to the
authority where you live.

## Age

You need to be at least 14 to use Potyro.

## Keeping it safe

Your data is encrypted on your device before it is synced or shared, and your key stays on your
device. Be aware of the limits:

- Anyone who has an invite link to an app can join it. Send it only to people you mean.
- The sync relay does not check who connects. It cannot read what it holds, but anyone who reaches
  it can store data on it.
- In a browser, code running on the Potyro site can still ask your browser to use your stored key.
  The phone apps keep it in the phone's keystore.

## Changes

We post every change here, with its date. If a change matters to you, Potyro tells you before it
applies.
