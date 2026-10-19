# Surveiller un cluster Kubernetes avec une IA : pile d'observabilité et assistant en lecture seule

Projet 5 du cours *Cloud Services and Systems* (HES-SO Master, groupe 13) : « Monitoring Kubernetes clusters with AI ».

Ce dépôt contient tout ce qu'il faut pour monter, **d'abord en local sur Kind, puis sur Switch Cloud**, une pile qui collecte les
métriques et les logs d'un cluster Kubernetes et permet de les interroger en langage naturel, **sans qu'aucune donnée ne quitte le cluster**.

> **État honnête (19.10.2026)** : le déploiement **local (Kind)** a été exécuté de bout en bout, une fois sans intervention
> (`make local-all`, test de fumée 6 contrôles sur 6), après trois tentatives échouées puis corrigées. Le déploiement **Switch Cloud n'a
> jamais été exécuté** : tout ce qui le concerne est écrit d'après la documentation de Switch et reste à tester.
> Détail de ce qui est vérifié ou non : [guide](docs/Projet5-Stack-Observabilite-Kubernetes.docx), sections 0, 3.7 et 5.

## Pourquoi ce projet

Le sujet demande un assistant IA qui aide à superviser un cluster Kubernetes. Le groupe a retenu trois contraintes :
- **confidentialité maximale** (données médicales envisagées) : le modèle de langage tourne **dans le cluster** (Ollama) ; aucune API externe ;
- **assistant en lecture seule** : il ne fait que des requêtes `GET` vers Mimir et Loki, sans `kubectl` ni droit d'écriture ;
- **peu d'innovation** : on reprend les technologies de l'article du HUG cité dans le sujet (Ollama, LangChain/LangGraph, Open WebUI).

L'autre exigence est la **reproductibilité** : tout est décrit en code (OpenTofu + Helm, scripts, Makefile) pour qu'un déploiement sur un
cloud public demande le moins possible de gestes manuels.

## Ce que contient la pile

```
Cluster Kubernetes
  ├─ k8s-monitoring (Alloy)  ── métriques ──▶ Mimir ──▶ stockage S3 (Garage en local, SCS3 chez Switch)
  │                          └─ logs / événements ──▶ Loki ──▶ stockage S3
  ├─ Grafana         (sources de données : Mimir et Loki)
  ├─ Ollama          (modèle qwen3:8b, sur CPU), utilisé par Open WebUI et par l'assistant
  ├─ assistant       (FastAPI + agent LangChain/LangGraph, 6 outils en lecture seule) ──▶ Mimir, Loki, Ollama
  └─ Open WebUI      (interface de chat ; un seul outil exposé : l'assistant)
```

| Composant | Rôle | Namespace |
|---|---|---|
| Garage (local seulement) | stockage S3 sans MinIO pour Mimir et Loki | `garage` |
| Mimir, Loki | stockage des métriques et des logs | `mimir`, `loki` |
| k8s-monitoring (Alloy) | collecte | `monitoring` |
| Grafana | visualisation | `grafana` |
| Ollama | serveur du LLM | `ollama` |
| assistant | API et agent (code dans `assistant/`) | `assistant` |
| Open WebUI | interface de chat | `open-webui` |

Les choix techniques et leurs justifications sont dans le [guide](docs/Projet5-Stack-Observabilite-Kubernetes.docx) (tableau des décisions et sections 3 et 4).

## Prérequis

Testé sur un Mac Apple silicon, Docker Desktop avec **10 CPU et 15 Gio de mémoire** (le script `make preflight` avertit en dessous de 14 Gio).
Versions utilisées lors des essais : OpenTofu 1.13.1, Helm 4.3.1, kubectl 1.37.1, kind 0.33.0, Docker 29.8.2 ; en plus `git`, `openssl`, `python3`.

```bash
make preflight        # vérifie les outils, la mémoire Docker et les clusters Kind existants ; ne modifie rien
```

