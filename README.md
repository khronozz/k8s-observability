# Surveiller un cluster Kubernetes avec une IA : pile d'observabilité et assistant en lecture seule

Projet 5 du cours *Cloud Services and Systems* (HES-SO Master, groupe 13) : « Monitoring Kubernetes clusters with AI ».

Ce dépôt contient tout ce qu'il faut pour monter, **d'abord en local sur Kind, puis sur AWS (EKS)**, une pile qui collecte les
métriques et les logs d'un cluster Kubernetes et permet de les interroger en langage naturel. **En local, aucune donnée ne quitte la
machine** ; sur AWS, l'assistant appellera Amazon Bedrock (voir « Pourquoi ce projet »).

> **État honnête (25.10.2026)** : le déploiement **local (Kind)** a été exécuté de bout en bout, une fois sans intervention
> (`make local-all`, test de fumée 6 contrôles sur 6). Le déploiement **AWS a été exécuté deux fois** : l'infrastructure (réseau, EKS, S3, droits)
> se crée et se détruit avec des scripts, mais la pile complète n'a **jamais tourné jusqu'au bout** : Mimir et Loki étaient en marche, Alloy et
> Grafana n'ont pas été installés, car les droits AWS de l'utilisateur ont été retirés le 24.10.2026 à 15h17 (cause inconnue). L'**hôte EC2**
> (assistant + Open WebUI) est écrit et sa syntaxe est validée, mais il n'a **jamais été lancé**. Le déploiement Switch Cloud, jamais exécuté, est **abandonné**.
> Détail : section « Déploiement sur AWS » ci-dessous, [plan de tests](docs/tests/plan-de-tests.md) (aucun résultat encore),
> [guide](docs/Projet5-Stack-Observabilite-Kubernetes.docx).

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

## Déploiement sur AWS (partiellement exécuté)

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

### Architecture cible

```
Compte AWS, région us-east-1
  ├─ Cluster EKS (surveillé)       Alloy ──▶ Mimir, Loki ──▶ Amazon S3 ; Grafana        (2 nœuds m5.xlarge : 4 vCPU, 16 Gio chacun)
  ├─ Instance EC2 (hors cluster)   Open WebUI ──▶ assistant (/v1) ──▶ Mimir, Loki       (t3.small, Docker Compose ; port 3000 limité à nos adresses)
  └─ Amazon Bedrock                Mistral Large 3, appelé par l'assistant              (rôle de l'instance, limité à ce modèle)
```

L'assistant joint Mimir et Loki par deux ports ouverts sur les nœuds (NodePort 30090 et 30310), accessibles **seulement depuis le groupe de
sécurité de l'hôte**. Mimir et Loki n'ont pas d'authentification : ils ne doivent jamais être joignables depuis Internet.
Les images viennent du registre GitLab du projet (image `linux/amd64`, jeton de déploiement en lecture seule).

### Comment l'utiliser

```bash
make aws-up        # crée tout (≈ 0,48 $/h pour le cluster) : lit .work/registry-token et envs/aws/infra/terraform.tfvars
make aws-audit     # liste ce qui reste (lecture seule)
make aws-down      # détruit tout, puis lance l'audit
make aws-allow-ip  # ajoute l'adresse IP actuelle aux adresses autorisées (changement de lieu)
```

Avant le premier lancement : copier `envs/aws/infra/terraform.tfvars.example` en `terraform.tfvars` et le compléter (`kubernetes_version`,
`assistant_image`, `registry_username`), pousser l'image de l'assistant dans le registre (`docker buildx build --platform linux/amd64 ... --push`),
et écrire le jeton de déploiement GitLab dans `.work/registry-token` (une ligne, droits 600, ignoré par Git). Le jeton ne doit jamais être
collé dans un message, un ticket ou un fichier versionné.

