# Rapport d'architecture — Debugger DAP ↔ luna pour l'IDE OpenSNES

> Date : 2026-06-25 · Auteur : Claude (revue archi) · Statut : proposition + **doutes à lever avant tout code**
> Contexte décidé en amont : IDE = **extension VS Code** (on ne construit pas l'éditeur) ;
> luna est **orchestré, pas embarqué** dans la webview. Ce rapport ne couvre que **le joyau : le debugger**.

---

## 0. TL;DR

- Le debugger = un **DAP adapter** ("OpenSNES Debug Adapter", TypeScript) qui traduit
  l'UI de debug VS Code (DAP) ↔ commandes de contrôle luna (`luna mcp`).
- **On ne stream rien en temps-réel.** Tout est request/response sur l'état de luna **à l'arrêt**.
- Le jeu interactif vit dans la **fenêtre native de luna** ; l'éditeur affiche
  **snapshots + viewers (VRAM/OAM/palette/mémoire) à la pause**.
- **3 inconnues bloquantes** doivent être confirmées auprès de l'auteur de luna AVANT d'écrire
  une ligne de DAP (§5) : *(1)* session persistante stateful, *(2)* une seule instance GUI+contrôle
  ("play-then-break"), *(3)* breakpoints/watchpoints pilotables.
- **2 morceaux durs** côté toolchain OpenSNES : *(4)* mapping ligne-C ↔ PC 65816, *(5)* inspection
  des variables locales (frames pile). Sans (4), on livre un **debug niveau ASM** (déjà très utile).

---

## 1. Architecture générale

```
┌───────────────────────────────────────┐        ┌──────────────────────────────┐
│  VS Code                               │        │  luna (process séparé)        │
│  ┌──────────────┐   DAP (JSON-RPC)     │        │                              │
│  │ Debug UI     │◄───────────────┐     │        │  ┌────────────────────────┐  │
│  │ (bp, step,   │                │     │        │  │ CPU 65816 + APU + chips │  │
│  │  vars, call  │     ┌──────────▼───┐ │  IPC   │  │ (cycle-accurate)        │  │
│  │  stack)      │     │ OpenSNES DAP │ │ (stdio │  └────────────────────────┘  │
│  └──────────────┘     │ adapter (TS) │◄┼─JSON──►│  control surface (luna mcp)  │
│  ┌──────────────┐     └──────────────┘ │  RPC)  │  - load/run/pause/step       │
│  │ Webviews:    │            ▲          │        │  - bp set/clear/hit          │
│  │ frame snap,  │────────────┘          │        │  - peek mem / regs / ppu     │
│  │ VRAM/OAM/pal │   (rend l'état lu     │        │  - screenshot (état courant) │
│  │  viewers     │    via l'adapter)     │        │  ┌────────────────────────┐  │
│  └──────────────┘                       │        │  │ Fenêtre GUI native      │  │
└───────────────────────────────────────┘        │  │ (le jeu, 60fps, manette)│  │
                                                   │  └────────────────────────┘  │
                                                   └──────────────────────────────┘
```

**Point d'architecture central (et nuance n°1) :** idéalement **UNE SEULE instance luna**
expose à la fois la **fenêtre GUI** (où on joue) ET le **canal de contrôle** (où le DAP pilote).
On joue à la manette → on touche un breakpoint → ça se fige → on inspecte dans l'éditeur → on
reprend. Si le canal de contrôle est **headless-only** (pas de fenêtre), on perd le "play-then-break"
et on tombe sur du debug **scripté** (input programmé → break), bien plus faible pour un jeu. → **RFE §5.**

---

## 2. Les deux rôles de luna (ne pas confondre)

| Rôle | Invocation | Nature | Intégration |
|---|---|---|---|
| **A. Moteur de debug** | `luna mcp` (persistant) | request/response, état figé | **serrée** (DAP adapter) |
| **B. Lecteur interactif** | `luna run` (fenêtre native) | temps-réel 60fps + audio + manette | **lâche** (lancé en sœur) |

Le rêve = **A et B sur la même instance** (cf. nuance n°1). Le repli acceptable = deux instances
(une pour jouer, une pour le debug scripté) — mais l'UX "joue puis casse" disparaît.

---

## 3. Le cycle de debug (launch → breakpoint → run → hit → inspect → step)

### 3.1 Launch / Attach
- DAP `launch` → l'adapter spawn **un `luna mcp` long-lived**, charge la ROM (`game.sfc`),
  charge le `.sym` (symboles) + le **line-table** (si dispo, cf. §4-doute), met en pause au reset.
- Variante `attach` : se rattacher à une instance luna déjà lancée (le rêve "play-then-break").

### 3.2 Set breakpoints
- DAP `setBreakpoints(source, lines[])` → l'adapter traduit **ligne C → adresse PC** (via le
  line-table) → `luna: bp add <pc>`. Sans line-table : breakpoints **par symbole/adresse** (vue ASM).
