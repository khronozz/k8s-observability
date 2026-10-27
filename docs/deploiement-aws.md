# Déploiement sur AWS

Cible demandée par le professeur le 22.10.2026. **Partiellement exécuté** : voir l'état exact dans la section
« Ce qui a été observé » et le [README](../README.md).


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

## Architecture cible

```
Compte AWS, région us-east-1
  ├─ Cluster EKS (surveillé)       Alloy ──▶ Mimir, Loki ──▶ Amazon S3 ; Grafana        (2 nœuds m5.xlarge : 4 vCPU, 16 Gio chacun)
  ├─ Instance EC2 (hors cluster)   Open WebUI ──▶ assistant (/v1) ──▶ Mimir, Loki       (t3.small, Docker Compose ; port 3000 limité à nos adresses)
  └─ Amazon Bedrock                Mistral Large 3, appelé par l'assistant              (rôle de l'instance, limité à ce modèle)
```

L'assistant joint Mimir et Loki par deux ports ouverts sur les nœuds (NodePort 30090 et 30310), accessibles **seulement depuis le groupe de
sécurité de l'hôte**. Mimir et Loki n'ont pas d'authentification : ils ne doivent jamais être joignables depuis Internet.
Les images viennent du registre GitLab du projet (image `linux/amd64`, jeton de déploiement en lecture seule).

## Comment l'utiliser

```bash
make aws-check      # vérification préalable : droits, limites du compte, versions, registre, plan OpenTofu (ne crée pas de cluster)
make aws-up         # crée tout (≈ 0,48 $/h pour le cluster) : lance d'abord la vérification, puis lit .work/registry-token et terraform.tfvars
make aws-audit      # liste ce qui reste (lecture seule)
make aws-down       # détruit tout, puis lance l'audit
make aws-allow-ip   # ajoute l'adresse IP actuelle aux adresses autorisées (changement de lieu), sans rien appliquer d'autre
make aws-redo-host  # refait SEULEMENT l'hôte EC2 si son démarrage a échoué (le cluster et les buckets restent)
```

**Principe pour limiter les attentes inutiles** (décidé le 27.10.2026 après les essais des 23, 24 et 26.10) :
- La vérification préalable (`aws-check`, lancée par `aws-up`) cherche en une à deux minutes ce qui ferait échouer le déploiement après 10 ou 20 minutes.
  Elle crée puis supprime aussitôt quelques objets de test pour contrôler les droits d'écriture (paramètre SSM, rôle IAM, bucket S3). Elle ne peut pas vérifier
  la création d'un cluster EKS, `iam:PassRole`, l'agent SSM de l'hôte, ni l'accès de l'hôte au registre depuis AWS : ces points se constatent au premier lancement.
- `aws-up` peut être relancé après un échec : il reprend où il s'est arrêté. Les délais d'attente ne détruisent rien : OpenTofu n'attend plus Helm (variable
  `helm_wait`), c'est le script qui attend l'état réel des pods (40 min au plus). Un délai dépassé laissait auparavant les composants « failed » dans l'état,
  et la relance les détruisait pour les recréer.
- Si seul l'hôte échoue, `aws-redo-host` le recrée en quelques minutes au lieu de tout détruire. Son script de démarrage réessaie chaque étape réseau
  6 fois, annonce `G13-OK` ou `G13-ECHEC` dans la sortie console de l'instance, et `aws-up` s'arrête dès qu'il lit `G13-ECHEC`.

Avant le premier lancement : copier `envs/aws/infra/terraform.tfvars.example` en `terraform.tfvars` et le compléter (`kubernetes_version`,
`assistant_image`, `registry_username`), pousser l'image de l'assistant dans le registre (`docker buildx build --platform linux/amd64 ... --push`),
et écrire le jeton de déploiement GitLab dans `.work/registry-token` (une ligne, droits 600, ignoré par Git). Le jeton ne doit jamais être
collé dans un message, un ticket ou un fichier versionné.

Règle de nommage : toutes nos ressources portent le préfixe `g13-p5` (groupe 13, projet 5) et les étiquettes `Project`, `Group`, `Owner`.
**Nous ne touchons à rien qui n'a pas ce préfixe ni ces étiquettes** : le compte peut être partagé avec d'autres étudiants.

## Ce qui a été observé

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
| 26.10 | Droits d'écriture après leur retour | destruction réussie de 60 ressources (EKS, VPC, EC2, groupes de sécurité, IAM, S3) ; nœuds 8 min 9 s, passerelle Internet 6 min 39 s, cluster 3 min 40 s |
| 27.10 | Vérification préalable (`aws-preflight.sh`) | 49 contrôles ok, 0 échec, 3 à surveiller, 41 s ; `tofu validate` sur les deux environnements et plan de 70 ressources sans erreur |
| 27.10 | Premier déploiement complet avec l'hôte EC2 | **19 min 12 s** au total : infrastructure ≈ 14 min 45 s, pile ≈ 3 min 20 s, hôte déjà prêt à l'attente. Hôte : `G13-OK` 179 s après son démarrage ; image de l'assistant tirée du registre HEFR depuis AWS en 137 s, image d'Open WebUI (1,46 Go) en 174 s. 40 pods `Running`, 10 volumes liés, Open WebUI répond |
| 27.10 | Chaîne complète depuis AWS | question « Comment va mon cluster ? » posée dans Open WebUI : l'assistant appelle Bedrock avec le rôle de l'instance, interroge Mimir et Loki par les NodePort et répond (réponse partiellement fausse : voir [plan de tests](tests/plan-de-tests.md), F1) |
| 27.10 | Données dans Mimir (requêtes directes par `port-forward`) | `sum(kube_pod_status_phase{phase="Running"})` = 40 (= kubectl) ; `count(up == 1)` = 8 ; 62 séries `container_memory_working_set_bytes` ; **0** série `node_memory_MemAvailable_bytes` et **0** série `cluster:namespace:pods:running` |