Ce qui est téléchargé : charts Helm et images (plusieurs Go ; celle d'Open WebUI fait 1,46 Go), le modèle `qwen3:8b` (**téléchargé par le chart Ollama** ; taille de téléchargement non relevée, 6,7 Go en mémoire).
Les durées dépendent donc beaucoup du réseau.

## Démarrage en local (Kind)

### A. Étape par étape (pour comprendre ou reprendre après un échec)

Lancez les commandes **dans l'ordre**, depuis la racine du dépôt.

| # | Commande | Ce qu'elle fait |
|---|---|---|
| 1 | `make preflight` | vérifie outils, mémoire Docker, clusters existants |
| 2 | `make local-secrets` | génère des mots de passe aléatoires dans `envs/local/secrets.auto.tfvars.json` (jamais écrasés, ignorés par git) |
| 3 | `make local-up` | crée le cluster Kind (1 plan de contrôle, 2 nœuds) |
| 4 | `make local-garage` | clone le chart Garage (commit figé) et le déploie (phase 1 d'OpenTofu) |
| 5 | `make local-garage-init` | initialise Garage : layout, 6 buckets, clé S3 → `envs/local/s3.auto.tfvars.json` |
| 6 | `make local-assistant-image` | construit l'image de l'assistant (sans cache) et la charge dans Kind |
| 7 | `make local-stack` | déploie Mimir, Loki, k8s-monitoring, Grafana, Ollama (télécharge le modèle), assistant, Open WebUI (phase 2) |
| 8 | `make local-webui-config` | crée l'entrée de modèle d'Open WebUI (prompt système, contexte, `think: false`) ; attend qu'Open WebUI réponde |
| 9 | `make local-test` | test de fumée : 6 contrôles (pods, modèle, assistant, Mimir, Open WebUI, question de bout en bout) |
| 10 | `make local-credentials` | affiche les identifiants Open WebUI et Grafana **dans votre terminal** (ne les collez pas dans un message) |

Durées mesurées le 19.10.2026 pour la création des ressources de l'étape 7 (en parallèle, donc non additives) : Loki 5 à 8 min,
Mimir 7 à 8 min, Grafana 5 à 6 min, k8s-monitoring 9 à 13 min, Open WebUI 9 à 10 min, **Ollama 15 à 21 min** (téléchargement du modèle).

### B. Commande unique

```bash
make local-down && make local-all     # ou simplement : make local-all   (sur une machine sans cluster)
```

`make local-all` enchaîne les 10 étapes ci-dessus. La durée totale n'a pas été chronométrée ; comptez au moins la durée de la
ressource la plus lente (Ollama, 15 à 21 min) plus la préparation.
**Fiabilité** : elle a réussi une fois sur quatre exécutions ; les trois échecs précédents venaient d'attentes trop courtes et sont corrigés
(section 3.7 du guide). Si une étape échoue, relancez les étapes restantes une par une (tableau A).

### Utiliser la pile

```bash
make pf-webui         # http://localhost:8080  (e-mail : admin@local.invalid ; mot de passe : make local-credentials)
make pf-grafana       # http://localhost:3000  (utilisateur : admin)
```

Dans Open WebUI, ouvrez **une nouvelle conversation** pour chaque question et posez par exemple « Quels sont les 3 pods qui consomment le plus de mémoire ? ».
Dépliez « Voir le résultat de ask_cluster_assistant » pour voir les requêtes réellement exécutées : c'est la façon de vérifier la réponse.

### Tout supprimer

```bash
make local-down       # supprime le cluster, l'état OpenTofu local et les clés S3 ; conserve les mots de passe générés
```

## Déploiement sur Switch Cloud (NON TESTÉ)

Étapes **manuelles** à faire d'abord (aucun accès à la plateforme à ce jour ; détail et sources : guide, section 3.5) :
1. créer le cluster SCK (portail Switch, ou `scripts/sck-create-cluster.sh` avec le JSON de la doc Switch) et télécharger son kubeconfig ;
2. créer les buckets SCS3 : `scripts/scs3-create-buckets.sh` (endpoint, région et clés à relever dans la doc ou le portail) ;
3. copier `envs/switch/terraform.tfvars.example` en `envs/switch/terraform.tfvars` et le compléter (fichier ignoré par git) ;
4. choisir un registre d'images ; l'image doit être construite pour **linux/amd64** (hypothèse sur les nœuds SCK, non vérifiée).

Puis, une fois ces prérequis réunis :

```bash
make switch-image REGISTRY=<registre>/<projet>   # construit l'image de l'assistant (linux/amd64) et la publie
export KUBECONFIG=~/.kube/sck-switch.yaml        # le kubeconfig SCK
make switch-apply                                # génère les secrets, déploie tout (OpenTofu), configure Open WebUI
```

Points ouverts connus (guide, section 5) : registre d'images, architecture des nœuds, accès sortant d'Open WebUI vers
`huggingface.co` (modèle d'embedding), GPU et quotas, endpoint et région SCS3, question « Mimir sans MinIO » au professeur.

## Contenu du dépôt

```
Makefile                  toutes les commandes (make help)
assistant/                code de l'assistant (FastAPI + LangChain/LangGraph), Dockerfile, 51 tests (pytest)
charts/assistant/         chart Helm de l'assistant
modules/observability/    module OpenTofu partagé (Mimir, Loki, k8s-monitoring, Grafana, Ollama, assistant, Open WebUI)
envs/local/               assemblage Kind (Garage + module)
envs/switch/              assemblage Switch Cloud (module seul)
kind/                     configuration du cluster local
scripts/                  preflight, secrets, Garage, configuration d'Open WebUI, test de fumée, identifiants, scripts SCK/SCS3
manual/local/             valeurs Helm de l'installation manuelle testée (référence)
docs/                     guide (DOCX), sources du guide (guide-src/), document d'architecture rendu (architecture/)
.gitlab/issue_templates/  modèle de ticket « Test / découverte »
```

## Documentation

- [`docs/Projet5-Stack-Observabilite-Kubernetes.docx`](docs/Projet5-Stack-Observabilite-Kubernetes.docx) : le guide (installation manuelle, automatisation, décisions et justifications, mesures, échecs et corrections, points ouverts). Régénérer : `make docs`.
- [`docs/architecture/`](docs/architecture/) : le document d'architecture soumis (PDF et DOCX), **conservé tel quel, ne pas le modifier**.
- [`CHANGELOG.md`](CHANGELOG.md) : journal des changements importants.

## Travailler à plusieurs

- **Ne jamais commiter de secret** (mot de passe, clé S3, kubeconfig, état OpenTofu). Le `.gitignore` les exclut ; lancez `make check-secrets` avant chaque commit et relisez `git diff --staged`.
- Une mise à jour se fait avec `git pull` : les fichiers locaux ignorés (secrets, état, clés S3, clone de Garage) sont conservés. **Ne supprimez pas le dossier pour le recréer** : vous perdriez ces fichiers et l'état d'OpenTofu du cluster.
- Une découverte, un échec, un résultat de test : ouvrez un ticket avec le modèle « Test_decouverte » (date, environnement, commande, sortie **sans secret**, niveau de preuve). On distingue toujours *observé*, *lu dans la documentation ou le code*, *non testé* et *hypothèse*.
- Modifications : branche puis merge request vers `main`. Mettez à jour le guide (`docs/guide-src/`) et le `CHANGELOG.md` avec le changement.

## Limites connues

- Les secrets (mots de passe, clés S3) sont en clair dans les valeurs Helm et dans le fichier d'état OpenTofu : acceptable pour un cluster local jetable, pas pour la production.
- L'assistant n'a ni authentification ni NetworkPolicy ; Open WebUI est prévu pour un seul administrateur.
- L'agent (`qwen3:8b`) produit parfois une requête PromQL mal formée et peut renoncer ; le test de fumée vérifie qu'un outil est appelé, pas que la réponse est utile.
- Les variables d'environnement d'Open WebUI ne servent qu'au premier démarrage : les modifier ensuite n'a aucun effet sans supprimer son volume.
- Rien n'a été mesuré sur la fiabilité des réponses sur un jeu de questions étendu.

## Licence

À définir par le groupe.
