---
title: Look inside any app.
lead: Every app's records are tables you can open, search and edit in Potyro, and take out as one SQLite file.
description: The Data page shows every app's records as tables; Export writes a real SQLite file with the app's code, photos and files.
---

## The Data page

From the home screen, or from inside any app, **Data** opens every app's records on this phone:
one table per kind of record, with the fields the app declared as its columns, and a related record
shown by its name. Search narrows the rows. Tapping a row opens the app's own form, so what you
change there is what the app shows afterwards. The app's code does not run for any of this.

## Export

In an app's menu, **Export** writes one file, `<app>.potyro.zip`. Inside it: `data.sqlite`, a real
SQLite file that opens in any SQLite browser, in Datasette, or on the command line; the app's code;
its photos and its files. **Import** brings the file back, on this device or another, with the
records as they were.

## Why a plain database

Your data is not locked to Potyro. A SQLite file is read by thousands of tools, and it will still be
readable if Potyro is gone.

## Go deeper

- [Export, import and packages](docs/00-how-potyro-works.md#export-import-and-packages)
- [Persistence and migrations](docs/06-persistence-and-migrations.md): the tables behind an app, and how they change
