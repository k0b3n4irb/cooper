# Dossier d'architecture v2 — « L'Anneau » : la stack unifiée OpenSNES + luna + IDE

> Date : 2026-06-26 · Statut : **brouillon vivant, à challenger** · Aucun code écrit.
> Remplace la v1 (« IDE OpenSNES »). Le changement majeur : on assume que
> **l'auteur possède la verticale entière** — le SDK (OpenSNES), le compilateur
> (cc65816 : cproc→QBE→wla), ET l'émulateur (luna). Ça transforme l'architecture :
> on ne *câble pas* trois outils tiers, on *co-conçoit* un seul système cohérent.
>
> Mission : **rendre les développeurs de jeux SNES heureux.** Le but n'est pas une
> 4ᵉ application — c'est **un anneau qui réunit les trois** : un *contrat partagé*
> que le SDK, l'émulateur et les frontends respectent tous.
>
> Règle du dossier : chaque décision = **(a)** choix, **(b)** raison, **(c)**
> alternative écartée, **(d)** contre-argument. §15 = doutes ouverts par risque.
> Rapport debugger détaillé en annexe : `/tmp/opensnes_dap_luna_report.md`.

---

## 0. TL;DR

- **L'anneau n'est pas une appli — c'est un CONTRAT** : (1) une **debug-info riche
  émise par le compilo** (lignes↔PC, frames/locals, types, banques) + (2) **luna
  comme backend de debug/contrôle**, idéalement **parlant DAP nativement**.
  Tout le reste (extension, IA, éditeurs d'assets) sont des **clients** de ce
  contrat.
- **Possession = superpouvoir.** Personne dans le homebrew SNES n'a la verticale.
  PVSnesLib = SDK seul ; Mesen2 = émulateur seul (debug superbe mais aveugle à
  ton C). Toi seul peux faire que les trois parlent la même langue.
- **Conséquence directe** : les « inconnues externes » de la v1 meurent. Le
  debugger interactif plein n'est plus une *RFE qu'on mendie* — c'est *ta
  roadmap luna*. Le mapping ligne-C↔PC (D5) n'est plus une montagne externe —
  c'est *ton compilo qui crache un `.dbg`*.
- **luna = moteur unique** : run / preview / test / validation / viewers / debug.
  Orchestré (process voisin), jamais embarqué en webview.
- **L'IA SDK-aware** = le plus gros différenciateur, et il n'est possible *que*
  parce que tu possèdes luna : l'IA écrit du C → build → **run dans luna** → lit
  le rendu → se corrige. Personne d'autre ne peut offrir « l'IA a vérifié que ça
  rend juste sur du cycle-accurate ».
- **MVP** = « VS Code qui connaît OpenSNES » (projet+build+run/preview+Problems)
  + le **Niveau 1 IA** (contexte SDK livré au scaffold, quasi gratuit). Le
  **joyau** = le debugger sur DAP. Les **différenciateurs assets** viennent après.
- **Garde-fou** : tout ce qui n'est pas *la colonne (contrat)* ou *un client
  mince de la colonne* est de la dette. C'est ce qui rend « du lourd » tenable en
  solo.

---

## 1. Le changement de donne — tu possèdes la verticale

| Brique | Qui la possède ailleurs | Chez toi |
|---|---|---|
| SDK / lib C | PVSnesLib (tiers) | **toi** (OpenSNES) |
| Compilateur | cc65 (tiers) | **toi** (cproc→QBE→wla) |
| Émulateur | bsnes / Mesen2 (tiers) | **toi** (luna) |
| Debug-info | ~inexistante en homebrew | **à toi de l'inventer** |

Conséquences qui réécrivent la v1 :

- **Q7 (responsivité de l'auteur luna) → MORTE.** L'auteur, c'est toi.
- **N1/N2 du debugger se réunifient.** La v1 séparait « N1 aujourd'hui sans RFE »
  et « N2 = RFE luna ». Comme tu livres luna, le debugger peut viser la **première
  classe d'emblée** ; N1 devient juste *l'ordre dans lequel on construit*, pas un
  plafond.
- **D5/D6 (ligne-C↔PC, locals) → items de roadmap compilo**, pas des inconnues.
- **L'IA peut vérifier dans luna.** Boucle agentique ancrée (§8 niveau 3).

---

## 2. Vision & mission

Un **tout-en-un** pour faire des jeux SNES : éditer (C **et** ASM WLA-DX), linter/
formater, **être assisté par l'IA**, débugger au niveau source, lancer/prévisualiser
dans l'émulateur, éditer sprites/map/palette. Cible de dev : des **jeux**, sur
OpenSNES + luna.

Le « tout-en-un » n'est pas une mégaclasse monolithique (cf. les non-goals de
`PHILOSOPHY.md` côté SDK — même esprit ici) : c'est **un contrat + des clients
minces**.

---

## 3. L'ANNEAU = le contrat partagé (la pièce maîtresse)

C'est **la première chose à concevoir**, avant toute appli, parce que c'est la
seule chose que les trois projets doivent respecter ensemble — et la seule que
seul toi peux imposer.

### 3.1 La debug-info riche (émise par le compilo)

Un artefact (`.dbg` ou extension du `.sym`) produit par `cproc→QBE→wla`, contenant :

- **table lignes↔PC** (fichier:ligne ↔ adresse 65816) → bp/step au niveau C (D5).
- **layout des frames** par fonction (offsets ABI cc65816 des locals/params) →
  inspection des variables locales (D6).
- **types** (tailles cible : `int`=2, `long`=4, structs) → affichage correct.
- **map symboles/banques** (déjà ~présente dans le `.sym`).

C'est le morceau « le plus dur » de la v1 — mais c'est **ton code**, donc un
chantier compilo planifiable, pas un mur. *Repli explicite* : tant que la
line-table n'existe pas, le debug tourne au **niveau symboles/ASM** (déjà utile).

### 3.2 luna comme backend de debug/contrôle

luna n'est plus « juste un émulateur » : c'est **le moteur de debug** de
l'écosystème. Surface à exposer (au-delà de l'actuel `load_rom/step/state/
screenshot/peek_*`, read-only) : **breakpoints/watchpoints runtime, continue/
run-until-hit, event d'arrêt asynchrone, poke** (write mémoire/registre), et
idéalement **GUI-attach** (jouer à la manette puis figer sur breakpoint).

