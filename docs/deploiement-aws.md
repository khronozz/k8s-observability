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

## Ce qui n'est pas vérifié

- **L'hôte EC2** n'a jamais été lancé : accès au registre depuis AWS, lecture des secrets dans SSM, appel de Bedrock depuis le rôle de l'instance
  (autorisation sur le modèle), versions de Docker Compose et d'Open WebUI choisies, étiquette qui permet de retrouver les nœuds EKS, accès par session SSM.
- Alloy et Grafana n'ont jamais été installés sur AWS ; l'écriture de Mimir et Loki dans S3 n'a pas été constatée (pods `Running`, mais aucune donnée relue).
- Les durées de déploiement de Mimir et Loki avec Helm ; l'état des composants Helm marqués échoués (ils ont dépassé leur délai avant la classe de stockage).
- La mémoire réelle de l'hôte (`t3.small`, 2 Gio : Open WebUI occupait ≈ 0,7 Gio sur Kind, le reste n'est pas mesuré).
- Crédits AWS restants et responsabilité de la facture (page des crédits : 0 $ de crédits visibles ; les étudiants ont été informés oralement que l'école paie ; le courriel du 15.10 ne le dit pas).
- Les trois cas d'usage avec le vrai modèle : voir le [plan de tests](tests/plan-de-tests.md), aucun résultat encore. Les refus (hors sujet, actions, secrets) ont été essayés en local le 25.10, un essai par formulation.

## Pièges rencontrés (utile à qui reprend)

- Les nœuds EKS exigent une limite de sauts des métadonnées de 2 : sinon les pods n'atteignent pas les droits du nœud (EBS) ; même chose pour les conteneurs de l'hôte.
- EKS n'a pas de classe de stockage utilisable par défaut : sans elle, les volumes restent en attente et Helm dépasse son délai.
- Sur macOS, `sed` retient la sortie dans un tube : utiliser `sed -l` ; `caffeinate -i` évite la mise en veille pendant les attentes longues.
- Les sorties de commandes AWS peuvent contenir le numéro de compte, y compris dans les messages d'erreur : le masquer avant de coller quoi que ce soit.
- Une destruction doit supprimer les volumes (PVC) **avant** le cluster, sinon des disques restent facturés.

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
