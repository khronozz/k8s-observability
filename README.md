# Surveiller un cluster Kubernetes avec une IA

Projet 5 du cours *Cloud Services and Systems* (HES-SO Master, groupe 13) : « Monitoring Kubernetes clusters with AI ».

## En bref

Un ingénieur pose une question en français (« Quels pods consomment le plus de mémoire ? », « Que se passe-t-il avec ce pod ? »).
Un assistant IA va chercher lui-même les métriques et les logs du cluster Kubernetes, puis répond en indiquant les requêtes
qu'il a utilisées, pour que la réponse puisse être vérifiée.

- L'assistant est en **lecture seule** : il ne peut rien modifier dans le cluster.
- Les métriques et les logs sont collectés par Alloy, stockés dans Mimir et Loki (outils de Grafana) et consultables dans Grafana.
- **Cible : AWS.** Le cluster surveillé (EKS) est séparé de la machine qui héberge l'assistant et son interface de chat
  (Open WebUI). Le modèle de langage est Amazon Bedrock (Mistral Large 3).
- **Version de test : en local** (Kind), tout dans un seul cluster, avec un modèle Ollama. Aucune donnée ne quitte la machine.

## Où en est chaque livrable (au 28 octobre 2026)

| Livrable du sujet | Où le trouver | État |
|---|---|---|
| 1. Exigences et architecture | [`docs/architecture/`](docs/architecture/) (version 3 à jour ; versions 1 et 2 conservées) ; [guide](docs/Projet5-Stack-Observabilite-Kubernetes.docx) | Fait |
| 2. Environnement d'observabilité | [local](docs/deploiement-local.md) ; [AWS](docs/deploiement-aws.md) ; code dans `envs/`, `modules/`, `scripts/` | **Local : fait**, exécuté de bout en bout (test de fumée 6 sur 6). **AWS : déployé le 27 octobre** (EKS, Mimir, Loki, Alloy, Grafana, S3) ; Mimir et Loki écrivent bien dans S3 (relevé du 28.10 : 37 objets côté Mimir, 468 côté Loki) |
| 3. Assistant IA | [`assistant/`](assistant/) | **Fait**, version 0.5.12 en service sur l'hôte AWS (Docker Compose, Open WebUI + assistant, Amazon Bedrock). Défauts connus : voir le [plan d'amélioration](docs/plan-amelioration.md) |
| 4. Rapport de tests | [`docs/tests/plan-de-tests.md`](docs/tests/plan-de-tests.md), [résultats](docs/tests/resultats/) | **Fait, avec réserves** : 15 scénarios (cas d'usage F1 à F5, refus S1 à S7, pannes R1 à R3) exécutés sur AWS les 27 et 28 octobre, résultats et défauts dans le plan. R3 a été remplacé par une variante (mauvais identifiant de modèle). Peu d'essais par scénario |
| 5. Démonstration | [`docs/demo/deroule-demonstration.md`](docs/demo/deroule-demonstration.md) | **À faire** : déroulé écrit, captures d'écran à produire |

**AWS.** Les 23 et 24 octobre, l'infrastructure a été créée et détruite par script, puis les droits AWS de l'étudiant ont été
retirés le 24 octobre à 15h17. Selon l'assistant du cours (message du 26 octobre), il s'agit d'une suppression accidentelle de
permissions qui a touché plusieurs groupes, et nos scripts n'en sont pas la cause. Depuis le 27 octobre, le déploiement complet
tourne (cluster EKS surveillé, hôte de l'assistant séparé). Détail : [déploiement AWS](docs/deploiement-aws.md).

## Architecture cible

```
Compte AWS, région us-east-1
  ├─ Cluster EKS (surveillé)       Alloy ──▶ Mimir, Loki ──▶ Amazon S3 ; Grafana
  ├─ Instance EC2 (hors cluster)   Open WebUI ──▶ assistant ──▶ Mimir, Loki
  └─ Amazon Bedrock                Mistral Large 3, appelé par l'assistant
```

Le professeur a demandé que l'assistant ne tourne pas dans le cluster qu'il surveille (retour du 22.10.2026). Mimir et Loki
n'ont pas d'authentification : ils ne sont jamais exposés sur Internet. Le schéma complet est dans le
[document d'architecture](docs/architecture/Group-13-Architecture-v4.docx).

## Démarrage rapide

**En local** (Mac, Docker Desktop, 15 Gio de mémoire pour Docker) :

```bash
make preflight     # vérifie les outils, ne modifie rien
make local-all     # crée tout, de zéro (au moins 15 à 21 minutes, à cause du téléchargement du modèle)
make pf-webui      # interface de chat sur http://localhost:8080 (identifiants : make local-credentials)
make local-down    # supprime tout
```

**Sur AWS** : demande un compte AWS avec les droits nécessaires, une image de l'assistant dans un registre et un jeton de lecture
de ce registre. Le cluster coûte environ **0,48 $ par heure** tant qu'il existe : `make aws-down` le détruit, puis contrôle
qu'il ne reste rien. Le mode d'emploi est dans le [déploiement AWS](docs/deploiement-aws.md).

Dans Open WebUI, ouvrez une nouvelle conversation pour chaque question. Sur **AWS** (version 0.5.11 et suivantes), les outils
appelés et leurs arguments sont listés sous la réponse (« Outils appelés ») ; pour `promql_instant` et `promql_range`, l'argument est la requête PromQL, qu'on peut rejouer dans Grafana. En **local**, il faut déplier le résultat de l'outil.

## Documentation

- [`docs/Projet5-Stack-Observabilite-Kubernetes.docx`](docs/Projet5-Stack-Observabilite-Kubernetes.docx) : le guide complet (installation, décisions et justifications, mesures, échecs et corrections, points ouverts). Se régénère avec `make docs`.
- [`docs/architecture/`](docs/architecture/) : le document d'architecture soumis (`Group-13-Architecture.pdf` et `.docx`, **conservés tels quels**) et ses mises à jour : [`Group-13-Architecture-v2.docx`](docs/architecture/Group-13-Architecture-v2.docx) (25.10, déploiement AWS partiel) , [`Group-13-Architecture-v3.docx`](docs/architecture/Group-13-Architecture-v3.docx) (28.10, schéma AWS) et [`Group-13-Architecture-v4.docx`](docs/architecture/Group-13-Architecture-v4.docx) (28.10, ajoute les exigences ; version à jour).
- [`docs/deploiement-local.md`](docs/deploiement-local.md), [`docs/deploiement-aws.md`](docs/deploiement-aws.md) : mode d'emploi détaillé.
- [`docs/tests/plan-de-tests.md`](docs/tests/plan-de-tests.md), [`docs/plan-amelioration.md`](docs/plan-amelioration.md) (limites et corrections classées par priorité) et [`docs/demo/deroule-demonstration.md`](docs/demo/deroule-demonstration.md).
- [`CHANGELOG.md`](CHANGELOG.md) : journal daté des changements. [`CONTRIBUTING.md`](CONTRIBUTING.md) : travail à plusieurs (branches, secrets).

## Contenu du dépôt

```
Makefile                  toutes les commandes (make help)
assistant/                code de l'assistant (FastAPI + LangChain/LangGraph ; LLM Ollama ou Bedrock), Dockerfile, tests
charts/assistant/         chart Helm de l'assistant
modules/observability/    module OpenTofu partagé (Mimir, Loki, Alloy, Grafana, Ollama, assistant, Open WebUI)
envs/local/               assemblage Kind (Garage + module)
envs/aws/                 assemblage AWS : infra/ (réseau, EKS, S3, droits, hôte EC2) puis stack/ (Mimir, Loki, Alloy, Grafana)
envs/switch/              Switch Cloud : ABANDONNÉ, jamais exécuté, conservé en référence
scripts/                  local : preflight, secrets, Garage, Open WebUI, test de fumée ; AWS : aws-up, aws-down, aws-audit, aws-redo-host (remplace l'hôte), aws-run-scenarios (tests de refus sur l'hôte) ; tests de refus
docs/                     guide, architecture, déploiements, tests, démonstration
```

## Limites connues

- Les secrets (mots de passe, clés S3) sont en clair dans les valeurs Helm et dans le fichier d'état OpenTofu : acceptable pour un cluster local jetable, pas pour la production.
- L'assistant n'a ni authentification ni NetworkPolicy ; Open WebUI est prévu pour un seul administrateur.
- L'agent (`qwen3:8b`) produit parfois une requête PromQL mal formée et peut renoncer ; le test de fumée vérifie qu'un outil est appelé, pas que la réponse est utile.
- Les variables d'environnement d'Open WebUI ne servent qu'au premier démarrage : les modifier ensuite n'a aucun effet sans supprimer son volume.
- La fiabilité des réponses n'a pas été mesurée sur un jeu de questions étendu : un à sept essais par scénario, résultats dans le [plan de tests](docs/tests/plan-de-tests.md). Les refus et la santé générale sont corrects dans nos essais ; la description d'un incident, d'un nœud ou d'un service est juste sur l'essentiel mais contient des affirmations fausses ou non vérifiées (conclusions tirées d'un résultat vide, nombres de lignes plafonnés présentés comme totaux, durées mal lues). Détail et corrections proposées : [plan d'amélioration](docs/plan-amelioration.md).
- L'interface `/v1` de l'assistant n'a pas d'authentification : elle ne doit être joignable que depuis l'hôte d'Open WebUI, jamais depuis Internet.
- Sur AWS, Open WebUI est servi en HTTP simple (sans chiffrement) sur le port 3000, limité à nos adresses : acceptable pour une preuve de concept, pas pour la production.
- Les nœuds EKS ont une adresse publique (pas de passerelle NAT, pour limiter le coût) ; l'accès à l'API Kubernetes et à l'interface est limité à nos adresses IP.
- L'assistant s'adresse à un seul nœud EKS pour joindre Mimir et Loki : si ce nœud est remplacé, l'hôte doit être recréé.

## Licence

Licence MIT (fichier `LICENSE`). Le copyright est attribué à la HES-SO, qui détient les droits sur les travaux réalisés dans le cadre de la formation. Cette attribution est une hypothèse du groupe, à faire confirmer par l'enseignant.