### 3.3 Le manifeste de projet

Un projet OpenSNES = dossier façon `examples/` (Makefile+`common.mk`, `main.c`,
`assets/`, `LIB_MODULES`, `USE_SA1/SUPERFX/HIROM`). Ce **contrat de projet** est lu
identiquement par le build, par luna, par l'IDE, et par l'IA. Pas de format
inventé : la convention existe déjà, on l'élève au rang de contrat.

---

## 4. Les capacités (toutes clientes du contrat)

| # | Capacité | Brique | Risque | Statut |
|---|---|---|---|---|
| C1 | Éditer du C | clangd (LSP) + éditeur VS Code | 🟢 | off-the-shelf |
| C1b | Éditer de l'ASM **WLA-DX** | grammaire TextMate (coloration) | 🟢 | à écrire (petit) |
| C2 | Lint + format C | clang-format + problem matcher cc65816 | 🟢 | off-the-shelf |
| C3 | Helper API | snippets + hover Doxygen + `compile_commands.json` | 🟡 | partiel |
| C4 | **Debugger** | DAP ↔ luna + debug-info compilo | 🔴 | l'anneau |
| C5 | Run / preview | `luna run` (fenêtre) + `--screenshot` (inline) | 🟢 | wrap CLI |
| C6 | **Éditeurs assets** (sprite/map/palette) | webviews canvas + preview luna | 🟠 | construire/wrap |
| C7 | **IA SDK-aware** | contexte + MCP OpenSNES + boucle luna | 🔴 | différenciateur n°1 |

