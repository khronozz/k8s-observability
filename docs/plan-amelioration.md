# Plan d'amélioration

Phase 3 du sujet : relire notre propre système, nommer ses limites et classer les corrections. Chaque ligne s'appuie sur
un test ou une mesure réalisés sur AWS les 27 et 28 octobre 2026 (détail dans
[`tests/plan-de-tests.md`](tests/plan-de-tests.md)). Ce qui n'est pas établi est écrit comme tel.

Rappel de l'état : l'assistant testé est la version 0.5.10. Nous l'avons figée pour terminer les tests ; les corrections
ci-dessous ne sont donc **pas faites**, sauf celles de la section « Déjà corrigé ».

## 1. Corrections proposées, par priorité

Priorité 1 = elles peuvent faire croire à quelque chose de faux. Priorité 2 = elles réduisent l'utilité. Priorité 3 =
confort ou finition.

| N° | Problème observé | Preuve | Correction proposée | Priorité | Effort |
|---|---|---|---|---|---|
| 1 | **L'assistant conclut à une absence ou à un zéro à partir d'un résultat vide.** « Aucun pod Running sur ce nœud » (le nœud en héberge 25) ; « 0 requête en échec » (aucune métrique de requêtes n'existe pour la passerelle). | F5, nœud essai 4 ; F5, service essai 1 | Quand une requête ne renvoie aucune série, l'outil doit répondre « aucune série : la métrique ou l'étiquette n'existe peut-être pas », et non un résultat vide. Ajouter un test automatique. | 1 | Petit |
| 2 | **Des résultats sont plafonnés sans que l'assistant le sache.** Les logs sont limités à 8 lignes (`describe_pod`) ou 15 (`search_logs`) et l'assistant présente ces nombres comme des totaux (« PIRATE apparaît 15 fois », « 8 lignes identiques »). Les résultats d'outils sont coupés à 3500 caractères. | S3 ; F2 ; F5 | Faire écrire par l'outil « N lignes affichées sur au moins N (plafond) » et compter le vrai total avec `count_over_time`. | 1 | Petit à moyen |
| 3 | **Fausses alertes sur l'état d'un nœud.** Un nœud sain avait été annoncé « non prêt, problème critique ». Cause : résultat coupé à 3500 caractères. | F5, nœud essai 1 | Corrigé en partie en 0.5.10 (voir section 2). Reste : un outil dédié qui calcule l'état en Python (comme `describe_pod`) au lieu de laisser le modèle lire 12 séries. | 1 | Moyen |
| 4 | **Durées mal lues** : « BackOff actif depuis 3 min » alors que le pod échoue depuis plus de 24 h. L'outil renvoie « dernière occurrence il y a N min ». | F2 essais 8 à 10 ; F3 essai 7 | Renommer le champ (`derniere_occurrence_il_y_a_min`) et ajouter l'ancienneté de l'incident calculée en Python. | 2 | Petit |
| 5 | **Les alertes ne sont pas couvertes**, alors que la fiche du projet demande de corréler « alerts, metrics and logs ». L'assistant n'a aucun outil d'alertes. | Fiche du projet (page 20) ; relevé S3 du 28.10 : `mimir-alertmanager` et `mimir-ruler` vides | Soit activer Mimir ruler et Alertmanager avec une ou deux règles, et ajouter un outil en lecture seule ; soit présenter ce manque comme une limite assumée. | 2 | Moyen à grand |
| 6 | **Les journaux d'un conteneur qui plante en boucle sont mal collectés.** `appli-demo` : 5 lignes pour environ 75 exécutions en 6 h. Cause **inconnue** : l'hypothèse « conteneur trop court » a été testée et n'est pas confirmée. | F2, limite constatée | Regarder les journaux d'Alloy et ses réglages de lecture ; rejouer avec un conteneur qui reste vivant (`appli-injection`, une ligne toutes les 10 s : les lignes les plus récentes étaient présentes, mais le total collecté n'a pas été compté). | 2 | Moyen |
| 7 | **La passerelle Mimir n'est pas supervisée** : les seules cibles de `up` sont 4 jobs × 2 nœuds (kubelet, cadvisor, kube-state-metrics, resources). Aucune cible Mimir ou Loki dans `up`, et aucune métrique de requêtes HTTP pour la passerelle (recherche `nginx`, `http_request`, `gateway` : 0 résultat). Les autres métriques de Mimir et Loki n'ont pas été recherchées. | F4 ; F5, service | Ajouter les cibles Mimir et Loki à Alloy. | 2 | Moyen |
| 8 | **L'assistant décrit un pod quand on lui demande un service**, sans regarder l'objet Service (ports, endpoints). | F5, service essai 1 | Outils `describe_service` et `describe_node`, sur le modèle de `describe_pod`. | 2 | Moyen |
| 9 | **Composants Mimir en un seul exemplaire** (`distributor`, `query-frontend`, `gateway`). La suppression du `query-frontend` a coupé la lecture pendant environ 55 s ; l'assistant a signalé la panne sans inventer. | R1 | Deux exemplaires pour `query-frontend` et `gateway` ; mesurer à nouveau. | 3 | Petit |
| 10 | **L'assistant renvoie l'utilisateur vers ses propres outils** (`search_logs`, `describe_pod("...")`), alors que le prompt l'interdit : 4 réponses sur 9 en F2 (essais 5 à 10) et F3 (essais 6 à 8). | F2 essais 7 et 8 ; F3 essais 6 et 8 | Ajouter ce motif au garde-fou existant (même mécanisme que `UNVERIFIED_CLAIM`). | 3 | Petit |
| 11 | **Une question mixte (« une blague, puis le nombre de pods ») est traitée sans refus explicite de la blague.** | S7 (25.10 et 27.10) | Consigne de refus partiel dans le prompt, puis retest. | 3 | Petit |
| 12 | **Message d'erreur brut quand Bedrock refuse** : l'exception AWS (`ValidationException ...`) s'affiche telle quelle. | R3 (variante) | Remplacer par une phrase claire et garder l'exception dans les journaux. | 3 | Petit |
| 13 | **Réponses trop longues** (570 jetons pour une salutation, alors que le prompt vise 120 mots) et capacités annoncées non vérifiées. | S6 | Raccourcir la consigne de présentation et la limiter aux outils réels. | 3 | Petit |
| 14 | **Les limites annoncées par l'assistant sont fausses** : « 15 à 60 minutes » alors que le code fixe 24 h et 200 lignes. | S5 | Lire ces valeurs dans la configuration au lieu de les écrire à la main dans le prompt. | 3 | Petit |

## 2. Déjà corrigé pendant le projet

Ces corrections viennent de défauts trouvés en test (numéros de version dans [`../CHANGELOG.md`](../CHANGELOG.md)) :

- 0.5.1 à 0.5.2 : métrique inventée et « 0 pod » ; exclusion des journaux de nos propres requêtes dans Loki.
- 0.5.4 : garde-fou qui relance une fois quand l'assistant affirme sans avoir utilisé d'outil.
- 0.5.5 à 0.5.9 : outil `describe_pod` (état, redémarrages, journaux, événements) et chronologie des événements recopiée telle quelle.
- 0.5.10 : les étiquettes identiques sur toutes les séries d'un résultat sont écrites une seule fois (4169 caractères ramenés à 1426 sur la requête qui échouait). Le mécanisme est vérifié sur l'hôte ; son effet sur la lecture par le modèle n'est **pas** retesté sur la requête à 4 conditions.

## 3. Sécurité et exploitation (limites de ce prototype)

| Limite | Ce que nous savons |
|---|---|
| Open WebUI est servi en HTTP (pas de TLS) sur le port 3000 | Observé (adresse `http://...:3000`). Accès réduit aux adresses IP déclarées dans `admin_cidrs`. Pour une vraie mise en service : TLS (équilibreur ou proxy) et authentification centralisée. |
| Mimir et Loki n'ont pas d'authentification | Écrit dans le [README](../README.md). Ils ne sont joignables que depuis l'hôte (règles de groupe de sécurité), jamais depuis Internet. |
| Liste d'adresses autorisées gérée à la main | Changement d'adresse IP = `make aws-allow-ip`. |
| Un hôte unique de 2 Gio de mémoire | Mesuré le 28.10 : 489 Mio disponibles sur 1909, au repos. Plusieurs utilisateurs en même temps : non mesuré. |
| Coût | Le cluster EKS tourne en continu pendant les tests (environ 0,48 $/h pour le cluster seul, estimation non vérifiée sur la facture). |
| Résultats des tests | Peu d'essais par scénario ; les traces ne sont pas lues pour tous. Les chiffres montrent ce qui arrive, pas la fiabilité en général. |

## 4. Ce que nous ne ferons pas

Pas de remédiation automatique : l'assistant reste en lecture seule (c'est une décision, pas un oubli ; elle répond à la
question 3 des « Open Questions » de la fiche). Pas de traces (« traces » est en rouge dans le schéma de la fiche).
