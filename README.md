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

## Où en est chaque livrable (au 25 octobre 2026)

| Livrable du sujet | Où le trouver | État |
|---|---|---|
| 1. Exigences et architecture | [`docs/architecture/`](docs/architecture/) (version 2 à jour, document d'origine conservé) ; [guide](docs/Projet5-Stack-Observabilite-Kubernetes.docx) | Fait |
| 2. Environnement d'observabilité | [local](docs/deploiement-local.md) ; [AWS](docs/deploiement-aws.md) ; code dans `envs/`, `modules/`, `scripts/` | **Local : fait**, exécuté de bout en bout (test de fumée 6 sur 6). **AWS : partiel**, voir ci-dessous |
| 3. Assistant IA | [`assistant/`](assistant/) | **Fait en local** (Ollama). Avec Bedrock : version écrite, seuls les refus ont été essayés. Hôte AWS : écrit, jamais lancé |
| 4. Rapport de tests | [`docs/tests/plan-de-tests.md`](docs/tests/plan-de-tests.md), [résultats](docs/tests/resultats/) | **Partiel** : plan de 14 scénarios ; 15 questions de refus et de contrôle essayées ; cas d'usage et pannes non exécutés |
| 5. Démonstration | [`docs/demo/deroule-demonstration.md`](docs/demo/deroule-demonstration.md) | **À faire** : déroulé écrit, captures d'écran à produire |

**Ce qui bloque AWS.** L'infrastructure (réseau, EKS, S3, droits) a été créée et détruite par script deux fois (23 et 24 octobre).
Mimir et Loki ont démarré, mais Alloy et Grafana n'ont jamais été installés : les droits AWS de l'étudiant ont été retirés le
24 octobre à 15h17, sans cause connue, alors qu'un cluster de test était en marche. L'hôte de l'assistant est écrit et sa syntaxe
est validée, mais il n'a jamais été lancé. Détail : [déploiement AWS](docs/deploiement-aws.md).

## Architecture cible

```
Compte AWS, région us-east-1
  ├─ Cluster EKS (surveillé)       Alloy ──▶ Mimir, Loki ──▶ Amazon S3 ; Grafana
  ├─ Instance EC2 (hors cluster)   Open WebUI ──▶ assistant ──▶ Mimir, Loki
  └─ Amazon Bedrock                Mistral Large 3, appelé par l'assistant
```

Le professeur a demandé que l'assistant ne tourne pas dans le cluster qu'il surveille (retour du 22.10.2026). Mimir et Loki
n'ont pas d'authentification : ils ne sont jamais exposés sur Internet. Le schéma complet est dans le
[document d'architecture](docs/architecture/Group-13-Architecture-v2.docx).

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

Dans Open WebUI, ouvrez une nouvelle conversation pour chaque question et dépliez le résultat de l'outil : c'est là qu'on voit
les requêtes réellement exécutées.

## Documentation

- [`docs/Projet5-Stack-Observabilite-Kubernetes.docx`](docs/Projet5-Stack-Observabilite-Kubernetes.docx) : le guide complet (installation, décisions et justifications, mesures, échecs et corrections, points ouverts). Se régénère avec `make docs`.
- [`docs/architecture/`](docs/architecture/) : le document d'architecture soumis (`Group-13-Architecture.pdf` et `.docx`, **conservés tels quels**) et sa mise à jour [`Group-13-Architecture-v2.docx`](docs/architecture/Group-13-Architecture-v2.docx).
- [`docs/deploiement-local.md`](docs/deploiement-local.md), [`docs/deploiement-aws.md`](docs/deploiement-aws.md) : mode d'emploi détaillé.
- [`docs/tests/plan-de-tests.md`](docs/tests/plan-de-tests.md) et [`docs/demo/deroule-demonstration.md`](docs/demo/deroule-demonstration.md).
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
scripts/                  local : preflight, secrets, Garage, Open WebUI, test de fumée ; AWS : aws-up, aws-down, aws-audit ; tests de refus
docs/                     guide, architecture, déploiements, tests, démonstration
```

## Limites connues

- Les secrets (mots de passe, clés S3) sont en clair dans les valeurs Helm et dans le fichier d'état OpenTofu : acceptable pour un cluster local jetable, pas pour la production.
- L'assistant n'a ni authentification ni NetworkPolicy ; Open WebUI est prévu pour un seul administrateur.
- L'agent (`qwen3:8b`) produit parfois une requête PromQL mal formée et peut renoncer ; le test de fumée vérifie qu'un outil est appelé, pas que la réponse est utile.
- Les variables d'environnement d'Open WebUI ne servent qu'au premier démarrage : les modifier ensuite n'a aucun effet sans supprimer son volume.
- Rien n'a été mesuré sur la fiabilité des réponses sur un jeu de questions étendu. Avec Bedrock, seuls les **refus** ont été essayés (15 questions, un essai chacune, 14 réponses conformes à notre lecture et une partielle, en local, le 25.10.2026 : [résultats](docs/tests/resultats/2026-10-25-local-bedrock.md)). Les cas d'usage (santé du cluster, incident, cause racine) n'ont pas été essayés avec ce modèle.
- L'interface `/v1` de l'assistant n'a pas d'authentification : elle ne doit être joignable que depuis l'hôte d'Open WebUI, jamais depuis Internet.
- Sur AWS, Open WebUI est servi en HTTP simple (sans chiffrement) sur le port 3000, limité à nos adresses : acceptable pour une preuve de concept, pas pour la production.
- Les nœuds EKS ont une adresse publique (pas de passerelle NAT, pour limiter le coût) ; l'accès à l'API Kubernetes et à l'interface est limité à nos adresses IP.
- L'assistant s'adresse à un seul nœud EKS pour joindre Mimir et Loki : si ce nœud est remplacé, l'hôte doit être recréé.

## Licence

Licence MIT (fichier `LICENSE`). Le copyright est attribué à la HES-SO, qui détient les droits sur les travaux réalisés dans le cadre de la formation. Cette attribution est une hypothèse du groupe, à faire confirmer par l'enseignant.