Cœur de valeur (ce qui justifie l'anneau vs « VS Code + Makefile ») = **C4 + C6 +
C7 + scaffolding**. Le reste est de l'assemblage d'existant.

---

## 5. Décisions structurantes

### D1 — Forme : pack d'extensions VS Code (standalone possible plus tard)
**(a)** Pack d'extensions VS Code (tasks, debugger DAP, custom editors, langages).
**(b)** Ne pas réécrire Monaco/LSP/DAP/marketplace ; concentrer l'effort solo sur
le spécifique SNES. **(c)** Écartés : Electron+Monaco from-scratch (poids
ingérable) ; Tauri (séduisant car luna=Rust, mais on reperd LSP/DAP) ; fork
VSCodium (= mode de *distribution*, pas archi → reporté). **(d)** Contre-arg : un
pack « fait » moins produit-fini qu'une app brandée → réponse : VSCodium +
extensions préinstallées donne le branding sans réécriture, plus tard.

### D2 — Moteur unique : luna, orchestré (jamais embarqué)
**(a)** luna seul moteur (run/preview/test/validation/viewers/debug), en process
voisin piloté. **(b)** Cycle-accurate, APU/SA-1/SuperFX/DSP-1 natifs, MCP stdio
persistant (vérifié v1.1.0). **(c)** Écarté : luna WASM embarqué en webview
(duplique le moteur ; l'éditeur n'a pas besoin de 60fps mais de snapshots à
l'arrêt — **le doute initial était fondé**). **(d)** Contre-arg : orchestrer un
process = latence IPC + cycle de vie → à l'arrêt la latence est non-contrainte ;
preview = un PNG. Plomberie, pas un mur.

### D3 — Sources, pas binaires
**(a)** Les éditeurs éditent la **source** (PNG/`.pal`/`.map`/`.it`) ; la
conversion reste `gfx4snes`/`smconv`/`make` ; la **vérité hardware** vient de luna.
**(b)** Réinventer un convertisseur dans l'IDE = 2ᵉ pipeline qui dérive
(silent-fail). **(c)** Écarté : éditer le format SNES natif packé. **(d)**
Contre-arg : « source-only » impose un rebuild avant preview hardware → réponse :
**deux preview** — canvas *approximatif instantané* (travail) + luna
*hardware-exact à la demande* (validation). On ne ment jamais sur lequel est lequel.

### D4 — luna parle DAP nativement (l'anneau est dans le moteur) ⟵ décision phare
**(a)** luna expose une surface **DAP native** (`luna dap`) : il *est* le debug
adapter. **(b)** Comme tu possèdes luna, l'anneau vit dans le moteur, pas dans une
extension jetable → **tout éditeur compatible DAP** (VS Code, Neovim, Emacs…)
débugge tes jeux *gratuitement*. C'est littéralement le move « rendre TOUS les
devs heureux ». **(c)** Écarté (ou repli de démarrage) : un adaptateur TypeScript
*dans l'IDE* qui traduit le MCP luna ↔ DAP — plus rapide à prototyper, mais le
debug est **verrouillé à VS Code**. **(d)** Contre-arg : DAP est verbeux et
orienté-éditeur ; l'embarquer alourdit luna (Rust). → *Chemin de de-risk proposé* :
**prototype TS d'abord** sur le MCP actuel pour éprouver l'UX, **puis migrer la
surface en DAP natif dans luna** une fois le modèle validé. (Choix non encore figé
— cf. Q1 §15.)

### D5 — L'IA = client du contrat, pas une application
**(a)** On ne construit **pas** d'IA. On construit ce qui rend *n'importe quelle*
IA experte d'OpenSNES : contexte + MCP + boucle de vérification luna (§8). **(b)**
Un LLM générique est nul en SNES homebrew (niche) → contexte obligatoire, pas
optionnel. L'IA devient un **client de plus** du même contrat (luna MCP,
debug-info, connaissance SDK). **(c)** Écarté : fine-tuning / modèle maison
(overkill ; le context-engineering gagne). **(d)** Contre-arg : la boucle
agentique (niveau 3) est de l'ingénierie réelle (budget, garde-fous
anti-boucle-infinie) → vrai, donc phasé : niveau 1 (contexte) d'abord, quasi
gratuit ; niveau 3 ensuite.

---

## 6. Architecture en couches

```
┌──────────────────────────── FRONTENDS (clients du contrat) ─────────────────────────┐
│  VS Code / VSCodium (+ tout éditeur DAP : Neovim, Emacs…)                            │
│                                                                                     │
│  C1  Éditeur C ── clangd (LSP)            C1b ASM WLA-DX ── grammaire TextMate       │
│  C2  Lint/format ── clang-format + matcher cc65816                                   │
│  C3  Helper ── snippets + hover Doxygen + compile_commands.json                      │
│  C4  Debug UI ──────────────── DAP ──────────────────────────────────┐             │
│  C5  Run/preview ── commandes « run/preview in luna »                  │             │
│  C6  Éditeurs assets ── webviews canvas (palette/tiles/map)            │             │
│  C7  IA ── contexte SDK + MCP OpenSNES (← un client de plus)           │             │
└──────────┬───────────────────────────────────────────────┬───────────┼─────────────┘
   sources  │ .c/.asm/.png/.pal/.map        manifeste projet │   DAP / MCP│
            ▼                                                ▼            ▼
┌────────────────────────────┐                  ┌──────────────────────────────────────┐
│  TOOLCHAIN OpenSNES         │                  │  luna (process voisin = BACKEND)       │
│  cc65816 (cproc→QBE→wla)    │   game.sfc       │  moteur cycle-accurate (APU/SA-1/GSU)  │
│  gfx4snes / smconv / make   │  + .sym + .dbg   │  + surface debug (bp/watch/continue/   │
│  ── ÉMET LA DEBUG-INFO ─────┼─────────────────▶│     events/poke)  + `luna dap`          │
│     (lignes↔PC, frames,     │   (LE CONTRAT)   │  + viewers (assets-dump/state/peek_*)   │
│      types, banques)        │                  │  + fenêtre native (jeu 60fps, manette) │
└────────────────────────────┘                  └──────────────────────────────────────┘
         └──────────────────  L'ANNEAU = .dbg (contrat) + luna (backend DAP)  ──────────┘
```

