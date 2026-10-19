# Journal des changements

Format : date, changement, preuve ou référence. Seuls les faits constatés sont consignés ; le détail est dans le guide (`docs/`).

## 2026-10-19
- Licence MIT ajoutée (`LICENSE`), copyright attribué à la HES-SO ; titularité des droits à confirmer par l'enseignant.
- Dépôt publié sur la forge HEFR (privé).
- Test de `think: false` pour la passe de recopie d'Open WebUI : retenu par défaut (`scripts/webui-bootstrap.sh`). Génération de la passe de recopie : 24,7 s → 7,9 s d'après les logs Ollama (comparaison indicative). Guide, section 4.11.
- `webui_timeout_seconds` (1800 s) : le téléchargement de l'image d'Open WebUI a dépassé l'ancien délai de 600 s (12 min 44 s mesurés).
- Test de fumée : le contrôle des pods réessaie pendant 5 min (faux échec juste après le déploiement).
- `scripts/webui-bootstrap.sh` attend `/health` : « Connection refused » juste après le déploiement, le pod n'ayant pas de sonde de disponibilité.
- `scripts/credentials.sh` relit les identifiants dans le cluster si le fichier de secrets est absent.
- `envs/local/.terraform.lock.hcl` ajouté (fournisseur Helm 2.17.0).
- `make local-down && make local-all` : première réussite d'un seul tenant sur Kind (quatrième exécution complète).
- Dépôt organisé pour GitLab : `docs/`, `.gitignore` complété, modèle de ticket, `make check-secrets`, `make docs`.

## 2026-10-18
- Module OpenTofu étendu à Ollama (chart otwld 1.88.0, modèle téléchargé par le chart), à l'assistant (chart local) et à la configuration d'Open WebUI.
- `scripts/webui-bootstrap.sh` : le prompt système d'un modèle n'est appliqué qu'avec une entrée de modèle en base (lecture du code d'Open WebUI v0.12.0, constaté « Je suis Qwen »).
- Assistant 0.4.3 : banc d'essai 0.4.2 contre 0.4.3 (guide, section 4.10). Chart Garage figé sur un commit.

## 2026-10-14 au 2026-10-16
- Installation manuelle sur Kind (Mimir, Loki, k8s-monitoring, Grafana, Open WebUI) puis Step 3 (Ollama, assistant, liaison Open WebUI), guide sections 2 et 4.