- Watchpoints mémoire (write sur `$xxxx`) → `luna: bp add --watch` (utile : "qui écrit l'OAM ?").

### 3.3 Run / Continue
- DAP `continue` → `luna: run` (jusqu'au prochain bp ou pause). luna **notifie** l'arrêt
  (event "stopped" : raison = breakpoint/step/pause, PC courant). ← **nécessite un canal d'événements
  asynchrone**, pas juste du req/resp (nuance §5).

### 3.4 Hit → Inspect (le cœur de la valeur)
À l'arrêt, l'adapter répond aux requêtes DAP en lisant l'état luna :
- `stackTrace` → frames pile (cf. §4-doute locals) ; au minimum 1 frame (PC + fonction via `.sym`).
- `scopes`/`variables` → globales (adresse `.sym` + type → taille : `int`=2, `long`=4, struct) ;
  locales = stack-relative (offsets ABI cc65816 — *gauche-à-droite*, `6,s`+).
- `registers` → A/X/Y/SP/DP/DBR/PC/flags via `luna: regs`.
- **Webview frame-snapshot** : `luna: screenshot (état courant)` → PNG → panneau.
- **Webviews viewers** : `luna: peek vram/cgram/oam` → rendu tiles/palette/sprites dans l'éditeur.
- `evaluate` (watch/REPL) : lire une expression simple (`g_score`, `oam[3].y`) → adresse → peek.

### 3.5 Step
- `next`/`stepIn`/`stepOut` au **niveau C** = step jusqu'au changement de ligne (line-table requis,
  + détection des bornes d'appel pour over/out). **Sans line-table** : step = **une instruction**
  65816 (vue ASM), ce qui reste exploitable.

### 3.6 Resume / Stop
- `continue` → `luna: run` ; `disconnect` → `luna: kill` (ou détache si `attach`).

---

## 4. Ce qui vit dans l'éditeur vs dans luna

| Dans l'éditeur (request/response, état figé) | Dans la fenêtre luna (temps-réel) |
|---|---|
| Call stack, variables, registres, watch | **Le jeu** (60fps, audio, manette) |
| Snapshot de frame au breakpoint (PNG) | — |
| Viewers VRAM / OAM / CGRAM / mémoire | — |
| Panneau Problems (erreurs build) | — |
| **Jamais** de stream vidéo temps-réel | — |

---

## 5. ⚠️ DOUTES & QUESTIONS OUVERTES (à lever AVANT de coder — classés par risque)

### 🔴 Bloquants — à confirmer auprès de l'auteur de luna en priorité

**D1. `luna mcp` est-il une session PERSISTANTE stateful ?**
Le DAP a besoin d'un process long-lived qui **garde l'état** entre `bp add`, `continue`, `step`,
`peek`. Or les *probes* actuelles semblent **spawn-par-commande** (`luna state -n <steps>`), ce qui
serait fatal pour le debug interactif (on ne peut pas "stepper" un process qui repart de zéro).
→ *De-risk* : vérifier que `luna mcp` est bien un **serveur** qui tient la session. **Si non = RFE
n°1, bloquante.**

**D2. Une seule instance GUI + contrôle ("play-then-break") ?**
Peut-on avoir la **fenêtre native** ET le **canal de contrôle** sur la **même** instance, pour jouer
à la manette puis figer sur breakpoint ? Si le contrôle est **headless-only**, on perd cette UX et on
tombe sur du debug **scripté** (input programmé). → **RFE n°2** : `luna run --control <socket>` (GUI +
contrôle). *Repli* : deux instances + debug scripté (acceptable mais tier-2).

**D3. Canal d'ÉVÉNEMENTS asynchrone (notification d'arrêt) ?**
Quand luna touche un breakpoint **pendant** que le jeu tourne, il doit **pousser** un event "stopped"
vers l'adapter (sinon il faut poller le PC, fragile). MCP est souvent req/resp ; un **breakpoint =
notification non sollicitée**. → Vérifier que luna peut **émettre** des events (ou un long-poll).
**Si non = RFE n°3.**

