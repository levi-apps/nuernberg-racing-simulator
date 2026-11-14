# Nürnberg Racing Simulator

Mit dem Auto durch das echte Nürnberg fahren, mit dem echten Straßennetz und echten Gebäuden, Kreuzungen und Ampeln aus OpenStreetMap. Erst in 2D aus der Vogelperspektive, später in 3D.

Stand: **Schritt 2 – mit dem Auto durch die ganze Stadt fahren.** (Schritt 1: Datenpipeline und Karten-Debugansicht)

## Schnellstart

Voraussetzung: Node.js 20 oder neuer.

```bash
npm install
npm run data:download   # OSM-Auszug Mittelfranken laden (~100 MB, Geofabrik)
npm run data:build      # Spielwelt erzeugen (~15 s), schreibt nach game/public/world/
npm run dev             # Spiel unter http://localhost:5173
```

`data:build` nimmt die neueste `.osm.pbf`-Datei in `data/raw/`. Eine andere Datei geht so: `npm run data:build -- pfad/zur/datei.osm.pbf`.

## Fahren

| Taste | Funktion |
|---|---|
| W / ↑ | Gas |
| S / ↓ | Bremse, im Stand rückwärts |
| A, D / ←, → | lenken |
| Leertaste | Handbremse (driften) |
| R | zurück auf die nächste Straße |
| C | Kamera: Norden oben ↔ dreht mit dem Auto |
| K | Karte / Debugansicht ein- und ausblenden |
| H | Tastenhilfe ein/aus |
| Mausrad | näher / weiter weg |

Gamepads werden mit der Standardbelegung unterstützt: RT Gas, LT Bremse, linker Stick lenkt, A ist die Handbremse.

- Die Karte startet am Hauptmarkt. Mit `#x,y` in der URL startest du an einer anderen Stelle (Meter, siehe Koordinaten).
- Auf der Straße fährt das Auto am schnellsten. Im Gelände ist es langsamer und rutschiger, im Wasser kommt es kaum voran.
- Gebäude sind fest. Unter Gebäuden hindurch kann man nur fahren, wenn dort eine Straße verläuft (Durchfahrten).
- Auf Brücken und in Tunneln fährt das Auto auf einer eigenen Ebene und prallt nicht gegen darunter- oder darüberliegende Gebäude.
- Unten im HUD stehen Straßenname und Tempolimit. Bei mehr als 5 km/h über dem Limit blinkt das Schild (noch ohne Folgen).
- Kacheln werden beim Fahren um das Auto herum nachgeladen. Solange die Umgebung fehlt, steht die Physik kurz still.

## Debugansicht (Taste K)

- Ziehen verschiebt die Karte, das Mausrad zoomt. Die Position steht in der URL (`#x,y,m-pro-pixel`) und lässt sich teilen.
- Beim Hineinzoomen erscheinen Fahrspuren mit Richtungspfeilen, Spurverbinder (nach Abbiegerichtung eingefärbt), die Regelung am Spurende (Stopp, Vorfahrt gewähren, Vorfahrtstraße, rechts vor links) und Ampeln. Die Ampeln schalten live.
- Ein Klick auf eine Spur, einen Verbinder oder eine Ampel zeigt die Details. Bei einer Spur werden außerdem Nachfolger und Vorgänger hervorgehoben.
- „Auto hier absetzen“ im Auswahlfeld einer Spur setzt das Auto dorthin.
- In der Browser-Konsole sind die Ansicht als `map` und der Fahrmodus als `drive` erreichbar.

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
game/       Browser-Client (Vite, Three.js)
  src/world/          Darstellung der Welt, Kachel-Nachladen (für Fahren und Debug)
  src/drive/          Auto (Physik, Kollision, Eingabe), Kamera, HUD
  src/debug/          Debug-Oberfläche
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
- Wer abseits der Straße unter eine Brücke fährt und dabei die Brückenfläche berührt, landet auf der Brücke.
- Mauern, Zäune, Poller und Bäume sind noch keine Hindernisse, nur Gebäude.

## Lizenz der Kartendaten

Kartendaten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), verfügbar unter der [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/). Die erzeugten Weltdaten sind eine abgeleitete Datenbank und fallen ebenfalls unter die ODbL.
