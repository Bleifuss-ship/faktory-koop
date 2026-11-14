# Fabrik-Koop

Ein kooperatives Fabrikbau-Spiel im Browser. Mehrere Leute bauen gemeinsam in derselben Welt: Rohstoffe abbauen, über Förderbänder transportieren, in Maschinen verarbeiten und zur Zentrale liefern, um neue Technik zu erforschen. Läuft auf PC und Handy, ohne Installation.

## Starten

Voraussetzung: [Node.js](https://nodejs.org) ab Version 18.

```bash
npm install
npm start
```

Dann im Browser `http://localhost:3000` öffnen. Mitspieler im selben WLAN öffnen `http://<IP-deines-Rechners>:3000`. Alle, die denselben **Weltnamen** eingeben, spielen zusammen. Der Link enthält die Welt (`?welt=name`) und kann direkt verschickt werden.

Welten werden alle 15 Sekunden und beim Beenden in `saves/` gespeichert. Leere Welten pausieren.

Optionale Umgebungsvariablen: `PORT` (Standard 3000), `SAVE_DIR` (Standard `./saves`).

## So spielt man

1. **Bohrer** auf ein farbiges Vorkommen stellen. Er gibt Rohstoffe in Pfeilrichtung aus.
2. **Förderbänder** ziehen. Beim Ziehen zeigen die Bänder automatisch in Zugrichtung.
3. Rohstoffe durch **Maschinen** schicken und die Produkte zur **Zentrale** in der Mitte bringen.
4. Die Forschungsziele oben links erfüllen, um neue Gebäude und Verbesserungen freizuschalten.

### Produktionsketten

| Maschine | Rezepte |
|---|---|
| Schmelze | Rubinerz → Rubinbarren · Azurit → Azurbarren · Quarzsand → Glasscheibe |
| Presse | Rubinbarren → Zahnrad · Azurbarren → Kupferspule |
| Montage | Zahnrad + Kupferspule → Motor · Glasscheibe + Kupferspule → Lampe · Motor + Lampe → Helferbot |

### Forschung

1. Erste Barren: 20 Rubinbarren → Presse
2. Mechanik: 20 Zahnräder, 20 Azurbarren → Montage
3. Antrieb: 15 Motoren, 30 Glasscheiben → Bohrer 50 % schneller
4. Beleuchtung: 15 Lampen, 40 Kupferspulen → Bänder 50 % schneller
5. Automatisierung: 10 Helferbots → gewonnen

### Steuerung

| | PC | Handy |
|---|---|---|
| Bauen | Gebäude wählen (oder Taste 1–5), klicken/ziehen | Gebäude wählen, tippen/ziehen |
| Drehen | R | ⟳ |
| Abreißen | Rechtsklick oder X | 🗑 wählen, tippen |
| Kamera | WASD, Leertaste/mittlere Maustaste + ziehen, Mausrad | ✋ + ziehen, zwei Finger zoomen |

## Aufbau

- `src/game.js`: Spiellogik (Karte, Gebäude, Förderbänder, Rezepte, Forschung). Läuft nur auf dem Server.
- `src/server.js`: HTTP-Server für die Dateien in `public/` und WebSocket-Server, der jede Welt mit 10 Ticks pro Sekunde simuliert und den Zustand an alle Spieler schickt.
- `public/`: Browser-Client (Canvas-Grafik, alles selbst gezeichnet, keine Bilddateien).
- `test/`: Tests für die Spiellogik (`npm test`).
