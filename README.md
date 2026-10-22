# Surveiller un cluster Kubernetes avec une IA : pile d'observabilité et assistant en lecture seule

Projet 5 du cours *Cloud Services and Systems* (HES-SO Master, groupe 13) : « Monitoring Kubernetes clusters with AI ».

Ce dépôt contient tout ce qu'il faut pour monter, **d'abord en local sur Kind, puis sur AWS (EKS)**, une pile qui collecte les
métriques et les logs d'un cluster Kubernetes et permet de les interroger en langage naturel. **En local, aucune donnée ne quitte la
machine** ; sur AWS, l'assistant appellera Amazon Bedrock (voir « Pourquoi ce projet »).

> **État honnête (22.10.2026)** : le déploiement **local (Kind)** a été exécuté de bout en bout, une fois sans intervention
> (`make local-all`, test de fumée 6 contrôles sur 6), après trois tentatives échouées puis corrigées. Le déploiement **AWS n'a pas encore
> été exécuté** : les choix sont faits et plusieurs points ont été vérifiés (section « Déploiement sur AWS »), mais **aucune ressource AWS
> n'a été créée** à ce jour. Le déploiement Switch Cloud, jamais exécuté, est **abandonné**.
> Détail de ce qui est vérifié ou non : [guide](docs/Projet5-Stack-Observabilite-Kubernetes.docx), sections 0, 3.7, 4.12, 5 et 6.

## Pourquoi ce projet

Le sujet demande un assistant IA qui aide à superviser un cluster Kubernetes. Le groupe a retenu trois contraintes :
- **confidentialité en local** (données médicales envisagées au départ) : en local, le modèle de langage tourne **dans le cluster** (Ollama),
  sans API externe. Le professeur a indiqué le 22.10.2026 que ce n'est plus une priorité (preuve de concept) : sur AWS, les questions et les
  extraits de métriques et de logs lus par l'agent sont envoyés à **Amazon Bedrock** ;
- **assistant en lecture seule** : il ne fait que des requêtes `GET` vers Mimir et Loki, sans `kubectl` ni droit d'écriture ;
- **peu d'innovation** : on reprend les technologies de l'article du HUG cité dans le sujet (Ollama, LangChain/LangGraph, Open WebUI).

L'autre exigence est la **reproductibilité** : tout est décrit en code (OpenTofu + Helm, scripts, Makefile) pour qu'un déploiement sur un
cloud public demande le moins possible de gestes manuels.

## Ce que contient la pile (version locale, Kind)

```
Cluster Kubernetes
  ├─ k8s-monitoring (Alloy)  ── métriques ──▶ Mimir ──▶ stockage S3 (Garage en local, Amazon S3 sur AWS)
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

## Déploiement sur AWS (EN COURS : choix faits, rien d'exécuté sur AWS)

Retour du professeur du 22.10.2026 et ce que le groupe en a retenu :

| Changement demandé | Décision | Base |
|---|---|---|
| Plus de Switch Cloud : espace AWS avec crédits | AWS, région `us-east-1`, cluster **EKS** et stockage **Amazon S3** (à la place de Garage) | région lue avec `aws configure get region` |
| Plus de LLM hébergé : modèle public, usage gratuit | **Amazon Bedrock**, modèle **Mistral Large 3**, payé sur les crédits AWS | voir ci-dessous |
| L'assistant ne doit pas tourner dans le cluster surveillé | **Une instance EC2** héberge l'assistant et Open WebUI (Docker Compose), hors du cluster ; Mimir, Loki, Alloy et Grafana restent dans le cluster | décision du groupe, 22.10.2026 |
| Question de test finale : « Quel temps fait-il aujourd'hui ? » | L'assistant doit refuser : règle de périmètre dans son prompt système | 1 essai avec Bedrock : refusé en 1 appel ; à répéter sur plusieurs formulations |

**Pourquoi Bedrock et pas ChatGPT** (documentation consultée le 22.10.2026) : l'API OpenAI exige un crédit prépayé (5 $ au minimum, aucun
niveau gratuit mentionné) ; le niveau gratuit de l'API Gemini est exclu par ses conditions d'utilisation pour des utilisateurs en Suisse ;
Groq et OpenRouter ont un niveau gratuit mais plafonné (Groq : 200 000 tokens par jour pour `gpt-oss-20b`, chiffre d'une page ambiguë entre plan
gratuit et plan Developer ; OpenRouter : 50 requêtes par jour sans crédit acheté). Bedrock est déjà autorisé sur le compte du groupe et se paie sur
les crédits AWS. Les crédits restants et leur couverture de Bedrock ne sont **pas vérifiés**.

**Pourquoi l'assistant expose une interface compatible OpenAI** : d'après la documentation d'Open WebUI, il ne se connecte pas directement à
Bedrock (il passe par un proxy, le *Bedrock Access Gateway*). Plutôt que d'ajouter ce composant, l'assistant expose `/v1/chat/completions` et
Open WebUI le voit comme un modèle. Il reste ainsi un seul enchaînement d'appels au LLM par question, au lieu de deux (économie **non mesurée**).

### Architecture cible (NON IMPLÉMENTÉE)

```
Compte AWS, région us-east-1
  ├─ Cluster EKS (surveillé)       Alloy ──▶ Mimir, Loki ──▶ Amazon S3 ; Grafana        (2 nœuds m5.xlarge : 4 vCPU, 16 Gio chacun)
  ├─ Instance EC2 (hors cluster)   Open WebUI ──▶ assistant (/v1) ──▶ Mimir, Loki       (accès réseau restreint, jamais public)
  └─ Amazon Bedrock                Mistral Large 3, appelé par l'assistant              (identifiants du rôle de l'instance : prévu)
