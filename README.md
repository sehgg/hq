# HQ

Ein lokaler Projektplaner für Projekte, Prioritäten und lose Aufgaben.

## Start im Entwicklungsmodus

```sh
npm ci
npm start
```

## Eigenständige Mac-App bauen

```sh
npm run package
```

Auf einem Apple-Silicon-Mac entsteht `out/HQ-darwin-arm64/HQ.app`. Die App lässt sich per Doppelklick öffnen oder nach **Programme** ziehen. Auf einem Intel-Mac heißt der Ausgabeordner `HQ-darwin-x64`. Auf einem Windows-Rechner erzeugt derselbe Befehl einen Windows-Build mit `HQ.exe`.

Die Daten liegen getrennt von der App im Benutzerprofil. Auf macOS ist die Datenbank `~/Library/Application Support/HQ/hq.sqlite`.

## Deleting entries

Open a task or feature and choose **Löschen** in the details panel. Confirming permanently deletes the entry, its subtasks and acceptance criteria, and its dependency links. Linked tasks and features remain in place.
