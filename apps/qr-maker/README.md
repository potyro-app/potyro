# QR Maker

Type a text, a link, a Wi‑Fi network or a contact, and a QR code appears as you type — big, black
on white, ready to hold up. **Share** it as a picture, **Keep** it for next time, or **Save a copy**.
Nothing leaves the device: the code is made here, with no library and no network.

```
qr-maker.app.ts   the app: the Make screen, the Kept screen, the tile, the demo
qr.ts             the encoder (byte mode, versions 1–40, levels L/M/Q/H, Reed–Solomon, the eight
                  masks), a PNG written by hand, and a canvas drawer
words.ts          every word on the screens, in six languages
test/             the encoder read back by jsQR for every version, the app's shape and words
```

## What a code says

| Kind | What is typed | What the code carries |
|---|---|---|
| Text | anything | the text, as typed |
| Link | an address; `https://` is added when missing | the URL |
| Wi‑Fi | network name, password, WPA / WEP / open | `WIFI:T:WPA;S:name;P:password;;` — what phones read to join |
| Contact | name, phone, email | a small vCard 3.0 |

A kept code is a record (`code`: label, kind, content) whose picture is a PNG in the app's folder
(`codes/`), written from the matrix by `pngOf` — 1 bit a pixel, stored deflate blocks — so it needs
no canvas and is the same in the page, the sealed box and a test. What you last typed is remembered
in `ctx.storage`, so the app opens on it.

## The encoder (qr.ts)

After Project Nayuki's reference algorithm for ISO/IEC 18004: the smallest version that holds the
bytes at level M, the error-correction codewords per block, interleaving, the function patterns,
the zigzag placement, the eight masks scored by the standard's four penalties, format and version
information. `test/qr.test.ts` renders every code to pixels and reads it back with jsQR — a wrong
table or a wrong bit fails there — across all forty versions and all four levels.
