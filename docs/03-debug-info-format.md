# Dossier Q6 — La debug-info de l'anneau (forme & chantier)

> Date : 2026-06-26 · Statut : **conception, fondée sur l'audit réel des 4 couches**
> · Aucun code écrit. Annexe de `/tmp/opensnes_ide_architecture.md` (§3.1, Q6).
>
> Question : quelle **forme** donner à la debug-info qui permet le debug au
> niveau C (bp/step sur `main.c`, inspection des variables) à travers
> `cproc → QBE w65816 → wla-65816 → wlalink → luna` ?
>
> Méthode : 4 explorations parallèles du code réel (cproc, QBE, wla-dx, `.sym`+
> luna). Ce dossier en tire l'état des lieux, **la décision de format**, et le
> plan de chantier. Toutes les affirmations « aujourd'hui » sont sourcées.

---

## 0. TL;DR — la réponse à Q6

**N'invente AUCUN format. La debug-info ligne↔PC existe déjà dans WLA-DX ; il
faut la *brancher* et lui donner du C plutôt que de l'ASM.**

Trois classes de données, trois sorts différents :

| Donnée | Existe déjà ? | Verdict |
|---|---|---|
| **Ligne C ↔ adresse PC** | ⚠️ WLA a le mécanisme (addr-to-line v2), mais il pointe sur le `.asm` généré | **Étendre l'existant** : alimenter WLA en lignes *C* (pas ASM) |
| **Symbole ↔ adresse + taille** | ✅ `.sym` `[labels]`/`[definitions]` | **Réutiliser tel quel** |
| **Variables : nom → offset frame + type** | ❌ rien | **Le SEUL vrai nouveau** : un sidecar `[frames]`/`[types]` |

