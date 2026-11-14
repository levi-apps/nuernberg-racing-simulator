# Nürnberg Racing Simulator

Mit dem Auto durch das echte Nürnberg und das echte Roth fahren, mit dem echten Straßennetz und echten Gebäuden, Kreuzungen und Ampeln aus OpenStreetMap. In 3D (GTA-Look) oder als Draufsicht.

Stand: **Schritt 4 – Aufträge (Taxi, Kurier), Navigation, Minikarte, Straßennamen, Startgebiet.** (Schritt 1: Datenpipeline und Debugansicht, Schritt 2: Fahren, Schritt 3: Ampeln und KI-Verkehr)

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
| V | 3D-Ansicht (Verfolgerkamera, Standard) ↔ Draufsicht |
| B | zurückschauen (3D) |
| C | Kamera: Norden oben ↔ dreht mit dem Auto (Draufsicht) |
| G | Garage / Autohaus (Autos wechseln, lackieren, kaufen) |
| X | Job abbrechen bzw. Navigation beenden |
| Shift (Gamepad RB) | Nitro, wenn eingebaut |
| O | Startgebiet (Stadtteil) wählen |
| T | KI-Verkehr an/aus |
| + / − | Verkehrsdichte (25–250 %) |
| K | Karte / Debugansicht ein- und ausblenden |
| H | Tastenhilfe ein/aus |
| Mausrad | näher / weiter weg |

Gamepads werden mit der Standardbelegung unterstützt: RT Gas, LT Bremse, linker Stick lenkt, A ist die Handbremse.

- **Startgebiet:** Beim Start wählst du einen von rund 100 Stadt- und Ortsteilen (aus OSM). Du kannst auch einen zufälligen nehmen oder an der letzten Position weiterfahren. Die Taste O öffnet die Auswahl jederzeit. Mit `#x,y` in der URL startest du ohne Menü direkt an einer Stelle (Meter, siehe Koordinaten).
- **Straßennamen:** Sie stehen entlang der Straßen, auch bei Querstraßen. Wichtige Straßen haben Vorrang, und Beschriftungen überdecken sich nicht.
- Auf der Straße fährt das Auto am schnellsten. Im Gelände ist es langsamer und rutschiger, im Wasser kommt es kaum voran.
- Gebäude sind fest. Unter Gebäuden hindurch kann man nur fahren, wenn dort eine Straße verläuft (Durchfahrten).
- Auf Brücken und in Tunneln fährt das Auto auf einer eigenen Ebene und prallt nicht gegen darunter- oder darüberliegende Gebäude.
- Unten im HUD stehen Straßenname und Tempolimit. Bei mehr als 5 km/h über dem Limit blinkt das Schild (noch ohne Folgen).
- Kacheln werden beim Fahren um das Auto herum nachgeladen. Solange die Umgebung fehlt, steht die Physik kurz still.

## Optik

Die Welt wird als realistische Draufsicht gezeichnet. Alle Texturen sind prozedural (Shader in `game/src/world/materials.ts`), es gibt also keine Bilddateien.

- **Straßen:** Asphalt mit Korn und ausgebesserten Stellen, Gehwege mit Pflaster und hellem Bordstein, abgerundete Kreuzungsecken.
- **Markierungen:** weiß und in echter Breite, Leitlinien gestrichelt (3 m Strich, 6 m Lücke), Haltelinien, Zebrastreifen, Fußgängerfurten an Ampeln und Abbiegepfeile aus `turn:lanes`.
- **Brücken:** mit Geländer und Schatten.
- **Gleise:** Schotterbett und zwei Schienen; Straßenbahnschienen liegen in der Fahrbahn.
- **Wege und Grenzen:** Fuß- und Radwege (Radwege rot), Hecken, Mauern (Stadtmauer breit) und Zäune.
- **Gebäude:** Dächer in Ziegelrot, Schiefergrau oder Kupfergrün, aus `roof:colour` oder je nach Gebäudeart. Satteldächer bekommen einen First, Walmdächer Dachflächen, verwinkelte Steildächer schräge Ränder. Flachdächer haben eine helle Attika. Schatten richten sich nach der Gebäudehöhe (Sonne aus Südwesten).
- **Bäume:** Einzelbäume und Baumreihen aus OSM mit Kronen und Schatten. Wälder, Rasen und Wasser haben eigene Muster, das Wasser bewegt sich langsam.
- **Ampeln:** Mast am Fahrbahnrand, bei breiten Zufahrten mit Ausleger über die Spuren, leuchtende Lampe mit Schein auf der Fahrbahn.

