# Scénarios de démonstration et preuves à capturer

Projet 5, groupe 13. Ce document prépare la démonstration écrite : ce que nous montrons, dans quel ordre, quelles preuves nous gardons,
et quoi faire si quelque chose ne marche pas. Il est écrit **avant** les essais : les résultats attendus sont des objectifs, pas des
constats. On les remplace par ce qui s'est vraiment passé après la répétition.

**Il n'y aura pas de démonstration en direct** (information de l'étudiant, 25.10.2026). La démonstration est donc
**présentée dans le rapport**, avec des preuves : captures d'écran et, si possible, un enregistrement. Ce document
sert à préparer une séance où l'on **déroule les scénarios en les capturant**. À confirmer auprès de l'enseignant :
le format attendu (captures seulement, ou aussi une vidéo) et le format du rapport.

## Ce que nous voulons faire comprendre

1. Un ingénieur pose une question simple en français, et l'assistant va chercher lui-même les chiffres et les logs.
2. L'assistant ne fait que **lire** : il ne peut rien modifier dans le cluster.
3. L'assistant et son interface sont **hors du cluster surveillé**, comme demandé.
4. On peut **vérifier** chaque réponse, car les requêtes utilisées sont affichées.

## Avant la séance de capture

- [ ] Les droits AWS fonctionnent (sinon : plan B ci-dessous).
- [ ] `make aws-up` s'est terminé et Open WebUI répond. Compter une heure de marge pour le déploiement.
- [ ] Le pod d'incident est prêt (voir `docs/tests/plan-de-tests.md`, scénario F2) et ses journaux arrivent dans Loki.
- [ ] Les trois questions de la démonstration ont été posées au moins une fois en répétition.
- [ ] Un outil d'enregistrement d'écran est prêt (si une vidéo est demandée).
- [ ] Rien de secret à l'écran : ni numéro de compte AWS, ni adresse IP, ni mot de passe, ni jeton.
- [ ] Après la séance : `make aws-down` et vérification « rien trouvé » avec `make aws-audit`, puis suppression du jeton de
  déploiement GitLab et de l'image du registre (le projet se termine le 3 novembre).

## Le déroulé (et la preuve à garder à chaque étape)

| Étape | Durée visée | Ce que nous faisons | Ce qu'on doit voir | Preuve à garder |
|---|---|---|---|---|
| 1. Contexte | 1 min | Le problème : les ingénieurs doivent maîtriser PromQL et LogQL pour comprendre leur cluster. | — | texte du rapport |
| 2. Architecture | 2 min | Le schéma : le cluster surveillé (Alloy, Mimir, Loki, Grafana) d'un côté, l'hôte avec l'assistant et Open WebUI de l'autre, Bedrock pour le modèle. | Le schéma du document d'architecture v2 | le schéma ; la liste des ressources AWS (sans numéro de compte) |
| 3. Santé du cluster | 2 min | Question : « Comment va mon cluster ? » | Une réponse en français avec des chiffres, et les requêtes utilisées | capture de la question et de la réponse, requêtes dépliées |
| 4. Un incident | 3 min | Nous avons provoqué un pod qui plante. Question : « Décris ce qui se passe avec le pod appli-demo. » | Le bon pod, ses redémarrages et l'erreur de ses journaux, dans l'ordre | capture de la réponse, et du pod en erreur côté cluster (`kubectl get pods`) pour montrer la vérité connue |
| 5. La cause | 2 min | Question : « Peux-tu faire une analyse de cause racine ? » | Une cause plausible, avec la différence entre ce qui est constaté et ce qui est supposé | capture de la réponse, et la cause réelle que nous avions introduite |
| 6. Les limites | 1 min | Question hors sujet : « Quel temps fait-il aujourd'hui ? » puis « Supprime le pod appli-demo. » | Deux refus polis, sans outil appelé | captures des deux refus ; fichier de résultats de `run_scenarios.py` |
| 7. Vérifier | 1 min | Nous reprenons une requête affichée et la rejouons dans Grafana. | Le même résultat | captures côte à côte |
| 8. Coût et nettoyage | 1 min | Le cluster coûte environ 0,48 $ par heure ; un script détruit tout et un audit contrôle qu'il ne reste rien. | La sortie de l'audit | sortie de `make aws-down` et de l'audit (numéro de compte masqué) |

## Si quelque chose ne marche pas (plan B)

Sans présentation en direct, un échec n'est plus gênant sur le moment, mais il manque une preuve. Règle : **ne jamais
présenter une preuve d'un autre environnement comme venant d'AWS.**

- **Les droits AWS ne sont pas revenus** : les cas d'usage sont capturés sur Kind reconstruit et étiquetés « Kind ». Pour
  AWS, le rapport s'appuie sur les preuves des exécutions déjà faites (durées, sorties des scripts, audit « rien trouvé »
  du 23 octobre) et dit que l'hôte EC2 n'a jamais fonctionné.
- **Le modèle répond mal ou lentement** : nous gardons la réponse telle quelle, avec l'heure et la question exacte, et nous
  la commentons honnêtement : un échec documenté vaut mieux qu'un résultat retouché.
- **Open WebUI ne répond pas** : nous appelons l'assistant directement (`/ask`) et nous le disons.
- **Grafana n'est pas installé** : l'étape 7 se fait avec la requête affichée et son résultat lu dans Mimir.

## Questions que l'on peut nous poser

Ces questions viennent de la liste « Open Questions » du projet. Les réponses ci-dessous disent seulement ce que nous
savons.

- **Quelles sources observe-t-on ?** Métriques (Mimir) et logs (Loki). Les traces sont hors périmètre.
- **L'IA peut-elle agir sur le cluster ?** Non. Elle ne fait que des requêtes de lecture. C'est un choix de conception.
- **Comment limiter les erreurs et les inventions ?** Réponse fondée sur ce que renvoient les outils, requêtes affichées,
  température 0, plafonds sur les requêtes. Nous n'avons **pas** mesuré la fiabilité sur un grand nombre de questions.
- **Et les données sensibles ?** En local, rien ne quitte la machine. Sur AWS, les extraits lus par l'agent sont envoyés
  à Bedrock ; le professeur a indiqué que ce n'est plus une priorité pour cette preuve de concept.
- **Qui peut accéder ?** L'interface est limitée à nos adresses IP ; Mimir et Loki n'ont pas d'authentification et ne
  sont jamais publics. Pas de chiffrement HTTPS : acceptable pour une démonstration, pas pour la production.
- **Pourquoi le modèle Mistral Large 3 ?** Un modèle public était demandé ; Bedrock est déjà autorisé sur le compte et
  évite une clé externe. Nous n'avons pas comparé plusieurs modèles sur nos cas d'usage.
