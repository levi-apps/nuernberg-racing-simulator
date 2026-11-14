# Nürnberg Racing Simulator

Mit dem Auto durch das echte Nürnberg fahren, mit dem echten Straßennetz und echten Gebäuden, Kreuzungen und Ampeln aus OpenStreetMap. Erst in 2D aus der Vogelperspektive, später in 3D.

Stand: **Schritt 1 – Datenpipeline und Karten-Debugansicht.**

## Schnellstart

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run data:download   # OSM-Auszug Mittelfranken laden (~100 MB, Geofabrik)
npm run data:build      # Spielwelt erzeugen (~15 s), schreibt nach game/public/world/
npm run dev             # Debugansicht unter http://localhost:5173
```

`data:build` nimmt die neueste `.osm.pbf`-Datei in `data/raw/`. Eine andere Datei geht so: `npm run data:build -- pfad/zur/datei.osm.pbf`.

## Debugansicht

- Ziehen verschiebt die Karte, das Mausrad zoomt. Die Position steht in der URL (`#x,y,m-pro-pixel`) und lässt sich teilen.
- Beim Hineinzoomen erscheinen Fahrspuren mit Richtungspfeilen, Spurverbinder (nach Abbiegerichtung eingefärbt), die Regelung am Spurende (Stopp, Vorfahrt gewähren, Vorfahrtstraße, rechts vor links) und Ampeln. Die Ampeln schalten live.
- Ein Klick auf eine Spur, einen Verbinder oder eine Ampel zeigt die Details. Bei einer Spur werden außerdem Nachfolger und Vorgänger hervorgehoben.
- In der Browser-Konsole ist die Ansicht als `map` erreichbar.

## Aufbau

```
shared/     Datenformat der Welt (TypeScript-Typen, Ampellogik)
pipeline/   OSM -> Spielwelt
  src/pbf/reader.ts   eigener PBF-Leser (ganz Mittelfranken in ~3 s)
  src/extract.ts      Zuschnitt auf die Stadtgrenze (OSM-Relation 62780), Projektion
  src/roadnet.ts      Straßengraph, Spuren, Kreuzungsflächen, Spurverbinder
  src/control.ts      Ampeln, Phasen, Vorfahrt, rechts vor links
  src/surfaces.ts     Fahrbahnflächen und Markierungen
  src/validate.ts     Prüfung des Spurgraphen (Sackgassen, Zusammenhang)
  src/tiles.ts        Ausgabe als Kacheln
game/       Browser-Client (Vite, Three.js), aktuell die Debugansicht
data/raw/   OSM-Rohdaten (nicht im Repo)
```

### Koordinaten

Meter in ETRS89 / UTM 32N (EPSG:25832), verschoben auf den Hauptmarkt als Ursprung (x = Osten, y = Norden). In den Dateien stehen Dezimeter als Ganzzahlen.

### Ausgabe (`game/public/world/`)

| Datei | Inhalt |
|---|---|
| `manifest.json` | Kachelliste, Stadtgrenze, Ursprung, Statistik |
| `tiles/{tx}_{ty}.json` | 250 × 250 m: Fahrbahnflächen, Markierungen, Spuren, Verbinder, Signalköpfe, Gebäude (mit Höhe), Flächen, Linien |
| `signals.json` | alle Ampelanlagen mit Phasen |
| `areas.json` | große Flächen (Wald, Wasser, Parks) |
| `overview.json` | Hauptstraßen für die Übersicht |
| `places.json` | Stadtteile und Sehenswürdigkeiten |

Objekte, die über Kachelgrenzen reichen, stehen in mehreren Kacheln mit derselben `id`.

### Wie die Regeln entstehen

- **Spuren:** aus `lanes`, `lanes:forward/backward`, `oneway` und `turn:lanes`. Fehlen Angaben, gelten Standardwerte je Straßenklasse. Busspuren werden nicht mitgezählt.
- **Verbinder:** Die Abbiegerichtung ergibt sich aus dem Winkel. `turn:lanes` und Abbiegeverbote (`restriction`) werden berücksichtigt. Passen die Pfeile nicht zur Geometrie, bekommt die Spur eine Ausfahrt passend zu ihrer Lage.
- **Ampeln:** Die Standorte stammen aus OSM (`highway=traffic_signals`). Ein Ampelknoten bis 55 m vor einer Kreuzung gehört zu dieser Kreuzung; ohne Richtungsangabe gilt er für die Fahrtrichtung zur nächsten Kreuzung. Signalisierte Knoten, die weniger als 45 m auseinanderliegen, bilden eine gemeinsame Anlage. Die Phasen sind **erzeugt** (zwei Achsen, feste Zeiten), echte Schaltpläne gibt es in OSM nicht.
- **Vorfahrt:** Kreisverkehr, `highway=stop/give_way` und `priority_road` werden ausgewertet. Sonst hat die höhere Straßenklasse Vorfahrt. Bei gleichrangigen Wohnstraßen gilt rechts vor links, Ausfahrten von Grundstücken und Parkplätzen müssen warten.

### Bekannte Grenzen (Stand Schritt 1)

- Bei großen Knoten mit mehreren OSM-Kreuzungen (z. B. Plärrer) haben die inneren Verbindungen keine eigene Ampel, sondern „Vorfahrt gewähren“.
- Etwa 5 % der Spuren liegen außerhalb des zusammenhängenden Hauptnetzes (Parkplätze, Stummel an der Stadtgrenze). Sie sind mit `iso: 1` markiert.
- Die Fahrbahnbreite ergibt sich nur aus den Fahrspuren. Parkstreifen, Gehwege und Bordsteine fehlen noch.

## Lizenz der Kartendaten

Kartendaten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), verfügbar unter der [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/). Die erzeugten Weltdaten sind eine abgeleitete Datenbank und fallen ebenfalls unter die ODbL.
