# Travailler à plusieurs

- **Ne jamais commiter de secret** (mot de passe, clé S3, kubeconfig, état OpenTofu). Le `.gitignore` les exclut ; lancez `make check-secrets` avant chaque commit et relisez `git diff --staged`.
- Une mise à jour se fait avec `git pull` : les fichiers locaux ignorés (secrets, état, clés S3, clone de Garage) sont conservés. **Ne supprimez pas le dossier pour le recréer** : vous perdriez ces fichiers et l'état d'OpenTofu du cluster.
- Une découverte, un échec, un résultat de test : ouvrez un ticket avec le modèle « Test_decouverte » (date, environnement, commande, sortie **sans secret**, niveau de preuve). On distingue toujours *observé*, *lu dans la documentation ou le code*, *non testé* et *hypothèse*.
- **Une branche par membre** (`dev/<prénom>`, par exemple `dev/nicolas`), créée depuis `main`. Seul son propriétaire y pousse ; les autres la récupèrent pour tester
  (`git fetch`, puis `git checkout dev/<prénom>`) et proposent leurs changements par leur propre branche ou par une merge request. Ramenez régulièrement `main` dans votre branche (`git merge main`).
- **`main` est protégée** : personne n'y pousse directement, tout passe par une merge request. Les membres du groupe ont le rôle Maintainer et peuvent donc fusionner : aucune relecture n'est imposée par la forge.
- Modifications : mettez à jour le guide (`docs/guide-src/`) et le `CHANGELOG.md` avec le changement.