**D4. API de breakpoints / watchpoints ?**
luna sait-il : bp sur PC, **watchpoint sur écriture mémoire** (le `--dma-trace`/"VRAM breakpoints"
des règles le suggèrent), conditions ? Set/clear/enable, et le **hit-notify** (cf. D3) ? → Inventorier
l'API réelle (pas juste `--assert`, qui est one-shot). Lacunes → RFE.

### 🟠 Durs — côté toolchain OpenSNES (pas luna)

**D5. Mapping ligne-C ↔ adresse PC 65816 (debug *au niveau source*).**
**Le plus dur.** Il faut de la **debug-info** qui survive `cproc → QBE → wla → .sym`. Aujourd'hui
le `.sym` donne des **symboles** (fonctions, globales), pas forcément une **table lignes↔PC**. cproc/QBE
n'émettent probablement pas de DWARF/line-info exploitable, et wla a son propre format.
→ *De-risk / repli* : **livrer d'abord le debug niveau ASM** (PC, step instruction, regs, mémoire,
symboles) — déjà énorme avec le `.sym` + luna existants. Le **C-line mapping = chantier compilo
dédié** (émettre une table lignes dans la pipeline), à faire après. **Ne pas bloquer le debugger
là-dessus.**

**D6. Inspection des variables LOCALES (frames pile).**
Les globales sont faciles (`.sym` → adresse + type). Les **locales** vivent sur la pile à des offsets
**par fonction** (ABI cc65816 connu : gauche-à-droite, `6,s`+, mais le **frame layout par fonction**
n'est pas exporté). Sans info de frame, on n'affiche pas proprement les locals.
→ *Repli* : globales + registres + mémoire brute d'abord ; locals = dépend de D5 (la même debug-info).

### 🟡 Gérables — nuances de conception

**D7. Snapshot de l'état COURANT (pas un run frais).**
`luna --screenshot` existe, mais pour le debug il faut shooter **l'état figé courant**, pas relancer.
→ Vérifier `luna mcp: screenshot` sur la session vivante (probablement OK si D1 l'est).

**D8. Multi-processeurs (APU SPC700, SA-1, SuperFX) dans le modèle DAP.**
DAP modélise des "threads". luna exécute les coprocesseurs nativement → on **pourrait** exposer
chaque CPU comme un "thread" DAP (main 65816, SPC700, GSU…). **Avancé** : commencer **CPU principal
seul**, ajouter les chips après (gros différenciateur vs les autres outils SNES, mais pas P1).

**D9. Re-sync après rebuild.**
Un `make` change les adresses → l'adapter doit **recharger `.sym` + line-table** à chaque build, et
invalider les breakpoints résolus par adresse. → Watch sur les artefacts + re-résolution.

**D10. Latence / volume IPC.**
Dump VRAM (64 Ko) à chaque pause via stdio JSON = OK (pause = pas de contrainte temps-réel). Encoder
en binaire/base64 plutôt qu'en JSON verbeux pour les gros buffers. Pas un risque, juste un soin.

**D11. clangd sur cible non-standard (`int`=2).**
Hors-scope debugger, mais pour le "helper/linting" : clangd mentira parfois (tailles). → clangd =
complétion/nav ; **vérité = build cc65816** (problem matcher). Diagnostics fiables = compilo, pas clangd.

**D12. DAP attend des concepts "standard".**
Pas de "threads" classiques, pile matérielle 65816 atypique, banques. Le mapping DAP→SNES demande des
choix (que montre-t-on comme "memory" : WRAM ? VRAM ? l'espace banque complet ?). → Définir un modèle
mémoire clair (espaces nommés : WRAM `$7E/$7F`, VRAM, CGRAM, OAM, ROM banques).

---

## 6. Plan phasé (debugger uniquement)

- **P2.0 — Pré-requis (avant tout code)** : lever **D1–D4** avec l'auteur de luna. Go/no-go.
- **P2.1 — Debug ASM** : launch `luna mcp`, bp par adresse/symbole, continue, **step instruction**,
  registres, **mémoire** (modèle D12), **snapshot frame**. Pas de ligne-C. *Déjà très utile.*
- **P2.2 — Viewers** : webviews VRAM/OAM/CGRAM (lecture état figé). Gros effet "waouh", faible risque.
- **P2.3 — Variables globales + watch** : `.sym` + types → scopes/variables/evaluate.
- **P2.4 — Source-level (si D5 résolu)** : chantier compilo "émettre line-table" → bp/step au niveau C,
  locals (D6). **Le plus dur, le plus tard.**
- **P2.5 — Multi-chips (D8)** : SPC700 / SA-1 / GSU comme threads DAP. Différenciateur, optionnel.

---

## 7. RFEs consolidées à demander à l'auteur de luna

1. **Session de contrôle persistante stateful** (`luna mcp` serveur tenant l'état). *(D1, bloquant)*
2. **GUI + contrôle sur une instance** (`luna run --control`), pour play-then-break. *(D2)*
3. **Canal d'événements asynchrone** (push "stopped"/breakpoint-hit). *(D3)*
4. **API breakpoints/watchpoints complète** : PC bp, mem-write watch, conditions, set/clear/notify. *(D4)*
5. **Screenshot/peek sur l'état figé courant** de la session. *(D7)*
6. *(plus tard)* Hooks coprocesseurs pour le debug multi-CPU. *(D8)*

---

## 8. Bottom line / conditions de GO

- L'archi est **saine et réaliste en solo** *à condition que luna soit un vrai serveur de contrôle
  stateful avec events* (D1+D3). **C'est LE go/no-go.** À vérifier en premier, 30 min de lecture de
  l'API luna ou un mail à l'auteur.
- Le **debug niveau ASM (P2.1-P2.3)** est livrable **sans toucher le compilo** — c'est la valeur
  immédiate. Le **debug niveau C (P2.4)** est un **chantier compilo séparé** (line-table) à ne pas
  mettre sur le chemin critique.
- **Aucune fenêtre temps-réel dans l'éditeur** : snapshots + viewers à l'arrêt seulement. Le jeu vit
  dans luna. (Cf. la discussion : ton doute sur l'embedding était fondé ; on orchestre.)
- Risque résiduel le plus sérieux = **D5 (mapping ligne-C)**. Stratégie : *ne pas en dépendre pour la v1*.

> Nuance finale : ce rapport suppose que luna **veut** être pilotable comme un moteur de debug.
> Si l'auteur ne souhaite pas exposer/maintenir cette surface, **toute la stratégie debugger
> bascule** — il faudrait soit forker luna, soit un autre back-end (et on perd la cycle-accuracy +
> les chips natifs). C'est la dépendance la plus structurante du projet : **à clarifier en tout
> premier, avant même D1.**

---

## 9. FINDINGS — vérification empirique de l'API luna (2026-06-25) + reco RÉVISÉE

Doutes convertis en faits en inspectant `luna --help`, `luna mcp --help`, `luna run --help`
(binaire pinné v1.1.0).

### 9.1 Ce que luna expose réellement
- **Sous-commandes** : `run`, `mcp`, `state`, `frames`, `wram-trace`, `bench`, `spc-dump`,
  `assets-dump`. **Toutes headless / batch-introspection.** La GUI est mentionnée mais **n'est
  PAS une sous-commande CLI** (pas de `luna gui`/play exposé dans ce build).
- **Catalogue MCP** (`luna mcp`) : `load_rom`, `reset`, `step`, `state`, `screenshot`,
  `drain_audio`, `peek_memory`, `peek_aram`. **Process persistant** ("stays alive until the client
  closes the stream").
- **`luna run`** : `--steps N`, `--screenshot`, `--force-display`, `--bg`, `--audio-out`,
  `--nocash-out` ($21FC TTY), `--wdm-out` (capture des `WDM $xx` = le canal breakpoint/`SNES_ASSERT`
  **embarqué dans le code**), `--print-fbhash`.

### 9.2 Verdict sur les doutes bloquants
| Doute | Verdict empirique |
|---|---|
| **D1** session persistante stateful | ✅ **RÉSOLU** — `step`+`peek_memory`+process vivant = session interactive de step/inspect |
| **D4** breakpoints / watchpoints runtime | ❌ **ABSENT du MCP** — seulement `step N`. Les "breakpoints" = marqueurs **`WDM` embarqués dans le code**, capturés en batch (`--wdm-out`), pas posés à chaud |
| **D3** event d'arrêt async | ❌ pas de bp runtime ⟹ pas de "wait-for-hit" |
| **D2** GUI + contrôle, 1 instance | ❌ MCP = stdio headless ; GUI non-exposée ; pas de "play-then-break" |
| poke (write mémoire/registre) | ❌ luna MCP est **read-only** (`peek_*` seulement) |

**Conclusion : luna fait aujourd'hui le RUN / TEST / INTROSPECTION ; le debug interactif PLEIN lui
manque — mais c'est une RFE, pas un mur.** Le MCP actuel donne déjà un debugger *utile* (step +
inspect) ; le passer en interactif complet = ajouter à luna une surface bp/watch/continue/events/poke.
**Et c'est exactement le type de RFE que tu as déjà fait aboutir** (luna v1.1.0 a livré ta RFE
`vram_layout`). Donc chemin **réaliste**, pas un blocage.

### 9.3 Debugger sur OpenSNES + luna — deux niveaux

**Niveau 1 — réalisable AUJOURD'HUI sur le MCP luna existant, zéro RFE :**
- "Stepping debugger" : `step N` + inspect complet — registres via `state`, `peek_memory` /
  `peek_aram`, PPU via `state`, **framebuffer** via `screenshot`, **viewers VRAM / OAM / CGRAM** via
  `assets-dump` / `state`.
- **Breakpoints embarqués dans le code** : macro `SNES_BREAK` / `SNES_ASSERT` → `WDM $00` → capturé
  (`--wdm-out` / le canal WDM). Modèle : "run jusqu'au breakpoint *source*, puis step + inspect".
- Un DAP mappé là-dessus est **déjà un vrai outil** (surtout avec les viewers), même sans bp posé à
  chaud depuis l'IDE.

**Niveau 2 — RFE à luna (interactif plein) :**
- Surface à demander : **bp / watch runtime** posés depuis l'IDE, **run-until-hit + event d'arrêt
  async**, **poke** mémoire/registre, idéalement **GUI-attach** (play-then-break).
- **C'est une RFE à l'auteur de luna — canal déjà éprouvé** (RFE `vram_layout` → livrée en v1.1.0).
  Réaliste, calendrier raisonnable, pas bloquant pour démarrer (le Niveau 1 tourne entre-temps).

### 9.4 Recommandation — OpenSNES + luna, un seul moteur

| Job | Backend |
|---|---|
| run / test / preview / validation cycle-accurate / viewers / CI **ET** debug | **luna** (unique) |
| jouer temps-réel | **luna run** (fenêtre native) |

- **DAP P2.1** sur le MCP actuel (step + inspect + viewers + WDM breakpoints) → **livrable sans rien
  attendre**.
- **DAP P2.2** quand la RFE luna (bp/watch/continue/events/poke) atterrit → debug interactif plein.
- **Un seul émulateur, de bout en bout.** Pas de second moteur.

### 9.5 La vraie nuance (luna-only)
- Le seul facteur structurant = **la responsivité de l'auteur de luna sur la RFE debug**. L'historique
  (RFE `vram_layout` livrée en v1.1.0) montre que le canal marche → **risque faible**.
- **D5 (ligne-C ↔ PC)** reste le morceau dur, **côté compilo OpenSNES** (émettre une line-table dans
  `cproc → QBE → wla`), **indépendant de luna**. Repli : niveau **symboles** d'abord (bp par label,
  watch des globales) — atteignable dès le Niveau 1.
- Tant que la RFE Niveau 2 n'a pas atterri, le debugger reste **step + WDM breakpoints + inspect** :
  limité mais réel, et déjà sur la stack OpenSNES + luna que tu veux.

### 9.6 Go (luna-only)
1. **P2.1 maintenant** : DAP sur le MCP luna existant (step + inspect + viewers + WDM breakpoints).
   Aucune dépendance externe, aucun second émulateur.
2. **RFE luna en parallèle** : bp / watch / continue / events / poke (+ GUI-attach), via le même canal
   que la RFE `vram_layout`.
3. **luna = moteur unique** — run, test, preview, validation, debug. C'est toute la stack.