---

## 7. Le debugger (C4) — détail

Reframe ownership : ce que la v1 traitait en deux niveaux séparés par une
dépendance externe devient **un seul debugger first-class**, construit dans cet
ordre :

1. **Niveau symboles/ASM** (sans `.dbg`) : launch `luna`, step instruction, regs/
   PPU (`state`), mémoire (`peek_*`, modèle mémoire nommé : WRAM `$7E/$7F`, VRAM,
   CGRAM, OAM, ROM banques), snapshot frame (`screenshot`), bp par adresse/symbole
   + breakpoints embarqués `WDM`/`SNES_BREAK`. *Livrable sur le MCP actuel.*
2. **Surface runtime dans luna** (ta roadmap) : bp/watch posés à chaud, continue/
   run-until-hit, event d'arrêt async, poke. → debug interactif plein.
3. **DAP natif** (`luna dap`) : le tout exposé en DAP → éditeur-agnostique (D4).
4. **Niveau source** (quand `.dbg` existe, §3.1) : bp/step au niveau C, locals.
5. **Multi-chips** (avancé) : SPC700 / SA-1 / GSU comme « threads » DAP — gros
   différenciateur vs tout l'écosystème, optionnel.

Détail des messages DAP, du cycle launch→bp→hit→inspect→step, et du modèle
mémoire : `/tmp/opensnes_dap_luna_report.md`.

---

## 8. L'IA SDK-aware (C7) — trois niveaux, du moins cher au plus puissant

**Niveau 1 — Le contexte (quasi gratuit, à faire quoi qu'il arrive).**
Tu as déjà `CLAUDE.md`, `KNOWN_LIMITATIONS.md`, `.claude/rules/`. Ship une version
**orientée utilisateur** dans le scaffold de projet (un `AGENTS.md`/`CLAUDE.md`
template). Toute IA dans l'éditeur (Claude Code, Copilot, Cline…) le lit et cesse
d'halluciner du PVSnesLib/cc65, et **respecte tes silent-failures** (bank $00, args
left-to-right, budget DMA VBlank, `volatile`…). **Meilleur ratio valeur/coût du
projet.** Bénéficie même aux devs qui n'utilisent pas l'IDE.

**Niveau 2 — MCP « OpenSNES » (tu maîtrises déjà le pattern via luna).**
Outils que l'IA appelle : lookup de signature API, « valide ce code contre les
contraintes », lecture du `.sym`/`.dbg`, build+run. L'IA interroge au lieu de
deviner.