```

### Vérifié le 22.10.2026 (AWS CLI 1.46.1)

| Point | Résultat observé |
|---|---|
| Identité | utilisateur IAM, groupe `students`, politique `AdministratorAccess` (plus Bedrock, EC2, S3, CloudFormation). Une règle d'organisation éventuelle ne serait pas visible à ce niveau |
| Région configurée | `us-east-1` |
| EKS | `aws eks list-clusters` : liste vide (aucun cluster) |
| Bedrock, Mistral Large 3 | appel d'outils fonctionnel (1 essai : `stopReason: tool_use`, 439 ms, 126 tokens) |
| Image de l'assistant `0.5.0` | construite sur Mac (40,6 s) ; 58 tests pytest avec faux modèles ; avec Bedrock, la question sur la météo est refusée (1 essai : 1 593 tokens en entrée, 19 en sortie) |

### Reste à vérifier ou à faire (NON TESTÉ)

- crédits AWS restants et couverture de Bedrock ; compte peut-être partagé avec d'autres étudiants (non vérifié) : préfixe `g13-` et étiquettes sur nos ressources ;
- quotas (vCPU, clusters EKS) ;
- architecture de l'image : celle construite sur Mac est **arm64**, une instance `m5`/`t3` est x86 : reconstruire en `linux/amd64` (ou choisir une instance Graviton) ;
- authentification de `kubectl` auprès d'EKS avec le CLI AWS version 1 (`aws eks get-token`) ;
- accès réseau de l'instance EC2 vers Mimir et Loki (ils n'ont pas d'authentification : ne jamais les exposer publiquement) ;
- registre d'images (ECR ou registre GitLab) ; configuration et exposition d'Open WebUI sur l'instance ;
- consommation mémoire réelle de la pile (le dimensionnement à 2 × 16 Gio est une borne déduite de l'installation Kind, pas une mesure) ;
- calibrage de l'assistant : un seul essai du refus hors sujet.

### Coûts (prix à la demande, `us-east-1`, lus avec l'API de prix AWS le 22.10.2026)

| Poste | Prix |
|---|---|
| `m5.xlarge` (4 vCPU, 16 Gio) | 0,192 $/h par nœud, soit 0,384 $/h pour 2 nœuds |
| `t3.xlarge`, `m5.large`, `t3.large` | 0,1664 $, 0,096 $ et 0,0832 $ par heure |
| Plan de contrôle EKS (support standard) | 0,10 $/h (page de prix AWS) |
| Mistral Large 3 (Bedrock) | 0,50 $ en entrée et 1,50 $ en sortie par million de tokens |

Nœuds et plan de contrôle : **0,484 $/h**, soit environ 1,45 $ pour une session de 3 h et environ 11,60 $ si le cluster est oublié pendant 24 h.
Volumes, load balancers, passerelle NAT éventuelle et instance EC2 ne sont **pas encore chiffrés**. Règle du groupe : sessions courtes et planifiées,
destruction et audit des ressources restantes après chaque session.

### Vérifications préalables (lecture seule, sans coût)

Chaque membre qui lancera un déploiement les exécute avec son propre utilisateur :

```bash
aws sts get-caller-identity --query Arn --output text      # votre identité (masquez le numéro de compte si vous collez le résultat)
aws configure get region                                   # attendu : us-east-1
aws eks list-clusters                                      # clusters existants
aws iam list-groups-for-user --user-name <votre-utilisateur>
aws iam list-attached-group-policies --group-name <votre-groupe>
```

### Suite prévue

Les commandes `make aws-*` et le dossier `envs/aws/` **n'existent pas encore**. Ordre prévu : environnement OpenTofu pour AWS (réseau, EKS,
S3, instance EC2, rôles), scripts de création, de destruction et d'audit, puis une première session de test de 3 h au plus, suivie de la destruction
et de l'audit. Les mesures de cette session remplaceront les hypothèses ci-dessus.

### Switch Cloud : abandonné

Abandonné après le retour du professeur du 22.10.2026. Les fichiers `envs/switch/`, `scripts/sck-*` et `scripts/scs3-*` et les cibles `make switch-*`
sont conservés à titre de référence : ils n'ont **jamais été exécutés** et ne sont plus maintenus.

## Contenu du dépôt

```
Makefile                  toutes les commandes (make help)
assistant/                code de l'assistant (FastAPI + LangChain/LangGraph ; LLM Ollama ou Bedrock), Dockerfile, 58 tests (pytest)
charts/assistant/         chart Helm de l'assistant
modules/observability/    module OpenTofu partagé (Mimir, Loki, k8s-monitoring, Grafana, Ollama, assistant, Open WebUI)
envs/local/               assemblage Kind (Garage + module)
envs/switch/              assemblage Switch Cloud (ABANDONNÉ, jamais exécuté, conservé en référence)
envs/aws/                 (à venir) assemblage AWS : EKS, S3, instance EC2
kind/                     configuration du cluster local
scripts/                  preflight, secrets, Garage, configuration d'Open WebUI, test de fumée, identifiants ; scripts SCK/SCS3 (abandonnés)
manual/local/             valeurs Helm de l'installation manuelle testée (référence)
docs/                     guide (DOCX), sources du guide (guide-src/), document d'architecture rendu (architecture/)
.gitlab/issue_templates/  modèle de ticket « Test / découverte »
```

## Documentation

- [`docs/Projet5-Stack-Observabilite-Kubernetes.docx`](docs/Projet5-Stack-Observabilite-Kubernetes.docx) : le guide (installation manuelle, automatisation, décisions et justifications, mesures, échecs et corrections, points ouverts). Régénérer : `make docs`.
- [`docs/architecture/`](docs/architecture/) : le document d'architecture soumis (`Group-13-Architecture.pdf` et `.docx`), **conservé tel quel, ne pas le modifier**, et sa mise à jour [`Group-13-Architecture-v2.docx`](docs/architecture/Group-13-Architecture-v2.docx) (cible AWS, assistant hors cluster).
- [`CHANGELOG.md`](CHANGELOG.md) : journal des changements importants.

## Travailler à plusieurs

- **Ne jamais commiter de secret** (mot de passe, clé S3, kubeconfig, état OpenTofu). Le `.gitignore` les exclut ; lancez `make check-secrets` avant chaque commit et relisez `git diff --staged`.
- Une mise à jour se fait avec `git pull` : les fichiers locaux ignorés (secrets, état, clés S3, clone de Garage) sont conservés. **Ne supprimez pas le dossier pour le recréer** : vous perdriez ces fichiers et l'état d'OpenTofu du cluster.
- Une découverte, un échec, un résultat de test : ouvrez un ticket avec le modèle « Test_decouverte » (date, environnement, commande, sortie **sans secret**, niveau de preuve). On distingue toujours *observé*, *lu dans la documentation ou le code*, *non testé* et *hypothèse*.
- **Une branche par membre** (`dev/<prénom>`, par exemple `dev/nicolas`), créée depuis `main`. Seul son propriétaire y pousse ; les autres la récupèrent pour tester
  (`git fetch`, puis `git checkout dev/<prénom>`) et proposent leurs changements par leur propre branche ou par une merge request. Ramenez régulièrement `main` dans votre branche (`git merge main`).
- **`main` est protégée** : personne n'y pousse directement, tout passe par une merge request. Les membres du groupe ont le rôle Maintainer et peuvent donc fusionner : aucune relecture n'est imposée par la forge.
- Modifications : mettez à jour le guide (`docs/guide-src/`) et le `CHANGELOG.md` avec le changement.

## Limites connues

- Les secrets (mots de passe, clés S3) sont en clair dans les valeurs Helm et dans le fichier d'état OpenTofu : acceptable pour un cluster local jetable, pas pour la production.
- L'assistant n'a ni authentification ni NetworkPolicy ; Open WebUI est prévu pour un seul administrateur.
- L'agent (`qwen3:8b`) produit parfois une requête PromQL mal formée et peut renoncer ; le test de fumée vérifie qu'un outil est appelé, pas que la réponse est utile.
- Les variables d'environnement d'Open WebUI ne servent qu'au premier démarrage : les modifier ensuite n'a aucun effet sans supprimer son volume.
- Rien n'a été mesuré sur la fiabilité des réponses sur un jeu de questions étendu. Avec Bedrock, le comportement de l'agent n'a été essayé que sur une question (refus hors sujet).
- L'interface `/v1` de l'assistant n'a pas d'authentification : elle ne doit être joignable que depuis l'hôte d'Open WebUI, jamais depuis Internet.

## Licence

Licence MIT (fichier `LICENSE`). Le copyright est attribué à la HES-SO, qui détient les droits sur les travaux réalisés dans le cadre de la formation. Cette attribution est une hypothèse du groupe, à faire confirmer par l'enseignant.
