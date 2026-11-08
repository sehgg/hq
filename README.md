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

Open a task, feature, or fix and choose **Löschen** in the details panel. Confirming permanently deletes the entry, its subtasks and acceptance criteria, and its dependency links. Linked entries remain in place.

## Linking tasks to features and fixes

In a software project's feature or fix details, use **Zugehörige Aufgaben** to create or assign tasks from the same project. Task details let you open, change, or clear the associated feature or fix. Assignments do not change either entry's status or create a predecessor relationship.

## Upcoming sections

The **Ideen** and **Recherche** navigation entries are placeholders for sections still in development.

## Planning releases

Software projects have a **Releases** tab. Use **[ + ]** to create a version and **[ B ]** to edit an existing version and its optional due date; the publish action marks a release as published. Features and fixes can target an unpublished release in the same project. Publishing removes that version from new selections while retaining existing assignments and the release contents. Existing free-text target versions are migrated to planned releases when the database is upgraded.
