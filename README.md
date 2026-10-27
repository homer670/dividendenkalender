# Portfolio – mobile App für Portfolio-Performance-Dateien

Inoffizieller Nachbau der mobilen App von [Portfolio Performance](https://www.portfolio-performance.info) inklusive der
Premium-Funktionen (Dashboards). Die App öffnet die Datei aus Portfolio Performance (Desktop) lokal auf dem Smartphone –
ohne Server, alle Berechnungen laufen auf dem Gerät.

## Funktionen

- **Datei öffnen**: `.xml` und `.portfolio` (XML, ZIP, Protobuf, verschlüsselt mit AES-128/256) aus iCloud Drive,
  Google Drive, Dropbox, OneDrive oder dem lokalen Speicher. Zuletzt geöffnete Dateien werden lokal gespeichert.
- **Sicherheit**: Passwort optional im Schlüsselbund (Face ID / Touch ID / Fingerabdruck), verschlüsselte Dateien werden
  beim Verlassen der App gesperrt, diskreter Modus.
- **Dashboard (Premium)**: Dashboards der Desktop-Datei anzeigen, eigene mobile Dashboards anlegen, kopieren und
  bearbeiten. Alle 62 Widget-Typen des Desktops (Kennzahlen, Risikokennzahlen, Diagramme, Heatmaps, Erträge, Trades,
  Klassifizierungen, Rebalancing, FIRE, Ereignisse, Limits, …) mit denselben Konfigurationsschlüsseln.
- **Vermögensaufstellung** nach Klassifizierung mit Einstandswert, Kursgewinn und Tagesveränderung.
- **Performance**: Diagramm (Performance/Vermögen/Delta, Vergleich mit Benchmark), TTWROR, IZF, Drawdown, Volatilität,
  Performance-Berechnung und Wertpapier-Performance.
- **Buchungen**, **Konten**, **Depots**, **Wertpapiere**, **Watchlists**, **Sparpläne**, **Klassifizierungen**
  (Struktur und Rebalancing), **Erträge** (alle Modi wie in PP), **Dividendenkalender**, **Trades**.
- Berichtszeiträume und Filter aus der Datei, Zahlenformat Deutschland/Schweiz, heller und dunkler Modus.
- Wechselkurse der Europäischen Zentralbank (Download und Cache auf dem Gerät).

## Exakte Berechnungen

Die Rechenlogik ist 1:1 aus dem Java-Code von Portfolio Performance portiert (BigDecimal-Rundung, `Math.round`,
Kahan-Summation, Sortierreihenfolgen). Ein Referenz-Orakel (`tools/oracle`) berechnet dieselben Dateien mit dem
originalen PP-Code; `npm test` vergleicht die Ergebnisse.

## Entwicklung

```bash
npm install
npx expo start          # Entwicklungsserver
npm run lint            # ESLint
npm run typecheck       # TypeScript
npm test                # Tests gegen die Referenzwerte
```

Builds für iOS/Android mit EAS: `npx eas-cli@latest build --profile development`.

## Lizenz und Herkunft

Die Berechnungslogik und die Texte stammen aus [Portfolio Performance](https://github.com/portfolio-performance/portfolio)
(© Andreas Buchen und Mitwirkende, Eclipse Public License 1.0). Dieses Projekt ist kein offizielles Produkt von
Portfolio Performance.