## Ce qui n'est pas vérifié

- **L'hôte EC2** : constaté le 27.10 qu'il démarre, lit ses secrets dans SSM, tire les images depuis le registre HEFR et ghcr.io, et que l'assistant appelle Bedrock avec le rôle de l'instance. Pas encore vérifiés : l'accès par session SSM (agent, droits `ssm:StartSession`, `session-manager-plugin`), la mémoire réelle, laquelle des deux recherches de nœud a trouvé l'adresse.
- Alloy et Grafana sont installés sur AWS depuis le 27.10 (pods `Running`) ; l'écriture de Mimir et Loki dans S3 n'a pas été constatée (aucun objet relu dans les buckets).
- Les durées de déploiement de Mimir et Loki avec Helm ; l'état des composants Helm marqués échoués (ils ont dépassé leur délai avant la classe de stockage).
- Les correctifs du 27.10 (vérification préalable, attente des pods par le script, `aws-redo-host`, ciblage de `aws-allow-ip`, masquage des secrets) :
  syntaxe contrôlée avec `shellcheck`, logique essayée contre de faux outils, **jamais exécutés contre AWS**. Pas non plus : le plan `tofu` avec les modifications de `eks.tf` et `host.tf`.
- L'image d'Open WebUI (1,46 Go) a mis 12 min 44 s à se télécharger sur Kind (19.10) : sur l'hôte EC2, durée inconnue ; `aws-up` attend jusqu'à 25 min.
- La mémoire réelle de l'hôte (`t3.small`, 2 Gio : Open WebUI occupait ≈ 0,7 Gio sur Kind, le reste n'est pas mesuré).
- Crédits AWS restants et responsabilité de la facture (page des crédits : 0 $ de crédits visibles ; les étudiants ont été informés oralement que l'école paie ; le courriel du 15.10 ne le dit pas).
- Les trois cas d'usage avec le vrai modèle : voir le [plan de tests](tests/plan-de-tests.md), aucun résultat encore. Les refus (hors sujet, actions, secrets) ont été essayés en local le 25.10, un essai par formulation.

## Pièges rencontrés (utile à qui reprend)

- Les nœuds EKS exigent une limite de sauts des métadonnées de 2 : sinon les pods n'atteignent pas les droits du nœud (EBS) ; même chose pour les conteneurs de l'hôte.
- EKS n'a pas de classe de stockage utilisable par défaut : sans elle, les volumes restent en attente et Helm dépasse son délai.
- Sur macOS, `sed` retient la sortie dans un tube : utiliser `sed -l` ; `caffeinate -i` évite la mise en veille pendant les attentes longues.
- Les sorties de commandes AWS peuvent contenir le numéro de compte, y compris dans les messages d'erreur : le masquer avant de coller quoi que ce soit.
- Une destruction doit supprimer les volumes (PVC) **avant** le cluster, sinon des disques restent facturés.
- L'API du cluster n'accepte que les adresses de `admin_cidrs` : après un changement de lieu, `kubectl` affiche « TLS handshake timeout » (constaté le 26.10). `aws-down` et `aws-allow-ip` ajoutent l'adresse actuelle seuls.
- `tofu destroy` exige que toutes les variables obligatoires soient définies, y compris `registry_token` : `aws-down` en fournit une valeur sans effet (constaté le 26.10, avant correction).
- Les sorties de `tofu` pour Helm affichent les clés d'accès S3 en clair : `aws-up`, `aws-down` et `aws-allow-ip` passent désormais tout par un filtre (`mask_output`).
- L'index d'étiquettes d'AWS garde des ressources supprimées pendant plusieurs minutes : l'audit vérifie auprès d'EC2 avant de les compter.
- Un apply peut proposer de remplacer les nœuds si AWS publie une nouvelle image : `use_latest_ami_release_version = false` (lu dans le code du module 21.29.0, effet non encore constaté).

## Coûts (prix à la demande, `us-east-1`, lus avec l'API de prix AWS le 22.10.2026)

| Poste | Prix |
|---|---|
| `m5.xlarge` (4 vCPU, 16 Gio) | 0,192 $/h par nœud, soit 0,384 $/h pour 2 nœuds |
| Plan de contrôle EKS (support standard) | 0,10 $/h (page de prix AWS) |
| Mistral Large 3 (Bedrock) | 0,50 $ en entrée et 1,50 $ en sortie par million de tokens |

Nœuds et plan de contrôle : **0,484 $/h**, soit environ 11,60 $ par jour si le cluster est oublié. L'instance EC2, les volumes et le trafic ne sont
**pas encore chiffrés**. Règle du groupe : sessions courtes et planifiées, destruction et audit après chaque session.

## Switch Cloud : abandonné

Abandonné après le retour du professeur du 22.10.2026. Les fichiers `envs/switch/`, `scripts/sck-*` et `scripts/scs3-*` et les cibles `make switch-*`
sont conservés à titre de référence : ils n'ont **jamais été exécutés** et ne sont plus maintenus.
