# Journal des changements

Format : date, changement, preuve ou référence. Seuls les faits constatés sont consignés ; le détail est dans le guide (`docs/`).

## 2026-10-25
- Documents mis à jour : guide (sections 6.10 à 6.13, calendrier, décisions), architecture v2 (état réel), déroulé de la démonstration (`docs/demo/deroule-demonstration.md`, écrit avant les essais).
- `scripts/run_scenarios.py` : pose les questions de refus (S1, S2, S4, S6) à l'assistant et note les réponses ; testé seulement contre un faux serveur. Scénario S6 ajouté au plan de tests (13 scénarios).
- Hôte EC2 écrit dans `envs/aws/infra` (`host.tf` et modèles) : assistant et Open WebUI en Docker Compose, rôle limité au modèle Bedrock choisi et à la lecture de deux secrets SSM, accès par session SSM. Syntaxe validée avec `tofu validate`, **jamais lancé** (commit bd06730, SSM : 5c550b5).
- Instance `t3.small` : Open WebUI occupait ≈ 0,7 Gio sur Kind (relevé du 17.10) ; la mémoire de l'ensemble sur AWS n'est pas mesurée.
- Image de l'assistant poussée en `linux/amd64` dans le registre GitLab du projet (construction `buildx` depuis un Mac arm64, 50 s) ; architecture vérifiée dans le registre. Jeton de déploiement GitLab en lecture seule créé.
- `scripts/aws-up.sh` : contrôle des variables et du jeton avant toute création, attente d'Open WebUI en fin de déploiement (commit a164eb4). Classe de stockage `gp3` par défaut (e080bb0).
- Plan de tests : 12 scénarios au départ, 14 aujourd'hui (S6 et S7 ajoutés) (`docs/tests/plan-de-tests.md`, commit b3b3979).
- Refus de l'assistant essayés en local avec Bedrock (S1, S2, S4, S6, S7 : 14 questions, un essai chacune) : 14 réponses conformes à notre lecture, un écart sur la question mixte de S7. Détail brut dans `docs/tests/resultats/2026-10-25-local-bedrock.md` (commit cf68027).
- Bedrock : appel réel du modèle `mistral.mistral-large-3-675b-instruct` réussi malgré le retrait des droits IAM et EKS ; le modèle n'apparaît pas dans la liste par fournisseur Mistral (cause inconnue).

## 2026-10-24
- Deuxième exécution AWS. Droits IAM et EKS retirés pour l'utilisateur à 15h17 (cause inconnue, `AccessDenied`) alors qu'un cluster de test était en marche (≈ 0,48 $/h). Demande envoyée dans le canal Teams du cours ; aucun contournement tenté. Constat inchangé le 25.10 à 00h32.
- Pilote de disques EBS en échec (`no EC2 IMDS role found`, première exécution) : limite de sauts des métadonnées passée à 2 ; vérifié (module en 47 s, contrôleurs 6/6).
- Volumes en attente (aucune classe de stockage par défaut sur EKS) : classe `gp3` par défaut ; pods Mimir et Loki en `Running`. Alloy et Grafana n'ont pas été installés.
- Audit : le verdict ne tenait pas compte des ressources trouvées (variable perdue dans un sous-processus) ; corrigé et confirmé par l'utilisateur.

## 2026-10-23
- Première exécution AWS complète (création puis destruction) : cluster ≈ 10 à 11 min, groupe de nœuds 1 à 2 min, modules complémentaires 16 à 47 s ; destruction : groupe de nœuds 8 min, passerelle Internet 7 min, cluster 3 min ; audit final « rien trouvé ». Coût estimé ≈ 0,45 $ (calcul, pas une facture).
- Environnement `envs/aws/infra` (réseau, EKS, S3, droits) et `envs/aws/stack` (Mimir, Loki, Alloy, Grafana), scripts `aws-up`, `aws-down`, `aws-audit`, `aws-allow-ip`. Préfixe `g13-p5`, étiquettes `Project`, `Group`, `Owner`.

## 2026-10-22
- Retour du professeur : Switch Cloud abandonné au profit d'AWS (`us-east-1`) ; LLM hébergé localement abandonné au profit d'un modèle public ; l'assistant sort du cluster surveillé. Mimir, Loki, Alloy et Grafana restent dans le cluster ; l'assistant et Open WebUI iront sur une instance EC2.
- Compte AWS (lu avec le CLI) : utilisateur IAM du groupe `students` avec la politique `AdministratorAccess` ; `aws eks list-clusters` renvoie une liste vide.
- LLM : Amazon Bedrock plutôt qu'une API publique. OpenAI exige un crédit prépayé (5 $ minimum) ; le niveau gratuit de Gemini est exclu pour des utilisateurs en Suisse (conditions d'utilisation). Mistral Large 3 : appel d'outils vérifié sur le compte du projet (un essai, 439 ms, 126 tokens).
- Open WebUI ne parle pas directement à Bedrock (proxy requis d'après sa documentation) : l'assistant expose une interface compatible OpenAI (`/v1/chat/completions`) et Open WebUI le voit comme un modèle. Commit f242ee1 sur `dev/nicolas`.
- Test de l'image `assistant:0.5.0` avec Bedrock (un essai) : la question hors sujet sur la météo est refusée en un appel (1 593 tokens en entrée, 19 en sortie).
- Dimensionnement d'EKS : 2 × `m5.xlarge` (0,192 $/h chacun d'après l'API de prix, `us-east-1`), plan de contrôle à 0,10 $/h ; à ajuster après la première mesure.
- Une branche Git par membre (`dev/nicolas`) ; seul son propriétaire y pousse.
- Documentation mise à jour pour la cible AWS : README, guide (section 4.12, chapitre 6), architecture v2 (`docs/architecture/Group-13-Architecture-v2.docx`, nouveau fichier ; version 1 inchangée). Rien n'est encore exécuté sur AWS.

## 2026-10-19
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
