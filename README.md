# Webmania

Webmania è un racing game ultra-leggero ispirato ai classici arcade come *Trackmania Nations Forever*. Il gioco è progettato per garantire alte performance su hardware datato, utilizzando una grafica low-poly stilizzata e una generazione procedurale delle piste.

Provalo su [https://fibreditoniocartonio.github.io/webmania/](https://fibreditoniocartonio.github.io/webmania/)

## Caratteristiche principali

- **Generazione procedurale**: Ogni tracciato è generato da un `seed`. Inserisci un codice per rigenerare una pista specifica o sfidare altri piloti sullo stesso percorso.
- **Fisica 3D**: Motore fisico basato su `cannon-es` per una gestione realistica di salti, accelerazioni e derapate.
- **Garage**: Personalizzazione completa dei colori di carrozzeria, cerchioni, spoiler e strumentazione digitale.
- **Sistema di Record**: Salvataggio dei tempi migliori e gestione dei tempi intermedi (split) ai checkpoint tramite `localStorage`.
- **Multi-Input**: Supporto nativo per Tastiera, Gamepad e controlli Touch (incluso un editor grafico per il layout dei tasti).
- **Ottimizzazione**: Risoluzione interna scalabile per mantenere il framerate elevato anche su dispositivi di fascia bassa.

## Controlli (Default)

| Azione | Tastiera | Gamepad |
| :--- | :--- | :--- |
| **Acceleratore** | `W` / `Freccia Su` | `R2` / `RT` |
| **Freno / Retro** | `S` / `Freccia Giù` | `L2` / `LT` |
| **Sterzo** | `A` - `D` / `Frecce` | `Analogico SX` |
| **Freno a mano** | `Spazio` / `Shift` | `A` / `X` |
| **Respawn (Fermo)** | `R` | `B` / `O` |
| **Respawn (In corsa)** | `Invio` | `Y` / `Δ` |
| **Pausa** | `Esc` / `P` | `Start` |

## Note Tecniche

Il progetto è sviluppato in Vanilla JavaScript utilizzando ES Modules. Non sono necessari strumenti di build o compilazione.

- **Rendering**: Three.js (WebGL)
- **Fisica**: Cannon-es
- **Logica**: JavaScript ES6+

## Installazione

1. Clona la repository:
   ```bash
   git clone https://github.com/tuo-username/webmania.git
   ```
2. Apri `index.html` tramite un server locale (necessario per il caricamento dei moduli JS), ad esempio:
   ```bash
   python -m http.server 8000
   ```

## Licenza

Questo progetto è distribuito sotto licenza **GPL-3.0**. Consulta il file delle licenze per maggiori dettagli.