Règle de nommage : toutes nos ressources portent le préfixe `g13-p5` (groupe 13, projet 5) et les étiquettes `Project`, `Group`, `Owner`.
**Nous ne touchons à rien qui n'a pas ce préfixe ni ces étiquettes** : le compte peut être partagé avec d'autres étudiants.

### Ce qui a été observé

| Date | Point | Résultat observé |
|---|---|---|
| 22.10 | Identité AWS | utilisateur IAM, groupe `students`, politique `AdministratorAccess` à cette date |
| 22.10 | Bedrock, Mistral Large 3 | appel d'outils fonctionnel (1 essai : `stopReason: tool_use`, 439 ms, 126 tokens) |
| 22.10 | Image `assistant:0.5.0` | construite sur Mac ; 58 tests pytest avec faux modèles ; question sur la météo refusée avec Bedrock (1 essai) |
| 23.10 | Première exécution complète (création puis destruction) | création du cluster ≈ 10 à 11 min, groupe de nœuds 1 à 2 min, modules complémentaires 16 à 47 s ; destruction : groupe de nœuds 8 min, passerelle Internet 7 min, cluster 3 min ; audit final « rien trouvé » ; coût estimé ≈ 0,45 $ pour ≈ 56 min (calcul d'après les prix, **pas** une facture) |
| 23.10 | Accès `kubectl` à EKS avec le CLI AWS version 1 | fonctionne (`aws eks update-kubeconfig`) |
| 23.10 puis 24.10 | Pilote de disques EBS en échec (`no EC2 IMDS role found`) à la première exécution | corrigé en passant la limite de sauts des métadonnées à 2 sur les nœuds ; vérifié à la deuxième exécution (module en 47 s, contrôleurs 6/6) |
| 24.10 | Disques des composants en attente (aucune classe de stockage par défaut sur EKS) | classe `gp3` par défaut ajoutée (`envs/aws/stack/storageclass.yaml`) ; les volumes se sont liés et les pods Mimir et Loki sont passés en `Running` |
| 24.10, 15h17 | Droits IAM et EKS retirés pour l'utilisateur | `AccessDenied` (« no identity-based policy allows... ») pour IAM et EKS ; Bedrock et l'identité restent utilisables. Cause inconnue ; demande envoyée dans le canal Teams du cours. Constaté encore le 25.10 à 00h32 |
| 25.10 | Bedrock après le retrait des droits | appel du modèle `mistral.mistral-large-3-675b-instruct` réussi (11 tokens). Ce modèle n'apparaît pas dans la liste filtrée par fournisseur Mistral (cause inconnue) |
| 25.10 | Registre GitLab | image de l'assistant poussée en `linux/amd64` et vérifiée dans le registre |

### Ce qui n'est pas vérifié

- **L'hôte EC2** n'a jamais été lancé : accès au registre depuis AWS, lecture des secrets dans SSM, appel de Bedrock depuis le rôle de l'instance
  (autorisation sur le modèle), versions de Docker Compose et d'Open WebUI choisies, étiquette qui permet de retrouver les nœuds EKS, accès par session SSM.
- Alloy et Grafana n'ont jamais été installés sur AWS ; l'écriture de Mimir et Loki dans S3 n'a pas été constatée (pods `Running`, mais aucune donnée relue).
- Les durées de déploiement de Mimir et Loki avec Helm ; l'état des composants Helm marqués échoués (ils ont dépassé leur délai avant la classe de stockage).
- La mémoire réelle de l'hôte (`t3.small`, 2 Gio : Open WebUI occupait ≈ 0,7 Gio sur Kind, le reste n'est pas mesuré).
- Crédits AWS restants et responsabilité de la facture (page des crédits : 0 $ de crédits visibles ; les étudiants ont été informés oralement que l'école paie ; le courriel du 15.10 ne le dit pas).
- Les trois cas d'usage et les refus hors sujet avec le vrai modèle : voir le [plan de tests](docs/tests/plan-de-tests.md), aucun résultat encore.

### Pièges rencontrés (utile à qui reprend)

- Les nœuds EKS exigent une limite de sauts des métadonnées de 2 : sinon les pods n'atteignent pas les droits du nœud (EBS) ; même chose pour les conteneurs de l'hôte.
- EKS n'a pas de classe de stockage utilisable par défaut : sans elle, les volumes restent en attente et Helm dépasse son délai.
- Sur macOS, `sed` retient la sortie dans un tube : utiliser `sed -l` ; `caffeinate -i` évite la mise en veille pendant les attentes longues.
- Les sorties de commandes AWS peuvent contenir le numéro de compte, y compris dans les messages d'erreur : le masquer avant de coller quoi que ce soit.
- Une destruction doit supprimer les volumes (PVC) **avant** le cluster, sinon des disques restent facturés.

### Coûts (prix à la demande, `us-east-1`, lus avec l'API de prix AWS le 22.10.2026)

| Poste | Prix |
|---|---|
| `m5.xlarge` (4 vCPU, 16 Gio) | 0,192 $/h par nœud, soit 0,384 $/h pour 2 nœuds |
| Plan de contrôle EKS (support standard) | 0,10 $/h (page de prix AWS) |
| Mistral Large 3 (Bedrock) | 0,50 $ en entrée et 1,50 $ en sortie par million de tokens |

Nœuds et plan de contrôle : **0,484 $/h**, soit environ 11,60 $ par jour si le cluster est oublié. L'instance EC2, les volumes et le trafic ne sont
**pas encore chiffrés**. Règle du groupe : sessions courtes et planifiées, destruction et audit après chaque session.

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
envs/aws/infra/           AWS, étape 1 : réseau, EKS, S3, droits, hôte EC2 (assistant + Open WebUI) ; envs/aws/stack/ : étape 2 (Mimir, Loki, Alloy, Grafana)
kind/                     configuration du cluster local
scripts/                  local : preflight, secrets, Garage, Open WebUI, test de fumée ; AWS : aws-up, aws-down, aws-audit, aws-allow-ip ; scripts SCK/SCS3 (abandonnés)
manual/local/             valeurs Helm de l'installation manuelle testée (référence)
docs/                     guide (DOCX), sources du guide (guide-src/), architecture (architecture/), plan de tests (tests/)
.gitlab/issue_templates/  modèle de ticket « Test / découverte »
```

## Documentation

- [`docs/Projet5-Stack-Observabilite-Kubernetes.docx`](docs/Projet5-Stack-Observabilite-Kubernetes.docx) : le guide (installation manuelle, automatisation, décisions et justifications, mesures, échecs et corrections, points ouverts). Régénérer : `make docs`.
- [`docs/architecture/`](docs/architecture/) : le document d'architecture soumis (`Group-13-Architecture.pdf` et `.docx`), **conservé tel quel, ne pas le modifier**, et sa mise à jour [`Group-13-Architecture-v2.docx`](docs/architecture/Group-13-Architecture-v2.docx) (cible AWS, assistant hors cluster).
- [`docs/tests/plan-de-tests.md`](docs/tests/plan-de-tests.md) : les 12 scénarios de test (cas d'usage, refus, pannes), résultats à remplir.
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
- Sur AWS, Open WebUI est servi en HTTP simple (sans chiffrement) sur le port 3000, limité à nos adresses : acceptable pour une preuve de concept, pas pour la production.
- Les nœuds EKS ont une adresse publique (pas de passerelle NAT, pour limiter le coût) ; l'accès à l'API Kubernetes et à l'interface est limité à nos adresses IP.
- L'assistant s'adresse à un seul nœud EKS pour joindre Mimir et Loki : si ce nœud est remplacé, l'hôte doit être recréé.

## Licence

Licence MIT (fichier `LICENSE`). Le copyright est attribué à la HES-SO, qui détient les droits sur les travaux réalisés dans le cadre de la formation. Cette attribution est une hypothèse du groupe, à faire confirmer par l'enseignant.