**Décision de forme** : **étendre le `.sym` WLA v3** (tu possèdes wla-dx → tu peux
ajouter des sections), pas un DWARF, pas un format maison parallèle. luna apprend
à lire le `.sym` v3 (il ne le lit pas du tout aujourd'hui). DWARF serait
sur-dimensionné (conçu pour des piles/registres standards, pas pour des banques
65816) et personne dans la chaîne ne l'émet ni ne le lit.

**Le levier que la possession débloque** : un mini-ajout à wla-dx (fixer le
numéro de ligne courant, pas seulement le fichier) rend le mapping **ligne-C↔PC
natif**, sans outil de composition post-link. Voir §4.

---

## 1. État des lieux réel, couche par couche

### 1.1 cproc (frontend C)
- **Tokens** portent `file/line/column` (`struct location`, `cc.h:127-130,138` ;
  rempli `scan.c:475`). **MAIS les nœuds AST (`expr`/`decl`) n'ont pas de
  position** — jetée après le parse, utilisée seulement pour les erreurs.
- **Aucun `dbgloc`/`dbgfile` émis** dans l'IL (zéro occurrence).
- Locals → `alloc` (taille seule, `qbe.c:408-443`) ; **noms perdus** (deviennent
  des temps `%tN`). Offsets délégués à QBE.
- **Types** : signedness préservé **seulement** pour 1 octet ; **perdu pour ≥2
  octets** (u16 et s16 → même classe `w`, `qbe.c:211-221`). Structs émis avec
  offsets mais **sans noms de champs**. Globales nommées.

### 1.2 QBE w65816 (backend)
- **Le cœur QBE a déjà toute l'infra debug** : `dbgfile`/`dbgloc` parsés
  (`parse.c`), `emitdbgfile()`/`emitdbgloc()` (`emit.c:480-508`). amd64/arm64/rv64
  **les appellent** ; **w65816 NON** (`Odbgloc` tombe dans « unhandled op »).
- **Frames** : au moment d'émettre, le backend **connaît l'offset final** de
  chaque slot (`allocslot[idx]`, `w65816/emit.c:4360-4367`). Indexé par **temp
  QBE**, et **les noms C sont absents** (QBE ne voit que `%tmp.N`).
- Fonctions = labels nus ; pas de `.sym`/`.globl` émis (wla auto-génère).

### 1.3 wla-65816 / wlalink (assembleur/linker) — **la pièce maîtresse**
- **`.sym` Version 3** (`doc/symbols.rst`) avec sections : `[information]`
  `[labels]` `[definitions]` `[symbols]` `[breakpoints]` `[sections]`
  `[ramsections]` **`[source files v2]`** **`[addr-to-line mapping v2]`**
  `[rom checksum]`. Écriture : `wlalink/write.c:2375-2716`.
- **ADDR-TO-LINE EXISTE ET MARCHE** : `wla-65816 -i` (collecte les lignes par
  instruction) + `wlalink -S -A` (émet le mapping). Survit au link via le format
  objet WLAl (commandes `'f'`=changement de fichier, `'k'`=nouvelle ligne+offset,
  `listfile.c`).
- Directives debug : **`.SYM`/`.SYMBOL`** (→ `[symbols]`), **`.BREAKPOINT`/`.BR`**
  (→ `[breakpoints]`).
- **`.CHANGEFILE <id>`** (interne, `phase_1.c:11217`) : fixe le fichier actif et
  **remet `line_current` à 0** ; les lignes sont ensuite **comptées
  physiquement**. ⟵ **Il n'existe pas de directive pour *fixer* un numéro de
  ligne arbitraire.** C'est le seul chaînon manquant côté wla (§4).

### 1.4 .sym généré + luna
- `.sym` réel (ex. `collision_demo.sym`) = `[information][labels][definitions]
  [sections][ramsections]`. **Aucune info source/ligne** (parce que le build
  n'active ni `-i` ni `-A`).
- **Build** (`make/common.mk:367`) : `wlalink -S` seulement. **Pas de `-A`, pas de
  `-i`** à l'assembleur. cc65816 ne passe aucun flag debug.
- `symmap.py` ne parse que `bank:addr → nom` (`lib.py:111-154`).
- **luna** : **aucune conscience des symboles** — ne charge pas de `.sym`, pas de
  DWARF. **MAIS** le MCP (source) expose déjà **`run_until_pc`**,
  **`run_until_mem_write`**, **`run_until_mem_read`**, `search_memory` (en plus de
  `state`/`peek_*`). ⟵ **Le runtime de breakpoint existe ; il manque la couche
  symbolique.** (NB : le `--help` du binaire pinné v1.1.0 ne listait que le
  catalogue read-only — la source est en avance ; à confirmer sur le binaire.)

---

## 2. Les trois classes de données et leur source

```
  ┌─ Ligne C ↔ PC ────────────────────────────────────────────────┐
  │  besoin : poser un bp sur main.c:42, stepper au niveau C        │
  │  source : cproc (token→AST loc) → QBE (dbgloc) → wla (addr2line)│
  └────────────────────────────────────────────────────────────────┘
  ┌─ Symbole ↔ adresse + taille ──────────────────────────────────┐
  │  besoin : globales, fonctions, call stack minimal              │
  │  source : DÉJÀ dans .sym [labels]/[definitions]  (rien à faire) │
  └────────────────────────────────────────────────────────────────┘
  ┌─ Variable ↔ offset frame + type ──────────────────────────────┐
  │  besoin : afficher les locals/params, leur valeur typée        │
  │  source : cproc (nom+type) ⊕ QBE (offset) → sidecar [frames]    │
  │  ⟵ LE SEUL VRAI NOUVEAU. Aucun bout n'a nom+offset à lui seul. │
  └────────────────────────────────────────────────────────────────┘
```

Point dur structurant : **nom+type vivent dans cproc, l'offset vit dans QBE, et
les deux sont disjoints** (le nom C est perdu avant que l'offset existe). Réunir
les deux = le cœur du chantier « variables locales » (D6). C'est séparable et
**reportable** : globales + registres + mémoire brute d'abord.

---

## 3. Décision de format — étendre `.sym` v3 (pas DWARF, pas maison)

**(a) Choix** : la debug-info = **le `.sym` WLA v3 enrichi** :
- ligne↔PC : sections **`[source files v2]` + `[addr-to-line mapping v2]`**
  existantes, alimentées en **lignes C** (§4) ;
- symboles : `[labels]`/`[definitions]` existants ;
- variables : **nouvelles sections** `[frames]` (fonction → liste de
  {nom, offset, taille, signé?}) et éventuellement `[types]` (structs/enums) —
  ajoutées au writer `wlalink/write.c` (tu possèdes wla-dx).

**(b) Raison** : la moitié du travail (ligne↔PC, symboles) **existe déjà** dans
WLA ; le format est déjà parsé par l'écosystème (symmap, Mesen lit le WLA .sym).
Un seul fichier, un seul parseur côté luna.

**(c) Alternatives écartées** :
- **DWARF** : conçu pour ABIs standard (registres/pile linéaires), pas pour
  banques 65816 + slots Kl ; aucun maillon ne l'émet/le lit ; énorme à
  implémenter des deux côtés. Sur-dimensionné.
- **Format maison parallèle** (`.dbg` séparé du `.sym`) : duplique la résolution
  d'adresses que wlalink fait déjà au link ; deux fichiers à garder synchrones.
  *Sauf* pour les `[frames]`/`[types]` qui n'ont pas d'équivalent WLA — mais
  autant les loger **dans** le `.sym` v3 que tu contrôles.

**(d) Contre-argument** : étendre le format `.sym` casse-t-il les parseurs tiers
(Mesen, symmap) ? Non : ils ignorent les sections inconnues (`symmap.py` filtre
déjà ; le format est sectionné). On reste rétro-compatible.

---

## 4. Le pivot — alimenter l'addr-to-line en lignes **C**, pas ASM

WLA `-i`/`-A` produit nativement `PC ↔ ligne du .asm généré`. Or on veut
`PC ↔ ligne de main.c`. Deux architectures :

### Architecture B — composition post-link (sans toucher wla)
1. cproc émet `dbgloc`/`dbgfile` (besoin : porter la loc token→AST).
2. w65816 traite `Odbgloc` et émet, à côté de chaque instruction, un marqueur de
   provenance C (commentaire structuré `; @loc main.c:42` ou table latérale).
3. wla `-i` + wlalink `-A` → `PC ↔ ligne_asm` (natif, gratuit).
4. Petit outil post-link compose `PC ↔ ligne_asm` ⊕ `ligne_asm ↔ ligne_C` →
   `PC ↔ ligne_C`. (Les lignes physiques du .asm sont stables : `sed` ne fait que
   des substitutions `.byte→.db`, ça préserve le compte de lignes.)
- **Coût** : pas de modif wla ; un outil de composition + le marqueur émetteur.
- **Fragilité** : dépend de la stabilité ligne-à-ligne `.asm`→assemblage.

### Architecture C — natif (en exploitant la possession de wla) ⟵ recommandé
1–2. idem (cproc `dbgloc` → w65816).
3. **Ajouter à wla-dx une capacité « fixer la ligne courante »** : `.CHANGEFILE`
   fixe déjà le fichier et remet `line_current=0` ; on étend (ou on ajoute `.LINE
   n`) pour **poser `line_current = n`**. ~quelques lignes dans `phase_1.c`.
4. w65816 émet, avant les instructions d'un statement C, `.CHANGEFILE <main.c-id>`
   + `.LINE 42`. La machinerie `-A` **existante** produit alors **`PC ↔ main.c:42`
   directement**, zéro composition.
- **Coût** : un petit patch wla (que tu possèdes) + l'émission côté w65816.
- **Avantage** : robuste, pas d'outil tiers, réutilise tout le pipeline `-A`.

**Recommandation : Architecture C.** C'est exactement le genre de chose que la
possession de la verticale rend trivial — un autre projet devrait forker wla ;
toi tu commites dedans.

---

## 5. Le sidecar variables (`[frames]`/`[types]`) — le seul vrai nouveau

Pour afficher les locals/params, réunir deux moitiés disjointes :

- **cproc** connaît `(nom C, type, signé?)` par scope de fonction.
- **QBE w65816** connaît `(temp → offset frame final)` (`allocslot`).

Options pour les relier :
- **Option 1 — nommer les allocs** : cproc nomme le temp d'`alloc` d'après la
  variable C (`%score` au lieu de `%t123`). Alors `allocslot` est indexé par un
  temp dont le **nom = nom C** → le backend émet `nom + offset` directement.
  Élégant, mais gérer les collisions de scope (même nom, blocs différents) et le
  mangling SSA.
- **Option 2 — table latérale cproc** : cproc émet, par fonction, `(nom, type) ↔
  identifiant d'alloc` ; QBE émet `(identifiant d'alloc → offset)` ; composition
  → `[frames]`. Plus verbeux mais sans toucher au nommage SSA.

Et les **types** : cproc doit cesser de jeter la signedness ≥2 octets pour le
canal debug (ou l'émettre dans `[types]` même si l'IL reste agnostique). Structs :
ajouter les **noms de champs** (cproc les a ; ils ne sont pas émis).

**Ce bloc est reportable (P7).** Niveau 1 du debugger = globales (déjà dans
`.sym`) + registres + mémoire. Les locals C arrivent avec ce sidecar.

---

## 6. Côté luna — ce qu'il faut ajouter

luna a le **runtime** (`run_until_pc`, watch mémoire) mais **aucune couche
symbolique**. À ajouter :
- **charger le `.sym` v3** au `load_rom` (param optionnel `sym_path`) : parser
  `[labels]`, `[addr-to-line v2]`, `[frames]`/`[types]`.
- **résolution** : `pc → (fichier, ligne)`, `(fichier, ligne) → pc` (pour poser un
  bp depuis l'IDE), `addr → symbole`, `frame courant → locals typés`.
- exposer ça en MCP/DAP : `set_breakpoint(file, line)`, `stack_trace`,
  `variables`. Le `run_until_pc` existant fait le gros œuvre dessous.

C'est **ton code luna** → pas une RFE, une roadmap.

---

## 7. Plan de chantier (phasé, par couche)

| Phase | Travail | Couche | Effort | Risque | Débloque |
|---|---|---|---|---|---|
| **G0** | Activer `-i`/`-A` dans le build → `.sym` avec `PC↔ligne_asm` ; luna charge le `.sym` (labels + addr-to-line) | build + luna | ~jours | 🟢 | debug **niveau ASM** avec symboles (déjà énorme) |
| **G1** | cproc : porter la loc token→AST + émettre `dbgloc`/`dbgfile` | cproc | ~1 sem | 🟠 | la source C entre dans le pipeline |
| **G2** | w65816 : traiter `Odbgloc` (cœur QBE déjà prêt) | qbe | ~jours | 🟢 | la loc C atteint l'émetteur |
| **G3** | wla : `.LINE n` (set line_current) ; w65816 émet `.CHANGEFILE`+`.LINE` | wla + qbe | ~jours | 🟠 | **`PC ↔ main.c:ligne` natif** (Archi C) → bp/step au niveau C |
| **G4** | sidecar `[frames]`/`[types]` (cproc⊕qbe→`.sym`) ; luna les lit | cproc+qbe+wla+luna | ~1–2 sem | 🔴 | **variables locales typées** |
| **G5** | DAP : exposer file/line bp, stack_trace, variables (cf. dossier IDE D4) | luna/IDE | — | — | l'expérience complète |

Chemin critique vers « bp/step au niveau C » = **G0→G1→G2→G3** (semaines, pas
mois). Les **variables locales** (G4) sont l'extension dure mais séparée.

---

## 8. Doutes & questions ouvertes

- **R1 — stabilité ligne `.asm` (si Archi B).** Évitée par l'Archi C (recommandée).
- **R2 — `.LINE n` dans wla** : confirmer que `line_current` n'est pas écrasé par
  le comptage physique juste après (sinon il faut suspendre l'incrément le temps
  d'un statement, ou émettre `.CHANGEFILE`+`.LINE` à chaque ligne logique). À
  prototyper en premier — c'est le pari de l'Archi C.
- **R3 — granularité optimisée.** Avec l'optimiseur QBE, plusieurs lignes C se
  mélangent (instructions réordonnées). Le mapping sera approximatif sur code
  optimisé (problème classique de tout debugger optimisé). Repli : `-O0`/mode
  debug du compilo, ou accepter le « jump around ».
- **R4 — collisions de noms de locals (G4, option 1).** Scopes imbriqués. Penche
  vers l'option 2 (table latérale) si le nommage SSA résiste.
- **R5 — binaire luna pinné vs source.** Confirmer que `run_until_pc`/watch sont
  dans le binaire v1.1.0 ou nécessitent un rebuild/bump.
- **R6 — signedness ≥2 octets jetée par cproc.** Pour les types debug, il faut la
  récupérer (canal debug séparé de l'IL, qui lui reste agnostique).

---

## 9. Bottom line

- **Q6 tranchée** : **étendre le `.sym` WLA v3**, ne rien inventer. Ligne↔PC =
  brancher l'addr-to-line existant + lui donner du C (Archi C, petit patch wla
  que tu possèdes). Symboles = déjà là. Variables = un sidecar `[frames]/[types]`,
  le seul vrai nouveau, et reportable.
- **La possession paie ici plus que partout ailleurs** : le seul chaînon manquant
  (fixer la ligne courante dans wla) est un commit chez toi, pas un fork ni une
  RFE. luna a déjà le runtime de breakpoint ; il lui manque la couche symbolique,
  ton code aussi.
- **Chemin court vers le debug niveau C** : G0→G3 en semaines. **G0 seul**
  (activer `-i`/`-A` + luna lit le `.sym`) donne déjà un debug **niveau ASM
  symbolisé** — un premier livrable concret et peu risqué.
- **Prochaine action concrète proposée** : prototyper **R2** (le `.LINE n` dans
  wla) — c'est le pari dont dépend toute l'Architecture C. 30 lignes de C + un
  `.asm` de test passé dans `-i`/`-A`.
