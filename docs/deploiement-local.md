# Déploiement local (Kind)

Version de test du projet : tout tourne dans un seul cluster Kind sur un portable, avec le modèle de langage Ollama dans
le cluster. **Aucune donnée ne quitte la machine.** Le cluster surveillé et l'assistant sont dans le même cluster : ce n'est
pas l'architecture cible (voir le [README](../README.md) et le [déploiement AWS](deploiement-aws.md)).

Version de l'assistant déployée par le `Makefile` local : 0.4.3 (Ollama). L'image 0.5.0 (Bedrock, interface `/v1`) est celle de l'hôte AWS.

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

Les choix techniques et leurs justifications sont dans le [guide](Projet5-Stack-Observabilite-Kubernetes.docx) (tableau des décisions et sections 3 et 4).

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
