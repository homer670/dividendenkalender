# Referenz-Orakel (Portfolio Performance)

Die Berechnungen der App sind aus dem Java-Code von [Portfolio Performance](https://github.com/portfolio-performance/portfolio)
nach TypeScript portiert. Dieses Werkzeug lädt dieselbe Datei mit dem **originalen** PP-Code und schreibt alle relevanten
Ergebnisse (Vermögensaufstellung, Performance-Index, TTWROR, IZF, Drawdown, Volatilität, Performance-Berechnung,
Wertpapier-Performance, Filter, Trades, Erträge, Benchmarks …) als JSON. `tests/calc.test.ts` vergleicht diese Werte mit
der TypeScript-Implementierung.

```bash
tools/oracle/setup.sh                       # PP-Quellen holen und kompilieren (Java 21, Maven)
java -cp "tools/oracle/target/classes:$(cat tools/oracle/cp.txt)" oracle.Generator 1 /tmp/out 3   # Testdaten erzeugen
tools/oracle/run.sh calc /tmp/out/client-1-bin.portfolio /tmp/out/client-1-bin.portfolio.calc.json geheim /tmp/out/rates.csv
FIXTURE_DIR=/tmp/out npx vitest run          # gegen die TypeScript-Implementierung prüfen
```

`Generator.java` erzeugt zufällige, aber reproduzierbare Portfolios (Seed, Komplexität) in allen Dateiformaten
(XML, XML mit IDs, ZIP, Protobuf, verschlüsselt). Die Stubs unter `name/abuchen/portfolio/pdfbox*` ersetzen die
PDF-Bibliotheken, die für die Berechnungen nicht benötigt werden.
