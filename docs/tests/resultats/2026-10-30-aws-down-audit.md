# Résultat : destruction de l'environnement AWS et audit (30.10.2026)

Source : sortie de `make aws-down` (journal local `.work/down-2026-10-30.log`, non publié) et deux exécutions de `make aws-audit`. Lancé par Nicolas après la vidéo de démonstration, entre 15h45 et 16h05 (heure de Zurich). Première exécution de `aws-down` dans sa version corrigée (jeton défini à la destruction, sortie filtrée par `mask_output`).

## Ce qui a été observé

| Étape | Résultat |
|---|---|
| 1/4 Pile Helm | 4 releases détruites sans erreur : Grafana 9 s, k8s-monitoring 37 s, Loki 13 s, Mimir 31 s |
| 2/4 Volumes persistants | 10 demandes de volume (PVC) supprimées dans les espaces `loki` et `mimir` ; le script a attendu la suppression des volumes persistants (9 lignes « condition met » dans le journal) ; l'audit final ne trouve plus aucun volume du projet |
| 3/4 Infrastructure | `Destroy complete! Resources: 72 destroyed.` Instance de l'hôte 31 s, groupe de nœuds 8 min 19 s, passerelle Internet 6 min 51 s, cluster EKS 2 min 48 s |
| 4/4 Audit (dans `aws-down`) | **Échec à tort** : une ligne, `ec2 : instance/i-07436d36ca9377ace`, alors que la section « Instances EC2 (hors terminées) » disait « rien » |

## Défaut de l'audit trouvé et corrigé

La fonction `exists_ec2` de `scripts/aws-audit.sh` écartait les entrées périmées de l'index d'étiquettes pour les groupes de sécurité, volumes, VPC et autres, mais pas pour les instances. EC2 garde environ une heure une instance terminée visible : l'audit la comptait comme restante et `aws-down` sortait en erreur. Vérifié : `aws ec2 describe-instances --instance-ids i-07436d36ca9377ace` donnait l'état `terminated`. Correctif : une instance à l'état `terminated` est traitée comme périmée ; `running` et `shutting-down` restent comptées. Testé avec un faux `aws` (trois états), puis exécuté pour de vrai (ci-dessous). Les 8 autres entrées périmées (règles de groupe de sécurité, un volume) étaient déjà écartées correctement.

## Audit final (extrait, à partir de « Clusters EKS »)

```text
== Clusters EKS
   rien
== Instances EC2 (hors terminées) portant l'étiquette Group=13
   rien
== Volumes EBS (étiquette du projet, créés par Kubernetes, ou non attachés)
   rien
   (info, tous propriétaires confondus) volumes non attachés dans la région : 2
== Équilibreurs de charge (classiques et v2) dont le nom ou le VPC rappelle le projet
   rien
== Passerelles NAT et adresses Elastic IP
   rien
   rien
== VPC et groupes de sécurité du projet
   rien
   rien
== Buckets S3 préfixés g13-p5
   rien
== Utilisateurs IAM préfixés g13-p5
   rien
== Rôles IAM préfixés g13-p5 (cluster, nœuds, instance)
   rien

AUDIT : rien trouvé (selon les contrôles ci-dessus).
```

## Ce que cela ne prouve pas

- L'audit ne cherche que ce qui porte notre préfixe `g13-p5` ou nos étiquettes : il ne dit rien du reste du compte. Les 2 volumes non attachés sont comptés « tous propriétaires confondus » ; ils ne portent pas l'étiquette du projet (la ligne « volumes du projet » dit « rien »), mais leur propriétaire n'a pas été vérifié.
- Les paramètres SSM et les buckets S3 du projet sont absents de l'audit parce qu'ils ont été détruits avec le reste (lignes `Destruction complete` du journal) ; l'audit les cherche (buckets, utilisateurs et rôles IAM : « rien »). Les paramètres SSM ne sont pas inclus dans l'audit.
- Aucune facture n'a été consultée : le coût réel n'est pas relevé.

## Limite du masquage constatée

La sortie de `aws-down` (plan de destruction de Helm) affiche en clair le mot de passe administrateur de Grafana, les adresses IP autorisées de l'équipe et l'adresse publique de l'hôte. `mask_output` ne masque que les clés d'accès, les secrets d'accès S3, les numéros de compte (12 chiffres) et les motifs `AKIA…`. Le cluster n'existe plus, donc ce mot de passe ne donne plus accès à rien, mais le journal ne doit jamais être publié ni collé dans une capture.