**Niveau 3 — Boucle agentique ancrée dans luna (CE QUE PERSONNE D'AUTRE NE PEUT).**
L'IA écrit du C → build cc65816 → **run dans luna** → lit framebuffer/`state`/
`peek_*` → **se corrige**. Équivalent SNES de « l'agent voit son test passer »,
mais sur du rendu cycle-accurate. Différenciateur unique de la verticale.
*Coût réel* : ingénierie agentique (budget tokens, garde-fous anti-boucle).

---

## 9. Support langage : C (C1) + WLA-DX (C1b)

- **C (C1/C2/C3, 🟢)** : clangd pour complétion/nav ; `compile_commands.json` avec
  les **defines cible** (`u8/u16/...`, `int`=2) ; clang-format (`.clang-format` =
  style SDK : 4 espaces, K&R) ; snippets + hover depuis les en-têtes Doxygen.
  *Garde-fou D11* : clangd **ment sur les tailles** (cible non-standard) →
  **autorité des diagnostics = build cc65816**, pas clangd.
- **WLA-DX (C1b, 🟢, petit)** : grammaire **TextMate** (`.tmLanguage.json`) déclarée
  dans le manifeste. Tokenise mnémoniques 65816, **directives WLA** (`.section`/
  `.ends`, `.db`/`.dw`, `.ramsection`, `.equ`, `.ACCU`/`.INDEX`, `.incbin`…),
  littéraux `$`/`%`, commentaires `;`, labels colonne 0. Source = manuel WLA-DX.
  *Build-vs-intégrer* : grammaires « 65816 » génériques existent, mais le dialecte
  WLA est spécifique → grammaire taillée justifiée, assez petite pour l'assumer.
  *Hook futur* : lint du piège `.ACCU 8/16` manquant après `rep`/`sep`
  (cf. `abi_lint.md`) — linter, pas coloration ; étape ultérieure.

---

## 10. Éditeurs d'assets (C6) — build-vs-wrap (l'arbitrage réel)

Le workspace contient déjà : **SNESTilesKitten** (éditeur de tiles), **schismtracker**
+ **openmpt** (trackers IT = entrée de `smconv`).

| Asset | Construire ? | Position |
|---|---|---|
| **Audio (IT)** | ❌ Non | Lancer schismtracker/openmpt depuis l'IDE. Écrire un tracker = projet en soi. |
| **Tiles/sprites** | ⚠️ À débattre | SNESTilesKitten existe. Wrapper (cheap, peu intégré) vs webview maison (cher : preview luna + palette partagée + round-trip gfx4snes). |
| **Palette** | ✅ Oui (petit) | 15-bit BGR, CGRAM 256 + sous-palettes. **Brique commune** (tiles+map en dépendent) et la moins chère → **premier** éditeur d'assets. |
| **Map / tilemap** | ✅ Oui | Écrans 32×32, modes `SC_*`, attributs priorité/flip. Pas d'équivalent intégré, fort différenciateur. Après palette+tiles. |

Insight : palette = point d'entrée C6 (commune + cheap) ; tracker = hors-scope
(intégrer, pas construire) ; tiles = le vrai build-vs-wrap à trancher (Q4).

---

## 11. Modèle de projet & scaffolding

Le contrat de projet (§3.3) permet : **New Project** (scaffold Makefile+main.c+
assets+ `AGENTS.md` contexte IA), **détection** (lit `LIB_MODULES`/`USE_*` → build,
defines clangd, mode debug), **multi-cible** (LoROM/HiROM/SA-1/SuperFX depuis l'UI).
Gros différenciateur peu coûteux : la convention existe, on l'expose.

---

## 12. Distribution & dépendances

- **Pack d'extensions** (`.vsix`) — VS Code / VSCodium / Cursor.
- **luna** — binaire pinné, bootstrap SHA-checké (modèle `install-luna.sh`).
- **Toolchain cc65816** — buildée depuis le repo OpenSNES ou bundle pinné par OS.
- **Standalone optionnel** — VSCodium + extensions préinstallées = produit brandé,
  sans réécriture.
- **Debug DAP-natif** (D4) — bonus distribution : le debug marche hors VS Code.

---

## 13. Phasage v2 (réordonné autour du contrat)

- **P0 — « VS Code qui connaît OpenSNES » (🟢, jours)** : modèle de projet + tasks
  build + **run/preview luna** + Problems (matcher cc65816) + scaffolding +
  **Niveau 1 IA** (contexte SDK au scaffold). **+ C1b coloration WLA-DX** (cheap,
  immédiat). *→ dépasse déjà un `.vscode/` nu. MVP.*
- **P1 — Langage & helper (🟢)** : clangd + `compile_commands.json` + defines cible
  + clang-format + snippets/hover API.
- **P2 — Debugger niveau symboles/ASM (🔴)** : DAP sur le MCP/contrôle luna actuel
  (step + inspect + viewers + WDM breakpoints). *Joyau, livrable sans nouvelle
  surface luna.*
- **P3 — Surface debug runtime dans luna + DAP natif (🔴)** : bp/watch/continue/
  events/poke, puis `luna dap`. *Ta roadmap luna ; débloque le debug interactif
  plein **et** l'éditeur-agnosticité.*
- **P4 — Éditeur de palette (🟠)** : webview, round-trip `.pal`, preview luna.
- **P5 — Tiles + Map (🟠)** : selon Q4 (wrap SNESTilesKitten vs maison).
- **P6 — IA niveau 2 (MCP OpenSNES) puis niveau 3 (boucle luna) (🔴)** : le
  différenciateur ultime.
- **P7 — Debug niveau source (`.dbg`) (🔴, compilo)** : line-table + frames → bp/
  step au niveau C + locals. Le plus dur, hors chemin critique.
- **P8 — Multi-chips DAP (avancé)** : SPC700/SA-1/GSU comme threads.

**Phasage alternatif à débattre** (Q5) : « contenu d'abord » (P4/P5 avant le
debugger) si créer les assets fait plus mal que débugger aujourd'hui.

---

## 14. Le garde-fou (anti-scope-death)

« Du lourd » en solo meurt par la **largeur**. Discipline non négociable :

> **Tout ce qui n'est pas (a) la colonne [contrat = `.dbg` + luna backend] ou
> (b) un client mince de la colonne est de la dette.**

Corollaires : moteur unique (luna) ; sources-only (aucun pipeline d'assets
parallèle) ; off-the-shelf partout sauf C4/C6/C7 ; tout nouveau besoin se demande
« est-ce un client du contrat ? » avant d'être codé.

---

## 15. ⚠️ DOUTES & QUESTIONS OUVERTES (reclassés — Q7 v1 supprimée)

### 🔴 Stratégiques

**Q1. DAP natif dans luna, ou adaptateur TS dans l'IDE (D4) ?** La décision phare.
Recommandation : **prototype TS d'abord (de-risk UX) → migrer en DAP natif**. À
figer car ça structure où vit la complexité (Rust vs TS) et l'éditeur-agnosticité.

**Q2. Cible : toi (mainteneur) ou utilisateurs externes ?** Change la barre de
finition, doc, multi-OS, support. (La mission « rendre les devs heureux » penche
vers *externes* — donc DAP natif, onboarding, packaging soignés.)

**Q3. Périmètre v1 = quoi ?** Le « tout-en-un » est un piège solo. Proposition de
v1 minimale qui livre déjà du bonheur : **P0 + P1 + P2 + Niveau 1 IA**.

### 🟠 Architecturaux

**Q4. Tiles : wrap SNESTilesKitten vs webview maison (§10) ?** (besoin : regarder
ce que round-trip réellement SNESTilesKitten vs gfx4snes — info manquante
aujourd'hui).

**Q5. Phasage : debugger d'abord ou assets d'abord (§13) ?** Où est la douleur
réelle — débugger ou créer du contenu ?

**Q6. Forme de la debug-info (§3.1).** Étendre le `.sym`, format maison, ou viser
un standard (DWARF-like) ? Impacte cproc/QBE/wla **et** la consommation côté luna.

### 🟡 Détail / dépendances

**Q7. clangd sur `int`=2 (D11).** Autorité = build cc65816, pas clangd. À cadrer
pour ne pas induire l'utilisateur en erreur.

**Q8. Boucle agentique IA niveau 3 (§8).** Garde-fous (budget, anti-boucle) à
concevoir. Phasé après niveaux 1–2.

**Q9. Maintenance solo (§14).** La discipline « contrat + clients minces » est ce
qui tient le tout. Toute violation = dette.

---

## 16. Bottom line / conditions de GO

- L'archi est **saine, réaliste et unique** *parce que tu possèdes la verticale*.
  L'anneau = **le contrat** (`.dbg` du compilo + luna backend DAP), pas une appli.
- **Valeur ajoutée réelle** sur « VS Code + Makefile » = **C4 (debug) + C6 (assets)
  + C7 (IA ancrée luna) + scaffolding**. Si ce n'est pas le but, un template
  `.vscode/` suffit (mais ce *n'est pas* le but ici — la mission est « du lourd »).
- **MVP** = P0+P1+P2 + Niveau 1 IA. **Joyau** = le debugger sur DAP (atteignable,
  car tu possèdes luna). **Différenciateur ultime** = l'IA qui vérifie dans luna.
- **Risque résiduel n°1** = pas technique mais de **périmètre (Q3)** et **forme du
  contrat (Q1/Q6)**. La technique est à ta portée ; c'est le découpage qui décide.

> Nuance finale : ce dossier suppose que le but est **un outil de productivité qui
> rend les devs heureux**, pas une démo techno. La possession de la verticale rend
> la chose *possible en solo* — mais seulement si l'anneau reste **un contrat mince
> et net**, pas une appli qui gonfle. La discipline §14 est la condition de survie.