### 3D-Ansicht (Standard, Taste V wechselt zur Draufsicht)

Die Kamera folgt dem Auto tief von hinten, mit Horizont und Himmel im Bild. B schaut zurück. Die Auswahl bleibt im Browser gespeichert. In 3D bekommen die Kacheln eigene Körper, die erst beim ersten Wechsel erzeugt werden.

- **Licht:** Sonne mit echten Schatten (Gebäude, Bäume, Masten, Autos) und Himmelslicht. Der Himmel spiegelt sich in Lack, Fenstern und Wasser. Dunst in der Ferne.
- **Tag und Nacht:** Die Sonne geht um 6 Uhr im Osten auf und um 18 Uhr im Westen unter. Abends und nachts gibt es Sterne und Mond, einen Teil der Fenster beleuchtet, leuchtende Läden, Straßenlaternen mit echtem Licht in der Nähe, Scheinwerfer und Rückleuchten. Standard: 1 Spieltag = 24 Minuten.
- **Gebäude:** Fassaden mit Fensterrahmen, Fensterbänken, Gesimsen und teils Ladenzonen im Erdgeschoss. Dazu Ziegeldächer mit Reihen und Verwitterung, Schornsteine, Flachdächer mit Attika und Aufbauten.
- **Straßen:** Asphalt mit Ausbesserungen, Pflaster, Markierungen. Straßenlaternen alle ~30 m entlang der Bordsteine. Ampeln mit Lampe zum Verkehr.
- **Bäume:** Kronen aus mehreren Laubballen.
- **Autos:** Gerundete Karosserien je Typ mit Radhäusern, Glaskabine, Säulen, Felgen mit Speichen, Spiegeln, Kennzeichen, Scheinwerfern und Rückleuchten. Sportwagen haben Heckflügel, Abschleppwagen Kran und Rundumleuchte. Der eigene Wagen hat Klarlack, und die Räder drehen und lenken. Die KI-Fahrzeuge nutzen dieselben Modelle in vier Pkw-Varianten plus Transporter und Bus.
- **Effekte:** Reifenspuren und Rauch beim Driften, Handbremsen, Vollbremsen und Nitro-Burnout. Leuchteffekte (Bloom) und Umgebungsverdeckung (GTAO).
- **Wetter:** Wolken, Regen mit nassen, spiegelnden Straßen und Pfützen, Gewitter mit Blitzen, Schnee mit Schneedecke. Nässe und Schnee verringern die Haftung. Im Grafikmenü wählbar oder automatisch wechselnd.
- **Kamera:** Blickfeld wächst mit dem Tempo und beim Nitro, Wackeln bei Unfällen, Bewegungsunschärfe am Bildrand, Farbkorrektur (warme Lichter, kühle Schatten), Lichtstrahlen und Linsenreflexe der Sonne.
- **Wahrzeichen:** St. Lorenz, St. Sebald, Frauenkirche mit Ziergiebel, St. Elisabeth, Stadtmauertürme, Sinwellturm, Fernmeldeturm, Schöner Brunnen. In der Altstadt Fachwerk- und Sandsteinhäuser, Chörlein, Gauben. In Roth: Stadtkirche, katholische Kirche und Schloss Ratibor mit Ecktürmen, Fachwerk in der Altstadt.
- **Werbung:** Überall hängt Werbung für [PokeTrade](https://poketrade.patrick-thomas.de): Plakatwände (beidseitig), Litfaßsäulen, Fassadenbanner, Leuchtreklamen auf Dächern und Plakate in Bushaltestellen. Nachts leuchten sie.
- **Echte 3D-Modelle:** Autos, Fußgänger, Bäume, Büsche und Trümmerteile von [Kenney](https://kenney.nl) (CC0). Lack mit Klarlack, spiegelnde Scheiben und Chrom.
- **Straßenleben:** parkende Autos am Straßenrand und auf Parkplätzen, Verkehrsschilder (Stopp, Vorfahrt, Tempo 30/50), Poller, Mülleimer, Bänke, Bushaltestellen, Fußgänger auf den Gehwegen (rennen weg, fallen um, schimpfen), rot-weiße Straßenbahnen auf den echten Gleisen. Kleine Dinge kann man umfahren, sie fliegen weg.
- **Natur:** Vorgärten mit Rasen, Beeten, Hecken, Büschen und Bäumen; Büsche in Parks; Wasser mit bewegten Wellen.
- **Schaden:** Dellen in der Karosserie, abfallende Teile und Stoßstangen, Glassplitter, Motorrauch ab ca. 40 % Schaden, weniger Leistung. Anzeige 🔧 am Tacho, Reparatur in jeder Tuning-Werkstatt.
- **Nacht:** Lichthöfe und Lichtkegel an den Laternen.

**Grafik-Einstellungen:** Das Zahnrad oben rechts zeigt die Uhrzeit im Spiel.

| Stufe | Schatten | Umgebungsverdeckung | Leuchten | Kantenglättung | Laternenlichter | Sichtweite |
|---|---|---|---|---|---|---|
| Niedrig | aufgemalt | – | – | – | – | 170 m |
| Mittel | 1024 px | – | ja | FXAA | 4 | 220 m |
| Hoch (Standard) | 2048 px | ja | ja | SMAA | 8 | 280 m |
| Ultra | 4096 px | ja | ja | SMAA | 12 | 340 m |

Dort lassen sich auch die Tageszeit (Regler oder Morgen/Mittag/Abend/Nacht), das Anhalten der Zeit und die Tageslänge einstellen. Auf Handys startet das Spiel mit „Mittel“. Die Minikarte und die große Karte (K) bleiben die unbeleuchtete Draufsicht.

## Jobs, Geld und Autos

Überall in der Stadt stehen farbige **Job-Marker** (am Boden, auf der Minikarte und mit Schild). Marker außerhalb des Bildes erscheinen am Rand mit Entfernung. Fahr hin und halte im Ring an, dann startet der Job. Bezahlt wird nach geplanter Fahrzeit, also ungefähr ein fester Betrag pro Minute je Job-Art.

| Job | Fahrzeug | ca. €/min | Ablauf |
|---|---|---|---|
| 🚕 Taxi | jedes | 8 | Fahrgast an einer Adresse, Ziel Adresse oder Ort; Trinkgeld für zügige, saubere Fahrt |
| 🍕 Essen liefern | jedes | 8 | Abholen bei Restaurant/Café, Zeitlimit, Zeitbonus |
| 📦 Paket-Express | jedes | 9 | knappes Zeitlimit; Kombi +30 %, Sportwagen +50 % |
| 🔑 Überführung | jedes | 10 | Kundenauto (teuer!) neben einem Autohaus übernehmen, Kratzer kosten Lohn |
| 🚌 Buslinie | Bus | 11 | echte Linie aus OSM, 5–9 echte Haltestellen, an jeder kurz halten; Pünktlichkeitsbonus |
| 🛋️ Umzug | Transporter/Abschlepper | 13 | lange Fahrt, Ladezeit, Schäden an den Möbeln kosten |
| 🪝 Abschleppen | Abschleppwagen | 14 | Pannenauto hängt hinten dran, zur Werkstatt |
| 🎩 VIP-Fahrt | Oberklasse | 18 | vom Hotel zu Oper, Bahnhof, Restaurant …; ohne Unfall/Rot gibt es 40 % Trinkgeld |
| 🏁 Illegales Rennen | siehe unten | Einsatz | an festen Treffpunkten, gegen 3 Gegner über 2–5 km mit Kontrollpunkten; Sieg 2,2× Einsatz, Platz 2 1,2× |

Grau mit Schloss bedeutet: Dafür fehlt das passende Fahrzeug. Unfälle und rote Ampeln mindern bei den meisten Jobs den Lohn. X bricht einen Job ab.

**Autos kaufen** kannst du nur bei einem echten Autohaus (blaue 🚗-Marker, 95 Autohäuser aus OSM). Halte dort an, dann öffnet sich der Verkaufsraum. Mit G öffnest du jederzeit die Garage: eigene Autos wechseln, lackieren (12 Farben) oder die Navigation zum nächsten Autohaus starten.

| Auto | Preis | Besonderheit | Spielzeit bis dahin (Ziel) |
|---|---|---|---|
| Stadtfloh | – | Startauto | – |
| Pendler | 90 € | etwas schneller | 10–20 min |
| Familienkombi | 220 € | Express +30 % | 30–40 min |
| Lastesel (Transporter) | 250 € | Umzüge | 30–40 min |
| Haken & Seil (Abschlepper) | 450 € | Abschleppen, Umzüge | |
| Stadtbus | 520 € | Buslinien | |
| Gran Turismo Lounge | 650 € | VIP-Fahrten, mehr Trinkgeld | 40–60 min |
| Blitz GT | 2.200 € | 290 km/h, Express +50 % | 1,5–3 h |
| Aurum Hyper | 8.000 € | 345 km/h, das teuerste | ~7 h |

**Illegale Rennen** finden an 23 festen Treffpunkten statt, verteilt über die ganze Stadt. Es gibt drei Klassen:

| Klasse | Einsatz | Gegner (Höchsttempo) | Voraussetzung |
|---|---|---|---|
| Straßenrennen (rot) | 25 € | ~150 km/h | – |
| Tuner-Treffen (lila) | 120 € | ~205 km/h | – (ohne Tuning kaum zu gewinnen) |
| Supersport-Rennen (schwarz) | 500 € | ~285 km/h | Sportwagen (Blitz GT, Aurum Hyper) |

**Tuning** gibt es in den Kfz-Werkstätten und Reifenhändlern aus OSM (orange 🔧-Marker). Halte dort an, dann öffnet sich die Werkstatt. Jedes eigene Auto hat drei Stufen für Motor (Tempo und Beschleunigung), Bremsen, Reifen & Fahrwerk (Grip und Lenkung) und Nitro (3, 5 oder 8 Sekunden Schub mit Shift, lädt sich in etwa 25 s wieder auf). Die Preise richten sich nach dem Wert des Autos. Lackieren geht dort ebenfalls.

Spielstand (Geld, Autos, Farben, Tuning) liegt im Browser (`localStorage`, Schlüssel `nrs.save`).

## Kartensymbole

Wie in GTA zeigen Symbole auf der Minikarte und in der großen Karte (K), wo etwas los ist: 🚗 Autohäuser, 🔧 Tuning-Werkstätten, 🏁 illegale Rennen, Job-Angebote (mit eigenem Symbol je Job), ⛽ Tankstellen, 🫧 Waschanlagen, 🚓 Polizei, 🚒 Feuerwehr und 🏥 Krankenhäuser. In der großen Karte blendet eine Legende unten rechts einzelne Arten ein und aus. Ein Klick auf ein Symbol setzt einen Wegpunkt mit Navigation. Job-Marker außerhalb des Bildes erscheinen am Bildrand mit Entfernung.

## Admin-Panel (geheim)

Zum Ausprobieren und Testen. Es ist im Spiel nirgends sichtbar: **dreimal schnell (innerhalb von 2 s) in die obere rechte Ecke klicken oder tippen** öffnet es, ✕ oder Esc schließt es. Es verändert nur den eigenen Spielstand im Browser.

- **Geld:** Beträge geben oder abziehen, Betrag setzen, Spielstand zurücksetzen (mit Rückfrage).
- **Autos:** alle Autos freischalten, jedes Auto sofort fahren, Tuning auf Maximum oder entfernen.
- **Teleport:** Suche über alle Straßen, Adressen („Fürther Str 100“), Stadtteile und benannte Orte. Dazu Schnellziele (nächstes Autohaus, Werkstatt, Rennen, Tankstelle, Polizei, Krankenhaus, Navigationsziel, Job-Ziel, Zufall), Koordinaten und „Klick in der Karte teleportiert“.
- **Fahren:** Leistungsfaktor ×0,5 bis ×4, Geistermodus (durch Häuser und Autos), unendlich Nitro, anhalten, umdrehen, Kamera.
- **Welt:** Verkehr an/aus, Dichte, Verkehr neu verteilen, Spieltempo (Zeitlupe bis Zeitraffer), FPS-/Positionsanzeige, Kartensymbole.
- **Jobs:** Job sofort erledigen oder abbrechen, neue Angebote, jeden Job sofort starten, zum nächsten Rennen, Rennen gewinnen.

## Navigation

- **Navigation:** Die Route wird über den Spurgraphen berechnet, inklusive Einbahnstraßen und Abbiegeverboten. Die Kosten sind Fahrzeit plus Zuschläge für Abbiegen und Ampeln, eine Route dauert wenige Millisekunden. Oben steht der nächste Abbiegehinweis mit Straßenname, Restweg und Restzeit. Auf der Straße liegt eine blaue Linie, und ein gelber Pfeil am Bildrand zeigt zum Ziel, wenn es nicht sichtbar ist. Wer abbiegt, bekommt nach etwa 1,5 s eine neue Route.
- **Minikarte (unten links):** etwa 670 × 670 m um dich, mit Route und Ziel.
- **Debugansicht:** „Navigation hierher“ bei einer angeklickten Spur startet eine freie Navigation.

## KI-Verkehr

Im Umkreis von etwa 450 m um dich fahren je nach Straßenart 50 bis 180 Autos, Transporter und Busse. Sie werden außer Sicht erzeugt und verschwinden in über 520 m Entfernung wieder.

- **Route:** An jeder Kreuzung wird zufällig gewählt, meist geradeaus, seltener abbiegen. Die Spur bestimmt, welche Richtungen möglich sind. Spuren außerhalb des Hauptnetzes und Zufahrten werden gemieden.
- **Fahren:** Abstand und Geschwindigkeit regelt das Intelligent Driver Model (IDM). Die KI hält das Tempolimit mit etwas Streuung ein und wird vor Kurven und Abbiegungen langsamer.
- **Ampeln:** Bei Rot hält die KI an der Haltelinie. Bei Gelb hält sie, wenn sie noch bequem bremsen kann.
- **Vorfahrt:** Die KI berücksichtigt Vorfahrtstraße, Vorfahrt gewähren, Stopp (erst anhalten), rechts vor links und Kreisverkehr. Linksabbieger warten bei Grün auf den Gegenverkehr. Ob sich zwei Fahrwege kreuzen, ergibt sich aus den Konfliktpunkten der Spurverbinder.
- **Kreuzungen:** Ist hinter der Kreuzung kein Platz, fährt die KI nicht hinein. Wer länger als 8 s wartet, fährt trotzdem; das löst gegenseitiges Blockieren auf.
- **Du als Spieler:** Stehst du auf ihrem Weg, bremst die KI für dich. Bei einem Zusammenstoß bleibt das getroffene Fahrzeug kurz liegen.
- **Rotlichtverstöße:** Wenn du über Rot fährst, wird das erkannt, gezählt und protokolliert (`traffic.events`). Strafen kommen später mit der Polizei.

In der Debugansicht zeigt ein Klick auf ein Fahrzeug Tempo, Zustand (z. B. „wartet an roter Ampel“, „lässt Vorfahrt“) und die geplante Route.

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
  src/tiles.ts        Ausgabe als Kacheln (inkl. Beschriftungspunkte für Straßennamen)
  src/nav.ts          Routinggraph, Adressen und Orte einrasten
game/       Browser-Client (Vite, Three.js)
  src/world/          Darstellung der Welt, Kachel-Nachladen (für Fahren und Debug)
  src/drive/          Auto (Physik, Kollision, Eingabe), Kamera, HUD
  src/traffic/        KI-Verkehr (Graph mit Konfliktpunkten, Simulation, Darstellung)
  src/nav/            Routing (A*), Navigation, Minikarten-Objekte
  src/missions/       Taxi- und Kurieraufträge, Oberfläche
  src/ui/             Startmenü (Stadtteilauswahl)
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
| `routing.bin` | Routinggraph über alle Spuren (binär, siehe `parseRouting` in `shared/`) |
| `names.json` | Straßennamen für Abbiegehinweise |
| `addresses.json` | ~74.000 Adressen, eingerastet auf die nächste öffentliche Spur |
| `pois.json` | ~6.400 benannte Orte (Gastronomie, Läden, Hotels, Kliniken, Autohäuser, Werkstätten, Tankstellen …) |
| `bus.json` | 164 Buslinien (je Richtung) mit eingerasteten Haltestellen |

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
- Die KI wechselt keine Spuren und überholt nicht. Sehr selten überlappen sich zwei KI-Fahrzeuge kurz in einer Kreuzung.
- Es gibt noch keine Radfahrer. Fußgänger laufen auf den Gehwegen, halten sich aber nicht an Ampeln.

## Spielwelt

Die Welt besteht aus Gebieten (`regions` im Manifest): Nürnberg (OSM-Relation 62780), Roth (OSM-Relation 158556) und dem Korridor der Verbindungsstraße dazwischen (kürzester Weg über Hauptstraßen, 2 × 160 m breit). Außerhalb ist die Spielwelt zu Ende.

## Lizenz der Modelle

Autos, Figuren, Bäume, Büsche und Trümmerteile in `game/public/models` stammen von Kenney (www.kenney.nl) und stehen unter CC0.

## Lizenz der Kartendaten

Kartendaten © [OpenStreetMap-Mitwirkende](https://www.openstreetmap.org/copyright), verfügbar unter der [Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/). Die erzeugten Weltdaten sind eine abgeleitete Datenbank und fallen ebenfalls unter die ODbL.
